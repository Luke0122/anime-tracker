'use strict';

const fs = require('fs');
const path = require('path');
const docxParser = require('./docxParser');
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

function seasonJsonPath(baseDir, seasonKey) {
  return path.join(baseDir, 'scripts', '_runtime', 'data', `bangumi_${seasonKey.replace('-', '')}.json`);
}

function yucJsonPath(baseDir, seasonKey) {
  return path.join(baseDir, 'scripts', '_runtime', 'data', `yuc_${seasonKey.replace('-', '')}.json`);
}

function findDocxInFolder(folder) {
  if (!folder || !fs.existsSync(folder)) return null;
  let files = [];
  try { files = fs.readdirSync(folder); } catch (_) { return null; }
  files = files.filter((f) => /新番信息.*\.docx$/i.test(f)).sort();
  if (!files.length) return null;
  return path.join(folder, files[files.length - 1]);
}

function findSeasonJsonInFolder(folder) {
  if (!folder || !fs.existsSync(folder)) return null;
  let files = [];
  try { files = fs.readdirSync(folder); } catch (_) { return null; }
  files = files.filter((f) => /新番信息.*\.json$/i.test(f)).sort();
  if (!files.length) return null;
  return path.join(folder, files[files.length - 1]);
}

function weekdayNum(wd) {
  if (!wd) return null;
  if (typeof wd === 'number') return wd;
  return WEEKDAY_TO_NUM[String(wd).trim()] ?? null;
}

function normalizeBangumiItem(x) {
  if (!x) return null;
  const wd = x.weekday || null;
  return {
    title: x.title || x.name_cn || x.name || '',
    weekday: wd,
    weekdayNum: weekdayNum(wd),
    time: x.time || null,
    eps: typeof x.eps === 'number' ? x.eps : x.eps ? parseInt(String(x.eps).replace(/[^0-9]/g, ''), 10) : null,
    studio: x.studio || null,
    rating: typeof x.rating === 'number' ? x.rating : x.rating != null ? parseFloat(x.rating) : null,
    original: x.original === true || x.original === '原创',
    bgmId: x.bgm_id || null,
    bgmUrl: x.bgm_url || null,
    coverUrl: x.image_url || null,
    name: x.name || null,
    nameCn: x.name_cn || null,
    date: x.date || null,
    source: x.source || null,
    director: x.director || null,
    script: x.script || null,
    cast: x.cast || null,
    tags: x.tags || null,
    summary: x.summary || null,
  };
}

function loadSeasonList(baseDir, seasonKey) {
  if (!SEASON_RE.test(String(seasonKey || ''))) throw new Error('无效季度: ' + seasonKey);
  const errors = [];

  const jp = seasonJsonPath(baseDir, seasonKey);
  if (fs.existsSync(jp)) {
    try {
      const data = JSON.parse(fs.readFileSync(jp, 'utf8'));
      const items = (data.items || []).map(normalizeBangumiItem).filter((x) => x && x.title);
      if (items.length) return { source: 'bangumi-json', items, meta: { fetchedAt: data.fetched_at || null } };
    } catch (e) { errors.push('bangumi JSON 解析失败: ' + e.message); }
  }

  const season = discoverSeasons(baseDir).find((s) => s.key === seasonKey);
  const seasonJson = season ? findSeasonJsonInFolder(season.folder) : null;
  if (seasonJson) {
    try {
      const data = JSON.parse(fs.readFileSync(seasonJson, 'utf8'));
      const items = (data.items || []).map(normalizeBangumiItem).filter((x) => x && x.title);
      if (items.length) return { source: 'season-json', items, meta: { json: seasonJson } };
    } catch (e) { errors.push('\u5b63\u5ea6 JSON \u89e3\u6790\u5931\u8d25: ' + e.message); }
  }
  const docx = season ? findDocxInFolder(season.folder) : null;
  if (docx) {
    try {
      const items = docxParser.parseNewAnimeDocx(docx);
      if (items.length) return { source: 'docx', items, meta: { docx } };
    } catch (e) { errors.push('docx 解析失败: ' + e.message); }
  }

  const yp = yucJsonPath(baseDir, seasonKey);
  if (fs.existsSync(yp)) {
    try {
      const data = JSON.parse(fs.readFileSync(yp, 'utf8'));
      const items = (data.shows || []).map((x) => ({
        title: x.title || '',
        weekday: x.weekday || null,
        weekdayNum: weekdayNum(x.weekday),
        time: x.time || null,
        eps: x.eps ? parseInt(String(x.eps).replace(/[^0-9]/g, ''), 10) : null,
        region: x.region || null,
      })).filter((x) => x.title);
      if (items.length) return { source: 'yuc-json', items, meta: {} };
    } catch (e) { errors.push('yuc JSON 解析失败: ' + e.message); }
  }

  return { source: 'none', items: [], errors };
}

module.exports = {
  discoverSeasons,
  loadSeasonList,
  currentSeasonKey,
  keyToLabel,
  findSeasonJsonInFolder,
};
