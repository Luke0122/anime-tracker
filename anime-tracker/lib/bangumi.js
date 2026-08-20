'use strict';

const https = require('https');

const UA = 'anime-tracker/0.1.0 (personal desktop tracker)';
const SEARCH_URL = 'https://api.bgm.tv/v0/search/subjects';
const DETAIL_URL = 'https://api.bgm.tv/v0/subjects';
const LEGACY_SEARCH = (kw) => `https://api.bgm.tv/search/subject/${encodeURIComponent(kw)}?type=2&responseGroup=medium`;

// 优先使用 Electron 的 Chromium 网络栈（跟随系统代理，与浏览器行为一致）；
// 非 Electron 环境（如单元测试）回退到 Node 自带 fetch。
let netFetch = null;
try {
  const { net } = require('electron');
  if (net && typeof net.fetch === 'function') netFetch = net.fetch.bind(net);
} catch (_) { /* 非 Electron 环境 */ }

async function doFetch(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const fn = netFetch || global.fetch;
    const res = await fn(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options, timeoutMs = 15000) {
  const res = await doFetch(url, options, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

function httpGetToIp(ip, hostname, path, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: ip,
      servername: hostname,
      path,
      method: 'GET',
      headers: { Host: hostname, 'User-Agent': UA, 'Accept': 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('响应解析失败')); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function resolveViaDoh(hostname) {
  const providers = [
    `https://223.5.5.5/resolve?name=${hostname}&type=A`,
    `https://dns.google/resolve?name=${hostname}&type=A`,
  ];
  for (const url of providers) {
    try {
      const res = await doFetch(url, { headers: { 'User-Agent': UA } }, 8000);
      const j = await res.json();
      const ans = (j.Answer || []).find((a) => a.type === 1 && a.data);
      if (ans) return ans.data;
    } catch (_) { /* try next */ }
  }
  return null;
}

function itemImage(s) {
  return (s.images && (s.images.large || s.images.common || s.images.medium)) || null;
}

// 从 Bangumi infobox 提取制作公司（动画制作 / 制作 / スタジオ）
function studioFromInfobox(infobox) {
  const rows = Array.isArray(infobox) ? infobox : [];
  for (const row of rows) {
    if (!/动画制作|制作|スタジオ/.test(String(row.key || ''))) continue;
    const v = row.value;
    if (v == null) continue;
    let text = '';
    if (typeof v === 'string') text = v;
    else if (Array.isArray(v)) text = v.map((x) => (x && typeof x === 'object' ? x.v || '' : String(x))).filter(Boolean).join('、');
    else text = String(v);
    const clean = String(text).replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
    if (clean) return clean;
  }
  return null;
}

function normalizeItems(items) {
  return (items || []).map((s) => ({
    bgmId: s.id,
    name: s.name || '',
    nameCn: s.name_cn || '',
    title: s.name_cn || s.name || '',
    date: s.date || null,
    rating: s.rating && typeof s.rating === 'object' ? s.rating.score : (typeof s.score === 'number' ? s.score : null),
    rank: s.rating && typeof s.rating === 'object' ? s.rating.rank : (typeof s.rank === 'number' ? s.rank : null),
    imageUrl: itemImage(s),
  }));
}

function normalizeDetail(s) {
  return {
    bgmId: s.id,
    name: s.name || '',
    nameCn: s.name_cn || '',
    title: s.name_cn || s.name || '',
    date: s.date || null,
    totalEpisodes: s.total_episodes != null ? Number(s.total_episodes) : null,
    eps: Array.isArray(s.eps) ? s.eps.length : null,
    rating: s.rating && typeof s.rating === 'object' ? s.rating.score : null,
    rank: s.rating && typeof s.rating === 'object' ? s.rating.rank : null,
    imageUrl: itemImage(s),
    summary: s.summary || null,
    studio: studioFromInfobox(s.infobox),
    tags: Array.isArray(s.tags) ? s.tags.map((t) => (t && t.name) || '').filter(Boolean).join('、') : null,
    airdates: Array.isArray(s.eps)
      ? s.eps.map((e) => (e && e.airdate ? String(e.airdate).slice(0, 10) : '')).filter(Boolean).sort()
      : null,
  };
}

async function search(keyword) {
  const kw = String(keyword || '').trim();
  if (!kw) throw new Error('请输入番名关键词');

  try {
    const data = await fetchJson(SEARCH_URL, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ keyword: kw, filter: { type: [2] }, limit: 12, offset: 0 }),
    });
    if (data && Array.isArray(data.data)) return normalizeItems(data.data);
  } catch (_) { /* fall through */ }

  try {
    const data = await fetchJson(LEGACY_SEARCH(kw), {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    });
    if (data && Array.isArray(data.result)) return normalizeItems(data.result);
  } catch (_) { /* fall through */ }

  try {
    const ip = await resolveViaDoh('api.bgm.tv');
    if (ip) {
      const data = await httpGetToIp(ip, 'api.bgm.tv', `/search/subject/${encodeURIComponent(kw)}?type=2&responseGroup=medium`);
      if (data && Array.isArray(data.result)) return normalizeItems(data.result);
    }
  } catch (_) { /* fall through */ }

  throw new Error('网络连接失败（请检查网络或代理，或稍后重试）');
}

async function detail(id) {
  try {
    const s = await fetchJson(`${DETAIL_URL}/${encodeURIComponent(id)}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    });
    if (s && s.id) return normalizeDetail(s);
  } catch (_) { /* fall through */ }

  try {
    const ip = await resolveViaDoh('api.bgm.tv');
    if (ip) {
      const s = await httpGetToIp(ip, 'api.bgm.tv', `/v0/subjects/${encodeURIComponent(id)}`);
      if (s && s.id) return normalizeDetail(s);
    }
  } catch (_) { /* fall through */ }

  throw new Error('网络连接失败（请检查网络或代理，或稍后重试）');
}

// Bangumi 收藏状态映射（v0 type -> 本地状态）
const COLLECTION_TYPE_MAP = { 1: 'plan', 2: 'completed', 3: 'watching', 4: 'on_hold', 5: 'dropped' };

function normalizeCollection(row, sub, status) {
  const eps = sub.total_episodes != null && Number(sub.total_episodes) > 0
    ? Number(sub.total_episodes)
    : (sub.eps && Number(sub.eps) > 0 ? Number(sub.eps) : null);
  return {
    bgmId: sub.id || null,
    title: sub.name_cn || sub.name || '',
    nameCn: sub.name_cn || '',
    date: sub.date || null,
    status,
    episode: Number(row.ep_status) || 0,
    totalEpisodes: eps,
    imageUrl: itemImage(sub),
  };
}

// 拉取 Bangumi 收藏：公开接口，无需令牌（参考 Pochan 的实现）
// GET /v0/users/{用户名或UID}/collections?subject_type=2&limit=50&offset=...
async function collections(uid) {
  const user = String(uid || '').trim();
  if (!user) throw new Error('请输入 Bangumi UID');
  const headers = { 'User-Agent': UA, 'Accept': 'application/json' };
  const out = [];
  let offset = 0;
  const limit = 50;
  const maxItems = 500;
  while (offset < maxItems) {
    let data;
    try {
      data = await fetchJson(
        `https://api.bgm.tv/v0/users/${encodeURIComponent(user)}/collections?subject_type=2&limit=${limit}&offset=${offset}`,
        { headers },
      );
    } catch (_) { break; }
    const rows = (data && data.data) || [];
    for (const row of rows) {
      const sub = row.subject || {};
      if (!sub.id) continue;
      out.push(normalizeCollection(row, sub, COLLECTION_TYPE_MAP[row.type] || 'watching'));
    }
    if (!rows.length || !data.total || out.length >= data.total || rows.length < limit) break;
    offset += limit;
  }
  return out;
}

module.exports = { search, detail, collections };