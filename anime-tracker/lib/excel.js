'use strict';

const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const { STATUS_LABELS, DAY_LABELS } = require('./labels');

/* ================= 导入（兼容新旧两种格式） ================= */

function cellStr(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  return String(v).trim();
}

function statusFromLabel(label) {
  for (const [k, v] of Object.entries(STATUS_LABELS)) {
    if (v === label) return k;
  }
  return 'plan';
}

function normalizeSeasonParts(year, quarter) {
  const y = String(year || '').trim();
  const q = String(quarter || '').trim().replace(/月/g, '');
  const m = Number(q);
  if (!/^\d{4}$/.test(y) || !Number.isFinite(m)) return null;
  const mm = String(m).padStart(2, '0');
  if (!['01', '04', '07', '10'].includes(mm)) return null;
  return `${y}-${mm}`;
}

function parseOldLayout(rows) {
  const items = [];
  const seen = new Set();
  let year = null;
  let season = null;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const c0 = cellStr(row[0]);
    const c1 = cellStr(row[1]);
    const ym = c0.match(/^(\d{4})年?$/);
    if (ym) { year = ym[1]; continue; }
    const isQuarterRow = !!c1 && /^\d{1,2}月$/.test(c1);
    if (isQuarterRow) {
      const qm = c1.match(/^(\d{1,2})月$/);
      const m = String(Number(qm[1])).padStart(2, '0');
      if (['01', '04', '07', '10'].includes(m)) season = `${year || '0000'}-${m}`;
    }
    const startCol = isQuarterRow ? 2 : 1;
    for (let i = startCol; i < row.length; i++) {
      const t = cellStr(row[i]);
      if (!t) continue;
      if (/^(\d{4})年?$/.test(t) || /^\d{1,2}月$/.test(t)) continue;
      if (!year) continue;
      const key = `${season || ''}|${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ title: t, season: season || `${year}-01` });
    }
  }
  return items;
}

function parseFlatLayout(rows, headerIdx, header) {
  const col = (name) => header.indexOf(name);
  const cTitle = col('番名');
  const cYear = col('年份');
  const cQuarter = col('季度');
  const cStatus = col('状态');
  const cEp = col('当前集数');
  const cTotal = col('总集数');
  const cRating = col('评分');
  if (cTitle < 0) return [];
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const title = cellStr(r[cTitle]);
    if (!title) continue;
    const item = { title };
    if (cYear >= 0 || cQuarter >= 0) {
      const season = normalizeSeasonParts(r[cYear], r[cQuarter]);
      if (season) item.season = season;
    }
    if (cStatus >= 0) item.status = statusFromLabel(cellStr(r[cStatus]));
    if (cEp >= 0 && r[cEp] != null && cellStr(r[cEp]) !== '') item.episode = parseInt(r[cEp], 10) || 0;
    if (cTotal >= 0 && r[cTotal] != null && cellStr(r[cTotal]) !== '') item.totalEpisodes = parseInt(r[cTotal], 10) || null;
    if (cRating >= 0 && r[cRating] != null && cellStr(r[cRating]) !== '') item.rating = parseInt(r[cRating], 10) || null;
    out.push(item);
  }
  return out;
}

function flatHeaderOf(rows) {
  const idx = rows.findIndex((r) => Array.isArray(r) && r.some((c) => cellStr(c) === '番名'));
  if (idx < 0) return null;
  return { idx, header: (rows[idx] || []).map((c) => cellStr(c)) };
}

function importExcel(filePath) {
  const wb = XLSX.readFile(filePath);
  let best = null;
  let bestScore = -1;
  const known = ['番名', '年份', '季度', '状态', '当前集数', '总集数', '评分'];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    let rows = [];
    try { rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }); } catch (_) { continue; }
    if (!rows.length) continue;
    const fh = flatHeaderOf(rows);
    if (!fh) continue;
    const score = known.filter((k) => fh.header.includes(k)).length;
    if (score > bestScore) {
      bestScore = score;
      best = { rows, headerIdx: fh.idx, header: fh.header };
    }
  }
  if (best) return parseFlatLayout(best.rows, best.headerIdx, best.header);
  const all = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    try {
      all.push(...XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }));
    } catch (_) { /* ignore */ }
  }
  return parseOldLayout(all);
}

/* ================= 导出（样式化） ================= */

const C = {
  header: 'FF3D8BFF',
  headerText: 'FFFFFFFF',
  titleText: 'FF3A3547',
  subText: 'FF8A8598',
  section: 'FFEAF2FF',
  sectionText: 'FF2B5CB8',
  border: 'FFD6E4F8',
  alt: 'FFF5F9FF',
  accent: 'FF2F6FD6',
};
const STATUS_COLORS = {
  watching: 'FF2F9E63',
  completed: 'FF3D6FD6',
  on_hold: 'FFD98B2B',
  dropped: 'FF8B8B93',
  plan: 'FF3D8BFF',
};

function baseBorder() {
  return {
    top: { style: 'thin', color: { argb: C.border } },
    left: { style: 'thin', color: { argb: C.border } },
    bottom: { style: 'thin', color: { argb: C.border } },
    right: { style: 'thin', color: { argb: C.border } },
  };
}

function setCell(cell, value, opts = {}) {
  cell.value = value;
  cell.font = {
    name: '微软雅黑',
    size: opts.size || 11,
    bold: !!opts.bold,
    color: { argb: opts.color || C.titleText },
  };
  cell.alignment = {
    vertical: 'middle',
    horizontal: opts.align || 'left',
    wrapText: !!opts.wrap,
  };
  if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
  if (opts.border !== false) cell.border = baseBorder();
}

function statsFor(list) {
  const total = list.length;
  const watching = list.filter((a) => a.status === 'watching').length;
  const completed = list.filter((a) => a.status === 'completed').length;
  const eps = list.reduce((s, a) => s + (a.episode || 0), 0);
  const rated = list.filter((a) => a.rating != null);
  const avg = rated.length ? rated.reduce((s, a) => s + a.rating, 0) / rated.length : null;
  return {
    total, watching, completed, eps, avg,
    rate: total ? Math.round((completed / total) * 100) : 0,
    ratedCount: rated.length,
  };
}

function progressPct(a) {
  if (!a.totalEpisodes) return null;
  return Math.min(100, Math.round(((a.episode || 0) / a.totalEpisodes) * 100));
}

function sortedAnime(anime) {
  return (anime || []).slice().sort((a, b) => {
    const sk = String(a.season || '').localeCompare(String(b.season || ''));
    return sk !== 0 ? sk : String(a.title || '').localeCompare(String(b.title || ''), 'zh');
  });
}

function groupBySeason(anime) {
  const map = {};
  for (const a of anime) {
    if (!map[a.season]) map[a.season] = [];
    map[a.season].push(a);
  }
  return map;
}

function seasonLabel(key) {
  const m = String(key || '').match(/^(\d{4})-(01|04|07|10)$/);
  return m ? `${m[1]}年${Number(m[2])}月` : String(key || '');
}

async function exportExcel(filePath, anime) {
  const wb = new ExcelJS.Workbook();
  const all = sortedAnime(anime);
  const stats = statsFor(all);
  const groups = groupBySeason(all);
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  /* ---- Sheet 1: 总览 ---- */
  const ws1 = wb.addWorksheet('总览');
  ws1.mergeCells('A1:F1');
  setCell(ws1.getCell('A1'), '我的追番记录', { size: 17, bold: true, align: 'center', fill: C.section, color: C.sectionText });
  ws1.getRow(1).height = 34;
  ws1.mergeCells('A2:F2');
  setCell(ws1.getCell('A2'), `按季度记录追番与进度 · 生成于 ${dateStr} · 共 ${stats.total} 部`, { size: 10, align: 'center', color: C.subText, border: false });

  const pairs = [
    ['追番总数', String(stats.total)],
    ['在看', String(stats.watching)],
    ['看完', String(stats.completed)],
    ['累计集数', String(stats.eps)],
    ['完成率', `${stats.rate}%`],
    ['平均评分', stats.avg != null ? stats.avg.toFixed(1) : '—'],
  ];
  const labelRow = 4;
  const valueRow = 5;
  pairs.forEach(([label, value], i) => {
    const lc = ws1.getCell(String.fromCharCode(65 + i * 2) + labelRow);
    const vc = ws1.getCell(String.fromCharCode(65 + i * 2 + 1) + valueRow);
    setCell(lc, label, { size: 11, align: 'center', fill: C.section, color: C.sectionText, bold: true });
    setCell(vc, value, { size: 15, bold: true, align: 'center', color: C.accent });
    ws1.getColumn(i * 2 + 1).width = 13;
    ws1.getColumn(i * 2 + 2).width = 14;
  });
  ws1.getRow(labelRow).height = 24;
  ws1.getRow(valueRow).height = 30;

  const qKeys = Object.keys(groups).sort();
  const summaryRow = 7;
  const headers = ['季度', '番剧数', '在看', '看完', '累计集数', '完成率', '平均评分'];
  headers.forEach((h, i) => {
    const c = ws1.getCell(String.fromCharCode(65 + i) + summaryRow);
    setCell(c, h, { size: 11, bold: true, align: 'center', fill: C.header, color: C.headerText });
  });
  if (qKeys.length) {
    qKeys.forEach((k, i) => {
      const st = statsFor(groups[k]);
      const row = summaryRow + 1 + i;
      const vals = [seasonLabel(k), String(st.total), String(st.watching), String(st.completed), String(st.eps), `${st.rate}%`, st.avg != null ? st.avg.toFixed(1) : '—'];
      vals.forEach((v, j) => {
        setCell(ws1.getCell(String.fromCharCode(65 + j) + row), v, {
          size: 11, align: j === 0 ? 'left' : 'center',
          fill: i % 2 === 1 ? C.alt : undefined,
        });
      });
    });
  } else {
    ws1.mergeCells(`A${summaryRow + 1}:G${summaryRow + 1}`);
    setCell(ws1.getCell(`A${summaryRow + 1}`), '暂无记录', { align: 'center', color: C.subText });
  }
  ws1.views = [{ state: 'frozen', ySplit: 6 }];

  /* ---- Sheet 2: 季度明细 ---- */
  const ws2 = wb.addWorksheet('季度明细');
  const heads2 = ['番名', '状态', '当前集数', '总集数', '进度', '更新日', '评分', '短评'];
  let r = 1;
  if (!qKeys.length) {
    setCell(ws2.getCell('A1'), '暂无记录', { align: 'center', color: C.subText });
  }
  for (const k of qKeys) {
    const list = groups[k];
    ws2.mergeCells(`A${r}:H${r}`);
    setCell(ws2.getCell(`A${r}`), `${seasonLabel(k)}（${list.length} 部）`, { size: 12, bold: true, fill: C.section, color: C.sectionText });
    ws2.getRow(r).height = 22;
    r += 1;
    heads2.forEach((h, i) => {
      setCell(ws2.getCell(String.fromCharCode(65 + i) + r), h, { size: 11, bold: true, align: 'center', fill: C.header, color: C.headerText });
    });
    r += 1;
    list.forEach((a, i) => {
      const pct = progressPct(a);
      const vals = [
        a.title || '',
        STATUS_LABELS[a.status] || '想看',
        a.episode || 0,
        a.totalEpisodes ?? '—',
        pct != null ? `${pct}%` : '—',
        a.updateDay != null ? DAY_LABELS[a.updateDay] : '',
        a.rating != null ? String(a.rating) : '',
        a.comment || '',
      ];
      vals.forEach((v, j) => {
        const c = ws2.getCell(String.fromCharCode(65 + j) + r);
        setCell(c, v, {
          size: 11,
          align: j === 0 || j === 7 ? 'left' : 'center',
          fill: i % 2 === 1 ? C.alt : undefined,
        });
        if (j === 1) c.font.color = { argb: STATUS_COLORS[a.status] || C.plan };
      });
      r += 1;
    });
    r += 1;
  }
  ws2.columns = [
    { width: 38 }, { width: 9 }, { width: 11 }, { width: 10 },
    { width: 9 }, { width: 10 }, { width: 8 }, { width: 42 },
  ];

  /* ---- Sheet 3: 全部记录（可筛选） ---- */
  const ws3 = wb.addWorksheet('全部记录');
  const heads3 = ['年份', '季度', '番名', '状态', '当前集数', '总集数', '进度', '更新日', '评分', '短评'];
  heads3.forEach((h, i) => {
    setCell(ws3.getCell(String.fromCharCode(65 + i) + 1), h, { size: 11, bold: true, align: 'center', fill: C.header, color: C.headerText });
  });
  ws3.getRow(1).height = 22;
  all.forEach((a, i) => {
    const m = String(a.season || '').match(/^(\d{4})-(01|04|07|10)$/);
    if (!m) return;
    const pct = progressPct(a);
    const row = i + 2;
    const vals = [
      Number(m[1]),
      `${Number(m[2])}月`,
      a.title || '',
      STATUS_LABELS[a.status] || '想看',
      a.episode || 0,
      a.totalEpisodes ?? '',
      pct,
      a.updateDay != null ? DAY_LABELS[a.updateDay] : '',
      a.rating ?? '',
      a.comment || '',
    ];
    vals.forEach((v, j) => {
      const c = ws3.getCell(String.fromCharCode(65 + j) + row);
      setCell(c, v, {
        size: 11,
        align: j === 2 || j === 9 ? 'left' : 'center',
        fill: i % 2 === 1 ? C.alt : undefined,
      });
      if (j === 3) c.font.color = { argb: STATUS_COLORS[a.status] || C.plan };
      if (j === 6) c.numFmt = '0"%"';
    });
  });
  ws3.columns = [
    { width: 8 }, { width: 8 }, { width: 36 }, { width: 9 },
    { width: 11 }, { width: 10 }, { width: 9 }, { width: 9 },
    { width: 8 }, { width: 42 },
  ];
  const last = all.length + 1;
  if (last > 1) {
    ws3.autoFilter = { from: 'A1', to: `J${last}` };
    ws3.addConditionalFormatting({
      ref: `G2:G${last}`,
      rules: [{
        type: 'dataBar',
        minLength: 0,
        maxLength: 100,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FF3D8BFF' },
      }],
    });
  }
  ws3.views = [{ state: 'frozen', ySplit: 1 }];

  await wb.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = { importExcel, exportExcel };