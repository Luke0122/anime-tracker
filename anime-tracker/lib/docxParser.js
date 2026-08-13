'use strict';

const fs = require('fs');
const AdmZip = require('adm-zip');

const WD_TBL_RE = /<w:tbl[^>]*>[\s\S]*?<\/w:tbl>/g;
const WD_TR_RE = /<w:tr[^>]*>[\s\S]*?<\/w:tr>/g;
const WD_TC_RE = /<w:tc[^>]*>[\s\S]*?<\/w:tc>/g;
const WD_T_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

function xmlUnescape(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function cellText(tcXml) {
  const parts = [];
  let m;
  const re = new RegExp(WD_T_RE.source, 'g');
  while ((m = re.exec(tcXml)) !== null) parts.push(xmlUnescape(m[1]));
  return parts.join('').trim();
}

function parseTable(tblXml) {
  const rows = [];
  let m;
  const trRe = new RegExp(WD_TR_RE.source, 'g');
  while ((m = trRe.exec(tblXml)) !== null) {
    const cells = [];
    const tcRe = new RegExp(WD_TC_RE.source, 'g');
    let c;
    while ((c = tcRe.exec(m[0])) !== null) cells.push(cellText(c[0]));
    rows.push(cells);
  }
  return rows;
}

function parseDocx(filePath) {
  if (!fs.existsSync(filePath)) throw new Error('docx 不存在: ' + filePath);
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('docx 中缺少 word/document.xml');
  const xml = entry.getData().toString('utf8');
  const tables = [];
  let m;
  const tblRe = new RegExp(WD_TBL_RE.source, 'g');
  while ((m = tblRe.exec(xml)) !== null) tables.push(parseTable(m[0]));
  return tables;
}

function parseEps(s) {
  if (!s) return null;
  const n = parseInt(String(s).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseRating(s) {
  if (!s || s === '—' || s === '-') return null;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function extractMainTable(tables) {
  for (const t of tables) {
    if (t.length < 2) continue;
    const head = (t[0] || []).map((s) => String(s || '')).join('|');
    if (head.includes('标题') && head.includes('星期')) return t;
  }
  return null;
}

function parseNewAnimeDocx(filePath) {
  const tables = parseDocx(filePath);
  const main = extractMainTable(tables);
  if (!main) throw new Error('未在 docx 中找到新番一览表');
  const items = [];
  for (const row of main.slice(1)) {
    const cells = row.map((s) => String(s || '').trim());
    const title = cells[1] || '';
    if (!title) continue;
    const original = cells[5];
    items.push({
      title,
      weekday: cells[2] || null,
      time: cells[3] || null,
      eps: parseEps(cells[4]),
      original: original === '原创' ? true : original === '改编' ? false : null,
      studio: cells[6] && cells[6] !== '—' ? cells[6] : null,
      rating: parseRating(cells[7]),
    });
  }
  return items;
}

module.exports = { parseNewAnimeDocx, parseDocx, extractMainTable };



