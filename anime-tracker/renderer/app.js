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
    toast(`\u68c0\u6d4b\u5230\u65b0\u7684\u5b63\u5ea6\u6570\u636e\uff1a${s ? s.label : seasonLabel(k)}\uff0c\u5df2\u81ea\u52a8\u5bfc\u5165\u300c\u5f53\u5b63\u65b0\u756a\u300d`, 'success');
  }
  saveKnownSeasons(keys);
}

/* ---------- 初始化 ---------- */
async function init() {
  bindGlobal();
  await refresh();
  const autoCheck = async () => {
    try {
      const seasons = await call(api.listSeasons());
      detectNewSeasons(seasons);
      state.seasons = seasons;
      renderSidebar();
    } catch (_) { /* \u5ffd\u7565 */ }
  };
  setInterval(autoCheck, 10 * 60 * 1000);
  window.addEventListener('focus', autoCheck);
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
  <div class="card">
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
      <button class="btn btn-primary" data-action="add" data-season="${key}">＋ 添加番剧</button>
    </div>
    ${list.length ? `<div class="cards">${list.map(cardHTML).join('')}</div>` : emptyHTML('这个季度还没有记录，添加一部番剧吧')}
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
        <button class="btn btn-primary" data-action="add">＋ 添加番剧</button>
      </div>
      ${sorted.length ? `
      <div class="quarter-section">
        <div class="quarter-title"><span class="dot"></span>最近观看<span class="n">${sorted.length} 部</span></div>
        <div class="cards">${sorted.map(cardHTML).join('')}</div>
      </div>` : emptyHTML('还没有任何记录，添加一部番剧吧')}
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
      <button class="btn btn-primary" data-action="add">＋ 添加番剧</button>
    </div>
    ${keys.length ? keys.map((k) => `
      <div class="quarter-section">
        <div class="quarter-title"><span class="dot"></span>${esc(seasonLabel(k))}<span class="n">${bySeason[k].length} 部</span></div>
        <div class="cards">${bySeason[k].map(cardHTML).join('')}</div>
      </div>`).join('') : emptyHTML('还没有任何记录，添加一部番剧吧')}
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

function statusBreakdown() {
  const defs = [
    { key: 'watching', label: '在看', color: '#7ee2a8' },
    { key: 'completed', label: '看完', color: '#8ab4f8' },
    { key: 'on_hold', label: '搁置', color: '#f7c784' },
    { key: 'dropped', label: '弃番', color: '#9aa0a6' },
    { key: 'plan', label: '想看', color: '#f89164' },
  ];
  return defs
    .map((d) => ({ label: d.label, value: state.anime.filter((a) => a.status === d.key).length, color: d.color }))
    .filter((x) => x.value > 0);
}

function monthlyWatchData() {
  const map = {};
  for (const a of state.anime) {
    for (const e of (a.watchLog || [])) {
      const m = String(e.at).slice(0, 7);
      if (m) map[m] = (map[m] || 0) + 1;
    }
  }
  return Object.keys(map).sort().map((k) => ({ label: k.slice(2) + '月', value: map[k] }));
}

function quarterCountData() {
  const map = {};
  for (const a of state.anime) {
    map[a.season] = (map[a.season] || 0) + 1;
  }
  return Object.keys(map).sort().map((k) => ({ label: k.slice(2) + '月', value: map[k] }));
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
  ctx.fillStyle = '#9a9aab';
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
    ctx.fillStyle = '#9a9aab';
    ctx.fillText(String(it.label), x + barW / 2, H - 5 * sc);
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
  ctx.fillStyle = '#14141a';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e9e9f2';
  ctx.font = 'bold 14px "Microsoft YaHei UI"';
  ctx.textAlign = 'center';
  ctx.fillText(String(total), cx, cy + 5);
  ctx.textAlign = 'left';
}

function drawStatsCharts(statusItems, monthItems, qCounts, qEps) {
  const cs = $('#chart-status');
  if (cs) drawDonut(cs, statusItems);
  const cm = $('#chart-month');
  if (cm) drawBarChart(cm, monthItems);
  const cq = $('#chart-qcount');
  if (cq) drawBarChart(cq, qCounts, { color0: '#7db4ff', color1: '#3d8bff' });
  const ce = $('#chart-qeps');
  if (ce) drawBarChart(ce, qEps, { color0: '#7ee2a8', color1: '#2f9e63' });
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
    <div class="stats-section-title">图表</div>
    <div class="charts-grid">
      <div class="chart-card"><h3>状态分布</h3><canvas id="chart-status" width="380" height="240"></canvas></div>
      <div class="chart-card"><h3>每月观看次数</h3><canvas id="chart-month" width="460" height="240"></canvas></div>
      <div class="chart-card"><h3>各季度番剧数</h3><canvas id="chart-qcount" width="460" height="240"></canvas></div>
      <div class="chart-card"><h3>各季度累计集数</h3><canvas id="chart-qeps" width="460" height="240"></canvas></div>
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
  drawStatsCharts(statusItems, monthItems, qCounts, qEps);
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
  c.innerHTML = `
    <div class="view-head"><h1>设置</h1></div>
    <div class="settings-panel">
      <div class="field">
        <label>动画信息数据目录（读取当季新番）</label>
        <input id="set-base" type="text" value="${esc(state.settings.animeInfoBaseDir || '')}" />
        <div class="hint" style="margin-top:6px">默认：D:\\ANIME\\日本TV动画信息。应用会读取季度文件夹里的 bangumi JSON；缺失时解析其中的「新番信息.docx」或内置 yuc.wiki 目录。</div>
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
        <label>数据文件</label>
        <div class="settings-box">
          ${esc(state.dataPath)}<br/>
          应用内置每日安全备份 ${state.backupCount} 份（每次修改自动更新、保留最近 30 天，数据损坏时自动恢复）。<br/>
          手动备份：用上方「立即备份」，或顶部菜单「导出 JSON 备份」；「导入 JSON 备份」可恢复旧备份。
        </div>
      </div>
      <div class="form-actions"><button class="btn btn-primary" data-action="settings-save">保存设置</button></div>
    </div>
  `;
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
    <div class="form-field full"><label>关联下载文件夹（可选，多个用分号隔开）</label><input id="f-folders" type="text" placeholder="如 D:\\ANIME\\花织" /></div>
    ${isEdit ? `
    <div class="form-field full">
      <label>观看记录（点击每集按钮标记已看，已看的集可修改观看时间，再点一次取消）</label>
      <div id="watch-log-list" class="watch-log-list"></div>
    </div>` : ''}
  </div>
  <div class="form-actions">
    ${isEdit ? '<button class="btn btn-danger" data-action="delete">删除</button>' : ''}
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
        'bangumi-json': 'Bangumi JSON',
        'season-json': '季度 JSON',
        'docx': '新番信息 docx',
        'yuc-json': 'yuc JSON',
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
    return `
    <div class="pick-item" data-action="season-pick"
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
      const meta = [it.date, it.rating != null ? `评分 ${it.rating}` : '', it.name && it.name !== it.title ? it.name : ''].filter(Boolean).join(' · ');
      const cover = it.imageUrl
        ? `<img class="cover" src="${esc(it.imageUrl)}" alt="" />`
        : '<div class="cover" style="display:flex;align-items:center;justify-content:center">🎬</div>';
      return `
      <div class="pick-item" data-action="bgm-pick" data-id="${it.bgmId}">
        ${cover}
        <div class="t">${esc(it.title)}</div>
        <div class="meta">${esc(meta)}</div>
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
    };
    if (d.date) {
      const dm = String(d.date).match(/^(\d{4})-(\d{1,2})/);
      if (dm) {
        const q = [1, 4, 7, 10][Math.floor((Number(dm[2]) - 1) / 3)];
        v.season = `${dm[1]}-${String(q).padStart(2, '0')}`;
      }
    }
    fillForm(v);
    modal.selected = { bgmId: d.bgmId, coverUrl: d.imageUrl, summary: d.summary };
    switchTab('manual');
    toast(`已从 Bangumi 填充「${v.title}」，可修改后保存`, 'success');
  } catch (e) {
    toast('获取详情失败：' + e.message, 'error');
  }
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
  toast(`已填充「${v.title}」，可修改后保存`, 'success');
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
function openImportModal() {
  renderModal(`
    <div class="modal-head"><h2>导入 Excel 记录</h2><button class="modal-close" data-action="close">✕</button></div>
    <div class="modal-body">
      <div class="hint">导入你现有的「已经 将要 看.xlsx」（年份 → 季度 → 番名结构）。已存在的条目会自动跳过，不会覆盖已有进度。</div>
      <div class="row"><button class="btn btn-primary" data-action="import-pick">选择 Excel 文件…</button></div>
      <div id="i-result"></div>
    </div>`);
}

async function doImportPick() {
  try {
    const res = await call(api.importExcel());
    if (!res) return;
    modal.pendingImport = res.fresh || [];
    const box = $('#i-result');
    const preview = (res.fresh || []).slice(0, 20).map((it) =>
      `<div class="pick-item"><div class="t">${esc(it.title)}</div><div class="meta">${esc(seasonLabel(it.season))}</div></div>`).join('');
    const more = (res.fresh || []).length > 20 ? `<div class="pick-empty">…共 ${res.fresh.length} 部待导入</div>` : '';
    box.innerHTML = `
      <div class="hint">${esc(res.file)} · 共 ${res.total} 条记录：${res.fresh.length} 部新增，${(res.skipped || []).length} 部已存在</div>
      ${preview}${more}
      ${res.fresh.length ? '<div class="form-actions"><button class="btn btn-primary" data-action="import-apply">确认导入</button></div>' : ''}
    `;
  } catch (e) { /* 已提示 */ }
}

async function doImportApply() {
  try {
    const res = await call(api.importExcelApply(modal.pendingImport));
    toast(`导入完成：新增 ${res.added.length} 部，跳过 ${res.skipped.length} 部`, 'success');
    closeModal();
    await refresh();
  } catch (e) { /* 已提示 */ }
}

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
  const patch = {
    animeInfoBaseDir: base,
    autoBackup: {
      ...cur,
      enabled: $('#ab-enabled') ? $('#ab-enabled').checked : !!cur.enabled,
      interval: $('#ab-interval') ? $('#ab-interval').value : (cur.interval || 'daily'),
      folder: $('#ab-folder') ? $('#ab-folder').value.trim() : (cur.folder || ''),
      keep: $('#ab-keep') ? (Number($('#ab-keep').value) || 30) : (cur.keep || 30),
    },
  };
  try {
    await call(api.updateSettings(patch));
    toast('设置已保存', 'success');
    await refresh();
  } catch (e) { /* 已提示 */ }
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
  $('#btn-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#menu-dropdown').classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    const dd = $('#menu-dropdown');
    if (dd && !dd.classList.contains('hidden') && !e.target.closest('.dropdown-wrap')) dd.classList.add('hidden');

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
    case 'import-excel': openImportModal(); break;
    case 'import-json': doImportJson(); break;
    case 'import-json-confirm': doImportJsonApply(); break;
    case 'import-pick': doImportPick(); break;
    case 'import-apply': doImportApply(); break;
    case 'export-excel': doExport('excel'); break;
    case 'export-json': doExport('json'); break;
    case 'settings-save': saveSettings(); break;
    case 'backup-now': doBackupNow(); break;
    case 'export-stats': doExportStatsChart(); break;
    default: break;
  }
}

init();

