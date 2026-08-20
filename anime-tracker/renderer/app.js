'use strict';

/* ---------- 常量 ---------- */
const STATUS_META = {
  watching: { label: '在看', cls: 'st-watching' },
  completed: { label: '看完', cls: 'st-completed' },
  on_hold: { label: '搁置', cls: 'st-hold' },
  dropped: { label: '弃番', cls: 'st-dropped' },
  plan: { label: '想看', cls: 'st-plan' },
};
const DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const state = {
  anime: [],
  seasons: [],
  view: null,
  search: '',
  status: '',
  settings: {},
  dataPath: '',
  backupCount: 0,
  sort: 'season',
};

const modal = {
  type: 'add',
  editId: null,
  seasonKey: null,
  seasonItems: [],
  seasonSource: '',
  selected: {},
  pendingImport: [],
  scanFolder: '',
};

/* ---------- 工具 ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// 读取 CSS 主题变量（供 canvas 图表使用，深浅色自适应）
const cssVar = (name, fb) => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fb;
  } catch (_) { return fb; }
};

const $ = (sel, root = document) => root.querySelector(sel);

function currentSeasonKey() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) * 3 + 1;
  return `${d.getFullYear()}-${String(q).padStart(2, '0')}`;
}

function seasonLabel(key) {
  const m = String(key || '').match(/^(\d{4})-(01|04|07|10)$/);
  return m ? `${m[1]}年${Number(m[2])}月` : String(key || '');
}

async function call(promise) {
  const r = await promise;
  if (!r || !r.ok) {
    toast((r && r.error) || '操作失败', 'error');
    throw new Error((r && r.error) || 'failed');
  }
  return r.data;
}

function toast(msg, type = 'info') {
  const box = document.createElement('div');
  box.className = `toast ${type}`;
  box.textContent = msg;
  $('#toast-root').appendChild(box);
  setTimeout(() => box.remove(), 3800);
}

function attachImgFallback(root) {
  root.querySelectorAll('img.cover, img.card-cover').forEach((img) => {
    img.addEventListener('error', () => img.remove());
  });
}

/* ---------- 新季度数据自动检测 ---------- */
const KNOWN_SEASONS_KEY = 'knownSeasons';

function loadKnownSeasons() {
  try { return JSON.parse(localStorage.getItem(KNOWN_SEASONS_KEY) || '[]'); } catch (_) { return []; }
}

function saveKnownSeasons(keys) {
  try { localStorage.setItem(KNOWN_SEASONS_KEY, JSON.stringify(keys)); } catch (_) { /* ignore */ }
}

function detectNewSeasons(seasons) {
  const raw = localStorage.getItem(KNOWN_SEASONS_KEY);
  const known = raw === null ? null : loadKnownSeasons();
  const keys = (seasons || []).map((s) => s.key);
  if (known === null) {
    saveKnownSeasons(keys);
    return;
  }
  const knownSet = new Set(known);
  const fresh = keys.filter((k) => !knownSet.has(k));
  if (!fresh.length) return;
  for (const k of fresh) {
    const s = seasons.find((x) => x.key === k);
    toast(`检测到新的季度数据：${s ? s.label : seasonLabel(k)}（可在「添加番剧 → 当季新番」选用）`, 'success');
  }
  saveKnownSeasons(keys);
}

/* ---------- 初始化 ---------- */
async function init() {
  bindGlobal();
  await refresh();
  const autoCheck = async () => {
    lastAutoCheck = Date.now();
    try {
      const seasons = await call(api.listSeasons());
      detectNewSeasons(seasons);
      state.seasons = seasons;
      renderSidebar();
      const bgmCfg = state.settings.bangumi || {};
      if (bgmCfg.autoSync && bgmCfg.uid) doBangumiSync(true);
    } catch (_) { /* \u5ffd\u7565 */ }
  };
  let lastAutoCheck = Date.now();
  setInterval(autoCheck, 10 * 60 * 1000);
  window.addEventListener('focus', () => {
    if (Date.now() - lastAutoCheck > 60 * 1000) autoCheck();
  });
  setTimeout(() => { autoCheck(); }, 6000);
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const repaintStats = () => { if (state.view === 'stats') render(); };
    if (mq.addEventListener) mq.addEventListener('change', repaintStats);
    else if (mq.addListener) mq.addListener(repaintStats);
  }
}

async function refresh() {
  const d = await call(api.getData());
  state.anime = d.anime || [];
  state.settings = d.settings || {};
  state.dataPath = d.dataFile || '';
  state.backupCount = d.backupCount || 0;
  if (d.warning) toast(d.warning, 'warn');
  const seasons = await call(api.listSeasons());
  state.seasons = seasons || [];
  detectNewSeasons(state.seasons);
  if (!state.view) {
    state.view = 'all';
  }
  renderSidebar();
  render();
}

/* ---------- 侧栏 ---------- */
function renderSidebar() {
  const nav = $('#season-nav');
  nav.innerHTML = state.seasons.map((s) => `
    <button class="nav-item ${state.view === s.key ? 'active' : ''}" data-view="${s.key}">
      ${esc(s.label)}<span class="count">${s.count}</span>
    </button>`).join('');
  document.querySelectorAll('#nav .nav-item[data-view]').forEach((b) => {
    b.classList.toggle('active', state.view === b.dataset.view);
  });
  document.querySelectorAll('.sidebar-footer .nav-item[data-view]').forEach((b) => {
    b.classList.toggle('active', state.view === b.dataset.view);
  });
  $('#data-path').textContent = state.dataPath ? `数据：${state.dataPath}` : '';
}

/* ---------- 内容渲染 ---------- */
function render() {
  const c = $('#content');
  if (state.view === 'stats') return renderStats(c);
  if (state.view === 'calendar') return renderCalendar(c);
  if (state.view === 'all') return renderAll(c);
  if (state.view === 'settings') return renderSettings(c);
  return renderSeason(c, state.view);
}

function filtered(seasonKey) {
  let list = state.anime;
  if (seasonKey) list = list.filter((a) => a.season === seasonKey);
  if (state.status) list = list.filter((a) => a.status === state.status);
  const q = state.search.trim().toLowerCase();
  if (q) list = list.filter((a) => String(a.title || '').toLowerCase().includes(q));
  return list;
}

function cardHTML(a) {
  const meta = STATUS_META[a.status] || STATUS_META.plan;
  const total = a.totalEpisodes;
  const ep = a.episode || 0;
  const pct = total ? Math.min(100, Math.round((ep / total) * 100)) : (ep ? 100 : 0);
  const cover = a.coverUrl
    ? `<img class="card-cover" src="${esc(a.coverUrl)}" alt="" />`
    : `<div class="card-cover-placeholder">🎬</div>`;
  const bits = [
    total ? `${ep} / ${total} 集` : (ep > 0 ? `看到第 ${ep} 集` : '还没开始看'),
    a.updateDay != null ? DAY_LABELS[a.updateDay] : '',
    a.rating != null ? `我的评分 ${a.rating}` : '',
  ].filter(Boolean);
  const lastW = lastWatchedAt(a);
  const actions = a.status === 'completed'
    ? `<button class="btn" data-action="edit" data-id="${a.id}">编辑</button>`
    : `<button class="btn btn-primary" data-action="bump" data-id="${a.id}">＋1 集</button>
       <button class="btn" data-action="complete" data-id="${a.id}">看完</button>
       <button class="btn" data-action="edit" data-id="${a.id}">编辑</button>`;
  return `
  <div class="card" data-action="edit" data-id="${a.id}" title="点击卡片编辑">
    <div class="card-top">
      ${cover}
      <div>
        <div class="card-title">${esc(a.title)}</div>
        <div class="card-meta">${esc(bits.join(' · '))}</div>
      </div>
      <span class="badge ${meta.cls}">${meta.label}</span>
    </div>
    <div class="progress-wrap">
      <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
      <span class="progress-label">${pct}%</span>
    </div>
    ${lastW ? `<div class="card-dl">最近观看：${esc(formatWatchTime(new Date(lastW).toISOString()))}</div>` : ''}
    ${a.comment ? `<div class="card-comment">${esc(a.comment)}</div>` : ''}
    <div class="card-actions">${actions}</div>
  </div>`;
}

function emptyHTML(msg, withAdd = true) {
  return `<div class="empty"><div class="big">🍃</div><p>${msg}</p>${withAdd ? '<button class="btn btn-primary" data-action="add">＋ 添加番剧</button>' : ''}</div>`;
}

function renderSeason(c, key) {
  const s = state.seasons.find((x) => x.key === key);
  const list = filtered(key);
  if (state.sort === 'recent') list.sort((a, b) => lastWatchedAt(b) - lastWatchedAt(a));
  const watching = list.filter((a) => a.status === 'watching').length;
  c.innerHTML = `
    <div class="view-head">
      <h1>${esc(s ? s.label : key)}</h1>
      <span class="sub">${list.length} 部 · ${watching} 在看</span>
      <div class="spacer"></div>
    </div>
    ${list.length ? `<div class="cards">${list.map(cardHTML).join('')}</div>` : emptyHTML('这个季度还没有记录，添加一部番剧吧', false)}
  `;
  attachImgFallback(c);
}

function renderAll(c) {
  const list = filtered(null);
  if (state.sort === 'recent') {
    const sorted = list.slice().sort((a, b) => lastWatchedAt(b) - lastWatchedAt(a));
    c.innerHTML = `
      <div class="view-head">
        <h1>全部番剧</h1>
        <span class="sub">共 ${list.length} 部 · 按最近观看排序</span>
        <div class="spacer"></div>
        <button class="btn" data-action="export-excel">📤 导出 Excel…</button>
      </div>
      ${sorted.length ? `
      <div class="quarter-section">
        <div class="quarter-title"><span class="dot"></span>最近观看<span class="n">${sorted.length} 部</span></div>
        <div class="cards">${sorted.map(cardHTML).join('')}</div>
      </div>` : emptyHTML('还没有任何记录，添加一部番剧吧', false)}
    `;
    attachImgFallback(c);
    return;
  }
  const bySeason = {};
  for (const a of list) {
    if (!bySeason[a.season]) bySeason[a.season] = [];
    bySeason[a.season].push(a);
  }
  const keys = Object.keys(bySeason).sort().reverse();
  c.innerHTML = `
    <div class="view-head">
      <h1>全部番剧</h1>
      <span class="sub">共 ${list.length} 部</span>
      <div class="spacer"></div>
      <button class="btn" data-action="export-excel">📤 导出 Excel…</button>
    </div>
    ${keys.length ? keys.map((k) => `
      <div class="quarter-section">
        <div class="quarter-title"><span class="dot"></span>${esc(seasonLabel(k))}<span class="n">${bySeason[k].length} 部</span></div>
        <div class="cards">${bySeason[k].map(cardHTML).join('')}</div>
      </div>`).join('') : emptyHTML('还没有任何记录，添加一部番剧吧', false)}
  `;
  attachImgFallback(c);
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

const CHART_COLORS = ['#f89164', '#7ee2a8', '#8ab4f8', '#f7c784', '#c9a9e8', '#f08a8a', '#6ec8d8', '#b3d47a', '#e0a45a', '#9aa0a6'];

function colorize(items) {
  return (items || []).map((it, i) => ({ ...it, color: CHART_COLORS[i % CHART_COLORS.length] }));
}

function topItemsWithOther(items, topN) {
  const top = (items || []).slice(0, topN);
  const rest = (items || []).slice(topN).reduce((s, x) => s + x.value, 0);
  if (rest > 0) top.push({ label: '其他', value: rest, color: '#6f6f7e' });
  return top;
}

function statusBreakdown(list = state.anime) {
  const defs = [
    { key: 'watching', label: '在看', color: '#7ee2a8' },
    { key: 'completed', label: '看完', color: '#8ab4f8' },
    { key: 'on_hold', label: '搁置', color: '#f7c784' },
    { key: 'dropped', label: '弃番', color: '#9aa0a6' },
    { key: 'plan', label: '想看', color: '#f89164' },
  ];
  return defs
    .map((d) => ({ label: d.label, value: list.filter((a) => a.status === d.key).length, color: d.color }))
    .filter((x) => x.value > 0);
}

function monthlyWatchData(list = state.anime) {
  const map = {};
  for (const a of list) {
    for (const e of (a.watchLog || [])) {
      const m = String(e.at).slice(0, 7);
      if (m) map[m] = (map[m] || 0) + 1;
    }
  }
  return Object.keys(map).sort().map((k) => ({ label: k.slice(2) + '月', value: map[k] }));
}

function quarterCountData(list = state.anime) {
  const map = {};
  for (const a of list) {
    map[a.season] = (map[a.season] || 0) + 1;
  }
  return Object.keys(map).sort().map((k) => ({ label: k.slice(2) + '月', value: map[k] }));
}

function studioBreakdown(list = state.anime) {
  const map = new Map();
  for (const a of list) {
    const s = String(a.studio || '').trim() || '未标注';
    map.set(s, (map.get(s) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function tagBreakdown(list = state.anime) {
  const map = new Map();
  for (const a of list) {
    const tags = String(a.tags || '').split(/[、，,;；\/]/).map((x) => x.trim()).filter(Boolean);
    for (const tag of tags) map.set(tag, (map.get(tag) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function drawBarChart(canvas, items, opts = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const sc = W / 400;
  ctx.clearRect(0, 0, W, H);
  const max = Math.max(1, ...items.map((i) => i.value));
  const padL = 30 * sc, padR = 8 * sc, padT = 8 * sc, padB = 20 * sc;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.fillStyle = cssVar('--text-dim', '#9a9aab');
  ctx.font = `${10 * sc}px "Microsoft YaHei UI"`;
  ctx.textAlign = 'right';
  for (let g = 0; g <= 4; g++) {
    const y = padT + chartH - (chartH * g) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(String(Math.round((max * g) / 4)), padL - 4 * sc, y + 3 * sc);
  }
  const n = items.length;
  const slot = chartW / Math.max(1, n);
  const barW = Math.min(22 * sc, slot * 0.55);
  const labelStep = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(chartW / 58))));
  ctx.textAlign = 'center';
  items.forEach((it, i) => {
    const h = Math.max(2, (chartH * it.value) / max);
    const x = padL + slot * i + (slot - barW) / 2;
    const y = padT + chartH - h;
    const grad = ctx.createLinearGradient(0, y, 0, padT + chartH);
    grad.addColorStop(0, opts.color0 || '#f89164');
    grad.addColorStop(1, opts.color1 || '#e0674a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, barW, h, 3 * sc); else ctx.rect(x, y, barW, h);
    ctx.fill();
    if (i % labelStep === 0) {
      const label = String(it.label);
      ctx.fillStyle = cssVar('--text-dim', '#9a9aab');
      ctx.fillText(label.length > 9 ? label.slice(0, 8) + '…' : label, x + barW / 2, H - 5 * sc);
    }
  });
  ctx.textAlign = 'left';
}

function drawLineChart(canvas, items, opts = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const sc = W / 400;
  ctx.clearRect(0, 0, W, H);
  const max = Math.max(1, ...items.map((i) => i.value));
  const padL = 30 * sc, padR = 10 * sc, padT = 10 * sc, padB = 24 * sc;
  const cw = W - padL - padR, ch = H - padT - padB;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.fillStyle = cssVar('--text-dim', '#9a9aab');
  ctx.font = `${10 * sc}px "Microsoft YaHei UI"`;
  ctx.textAlign = 'right';
  for (let g = 0; g <= 4; g++) {
    const y = padT + ch - (ch * g) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(String(Math.round((max * g) / 4)), padL - 4 * sc, y + 3 * sc);
  }
  const n = items.length;
  if (!n) { ctx.textAlign = 'left'; return; }
  const px = (i) => (n === 1 ? padL + cw / 2 : padL + (cw * i) / (n - 1));
  const py = (v) => padT + ch - (ch * v) / max;
  const color = opts.color || '#f89164';
  const labelStep = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(cw / 58))));
  const grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
  grad.addColorStop(0, 'rgba(248,145,100,0.30)');
  grad.addColorStop(1, 'rgba(248,145,100,0.02)');
  ctx.beginPath();
  items.forEach((it, i) => {
    const x = px(i), y = py(it.value);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineTo(px(n - 1), padT + ch);
  ctx.lineTo(px(0), padT + ch);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  items.forEach((it, i) => {
    const x = px(i), y = py(it.value);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * sc;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  items.forEach((it, i) => {
    const x = px(i), y = py(it.value);
    ctx.beginPath();
    ctx.arc(x, y, 3 * sc, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = cssVar('--panel', '#14141a');
    ctx.lineWidth = 1.2 * sc;
    ctx.stroke();
  });
  ctx.fillStyle = cssVar('--text-dim', '#9a9aab');
  ctx.textAlign = 'center';
  items.forEach((it, i) => {
    if (i % labelStep === 0) {
      const label = String(it.label);
      ctx.fillText(label.length > 9 ? label.slice(0, 8) + '…' : label, px(i), H - 5 * sc);
    }
  });
  ctx.textAlign = 'left';
}

function drawDonut(canvas, items) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const r = Math.min(W, H) / 2 - 4;
  const total = items.reduce((sum, i) => sum + i.value, 0) || 1;
  let start = -Math.PI / 2;
  items.forEach((it) => {
    const angle = (it.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = it.color;
    ctx.fill();
    start += angle;
  });
  ctx.fillStyle = cssVar('--panel', '#14141a');
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cssVar('--text', '#e9e9f2');
  ctx.font = 'bold 14px "Microsoft YaHei UI"';
  ctx.textAlign = 'center';
  ctx.fillText(String(total), cx, cy + 5);
  ctx.textAlign = 'left';
}

function drawStatsCharts(statusItems, monthItems, qCounts, qEps, studioItems, tagItems) {
  const cs = $('#chart-status');
  if (cs) drawDonut(cs, statusItems);
  const cm = $('#chart-month');
  if (cm) drawLineChart(cm, monthItems);
  const cq = $('#chart-qcount');
  if (cq) drawBarChart(cq, qCounts, { color0: '#7db4ff', color1: '#3d8bff' });
  const ce = $('#chart-qeps');
  if (ce) drawBarChart(ce, qEps, { color0: '#7ee2a8', color1: '#2f9e63' });
  const cs2 = $('#chart-studio');
  if (cs2) drawBarChart(cs2, studioItems.slice(0, 10), { color0: '#c9a9e8', color1: '#9a6fd8' });
  const ct = $('#chart-tags');
  if (ct) drawDonut(ct, colorize(topItemsWithOther(tagItems, 8)));
}

function renderStats(c) {
  const all = state.anime;
  const s = statsFor(all);
  const bySeason = {};
  for (const a of all) {
    if (!bySeason[a.season]) bySeason[a.season] = [];
    bySeason[a.season].push(a);
  }
  const qCounts = quarterCountData();
  const qEps = Object.keys(bySeason).sort().map((k) => ({ label: k.slice(2) + '月', value: statsFor(bySeason[k]).eps }));
  const statusItems = statusBreakdown();
  const monthItems = monthlyWatchData();
  const studioItems = studioBreakdown();
  const tagItems = tagBreakdown();
  const top = all.filter((a) => a.rating != null).sort((a, b) => b.rating - a.rating).slice(0, 5);
  const recent = all.filter((a) => lastWatchedAt(a) > 0).sort((a, b) => lastWatchedAt(b) - lastWatchedAt(a)).slice(0, 5);
  const avgText = s.avg != null ? s.avg.toFixed(1) : '—';
  const seasonSet = [...new Set(all.map((a) => a.season))].sort();
  const spanText = seasonSet.length
    ? `${seasonLabel(seasonSet[0])} ～ ${seasonLabel(seasonSet[seasonSet.length - 1])}`
    : '—';
  const dropped = all.filter((a) => a.status === 'dropped').length;
  const hold = all.filter((a) => a.status === 'on_hold').length;
  const plan = all.filter((a) => a.status === 'plan').length;
  c.innerHTML = `
    <div class="view-head">
      <h1>统计</h1>
      <span class="sub">共 ${all.length} 部追番记录</span>
      <div class="spacer"></div>
      <button class="btn" data-action="export-html-report">📄 导出 HTML 报告</button>
      <button class="btn btn-primary" data-action="export-stats">📊 导出统计图</button>
    </div>
    <div class="stats-grid">
      <div class="stat-card accent"><div class="num">${s.total}</div><div class="label">追番总数</div></div>
      <div class="stat-card"><div class="num" style="color:var(--green)">${s.watching}</div><div class="label">在看</div></div>
      <div class="stat-card"><div class="num" style="color:var(--blue)">${s.completed}</div><div class="label">看完</div></div>
      <div class="stat-card"><div class="num" style="color:var(--red)">${dropped}</div><div class="label">弃番</div></div>
      <div class="stat-card"><div class="num" style="color:var(--orange)">${hold}</div><div class="label">搁置</div></div>
      <div class="stat-card"><div class="num" style="color:var(--accent)">${plan}</div><div class="label">想看</div></div>
      <div class="stat-card"><div class="num" style="color:var(--accent-3)">${s.eps}</div><div class="label">累计集数</div></div>
      <div class="stat-card"><div class="num">${s.rate}%</div><div class="label">完成率</div></div>
      <div class="stat-card"><div class="num">${avgText}</div><div class="label">平均评分（${s.ratedCount} 部已评）</div></div>
      <div class="stat-card"><div class="num" style="font-size:19px">${esc(spanText)}</div><div class="label">追番跨度</div></div>
    </div>
    <div class="stats-section-title">图表分析</div>
    <div class="charts-grid">
      <div class="chart-card"><h3>状态分布</h3><canvas id="chart-status" width="360" height="220"></canvas></div>
      <div class="chart-card"><h3>每月观看集数</h3><canvas id="chart-month" width="520" height="220"></canvas></div>
      <div class="chart-card"><h3>各季度番剧数</h3><canvas id="chart-qcount" width="520" height="220"></canvas></div>
      <div class="chart-card"><h3>各季度累计集数</h3><canvas id="chart-qeps" width="520" height="220"></canvas></div>
      <div class="chart-card"><h3>制作公司 Top 10</h3><canvas id="chart-studio" width="520" height="220"></canvas></div>
      <div class="chart-card"><h3>题材标签占比</h3><canvas id="chart-tags" width="360" height="220"></canvas></div>
    </div>
    ${recent.length ? `
      <div class="stats-section-title">最近观看</div>
      <div class="top-list">
        ${recent.map((a, i) => `
          <div class="top-item">
            <span class="rank">${i + 1}</span>
            <span class="t">${esc(a.title)}<span style="color:var(--text-dim);font-size:12px"> · ${esc(formatWatchTime(new Date(lastWatchedAt(a)).toISOString()))}</span></span>
            <span class="r">第 ${a.episode || 0} 集</span>
          </div>`).join('')}
      </div>` : ''}
    ${top.length ? `
      <div class="stats-section-title">高分榜单</div>
      <div class="top-list">
        ${top.map((a, i) => `
          <div class="top-item">
            <span class="rank">${i + 1}</span>
            <span class="t">${esc(a.title)}<span style="color:var(--text-dim);font-size:12px"> · ${esc(seasonLabel(a.season))}</span></span>
            <span class="r">${a.rating} 分</span>
          </div>`).join('')}
      </div>` : ''}
  `;
  drawStatsCharts(statusItems, monthItems, qCounts, qEps, studioItems, tagItems);
}

function buildStatsChartDataUrl() {
  const mk = (w, h) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; };
  const donut = mk(380, 260);
  drawDonut(donut, statusBreakdown());
  const month = mk(460, 240);
  drawBarChart(month, monthlyWatchData());
  const qcount = mk(460, 240);
  drawBarChart(qcount, quarterCountData(), { color0: '#7db4ff', color1: '#3d8bff' });
  const all = state.anime;
  const bySeason = {};
  for (const a of all) {
    if (!bySeason[a.season]) bySeason[a.season] = [];
    bySeason[a.season].push(a);
  }
  const qeps = mk(460, 240);
  drawBarChart(qeps, Object.keys(bySeason).sort().map((k) => ({ label: k.slice(2) + '月', value: statsFor(bySeason[k]).eps })), { color0: '#7ee2a8', color1: '#2f9e63' });

  const W = 1200;
  const H = 1450;
  const canvas = mk(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101016';
  ctx.fillRect(0, 0, W, H);
  let y = 40;
  ctx.fillStyle = '#e9e9f2';
  ctx.font = 'bold 34px "Microsoft YaHei UI"';
  ctx.textAlign = 'center';
  ctx.fillText('番剧记录 · 统计报告', W / 2, y);
  y += 40;
  ctx.fillStyle = '#9a9aab';
  ctx.font = '18px "Microsoft YaHei UI"';
  ctx.fillText(`生成于 ${formatWatchTime(new Date().toISOString())} · 共 ${all.length} 部追番`, W / 2, y);
  ctx.textAlign = 'left';
  const s = statsFor(all);
  const statPairs = [
    ['追番总数', String(s.total)], ['在看', String(s.watching)], ['看完', String(s.completed)],
    ['累计集数', String(s.eps)], ['完成率', s.rate + '%'], ['平均评分', s.avg != null ? s.avg.toFixed(1) : '—'],
  ];
  y += 30;
  const colW = W / 3;
  statPairs.forEach(([label, value], i) => {
    const cx0 = 40 + (i % 3) * colW;
    const cy0 = y + Math.floor(i / 3) * 46;
    ctx.fillStyle = '#9a9aab';
    ctx.font = '18px "Microsoft YaHei UI"';
    ctx.fillText(label, cx0, cy0);
    ctx.fillStyle = '#f89164';
    ctx.font = 'bold 26px "Microsoft YaHei UI"';
    ctx.fillText(value, cx0 + 100, cy0);
  });
  y += 150;
  ctx.drawImage(donut, 40, y, 380, 260);
  ctx.drawImage(month, 470, y, 460, 240);
  y += 290;
  ctx.drawImage(qcount, 40, y, 460, 240);
  ctx.drawImage(qeps, 540, y, 460, 240);
  y += 290;
  const top = all.filter((a) => a.rating != null).sort((a, b) => b.rating - a.rating).slice(0, 5);
  const recent = all.filter((a) => lastWatchedAt(a) > 0).sort((a, b) => lastWatchedAt(b) - lastWatchedAt(a)).slice(0, 5);
  ctx.fillStyle = '#e9e9f2';
  ctx.font = 'bold 20px "Microsoft YaHei UI"';
  ctx.fillText('高分榜单', 40, y);
  ctx.fillText('最近观看', 640, y);
  y += 28;
  ctx.font = '16px "Microsoft YaHei UI"';
  for (let i = 0; i < 5; i++) {
    if (top[i]) {
      ctx.fillStyle = '#9a9aab';
      ctx.fillText(`${i + 1}. ${top[i].title} · ${top[i].rating} 分`, 40, y + i * 26);
    }
    if (recent[i]) {
      ctx.fillStyle = '#9a9aab';
      ctx.fillText(`${i + 1}. ${recent[i].title} · ${formatWatchTime(new Date(lastWatchedAt(recent[i])).toISOString())}`, 640, y + i * 26);
    }
  }
  y += 150;
  ctx.fillStyle = '#6f6f7e';
  ctx.font = '14px "Microsoft YaHei UI"';
  ctx.textAlign = 'center';
  ctx.fillText('番剧记录 Anime Tracker', W / 2, y);
  return canvas.toDataURL('image/png');
}


/* ---------- HTML 报告 ---------- */
function svgBars(items, opts = {}) {
  const W = 560, H = 240, padL = 44, padR = 14, padT = 16, padB = 36;
  const max = Math.max(1, ...items.map((i) => i.value));
  const cw = W - padL - padR, ch = H - padT - padB;
  const color = opts.color || '#f89164';
  const n = items.length;
  const slot = cw / Math.max(1, n);
  const bw = Math.min(30, slot * 0.55);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="'Microsoft YaHei UI','Segoe UI',sans-serif">`;
  for (let g = 0; g <= 4; g++) {
    const y = padT + ch - (ch * g) / 4;
    s += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(255,255,255,0.08)"/>`;
    s += `<text x="${padL - 6}" y="${y + 4}" fill="#9a9aab" font-size="11" text-anchor="end">${Math.round((max * g) / 4)}</text>`;
  }
  items.forEach((it, i) => {
    const h = Math.max(2, (ch * it.value) / max);
    const x = padL + slot * i + (slot - bw) / 2;
    const y = padT + ch - h;
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${color}"/>`;
    s += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 10}" fill="#9a9aab" font-size="11" text-anchor="middle">${esc(it.label)}</text>`;
  });
  s += '</svg>';
  return s;
}

function svgLine(items, opts = {}) {
  const W = 560, H = 240, padL = 44, padR = 16, padT = 16, padB = 36;
  const max = Math.max(1, ...items.map((i) => i.value));
  const cw = W - padL - padR, ch = H - padT - padB;
  const n = items.length;
  const px = (i) => (n === 1 ? padL + cw / 2 : padL + (cw * i) / (n - 1));
  const py = (v) => padT + ch - (ch * v) / max;
  const color = opts.color || '#f89164';
  const pts = items.map((it, i) => `${px(i).toFixed(1)},${py(it.value).toFixed(1)}`).join(' ');
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="'Microsoft YaHei UI','Segoe UI',sans-serif">`;
  for (let g = 0; g <= 4; g++) {
    const y = padT + ch - (ch * g) / 4;
    s += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(255,255,255,0.08)"/>`;
    s += `<text x="${padL - 6}" y="${y + 4}" fill="#9a9aab" font-size="11" text-anchor="end">${Math.round((max * g) / 4)}</text>`;
  }
  if (n > 1) {
    s += `<polygon points="${padL},${padT + ch} ${pts} ${px(n - 1).toFixed(1)},${padT + ch}" fill="rgba(248,145,100,0.16)"/>`;
    s += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  items.forEach((it, i) => {
    const x = px(i), y = py(it.value);
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}" stroke="#14141a" stroke-width="1.5"/>`;
    s += `<text x="${x.toFixed(1)}" y="${H - 10}" fill="#9a9aab" font-size="11" text-anchor="middle">${esc(it.label)}</text>`;
  });
  s += '</svg>';
  return s;
}

function svgDonut(items) {
  const W = 380, H = 240, cx = 118, cy = H / 2, r = 74, sw = 28;
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="'Microsoft YaHei UI','Segoe UI',sans-serif">`;
  if (!items.length) {
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2a2a33" stroke-width="${sw}"/>`;
    s += `<text x="${cx}" y="${cy + 8}" fill="#9a9aab" font-size="26" font-weight="bold" text-anchor="middle">0</text>`;
    s += '</svg>';
    return s;
  }
  items.forEach((it) => {
    const frac = it.value / total;
    const dash = frac * circ;
    const off = -acc * circ;
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${it.color}" stroke-width="${sw}" stroke-dasharray="${dash.toFixed(1)} ${(circ - dash).toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    acc += frac;
  });
  s += `<text x="${cx}" y="${cy + 8}" style="fill:var(--text)" font-size="26" font-weight="bold" text-anchor="middle">${total}</text>`;
  let ly = 22;
  for (const it of items.slice(0, 8)) {
    s += `<rect x="${W - 128}" y="${ly - 9}" width="11" height="11" rx="2.5" fill="${it.color}"/>`;
    s += `<text x="${W - 110}" y="${ly}" style="fill:var(--muted)" font-size="11.5">${esc(it.label)} · ${it.value}</text>`;
    ly += 19;
  }
  s += '</svg>';
  return s;
}

function reportScopeTitle(scopeKey) {
  if (scopeKey === 'all') return '全部追番报告';
  if (/^\d{4}$/.test(scopeKey)) return `${scopeKey} 年度报告`;
  return `${seasonLabel(scopeKey)} 季度报告`;
}

function buildHtmlReport(scopeKey) {
  const list = scopeKey === 'all'
    ? state.anime
    : state.anime.filter((a) => (/^\d{4}$/.test(scopeKey) ? (a.season || '').slice(0, 4) === scopeKey : a.season === scopeKey));
  const s = statsFor(list);
  const bySeason = {};
  for (const a of list) { (bySeason[a.season] = bySeason[a.season] || []).push(a); }
  const qKeys = Object.keys(bySeason).sort();
  const qCounts = quarterCountData(list);
  const qEps = qKeys.map((k) => ({ label: k.slice(2) + '月', value: statsFor(bySeason[k]).eps }));
  const statusItems = statusBreakdown(list);
  const monthItems = monthlyWatchData(list);
  const studioItems = studioBreakdown(list).slice(0, 10);
  const tagItems = colorize(topItemsWithOther(tagBreakdown(list), 8));
  const top = list.filter((a) => a.rating != null).sort((a, b) => b.rating - a.rating).slice(0, 10);
  const recent = list.filter((a) => lastWatchedAt(a) > 0).sort((a, b) => lastWatchedAt(b) - lastWatchedAt(a)).slice(0, 10);
  const title = reportScopeTitle(scopeKey);
  const dateStr = new Date().toISOString().slice(0, 10);
  const statCards = [
    ['追番总数', String(s.total), '#f89164'],
    ['在看', String(s.watching), '#7ee2a8'],
    ['看完', String(s.completed), '#8ab4f8'],
    ['累计集数', String(s.eps), '#f7c784'],
    ['完成率', s.rate + '%', '#c9a9e8'],
    ['平均评分', s.avg != null ? s.avg.toFixed(1) : '—', '#6ec8d8'],
  ].map(([label, value, color]) =>
    `<div class="card"><div class="num" style="color:${color}">${value}</div><div class="lbl">${label}</div></div>`).join('');
  const listHtml = (items, render) => items.length ? items.map(render).join('') : '<div class="empty-line">暂无数据</div>';
  const topHtml = listHtml(top, (a, i) =>
    `<div class="row"><span class="rank">${i + 1}</span><span class="t">${esc(a.title)}<em>${esc(seasonLabel(a.season))}</em></span><span class="r">${a.rating} 分</span></div>`);
  const recentHtml = listHtml(recent, (a, i) =>
    `<div class="row"><span class="rank">${i + 1}</span><span class="t">${esc(a.title)}<em>${esc(formatWatchTime(new Date(lastWatchedAt(a)).toISOString()))}</em></span><span class="r">第 ${a.episode || 0} 集</span></div>`);
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · 番剧记录</title>
<style>
  :root { color-scheme: dark; --bg:#101016; --panel:#15151c; --border:rgba(255,255,255,0.09); --rowline:rgba(255,255,255,0.05); --text:#e9e9f2; --muted:#9a9aab; --dim:#6f6f7e; --accent-2:#f7b9a0; --accent-3:#e87a52; }
  @media (prefers-color-scheme: light) {
    :root { color-scheme: light; --bg:#f4f4f8; --panel:#ffffff; --border:rgba(0,0,0,0.10); --rowline:rgba(0,0,0,0.06); --text:#1f1f28; --muted:#555563; --dim:#8a8a99; --accent-2:#c94f2b; --accent-3:#b9441f; }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: "Segoe UI","Microsoft YaHei UI","Microsoft YaHei",sans-serif; padding: 36px 24px 48px; }
  .wrap { max-width: 1180px; margin: 0 auto; }
  .head { text-align: center; margin-bottom: 28px; }
  .head h1 { font-size: 30px; font-weight: 800; letter-spacing: 1px; }
  .head p { color: var(--muted); font-size: 13.5px; margin-top: 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin-bottom: 24px; }
  .card { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 18px; text-align: center; }
  .card .num { font-size: 30px; font-weight: 800; }
  .card .lbl { color: var(--muted); font-size: 12.5px; margin-top: 5px; }
  .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 14px; margin-bottom: 24px; }
  .chart { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 16px; }
  .chart h3 { color: var(--muted); font-size: 14px; margin-bottom: 12px; font-weight: 600; }
  .chart svg { width: 100%; height: auto; display: block; }
  .lists { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 14px; }
  .list { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 16px; }
  .list h3 { color: var(--muted); font-size: 14px; margin-bottom: 12px; font-weight: 600; }
  .row { display: flex; align-items: center; gap: 12px; padding: 9px 4px; border-bottom: 1px solid var(--rowline); font-size: 13.5px; }
  .row:last-child { border-bottom: none; }
  .row .rank { color: var(--accent-2); font-weight: 700; width: 20px; }
  .row .t { flex: 1; }
  .row .t em { display: block; color: var(--dim); font-size: 11.5px; font-style: normal; }
  .row .r { color: var(--accent-3); font-weight: 600; }
  .empty-line { color: var(--dim); font-size: 13px; padding: 10px 4px; }
  .foot { text-align: center; color: var(--dim); font-size: 12px; margin-top: 30px; }
</style></head>
<body><div class="wrap">
  <div class="head"><h1>${esc(title)}</h1><p>番剧记录 Anime Tracker · 生成于 ${dateStr} · 共 ${list.length} 部 · 累计观看 ${s.eps} 集</p></div>
  <div class="grid">${statCards}</div>
  <div class="charts">
    <div class="chart"><h3>状态分布</h3>${svgDonut(statusItems)}</div>
    <div class="chart"><h3>每月观看集数</h3>${svgLine(monthItems)}</div>
    <div class="chart"><h3>各季度番剧数</h3>${svgBars(qCounts, { color: '#8ab4f8' })}</div>
    <div class="chart"><h3>各季度累计集数</h3>${svgBars(qEps, { color: '#7ee2a8' })}</div>
    <div class="chart"><h3>制作公司 Top 10</h3>${svgBars(studioItems, { color: '#c9a9e8' })}</div>
    <div class="chart"><h3>题材标签占比</h3>${svgDonut(tagItems)}</div>
  </div>
  <div class="lists">
    <div class="list"><h3>高分榜单</h3>${topHtml}</div>
    <div class="list"><h3>最近观看</h3>${recentHtml}</div>
  </div>
  <div class="foot">番剧记录 Anime Tracker</div>
</div></body></html>`;
  return { html, name: `番剧记录-${title}-${dateStr}.html` };
}

function openReportModal() {
  const years = [...new Set(state.anime.map((a) => (a.season || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const seasons = [...new Set(state.anime.map((a) => a.season).filter(Boolean))].sort().reverse();
  const opts = [`<option value="all">全部记录（${state.anime.length} 部）</option>`];
  for (const y of years) opts.push(`<option value="${y}">${y} 年度</option>`);
  for (const k of seasons) opts.push(`<option value="${k}">${seasonLabel(k)}</option>`);
  renderModal(`
    <div class="modal-head"><h2>导出 HTML 报告</h2><button class="modal-close" data-action="close">✕</button></div>
    <div class="modal-body">
      <div class="hint">生成一份静态 HTML 报告（内置图表、无需联网），可直接在浏览器打开查看，或截图分享你的年度 / 季度看番总结。</div>
      <div class="field"><label>统计范围</label><select id="report-scope" style="width:100%">${opts.join('')}</select></div>
      <div class="form-actions">
        <span style="flex:1"></span>
        <button class="btn" data-action="close">取消</button>
        <button class="btn btn-primary" data-action="report-generate">生成并保存…</button>
      </div>
    </div>`);
}

async function doExportHtmlReport() {
  const sel = $('#report-scope');
  const scopeKey = sel ? sel.value : 'all';
  let built;
  try {
    built = buildHtmlReport(scopeKey);
  } catch (e) {
    toast('生成 HTML 报告失败：' + (e && e.message || e), 'error');
    return;
  }
  try {
    const p = await call(api.exportHtmlReport(built.html, built.name));
    if (!p) return;
    toast(`HTML 报告已导出：${p}`, 'success');
    closeModal();
  } catch (e) { /* call 已提示 */ }
}

async function doExportStatsChart() {
  let dataUrl;
  try {
    dataUrl = buildStatsChartDataUrl();
  } catch (e) {
    toast('生成统计图失败：' + (e && e.message || e), 'error');
    return;
  }
  try {
    const p = await call(api.exportChart(dataUrl));
    if (!p) return;
    toast(`统计图已导出：${p}`, 'success');
  } catch (e) { /* call 已提示 */ }
}

function renderSettings(c) {
  const ab = state.settings.autoBackup || {};
  const bgm = state.settings.bangumi || {};
  const theme = state.settings.theme || 'system';
  c.innerHTML = `
    <div class="view-head"><h1>设置</h1></div>
    <div class="settings-panel">
      <div class="field">
        <label>外观主题</label>
        <select id="set-theme">
          <option value="system" ${theme === 'system' ? 'selected' : ''}>跟随系统</option>
          <option value="dark" ${theme === 'dark' ? 'selected' : ''}>深色</option>
          <option value="light" ${theme === 'light' ? 'selected' : ''}>浅色</option>
        </select>
        <div class="hint" style="margin-top:6px">跟随系统 = 按 Windows 深浅色自动切换；Mica 云母背景与标题栏按钮颜色会随主题变化。</div>
      </div>
      <div class="field">
        <label>动画信息数据目录（读取当季新番）</label>
        <input id="set-base" type="text" value="${esc(state.settings.animeInfoBaseDir || '')}" />
        <div class="hint" style="margin-top:6px">默认：D:\\ANIME\\日本TV动画信息。当季新番只来自 yuc.wiki（在线抓取，断网时用内置目录）；添加番剧时可用「搜 Bangumi」补全信息。</div>
      </div>
      <div class="field">
        <label>定期自动备份</label>
        <div class="settings-box">
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <input type="checkbox" id="ab-enabled" ${ab.enabled ? 'checked' : ''} /> 启用自动备份
          </label>
          <div class="row" style="margin-bottom:8px">
            <select id="ab-interval">
              <option value="daily" ${ab.interval !== 'weekly' ? 'selected' : ''}>每天</option>
              <option value="weekly" ${ab.interval === 'weekly' ? 'selected' : ''}>每周</option>
            </select>
            <input id="ab-folder" type="text" placeholder="备份文件夹（留空用默认）" value="${esc(ab.folder || '')}" />
            <input id="ab-keep" type="number" min="1" max="365" style="width:90px" placeholder="保留份数" value="${esc(ab.keep || 30)}" />
          </div>
          <div class="form-actions" style="margin-top:4px">
            <button class="btn" data-action="backup-now">💾 立即备份</button>
          </div>
          <div class="hint" style="margin-top:6px">启动应用时检查是否到期（每天/每周），自动把数据备份成带日期的 JSON 文件到指定文件夹，只保留最近 N 份；把该文件夹放进同步盘即可异地备份。默认文件夹：D:\\ANIME\\anime-tracker\\自动备份。</div>
        </div>
      </div>
      <div class="field">
        <label>Bangumi 收藏同步</label>
        <div class="settings-box">
          <div class="row" style="margin-bottom:8px">
            <input id="set-bgm-uid" type="text" placeholder="Bangumi UID（个人主页网址里的数字）" value="${esc(bgm.uid || '')}" style="flex:1" />
          </div>
          <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <input type="checkbox" id="set-bgm-auto" ${bgm.autoSync ? 'checked' : ''} /> 启动 / 聚焦窗口时自动同步
          </label>
          <div class="form-actions" style="margin-top:4px">
            <button class="btn" data-action="bangumi-sync">🔄 立即同步 Bangumi 收藏</button>
            <button class="btn" data-action="bangumi-enrich">🔍 补全 Bangumi 信息</button>
          </div>
          <div class="hint" style="margin-top:6px">同步会把 Bangumi 收藏里本程序没有的番剧按收藏状态自动添加（想看→想看、在看→在看、看过→看完等），只新增不覆盖本地进度。UID 在你 Bangumi 个人主页的网址里，例如 bgm.tv/user/12345 中的 12345。${bgm.lastSyncAt ? '上次同步：' + esc(formatWatchTime(new Date(bgm.lastSyncAt).toISOString())) : ''}</div>
        </div>
      </div>
      <div class="field">
        <label>下载目录扫描</label>
        <div class="settings-box">
          <div class="form-actions" style="margin-top:4px">
            <button class="btn" data-action="scan">📂 扫描下载目录…</button>
          </div>
          <div class="hint" style="margin-top:6px">扫描下载文件夹里的视频文件（mp4 / mkv / rmvb 等），自动识别番名与已下载集数，并与你的记录比对。</div>
        </div>
      </div>
      <div class="field">
        <label>数据文件</label>
        <div class="settings-box">
          ${esc(state.dataPath)}<br/>
          应用内置每日安全备份 ${state.backupCount} 份（每次修改自动更新、保留最近 30 天，数据损坏时自动恢复）。<br/>
          <div class="form-actions" style="margin-top:8px">
            <button class="btn" data-action="import-json">📥 导入 JSON 备份…</button>
            <button class="btn" data-action="export-json">💾 导出 JSON 备份…</button>
          </div>
        </div>
      </div>
      <div class="form-actions"><button class="btn btn-primary" data-action="settings-save">保存设置</button></div>
    </div>
  `;
  const autoEl = $('#set-bgm-auto');
  if (autoEl) {
    autoEl.addEventListener('change', () => {
      const cfg = state.settings.bangumi || {};
      const next = { ...cfg, autoSync: autoEl.checked };
      call(api.updateSettings({ bangumi: next })).then(() => {
        state.settings.bangumi = next;
        toast(autoEl.checked ? '已开启自动同步' : '已关闭自动同步', 'success');
      }).catch(() => { /* 已提示 */ });
    });
  }
  const themeEl = $('#set-theme');
  if (themeEl) {
    themeEl.addEventListener('change', () => {
      const theme = themeEl.value;
      call(api.updateSettings({ theme })).then(() => {
        state.settings.theme = theme;
        toast(theme === 'system' ? '已切换为跟随系统' : theme === 'dark' ? '已切换为深色' : '已切换为浅色', 'success');
      }).catch(() => { /* 已提示 */ });
    });
  }
}


/* ---------- 日历 ---------- */
const cal = { year: 0, month: 0 };

function seasonFromDate(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{1,2})/);
  if (!m) return null;
  const q = [1, 4, 7, 10][Math.floor((Number(m[2]) - 1) / 3)];
  return m[1] + '-' + String(q).padStart(2, '0');
}

function broadcastDatesFor(a) {
  if (Array.isArray(a.airdates) && a.airdates.length) {
    return a.airdates.map((x) => String(x).slice(0, 10)).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  }
  const m = String(a.season || '').match(/^(\d{4})-(01|04|07|10)$/);
  if (!m || a.updateDay == null) return [];
  const year = Number(m[1]);
  const startMonth = Number(m[2]);
  const out = [];
  const dt = new Date(year, startMonth - 1, 1);
  const end = new Date(year, startMonth + 2, 0);
  while (dt <= end) {
    if (dt.getDay() === Number(a.updateDay)) {
      out.push(dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'));
    }
    dt.setDate(dt.getDate() + 1);
  }
  return out;
}

function calKey(y, m, d) {
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function calWatchByDate() {
  const map = {};
  for (const a of state.anime) {
    for (const e of (a.watchLog || [])) {
      const d = String(e.at).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (!map[d]) map[d] = [];
      const g = map[d].find((x) => x.title === a.title);
      if (g) g.eps.push(e.episode); else map[d].push({ title: a.title, eps: [e.episode] });
    }
  }
  return map;
}

function calBroadcastMap() {
  const map = new Map();
  for (const a of state.anime) {
    for (const d of broadcastDatesFor(a)) {
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(a.title);
    }
  }
  return map;
}

async function fetchMissingAirdates() {
  const pending = state.anime.filter((a) => a.bgmId && !(Array.isArray(a.airdates) && a.airdates.length));
  if (!pending.length) return;
  let got = 0;
  for (const a of pending) {
    try {
      const d = await call(api.bangumiDetail(a.bgmId));
      const patch = {};
      if (Array.isArray(d.airdates) && d.airdates.length && !(Array.isArray(a.airdates) && a.airdates.length)) patch.airdates = d.airdates;
      if (d.studio && !a.studio) patch.studio = d.studio;
      if (d.tags && !a.tags) patch.tags = d.tags;
      if (d.cast && !a.cast) patch.cast = d.cast;
      if (d.summary && !a.summary) patch.summary = d.summary;
      if (d.imageUrl && !a.coverUrl) patch.coverUrl = d.imageUrl;
      if (Object.keys(patch).length) {
        await call(api.updateAnime(a.id, patch));
        got += 1;
      }
    } catch (_) { /* 单条失败跳过 */ }
    await new Promise((r) => setTimeout(r, 900));
  }
  if (got > 0 && state.view === 'calendar') {
    const c = $('#content');
    if (c) renderCalendar(c);
    toast('已从 Bangumi 补全 ' + got + ' 部番剧的播出日期', 'success');
  }
}

function renderCalendar(c) {
  if (!cal.year) {
    const d = new Date();
    cal.year = d.getFullYear();
    cal.month = d.getMonth() + 1;
  }
  const year = cal.year, month = cal.month;
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const todayKey = new Date().toISOString().slice(0, 10);
  const watchByDate = calWatchByDate();
  const bcast = calBroadcastMap();
  const pendingCount = state.anime.filter((a) => a.bgmId && !(Array.isArray(a.airdates) && a.airdates.length)).length;
  const pendingNote = pendingCount
    ? '<div class="cal-note">⏳ ' + pendingCount + ' 部番剧缺少播出日期，正在从 Bangumi 补全…</div>'
    : '';

  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell empty"></div>';
  const monthDaily = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = calKey(year, month, d);
    const watched = watchByDate[key] || [];
    const bcasts = (bcast.get(key) || []).slice(0, 3);
    const more = (bcast.get(key) || []).length - bcasts.length;
    const cls = ['cal-cell'];
    if (key === todayKey) cls.push('today');
    if (watched.length) cls.push('has-watch');
    if (bcasts.length) cls.push('has-bcast');
    cells += '<div class="' + cls.join(' ') + '">' +
      '<div class="cal-day">' + d + '</div>' +
      watched.map((w) => '<div class="cal-watch">' + esc(w.title) + ' <em>第 ' + w.eps.slice().sort((x, y) => x - y).join('、') + ' 集</em></div>').join('') +
      bcasts.map((x) => '<div class="cal-bcast">' + esc(x) + '</div>').join('') +
      (more > 0 ? '<div class="cal-bcast more">…等 ' + (more + bcasts.length) + ' 部</div>' : '') +
      '</div>';
    if (watched.length) monthDaily.push({ date: key, items: watched });
  }
  const tail = (firstDow + daysInMonth) % 7;
  for (let i = 0; i < (tail === 0 ? 0 : 7 - tail); i++) cells += '<div class="cal-cell empty"></div>';

  const dailyHtml = monthDaily.length
    ? monthDaily.map((g) => '<div class="cal-daily-row">' +
        '<span class="cal-daily-date">' + esc(g.date) + '</span>' +
        '<span class="cal-daily-items">' + g.items.map((w) => esc(w.title) + ' 第 ' + w.eps.slice().sort((x, y) => x - y).join('、') + ' 集').join('；') + '</span>' +
      '</div>').join('')
    : '<div class="cal-note">本月没有观看记录</div>';

  c.innerHTML = `
    <div class="view-head">
      <h1>日历</h1>
      <span class="sub">播出日期 · 每日观看</span>
      <div class="spacer"></div>
      <button class="btn" data-action="cal-export">📤 导出 Excel</button>
    </div>
    <div class="cal-toolbar">
      <button class="btn" data-action="cal-prev">‹ 上月</button>
      <div class="cal-title">${year} 年 ${month} 月</div>
      <button class="btn" data-action="cal-next">下月 ›</button>
      <div class="spacer"></div>
      <div class="cal-legend"><span class="dot bcast"></span>播出&nbsp;&nbsp;<span class="dot watch"></span>观看</div>
    </div>
    ${pendingNote}
    <div class="cal-grid">
      ${DAY_LABELS.map((h) => '<div class="cal-head">' + h + '</div>').join('')}
      ${cells}
    </div>
    <div class="stats-section-title">本月观看明细</div>
    <div class="cal-daily-list">${dailyHtml}</div>
  `;
  fetchMissingAirdates();
}

function calMove(delta) {
  const dt = new Date(cal.year || new Date().getFullYear(), (cal.month || 1) - 1 + delta, 1);
  cal.year = dt.getFullYear();
  cal.month = dt.getMonth() + 1;
  const c = $('#content');
  if (c) renderCalendar(c);
}

async function doExportCalendar() {
  const year = cal.year || new Date().getFullYear();
  const month = cal.month || new Date().getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const watchByDate = calWatchByDate();
  const bcast = calBroadcastMap();
  const schedule = [];
  const daily = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const key = calKey(year, month, d);
    for (const title of (bcast.get(key) || [])) schedule.push({ date: key, title });
    for (const w of (watchByDate[key] || [])) {
      daily.push({ date: key, title: w.title, eps: w.eps.slice().sort((x, y) => x - y).join('、') });
    }
  }
  try {
    const p = await call(api.exportCalendarExcel({
      title: year + '年' + month + '月',
      year,
      month,
      defaultName: '番剧记录-日历-' + year + '-' + String(month).padStart(2, '0') + '.xlsx',
      schedule,
      daily,
    }));
    if (!p) return;
    toast('日历 Excel 已导出：' + p, 'success');
  } catch (e) { /* call 已提示 */ }
}

/* ---------- 弹窗 ---------- */
function renderModal(html) {
  $('#modal-root').innerHTML = `<div class="overlay"><div class="modal">${html}</div></div>`;
  const ov = $('.overlay');
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeModal(); });
}

function closeModal() {
  $('#modal-root').innerHTML = '';
}

function allSeasonOptions() {
  const map = new Map();
  const now = new Date();
  const year = now.getFullYear();
  for (let y = year + 1; y >= year - 7; y--) {
    for (const m of ['01', '04', '07', '10']) {
      const key = `${y}-${m}`;
      if (!map.has(key)) map.set(key, seasonLabel(key));
    }
  }
  for (const st of state.seasons) {
    if (st && st.key && !map.has(st.key)) map.set(st.key, st.label || seasonLabel(st.key));
  }
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
}

function seasonOptions(selectedKey) {
  const opts = allSeasonOptions();
  if (!opts.some(([k]) => k === selectedKey) && selectedKey) opts.push([selectedKey, seasonLabel(selectedKey)]);
  return opts.map(([k, label]) => `<option value="${k}" ${k === selectedKey ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

/* ---------- 观看记录 ---------- */
function lastWatchedAt(a) {
  const log = a && a.watchLog;
  if (!Array.isArray(log) || !log.length) return 0;
  let max = 0;
  for (const e of log) {
    const t = new Date(e.at).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max;
}

function formatWatchTime(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isoToLocalInput(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function renderWatchLog(log) {
  const listEl = $('#watch-log-list');
  if (!listEl) return;
  const arr = log || [];
  const total = Number($('#f-total').value) || 0;
  let maxEp = 0;
  for (const e of arr) maxEp = Math.max(maxEp, e.episode);
  const range = total >= 1 ? total : Math.max(1, Math.min(maxEp + 3, 200));
  const watchedMap = new Map(arr.map((e) => [e.episode, e.at]));
  let html = '';
  for (let ep = 1; ep <= range; ep++) {
    const at = watchedMap.get(ep);
    const cls = at ? 'ep-btn watched' : 'ep-btn';
    const timeInput = at
      ? `<input type="datetime-local" class="ep-time" data-ep="${ep}" value="${isoToLocalInput(at)}" />`
      : '';
    html += `<div class="${cls}" data-action="ep-toggle" data-ep="${ep}" title="${at ? '已看，点击取消' : '点击标记已看'}">
      <span class="ep-num">第${ep}集</span>${timeInput}
    </div>`;
  }
  listEl.innerHTML = html;
}

function doEpToggle(el, e) {
  if (e && e.target && e.target.classList && e.target.classList.contains('ep-time')) return;
  const ep = Number(el.dataset.ep);
  if (el.classList.contains('watched')) {
    el.classList.remove('watched');
    const timeInput = el.querySelector('.ep-time');
    if (timeInput) timeInput.remove();
    el.title = '点击标记已看';
  } else {
    el.classList.add('watched');
    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.className = 'ep-time';
    input.dataset.ep = String(ep);
    input.value = isoToLocalInput(new Date().toISOString());
    el.appendChild(input);
    el.title = '已看，点击取消';
  }
}

function collectWatchLog() {
  const out = [];
  document.querySelectorAll('.ep-btn.watched').forEach((btn) => {
    const ep = Number(btn.dataset.ep);
    const input = btn.querySelector('.ep-time');
    const at = localInputToIso(input ? input.value : '');
    if (Number.isInteger(ep) && ep > 0 && at) out.push({ episode: ep, at });
  });
  return out;
}

function ensureAllWatched(log, maxEp) {
  const arr = log || [];
  if (!maxEp || maxEp < 1) return arr;
  const map = new Map(arr.map((e) => [e.episode, e.at]));
  const now = new Date().toISOString();
  for (let ep = 1; ep <= maxEp; ep++) {
    if (!map.has(ep)) map.set(ep, now);
  }
  return Array.from(map.entries()).map(([episode, at]) => ({ episode, at }));
}

function formHTML() {
  const isEdit = modal.type === 'edit';
  const statusOpts = Object.keys(STATUS_META).map((k) =>
    `<option value="${k}">${STATUS_META[k].label}</option>`).join('');
  const dayOpts = ['', ...DAY_LABELS].map((d, i) =>
    `<option value="${i === 0 ? '' : i - 1}">${d === '' ? '不固定' : d}</option>`).join('');
  const ratingOpts = ['', ...Array.from({ length: 10 }, (_, i) => i + 1)].map((r) =>
    `<option value="${r}">${r === '' ? '未评分' : r + ' 分'}</option>`).join('');
  return `
  <div class="form-grid">
    <div class="form-field full"><label>番名 *</label><input id="f-title" type="text" placeholder="输入或从上方标签页选择" /></div>
    <div class="form-field"><label>季度 *</label><select id="f-season">${seasonOptions(modal.seasonKey === 'all' ? currentSeasonKey() : modal.seasonKey)}</select></div>
    <div class="form-field"><label>状态</label><select id="f-status">${statusOpts}</select></div>
    <div class="form-field"><label>总集数（可选）</label><input id="f-total" type="number" min="1" step="1" placeholder="如 12" /></div>
    <div class="form-field"><label>每周更新日</label><select id="f-day">${dayOpts}</select></div>
    <div class="form-field"><label>我的评分（1-10）</label><select id="f-rating">${ratingOpts}</select></div>
    <div class="form-field full"><label>短评（可选）</label><textarea id="f-comment" placeholder="一句话记录观感…"></textarea></div>
    <div class="form-field"><label>制作公司（可选）</label><input id="f-studio" type="text" placeholder="如 Studio Bind" /></div>
    <div class="form-field"><label>题材标签（可选，顿号/逗号分隔）</label><input id="f-tags" type="text" placeholder="如 异世界、奇幻、冒险" /></div>
    <div class="form-field full"><label>主要声优（可选，可点「从 Bangumi 补全」自动填写）</label><input id="f-cast" type="text" placeholder="如 鲁迪乌斯·格雷拉特（内山夕实）…" /></div>
    <div class="form-field full"><label>关联下载文件夹（可选，多个用分号隔开）</label><input id="f-folders" type="text" placeholder="如 D:\\ANIME\\花织" /></div>
    ${isEdit ? `
    <div class="form-field full">
      <label>观看记录（点击每集按钮标记已看，已看的集可修改观看时间，再点一次取消）</label>
      <div id="watch-log-list" class="watch-log-list"></div>
    </div>` : ''}
  </div>
  <div class="form-actions">
    ${isEdit ? '<button class="btn btn-danger" data-action="delete">删除</button>' : ''}
    ${isEdit ? '<button class="btn" data-action="bgm-fill">🔍 从 Bangumi 补全</button>' : ''}
    <span style="flex:1"></span>
    <button class="btn" data-action="close">取消</button>
    <button class="btn btn-primary" data-action="save">保存</button>
  </div>`;
}

function openAddModal(opts = {}) {
  modal.type = 'add';
  modal.editId = null;
  modal.seasonKey = opts.seasonKey || (state.view && /^\d{4}-/.test(state.view) ? state.view : currentSeasonKey());
  modal.selected = { ...(opts.prefill || {}) };
  renderModal(`
    <div class="modal-head"><h2>添加番剧</h2><button class="modal-close" data-action="close">✕</button></div>
    <div class="modal-body">
      <div class="tabs">
        <button class="tab active" data-action="tab" data-tab="season">当季新番</button>
        <button class="tab" data-action="tab" data-tab="bangumi">搜 Bangumi</button>
        <button class="tab" data-action="tab" data-tab="manual">手动填写</button>
      </div>
      <div class="tab-panel" data-panel="season">
        <div class="row">
          <select id="m-season"></select>
          <input id="m-season-search" type="text" placeholder="搜索新番…" />
        </div>
        <div id="m-season-list" class="pick-list"></div>
        <div class="hint" id="m-season-hint"></div>
      </div>
      <div class="tab-panel hidden" data-panel="bangumi">
        <div class="row">
          <input id="m-bgm-q" type="text" placeholder="输入番名，如：摇曳露营" />
          <button class="btn btn-primary" data-action="bgm-search">搜索</button>
        </div>
        <div id="m-bgm-list" class="pick-list"></div>
      </div>
      <div class="tab-panel hidden" data-panel="manual">${formHTML()}</div>
    </div>`);
  const sel = $('#m-season');
  sel.innerHTML = `<option value="all" ${modal.seasonKey === 'all' ? 'selected' : ''}>全部季度</option>` +
    allSeasonOptions().map(([k, label]) =>
      `<option value="${k}" ${k === modal.seasonKey ? 'selected' : ''}>${esc(label)}</option>`).join('');
  sel.addEventListener('change', () => loadSeasonShows(sel.value));
  $('#m-season-search').addEventListener('input', renderSeasonList);
  $('#m-bgm-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doBgmSearch(); });
  wireForm();
  fillForm(modal.selected);
  loadSeasonShows(sel.value);
}

function openEditModal(id) {
  const a = state.anime.find((x) => x.id === id);
  if (!a) return;
  modal.type = 'edit';
  modal.editId = id;
  modal.seasonKey = a.season;
  modal.selected = {
    bgmId: a.bgmId, bgmUrl: a.bgmUrl, coverUrl: a.coverUrl, summary: a.summary,
  };
  renderModal(`
    <div class="modal-head"><h2>编辑番剧</h2><button class="modal-close" data-action="close">✕</button></div>
    <div class="modal-body">${formHTML()}</div>`);
  wireForm();
  fillForm(a);
}

function wireForm() {
  const st = $('#f-status');
  if (st) {
    st.addEventListener('change', () => {
      if (st.value === 'completed' && $('#watch-log-list')) {
        const total = Number($('#f-total').value) || 0;
        const cur = collectWatchLog();
        const maxEp = total || (cur.length ? Math.max(...cur.map((x) => x.episode)) : 0);
        renderWatchLog(ensureAllWatched(cur, maxEp));
      }
    });
  }
}

function fillForm(v) {
  if (!$('#f-title')) return;
  $('#f-title').value = v.title || '';
  if (v.season) {
    let opt = $('#f-season').querySelector(`option[value="${v.season}"]`);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = v.season;
      opt.textContent = seasonLabel(v.season);
      $('#f-season').appendChild(opt);
    }
    $('#f-season').value = v.season;
  }
  if (v.status) $('#f-status').value = v.status;
  $('#f-total').value = v.totalEpisodes ?? '';
  $('#f-day').value = v.updateDay != null ? String(v.updateDay) : '';
  $('#f-rating').value = v.rating != null ? String(v.rating) : '';
  $('#f-comment').value = v.comment || '';
  if ($('#f-studio')) $('#f-studio').value = v.studio || '';
  if ($('#f-tags')) $('#f-tags').value = v.tags || '';
  if ($('#f-cast')) $('#f-cast').value = v.cast || '';
  $('#f-folders').value = Array.isArray(v.folders) ? v.folders.join('; ') : '';
  renderWatchLog(v.watchLog);
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
}

async function loadSeasonShows(key) {
  modal.seasonKey = key;
  const listEl = $('#m-season-list');
  const hintEl = $('#m-season-hint');
  listEl.innerHTML = '<div class="pick-empty">加载中…</div>';
  hintEl.textContent = '';
  try {
    const res = await call(api.seasonShows(key));
    modal.seasonItems = res.items || [];
    modal.seasonSource = res.source || '';
    renderSeasonList();
    if (modal.seasonSource === 'none') {
      hintEl.textContent = '该季度暂无可用的新番数据。可以切到「搜 Bangumi」或「手动填写」。';
    } else if (modal.seasonSource === 'all') {
      hintEl.textContent = `全部季度 · 共 ${modal.seasonItems.length} 部（本地数据优先，其余来自内置 yuc.wiki 目录）`;
    } else {
      const srcMap = {
        'yuc-live': 'yuc.wiki 实时',
        'bundled-catalog': '内置 yuc.wiki 目录',
      };
      hintEl.textContent = `数据来源：${srcMap[modal.seasonSource] || modal.seasonSource} · 共 ${modal.seasonItems.length} 部`;
    }
  } catch (e) {
    listEl.innerHTML = `<div class="pick-empty">读取失败：${esc(e.message)}</div>`;
  }
}

function renderSeasonList() {
  const listEl = $('#m-season-list');
  if (!listEl) return;
  const q = ($('#m-season-search').value || '').trim().toLowerCase();
  const isAll = modal.seasonKey === 'all';
  const items = modal.seasonItems.filter((it) => !q || String(it.title).toLowerCase().includes(q));
  if (!items.length) {
    listEl.innerHTML = '<div class="pick-empty">没有匹配的新番</div>';
    return;
  }
  listEl.innerHTML = items.map((item) => {
    const key = item.season || (isAll ? null : modal.seasonKey);
    const existing = key ? state.anime.find((a) => a.title === item.title && a.season === key) : null;
    const meta = [
      isAll ? seasonLabel(item.season || modal.seasonKey) : null,
      item.weekday, item.time,
      item.eps ? `全${item.eps}话` : '',
      item.studio,
      item.rating != null ? `评分 ${item.rating}` : '',
    ].filter(Boolean).join(' · ');
    const cover = item.coverUrl
      ? `<img class="cover" src="${esc(item.coverUrl)}" alt="" />`
      : '<div class="cover" style="display:flex;align-items:center;justify-content:center">🎬</div>';
    const addedBadge = existing
      ? `<span class="badge st-added">已添加 · ${esc(STATUS_META[existing.status] ? STATUS_META[existing.status].label : '')}</span>`
      : '';
    const pickCls = existing ? 'pick-item added' : 'pick-item';
    const pickAttr = existing ? '' : ' data-action="season-pick"';
    return `
    <div class="${pickCls}"${pickAttr}
      data-title="${esc(item.title)}"
      data-season="${esc(item.season || modal.seasonKey)}"
      data-bgm-id="${esc(item.bgmId || '')}"
      data-bgm-url="${esc(item.bgmUrl || '')}"
      data-cover-url="${esc(item.coverUrl || '')}"
      data-eps="${esc(item.eps || '')}"
      data-weekday-num="${esc(item.weekdayNum ?? '')}"
      data-summary="${esc(item.summary || '')}">
      ${cover}
      <div class="t">${esc(item.title)}</div>
      <div class="meta">${esc(meta)}</div>
      ${addedBadge}
    </div>`;
  }).join('');
  attachImgFallback(listEl);
}

async function doBgmSearch() {
  const q = $('#m-bgm-q').value.trim();
  if (!q) { toast('请输入番名关键词', 'warn'); return; }
  const listEl = $('#m-bgm-list');
  listEl.innerHTML = '<div class="pick-empty">搜索中…</div>';
  try {
    const items = await call(api.searchBangumi(q));
    if (!items.length) { listEl.innerHTML = '<div class="pick-empty">没有找到结果，试试更短的关键词，或切到「手动填写」</div>'; return; }
    listEl.innerHTML = items.map((it) => {
      const existing = state.anime.find((a) => a.title === it.title);
      const meta = [it.date, it.rating != null ? `评分 ${it.rating}` : '', it.name && it.name !== it.title ? it.name : ''].filter(Boolean).join(' · ');
      const cover = it.imageUrl
        ? `<img class="cover" src="${esc(it.imageUrl)}" alt="" />`
        : '<div class="cover" style="display:flex;align-items:center;justify-content:center">🎬</div>';
      const addedBadge = existing
        ? `<span class="badge st-added">已添加 · ${esc(STATUS_META[existing.status] ? STATUS_META[existing.status].label : '')}</span>`
        : '';
      const pickCls = existing ? 'pick-item added' : 'pick-item';
      const pickAttr = existing ? '' : ' data-action="bgm-pick"';
      return `
      <div class="${pickCls}"${pickAttr} data-id="${it.bgmId}">
        ${cover}
        <div class="t">${esc(it.title)}</div>
        <div class="meta">${esc(meta)}</div>
        ${addedBadge}
      </div>`;
    }).join('');
    attachImgFallback(listEl);
  } catch (e) {
    listEl.innerHTML = `<div class="pick-empty">搜索失败：${esc(e.message)}（可切到「手动填写」直接录入）</div>`;
  }
}

async function doBgmDetail(id) {
  try {
    const d = await call(api.bangumiDetail(id));
    const v = {
      title: d.title || '',
      totalEpisodes: d.totalEpisodes ?? d.eps ?? null,
      bgmId: d.bgmId,
      bgmUrl: null,
      coverUrl: d.imageUrl,
      summary: d.summary,
      studio: d.studio || '',
      tags: d.tags || '',
      cast: d.cast || '',
    };
    if (d.date) {
      const dm = String(d.date).match(/^(\d{4})-(\d{1,2})/);
      if (dm) {
        const q = [1, 4, 7, 10][Math.floor((Number(dm[2]) - 1) / 3)];
        v.season = `${dm[1]}-${String(q).padStart(2, '0')}`;
      }
    }
    fillForm(v);
    modal.selected = { bgmId: d.bgmId, coverUrl: d.imageUrl, summary: d.summary, airdates: d.airdates || [] };
    switchTab('manual');
    toast(`已从 Bangumi 填充「${v.title}」，可修改后保存`, 'success');
  } catch (e) {
    toast('获取详情失败：' + e.message, 'error');
  }
}

async function autoFillFromBangumi(title, bgmId) {
  let id = bgmId;
  if (!id) {
    try {
      const items = await call(api.searchBangumi(title));
      const hit = items.find((it) => it.title === title) || items[0];
      if (!hit) return;
      id = hit.bgmId;
    } catch (_) { return; }
  }
  try {
    const d = await call(api.bangumiDetail(id));
    const v = {
      title: d.title || title,
      totalEpisodes: d.totalEpisodes != null ? d.totalEpisodes : null,
      bgmId: d.bgmId || id,
      coverUrl: d.imageUrl,
      summary: d.summary,
      studio: d.studio || '',
      tags: d.tags || '',
      cast: d.cast || '',
      airdates: d.airdates || [],
    };
    fillForm(v);
    modal.selected = {
      bgmId: v.bgmId,
      coverUrl: v.coverUrl,
      summary: v.summary,
      airdates: v.airdates,
    };
    toast('已自动从 Bangumi 补全「' + v.title + '」的信息', 'success');
  } catch (_) { /* 静默失败，保留原填充 */ }
}

function seasonPick(el) {
  const season = el.dataset.season && el.dataset.season !== 'all' ? el.dataset.season : currentSeasonKey();
  const v = {
    title: el.dataset.title,
    season,
    totalEpisodes: el.dataset.eps || null,
    updateDay: el.dataset.weekdayNum === '' ? null : Number(el.dataset.weekdayNum),
    bgmId: el.dataset.bgmId || null,
    bgmUrl: el.dataset.bgmUrl || null,
    coverUrl: el.dataset.coverUrl || null,
    summary: el.dataset.summary || null,
  };
  modal.selected = {
    bgmId: v.bgmId, bgmUrl: v.bgmUrl, coverUrl: v.coverUrl, summary: v.summary,
  };
  fillForm(v);
  switchTab('manual');
  toast(`已填充「${v.title}」，正在自动补全 Bangumi 信息…`, 'info');
  autoFillFromBangumi(v.title, v.bgmId);
}

async function submitForm() {
  const title = $('#f-title').value.trim();
  if (!title) { toast('请填写番名', 'warn'); return; }
  const entry = {
    title,
    season: $('#f-season').value,
    status: $('#f-status').value,
    totalEpisodes: $('#f-total').value === '' ? null : Number($('#f-total').value),
    updateDay: $('#f-day').value === '' ? null : Number($('#f-day').value),
    rating: $('#f-rating').value === '' ? null : Number($('#f-rating').value),
    comment: $('#f-comment').value.trim(),
    studio: $('#f-studio').value.trim(),
    tags: $('#f-tags').value.trim(),
    cast: $('#f-cast').value.trim(),
    folders: $('#f-folders').value.split(/[;；,，]/).map((s) => s.trim()).filter(Boolean),
    watchLog: collectWatchLog(),
    ...modal.selected,
  };
  if (entry.status === 'completed') {
    const logMax = entry.watchLog.length ? Math.max(...entry.watchLog.map((x) => x.episode)) : 0;
    entry.watchLog = ensureAllWatched(entry.watchLog, entry.totalEpisodes || logMax);
  }
  entry.episode = entry.watchLog && entry.watchLog.length
    ? Math.max(...entry.watchLog.map((x) => x.episode))
    : 0;
  const allWatched = entry.totalEpisodes && entry.watchLog.length >= entry.totalEpisodes;
  if (allWatched) entry.status = 'completed';
  else if (modal.type === 'edit' && entry.status === 'plan' && entry.episode > 0) entry.status = 'watching';
  try {
    if (modal.type === 'edit') {
      await call(api.updateAnime(modal.editId, entry));
      toast('已保存修改', 'success');
    } else {
      const item = await call(api.addAnime(entry));
      toast(`已添加「${item.title}」`, 'success');
    }
    closeModal();
    await refresh();
  } catch (e) { /* call 已提示 */ }
}

async function doDelete() {
  if (!modal.editId) return;
  const a = state.anime.find((x) => x.id === modal.editId);
  if (!window.confirm(`确定删除「${a ? a.title : ''}」吗？`)) return;
  try {
    await call(api.deleteAnime(modal.editId));
    toast('已删除', 'success');
    closeModal();
    await refresh();
  } catch (e) { /* 已提示 */ }
}

async function doBump(id) {
  try {
    const a = await call(api.bumpAnime(id));
    toast(a.status === 'completed' ? `「${a.title}」已看完 🎉` : `「${a.title}」看到第 ${a.episode} 集`, 'success');
    await refresh();
  } catch (e) { /* 已提示 */ }
}

async function doComplete(id) {
  try {
    const a = state.anime.find((x) => x.id === id);
    const maxEp = a.totalEpisodes || Math.max(0, ...(a.watchLog || []).map((x) => x.episode));
    const watchLog = ensureAllWatched(a.watchLog || [], maxEp);
    const ep = watchLog.length ? Math.max(...watchLog.map((x) => x.episode)) : (a.episode || 0);
    await call(api.updateAnime(id, { status: 'completed', watchLog, episode: ep }));
    toast(`「${a ? a.title : ''}」已标记看完 🎉`, 'success');
    await refresh();
  } catch (e) { /* 已提示 */ }
}

/* ---------- 扫描 ---------- */
function openScanModal() {
  renderModal(`
    <div class="modal-head"><h2>扫描下载目录</h2><button class="modal-close" data-action="close">✕</button></div>
    <div class="modal-body">
      <div class="hint">扫描文件夹里的视频文件（mp4 / mkv / rmvb 等），自动识别番名和已下载集数，并与你的记录比对。</div>
      <div class="row">
        <input id="s-path" type="text" placeholder="文件夹路径，如 D:\\ANIME\\花织" />
        <button class="btn" data-action="scan-run">扫描</button>
        <button class="btn btn-primary" data-action="scan-pick">选择文件夹…</button>
      </div>
      <div id="s-result"></div>
    </div>`);
}

async function doScanPick() {
  try {
    const res = await call(api.pickAndScan());
    if (!res) return;
    modal.scanFolder = res.folder;
    renderScanResult(res);
  } catch (e) { /* 已提示 */ }
}

async function doScanRun() {
  const p = $('#s-path').value.trim();
  if (!p) { toast('请输入文件夹路径', 'warn'); return; }
  try {
    const res = await call(api.scanFolder(p));
    modal.scanFolder = p;
    renderScanResult(res);
  } catch (e) { /* 已提示 */ }
}

function renderScanResult(res) {
  const box = $('#s-result');
  if (!box) return;
  const head = `<div class="hint">${esc(res.folder)} · 共 ${res.totalFiles} 个视频，识别出 ${res.groups.length} 部番，${res.skipped} 个无法识别</div>`;
  const items = res.matches.map((m) => {
    const g = m.group;
    const dl = g.count === 1 ? `已下载 1 集（第 ${g.minEpisode} 集）` : `已下载 ${g.count} 集（第 ${g.minEpisode}–${g.maxEpisode} 集）`;
    const note = m.matched
      ? (m.matched.episode < g.maxEpisode
        ? `<div class="card-dl">⚠ 已下载到第 ${g.maxEpisode} 集，但只看到第 ${m.matched.episode} 集</div>`
        : `<div class="card-dl">✓ 已看到第 ${m.matched.episode} 集，进度一致</div>`)
      : '';
    const badge = m.matched
      ? '<span class="badge st-watching">已关联</span>'
      : '<span class="badge st-plan">未关联</span>';
    const btn = m.matched ? '' : `<button class="btn btn-primary" data-action="scan-add" data-title="${esc(g.title)}">添加</button>`;
    return `
    <div class="pick-item">
      <div class="t"><strong>${esc(g.title)}</strong><div style="color:var(--text-dim);font-size:12px">${esc(dl)}</div>${note}</div>
      ${badge}${btn}
    </div>`;
  }).join('');
  box.innerHTML = head + (items ? `<div class="pick-list">${items}</div>` : '<div class="pick-empty">没有识别到任何番剧文件</div>');
}

function scanAdd(el) {
  closeModal();
  openAddModal({
    prefill: { title: el.dataset.title, folders: [modal.scanFolder] },
  });
}

/* ---------- 导入 / 导出 ---------- */
async function doImportJson() {
  try {
    const res = await call(api.importJson());
    if (!res) return;
    state.pendingImportJson = res.file;
    const sample = (res.firstTitles || []).map((t) =>
      `<div class="pick-item"><div class="t">${esc(t)}</div></div>`).join('');
    renderModal(`
      <div class="modal-head"><h2>导入 JSON 备份</h2><button class="modal-close" data-action="close">✕</button></div>
      <div class="modal-body">
        <div class="hint">该备份包含 <strong>${res.animeCount}</strong> 部番剧记录${res.hasSettings ? '，以及应用设置' : ''}。导入将<strong>替换</strong>当前数据，导入前会先自动备份当前数据，可随时从「导出/备份」恢复。</div>
        ${sample}
        <div class="form-actions">
          <span style="flex:1"></span>
          <button class="btn" data-action="close">取消</button>
          <button class="btn btn-primary" data-action="import-json-confirm">确认导入</button>
        </div>
      </div>`);
  } catch (e) { /* call 已提示 */ }
}

async function doImportJsonApply() {
  try {
    const res = await call(api.importJsonApply(state.pendingImportJson));
    toast(`备份导入完成：${res.animeCount} 部番剧`, 'success');
    closeModal();
    await refresh();
  } catch (e) { /* call 已提示 */ }
}

async function doExport(kind) {
  try {
    const p = kind === 'excel' ? await call(api.exportExcel()) : await call(api.exportJson());
    if (!p) return;
    toast(`已导出到：${p}`, 'success');
  } catch (e) { /* 已提示 */ }
}

/* ---------- 设置 ---------- */
async function saveSettings() {
  const base = $('#set-base').value.trim();
  const cur = state.settings.autoBackup || {};
  const curBgm = state.settings.bangumi || {};
  const patch = {
    theme: $('#set-theme') ? $('#set-theme').value : (state.settings.theme || 'system'),
    animeInfoBaseDir: base,
    autoBackup: {
      ...cur,
      enabled: $('#ab-enabled') ? $('#ab-enabled').checked : !!cur.enabled,
      interval: $('#ab-interval') ? $('#ab-interval').value : (cur.interval || 'daily'),
      folder: $('#ab-folder') ? $('#ab-folder').value.trim() : (cur.folder || ''),
      keep: $('#ab-keep') ? (Number($('#ab-keep').value) || 30) : (cur.keep || 30),
    },
    bangumi: {
      ...curBgm,
      uid: $('#set-bgm-uid') ? $('#set-bgm-uid').value.trim() : (curBgm.uid || ''),
      autoSync: $('#set-bgm-auto') ? $('#set-bgm-auto').checked : !!curBgm.autoSync,
    },
  };
  try {
    await call(api.updateSettings(patch));
    toast('设置已保存', 'success');
    await refresh();
  } catch (e) { /* 已提示 */ }
}

async function doBgmFill() {
  if (!modal.editId) return;
  const a = state.anime.find((x) => x.id === modal.editId);
  if (!a) return;
  let id = a.bgmId;
  if (!id) {
    try {
      const items = await call(api.searchBangumi(a.title));
      const hit = items.find((it) => it.title === a.title) || items[0];
      if (!hit) { toast('Bangumi 未找到「' + a.title + '」', 'warn'); return; }
      id = hit.bgmId;
    } catch (e) { toast('搜索失败：' + e.message, 'error'); return; }
  }
  try {
    const d = await call(api.bangumiDetail(id));
    fillForm({
      ...a,
      title: d.title || a.title,
      totalEpisodes: d.totalEpisodes != null ? d.totalEpisodes : (a.totalEpisodes ?? null),
      bgmId: d.bgmId || a.bgmId,
      coverUrl: d.imageUrl || a.coverUrl,
      summary: d.summary || a.summary,
      studio: d.studio || a.studio || '',
      tags: d.tags || a.tags || '',
      cast: d.cast || a.cast || '',
      airdates: d.airdates || a.airdates || [],
    });
    modal.selected = {
      bgmId: d.bgmId || a.bgmId,
      coverUrl: d.imageUrl || a.coverUrl,
      summary: d.summary || a.summary,
      airdates: d.airdates || a.airdates || [],
    };
    toast('已从 Bangumi 补全「' + a.title + '」的信息，保存后生效', 'success');
  } catch (e) { toast('获取 Bangumi 详情失败：' + e.message, 'error'); }
}

async function doBangumiEnrich() {
  const all = state.anime;
  if (!all.length) { toast('还没有任何番剧记录', 'info'); return; }
  toast('开始从 Bangumi 补全 ' + all.length + ' 部番剧的信息…', 'info');
  let done = 0;
  let failed = 0;
  for (const a of all) {
    let id = a.bgmId;
    if (!id) {
      try {
        const items = await call(api.searchBangumi(a.title));
        const hit = items.find((it) => it.title === a.title) || items[0];
        if (!hit) { failed += 1; continue; }
        id = hit.bgmId;
      } catch (_) { failed += 1; continue; }
    }
    try {
      const d = await call(api.bangumiDetail(id));
      const patch = {};
      if (id && String(id) !== String(a.bgmId)) patch.bgmId = id;
      if (d.studio && !a.studio) patch.studio = d.studio;
      if (d.tags && !a.tags) patch.tags = d.tags;
      if (d.cast && !a.cast) patch.cast = d.cast;
      if (d.summary && !a.summary) patch.summary = d.summary;
      if (Array.isArray(d.airdates) && d.airdates.length && !(Array.isArray(a.airdates) && a.airdates.length)) patch.airdates = d.airdates;
      if (d.imageUrl && !a.coverUrl) patch.coverUrl = d.imageUrl;
      if (d.totalEpisodes && !a.totalEpisodes) patch.totalEpisodes = d.totalEpisodes;
      if (Object.keys(patch).length) {
        await call(api.updateAnime(a.id, patch));
        done += 1;
      }
    } catch (_) { failed += 1; }
    await new Promise((r) => setTimeout(r, 700));
  }
  toast('Bangumi 信息补全完成：更新 ' + done + ' 部' + (failed ? '，失败 ' + failed + ' 部' : ''), done ? 'success' : 'warn');
  await refresh();
}

async function doBangumiSync(silent) {
  const cfg = state.settings.bangumi || {};
  const uidInput = $('#set-bgm-uid');
  const uid = (uidInput && uidInput.value.trim()) || cfg.uid || '';
  if (!uid) {
    if (!silent) toast('请先在设置里填写 Bangumi UID', 'warn');
    return;
  }
  if (uid !== cfg.uid) {
    try {
      await call(api.updateSettings({ bangumi: { ...cfg, uid } }));
      state.settings.bangumi = { ...cfg, uid };
    } catch (_) { /* 忽略 */ }
  }
  let items;
  try {
    items = await call(api.bangumiCollections(uid));
  } catch (e) {
    if (!silent) toast('同步失败：' + e.message, 'error');
    return;
  }
  const added = [];
  const skipped = [];
  for (const it of items) {
    if (!it.title) continue;
    const season = seasonFromDate(it.date);
    if (!season) continue;
    const exists = state.anime.some((a) =>
      (a.bgmId && it.bgmId && String(a.bgmId) === String(it.bgmId)) ||
      (a.title === it.title && a.season === season));
    if (exists) { skipped.push(it.title); continue; }
    try {
      const extra = {};
      if (it.bgmId) {
        try {
          const d = await call(api.bangumiDetail(it.bgmId));
          extra.studio = d.studio || '';
          extra.tags = d.tags || '';
          extra.cast = d.cast || '';
          extra.summary = d.summary || '';
          extra.airdates = d.airdates || [];
          extra.coverUrl = d.imageUrl || it.imageUrl || '';
          extra.totalEpisodes = d.totalEpisodes != null ? d.totalEpisodes : it.totalEpisodes;
        } catch (_) { /* 详情失败则用收藏基础信息 */ }
      }
      await call(api.addAnime({
        title: it.title,
        season,
        status: it.status,
        episode: it.episode,
        totalEpisodes: extra.totalEpisodes != null ? extra.totalEpisodes : it.totalEpisodes,
        bgmId: it.bgmId,
        coverUrl: extra.coverUrl || it.imageUrl || '',
        studio: extra.studio || '',
        tags: extra.tags || '',
        cast: extra.cast || '',
        summary: extra.summary || '',
        airdates: extra.airdates || [],
      }));
      added.push(it.title);
    } catch (e) {
      skipped.push(it.title + '（' + e.message + '）');
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  let matched = 0;
  for (const it of items) {
    const local = state.anime.find((a) => !a.bgmId && a.title === it.title);
    if (local && it.bgmId) {
      try {
        await call(api.updateAnime(local.id, { bgmId: it.bgmId }));
        matched += 1;
      } catch (_) { /* 忽略 */ }
    }
  }
  const autoChk = $('#set-bgm-auto');
  const autoSync = autoChk ? autoChk.checked : !!(state.settings.bangumi || {}).autoSync;
  const cfg2 = { ...(state.settings.bangumi || {}), autoSync, lastSyncAt: new Date().toISOString() };
  try {
    await call(api.updateSettings({ bangumi: cfg2 }));
    state.settings.bangumi = cfg2;
  } catch (_) { /* 忽略 */ }
  if (!silent || added.length) {
    toast('Bangumi 同步完成：新增 ' + added.length + ' 部，跳过 ' + skipped.length + ' 部' + (matched ? '，补全 bgmId ' + matched + ' 部' : ''), added.length ? 'success' : 'info');
  }
  if (added.length) await refresh();
}

async function doBackupNow() {
  try {
    const res = await call(api.backupNow());
    if (!res) return;
    toast(`已备份到：${res.path}`, 'success');
    await refresh();
  } catch (e) { /* 已提示 */ }
}


/* ---------- 事件绑定 ---------- */
function bindGlobal() {
  $('#search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
  $('#status-filter').addEventListener('change', (e) => { state.status = e.target.value; render(); });
  $('#sort-order').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
  $('#btn-add').addEventListener('click', () => openAddModal({}));
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-view]');
    if (nav) {
      state.view = nav.dataset.view;
      state.search = '';
      state.status = '';
      $('#search').value = '';
      $('#status-filter').value = '';
      renderSidebar();
      render();
      return;
    }

    const act = e.target.closest('[data-action]');
    if (act) handleAction(act, e);
  });
}

function handleAction(el, e) {
  const action = el.dataset.action;
  switch (action) {
    case 'close': closeModal(); break;
    case 'ep-toggle': doEpToggle(el, e); break;
    case 'add': openAddModal({ seasonKey: el.dataset.season }); break;
    case 'edit': openEditModal(el.dataset.id); break;
    case 'bump': doBump(el.dataset.id); break;
    case 'complete': doComplete(el.dataset.id); break;
    case 'delete': doDelete(); break;
    case 'tab': switchTab(el.dataset.tab); break;
    case 'season-pick': seasonPick(el); break;
    case 'bgm-search': doBgmSearch(); break;
    case 'bgm-pick': doBgmDetail(el.dataset.id); break;
    case 'save': submitForm(); break;
    case 'scan': openScanModal(); break;
    case 'scan-pick': doScanPick(); break;
    case 'scan-run': doScanRun(); break;
    case 'scan-add': scanAdd(el); break;
    case 'import-json': doImportJson(); break;
    case 'import-json-confirm': doImportJsonApply(); break;
    case 'export-excel': doExport('excel'); break;
    case 'export-json': doExport('json'); break;
    case 'settings-save': saveSettings(); break;
    case 'backup-now': doBackupNow(); break;
    case 'export-stats': doExportStatsChart(); break;
    case 'export-html-report': openReportModal(); break;
    case 'report-generate': doExportHtmlReport(); break;
    case 'cal-prev': calMove(-1); break;
    case 'cal-next': calMove(1); break;
    case 'cal-export': doExportCalendar(); break;
    case 'bangumi-sync': doBangumiSync(false); break;
    case 'bgm-fill': doBgmFill(); break;
    case 'bangumi-enrich': doBangumiEnrich(); break;
    default: break;
  }
}

init();

