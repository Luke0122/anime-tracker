'use strict';

const fs = require('fs');
const path = require('path');

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.webm', '.ts', '.mov', '.wmv', '.flv', '.rmvb', '.m4v']);
const METADATA_BRACKET_RE = /\[[^\]]*(?:1080|720|2160|4k|8k|x264|x265|h264|h265|hevc|avc|10bit|8bit|yuv|flac|aac|opus|dts|hi10p|chs|cht|big5|gb|简|繁|中字|字幕|v\d)[^\]]*\]/gi;

function walk(dir, depth, out) {
  if (depth > 5) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, depth + 1, out);
    else if (e.isFile() && VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
}

function findEpisode(cleaned) {
  const candidates = [];
  const collect = (re, prefer) => {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = r.exec(cleaned)) !== null) {
      const num = parseInt(m[1], 10);
      candidates.push({ num, index: m.index, length: m[0].length, prefer });
      if (m[0].length === 0) r.lastIndex += 1;
    }
  };
  collect(/\[(?:ep|e|第)?\s*0*(\d{1,3})(?:v\d)?\s*(?:话|話|集)?\]/i, 3);
  collect(/第\s*0*(\d{1,3})\s*[话話集]/, 2);
  collect(/\b(?:ep|e)\s*0*(\d{1,3})\b/i, 1);
  collect(/(?:^|[ _.-])0*(\d{1,3})(?:v\d)?(?=[ _.-]|$)/, 0);
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.prefer - a.prefer) || (b.index - a.index));
  return candidates[0];
}

function parseFilename(name) {
  const base = String(name || '').replace(/\.[^.]+$/, '');
  const cleaned = base.replace(METADATA_BRACKET_RE, '');
  const ep = findEpisode(cleaned);
  if (!ep) return null;

  let rest = cleaned.slice(0, ep.index) + cleaned.slice(ep.index + ep.length);
  rest = rest.replace(/\s+/g, ' ').trim();

  const groups = [];
  let m;
  const gr = /\[([^\]]+)\]/g;
  while ((m = gr.exec(rest)) !== null) groups.push(m[1].trim());
  let title = rest
    .replace(/\[[^\]]*\]/g, '')
    .replace(/^[\s\-_.[\]\uFF08\uFF09()]+|[\s\-_.[\]\uFF08\uFF09()]+$/g, '')
    .trim();
  if (!title && groups.length) {
    groups.sort((a, b) => b.length - a.length);
    title = groups[0];
  }
  title = title.replace(/^[\s\-_.[\]\uFF08\uFF09()]+|[\s\-_.[\]\uFF08\uFF09()]+$/g, '').trim();
  if (!title) return null;
  return { title, episode: ep.num };
}

function scanFolder(folder) {
  if (!folder || !fs.existsSync(folder)) throw new Error('文件夹不存在: ' + folder);
  if (!fs.statSync(folder).isDirectory()) throw new Error('不是文件夹: ' + folder);
  const files = [];
  walk(folder, 0, files);
  const groups = new Map();
  let skipped = 0;
  for (const file of files) {
    const p = parseFilename(path.basename(file));
    if (!p) { skipped += 1; continue; }
    if (!groups.has(p.title)) groups.set(p.title, { title: p.title, files: [] });
    groups.get(p.title).files.push({ file, episode: p.episode });
  }
  const result = Array.from(groups.values()).map((g) => {
    const eps = g.files.map((f) => f.episode);
    return {
      title: g.title,
      maxEpisode: Math.max(...eps),
      minEpisode: Math.min(...eps),
      count: g.files.length,
      files: g.files.slice().sort((a, b) => a.episode - b.episode),
    };
  });
  result.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  return { folder, groups: result, skipped, totalFiles: files.length };
}

function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\-_.!?'"：:；;，,。.、（）()【】\[\]「」『』！？·]/g, '');
}

function matchExisting(animeList, title) {
  const nt = normalizeTitle(title);
  if (!nt) return null;
  let contain = null;
  for (const a of animeList) {
    const na = normalizeTitle(a.title);
    if (!na) continue;
    if (na === nt) return a;
    const shorter = Math.min(na.length, nt.length);
    const diff = Math.abs(na.length - nt.length);
    if (shorter >= 3 && diff <= 2 && (na.includes(nt) || nt.includes(na)) && !contain) contain = a;
  }
  return contain;
}

module.exports = { scanFolder, parseFilename, normalizeTitle, matchExisting };


