'use strict';

const fs = require('fs');
const path = require('path');

// 优先使用 Electron 的 Chromium 网络栈（跟随系统代理）；非 Electron 环境（测试）用 Node fetch
let netFetch = null;
try {
  const { net } = require('electron');
  if (net && typeof net.fetch === 'function') netFetch = net.fetch.bind(net);
} catch (_) { /* 非 Electron 环境 */ }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AnimeAutoBot/1.0';

// 解析器/数据结构版本：解析逻辑变化后递增，使旧缓存自动作废并重新抓取
const CACHE_VERSION = 2;

function clean(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, '');
}

function parseCard(text) {
  const shows = [];
  const wdRe = /<table class="date_"[^>]*>[\s\S]*?<td class="date2?">\s*([^<]+?)\s*<\/td>/g;
  const wms = [];
  let m;
  while ((m = wdRe.exec(text)) !== null) wms.push(m);
  for (let idx = 0; idx < wms.length; idx++) {
    const wm = wms[idx];
    const weekday = wm[1].trim().split(/\s*\(/)[0];
    const sectionEnd = idx + 1 < wms.length ? wms[idx + 1].index : text.length;
    const section = text.slice(wm.index + wm[0].length, sectionEnd);
    const covers = [];
    const covRe = /<img[^>]*width="120px"[^>]*data-src="([^"]+)"/g;
    let cm;
    while ((cm = covRe.exec(section)) !== null) covers.push(cm[1]);
    const tableRe = /<table width="120px">([\s\S]*?)<\/table>/g;
    let sm;
    let cursor = 0;
    let ci = 0;
    while ((sm = tableRe.exec(section)) !== null) {
      const tableHtml = sm[1];
      const titleRe = /<td[^>]*class="date_title[^"]*"[^>]*>([\s\S]*?)<\/td>/;
      const tm = titleRe.exec(tableHtml);
      if (!tm) continue;
      const title = clean(tm[1].replace(/<br\s*\/?>/gi, ''));
      if (!title) continue;
      const seg = section.slice(cursor, sm.index);
      const times = [];
      let t;
      const timeRe = /(\d{1,2}:\d{2})~\s*/g;
      while ((t = timeRe.exec(seg)) !== null) times.push(t[1]);
      const timeStr = times.length ? times[times.length - 1] : '';
      let eps = '';
      const em = /\((?:(全\d+话))\)|P2=\s*(\d+)\s*话/.exec(seg);
      if (em) eps = em[1] || em[2] || '';
      else {
        const et = /全\s*(\d+)\s*话/.exec(tableHtml);
        if (et) eps = '全' + et[1] + '话';
      }
      const am = /<p class="area">([^<]+)<\/p>/.exec(tableHtml);
      const region = am ? am[1].trim() : '';
      const cover = covers[ci] || '';
      ci += 1;
      shows.push({ title, weekday, time: timeStr, eps, region, coverUrl: cover });
      cursor = sm.index + sm[0].length;
    }
  }
  return shows;
}

function parseOld(text) {
  const titles = [];
  const tr = /<p class="title_cn">([^<]+)<\/p>/g;
  let m;
  while ((m = tr.exec(text)) !== null) titles.push(clean(m[1]));
  const covers = [];
  const cr = /<img[^>]*width="180px"[^>]*data-src="([^"]+)"/g;
  let c;
  while ((c = cr.exec(text)) !== null) covers.push(c[1]);
  const seen = new Set();
  const out = [];
  let ci = 0;
  for (const t of titles) {
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push({ title: t, weekday: '', time: '', eps: '', region: '', coverUrl: covers[ci] || '' });
      ci += 1;
    }
  }
  return out;
}

// yuc.wiki 会把已结束的「首周先行放送」卡片用 HTML 注释 <!-- ... --> 隐藏；
// 解析前先剔除注释，避免把隐藏卡片当成真实新番（否则会出现同一部番重复两条）。
function stripComments(text) {
  return String(text).replace(/<!--[\s\S]*?-->/g, '');
}

function parsePage(text) {
  const html = stripComments(text);
  if (html.includes('width="120px"')) return parseCard(html);
  if (html.includes('title_cn')) return parseOld(html);
  return [];
}

async function fetchText(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const fn = netFetch || global.fetch;
    const res = await fn(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function cacheUsable(cached) {
  return !!cached
    && cached.version === CACHE_VERSION
    && cached.shows && Array.isArray(cached.shows) && cached.shows.length;
}

// 抓取某季度 yuc.wiki 数据；带缓存（默认 24 小时），网络失败时回退过期缓存。
// 缓存带 CACHE_VERSION：解析逻辑变更后旧缓存直接作废，重新抓取。
async function fetchSeason(yyyymm, cacheDir, ttlMs = 24 * 3600 * 1000) {
  if (cacheDir) {
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) { /* ignore */ }
  }
  const cacheFile = cacheDir ? path.join(cacheDir, yyyymm + '.json') : null;
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      if (cacheUsable(cached) && age < ttlMs) {
        return cached.shows;
      }
    } catch (_) { /* 坏缓存忽略 */ }
  }
  try {
    const html = await fetchText(`https://yuc.wiki/${yyyymm}/`);
    const shows = parsePage(html);
    if (shows && shows.length) {
      if (cacheFile) {
        try {
          fs.writeFileSync(cacheFile, JSON.stringify({
            yyyymm,
            version: CACHE_VERSION,
            fetchedAt: new Date().toISOString(),
            shows,
          }, null, 1), 'utf8');
        } catch (_) { /* ignore */ }
      }
      return shows;
    }
  } catch (_) { /* 网络失败走兜底 */ }
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cacheUsable(cached)) return cached.shows;
    } catch (_) { /* ignore */ }
  }
  return [];
}

module.exports = { parsePage, fetchSeason, fetchText, CACHE_VERSION };