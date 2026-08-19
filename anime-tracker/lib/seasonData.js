'use strict';

const fs = require('fs');
const path = require('path');
const yucLive = require('./yucLive');
const { WEEKDAY_TO_NUM } = require('./labels');

const SEASON_DIR_RE = /^(\d{4})年(\d{1,2})月$/;
const SEASON_RE = /^(\d{4})-(01|04|07|10)$/;

function keyFromParts(year, monthNum) {
  const m = String(monthNum).padStart(2, '0');
  if (!['01', '04', '07', '10'].includes(m)) return null;
  return `${year}-${m}`;
}

function keyToLabel(key) {
  const m = String(key || '').match(SEASON_RE);
  if (!m) return String(key || '');
  return `${m[1]}年${Number(m[2])}月`;
}

function currentSeasonKey() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) * 3 + 1;
  return `${d.getFullYear()}-${String(q).padStart(2, '0')}`;
}

function discoverSeasons(baseDir) {
  if (!baseDir || !fs.existsSync(baseDir)) return [];
  let names = [];
  try { names = fs.readdirSync(baseDir, { withFileTypes: true }); } catch (_) { return []; }
  const out = [];
  for (const name of names) {
    if (!name.isDirectory()) continue;
    const m = name.name.match(SEASON_DIR_RE);
    if (!m) continue;
    const key = keyFromParts(m[1], Number(m[2]));
    if (!key) continue;
    out.push({
      key,
      year: m[1],
      month: String(Number(m[2])).padStart(2, '0'),
      label: `${m[1]}年${Number(m[2])}月`,
      folder: path.join(baseDir, name.name),
    });
  }
  out.sort((a, b) => b.key.localeCompare(a.key));
  return out;
}

// 内置的 yuc.wiki 历史季度目录（2019-10 至 2026-07，随应用打包）
const BUNDLED_CATALOG = path.join(__dirname, '..', 'data', 'yuc-catalog.json');
let bundledCatalogCache = null;
function getBundledCatalog() {
  if (bundledCatalogCache) return bundledCatalogCache;
  try {
    bundledCatalogCache = JSON.parse(fs.readFileSync(BUNDLED_CATALOG, 'utf8'));
  } catch (_) {
    bundledCatalogCache = { seasons: {} };
  }
  return bundledCatalogCache;
}

function weekdayNum(wd) {
  if (!wd) return null;
  if (typeof wd === 'number') return wd;
  return WEEKDAY_TO_NUM[String(wd).trim()] ?? null;
}

// 与 yucLive.clean 一致：还原实体、去掉 <br>、压缩空白，保证内置目录标题与在线抓取一致
function cleanTitle(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, '')
    .replace(/\s+/g, '');
}

function catalogItems(seasonData) {
  if (!seasonData || !Array.isArray(seasonData.shows)) return [];
  return seasonData.shows.map((x) => ({
    title: cleanTitle(x.title),
    weekday: x.weekday || null,
    weekdayNum: weekdayNum(x.weekday),
    time: x.time || null,
    eps: x.eps ? parseInt(String(x.eps).replace(/[^0-9]/g, ''), 10) : null,
    region: x.region || null,
    coverUrl: x.cover
      ? `cover://local/${path.basename(x.cover)}`
      : (x.coverUrl || null),
  })).filter((x) => x.title);
}

// 当季新番只来自 yuc.wiki：在线抓取优先，失败时回退内置 yuc.wiki 目录（不读 bangumi JSON / Word 信息）
function loadSeasonList(baseDir, seasonKey) {
  if (!SEASON_RE.test(String(seasonKey || ''))) throw new Error('无效季度: ' + seasonKey);
  const errors = [];
  const catalog = getBundledCatalog();
  const seasonData = catalog.seasons && catalog.seasons[seasonKey.replace('-', '')];
  const items = catalogItems(seasonData);
  if (items.length) return { source: 'bundled-catalog', items, meta: {} };
  return { source: 'none', items: [], errors };
}

function loadAllShows(baseDir) {
  const out = [];
  const catalog = getBundledCatalog();
  const seasonKeys = Object.keys(catalog.seasons || {}).sort();
  for (const yyyymm of seasonKeys) {
    const key = `${yyyymm.slice(0, 4)}-${yyyymm.slice(4)}`;
    const items = catalogItems(catalog.seasons[yyyymm]);
    for (const it of items) out.push({ ...it, season: key });
  }
  return { source: 'all', items: out };
}

// 每季度从 yuc.wiki 实时获取（带缓存）；失败时回退到内置 yuc.wiki 目录
async function loadSeasonListLive(baseDir, seasonKey, cacheDir) {
  if (!SEASON_RE.test(String(seasonKey || ''))) throw new Error('无效季度: ' + seasonKey);
  const yyyymm = String(seasonKey).replace('-', '');
  try {
    const shows = await yucLive.fetchSeason(yyyymm, cacheDir);
    if (shows && shows.length) {
      const items = shows.map((x) => ({
        title: x.title || '',
        weekday: x.weekday || null,
        weekdayNum: weekdayNum(x.weekday),
        time: x.time || null,
        eps: x.eps ? parseInt(String(x.eps).replace(/[^0-9]/g, ''), 10) : null,
        region: x.region || null,
        coverUrl: x.coverUrl || null,
      })).filter((x) => x.title);
      if (items.length) return { source: 'yuc-live', items, meta: {} };
    }
  } catch (_) { /* 走离线兜底 */ }
  return loadSeasonList(baseDir, seasonKey);
}

module.exports = {
  discoverSeasons,
  loadSeasonList,
  loadSeasonListLive,
  loadAllShows,
  currentSeasonKey,
  keyToLabel,
};