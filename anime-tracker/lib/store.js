'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALID_STATUS = new Set(['watching', 'completed', 'dropped', 'on_hold', 'plan']);
const SEASON_RE = /^(\d{4})-(01|04|07|10)$/;

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeSeason(v) {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})[-年](\d{1,2})月?$/);
  if (!m) return null;
  const month = String(Number(m[2])).padStart(2, '0');
  if (!SEASON_RE.test(`${m[1]}-${month}`)) return null;
  return `${m[1]}-${month}`;
}

function validateEntry(input) {
  const e = input || {};
  const errs = [];
  if (!e.title || !String(e.title).trim()) errs.push('标题不能为空');
  const season = normalizeSeason(e.season);
  if (!season) errs.push(`季度格式不正确: ${e.season}`);
  if (!VALID_STATUS.has(e.status)) errs.push(`状态无效: ${e.status}`);

  const episode = Number(e.episode);
  if (!Number.isInteger(episode) || episode < 0) errs.push('当前集数必须是非负整数');

  let totalEpisodes = e.totalEpisodes;
  if (totalEpisodes === '' || totalEpisodes === null || totalEpisodes === undefined) totalEpisodes = null;
  else {
    totalEpisodes = Number(totalEpisodes);
    if (!Number.isInteger(totalEpisodes) || totalEpisodes < 1) errs.push('总集数必须是正整数');
  }

  let rating = e.rating;
  if (rating === '' || rating === null || rating === undefined) rating = null;
  else {
    rating = Number(rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) errs.push('评分必须在 1-10 之间');
  }

  let updateDay = e.updateDay;
  if (updateDay === '' || updateDay === null || updateDay === undefined) updateDay = null;
  else {
    updateDay = Number(updateDay);
    if (!Number.isInteger(updateDay) || updateDay < 0 || updateDay > 6) errs.push('更新日必须在 0-6 之间');
  }

  let watchLog = e.watchLog;
  if (!Array.isArray(watchLog)) watchLog = [];
  watchLog = watchLog
    .filter((x) => x && Number.isInteger(Number(x.episode)) && Number(x.episode) > 0 && x.at
      && !Number.isNaN(new Date(x.at).getTime()))
    .map((x) => ({ episode: Number(x.episode), at: String(x.at) }))
    .slice(-300);

  return {
    errors: errs,
    entry: {
      title: String(e.title || '').trim(),
      season,
      status: e.status,
      episode,
      totalEpisodes,
      rating,
      updateDay,
      comment: e.comment ? String(e.comment) : '',
      studio: e.studio ? String(e.studio).trim() : '',
      tags: e.tags ? String(e.tags).trim() : '',
      cast: e.cast ? String(e.cast).trim() : '',
      airdates: Array.isArray(e.airdates) ? e.airdates.map((x) => String(x).slice(0, 10)).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).slice(0, 300) : [],
      folders: Array.isArray(e.folders) ? e.folders.filter((f) => f && String(f).trim()) : [],
      bgmId: e.bgmId || null,
      bgmUrl: e.bgmUrl || null,
      coverUrl: e.coverUrl || null,
      summary: e.summary || null,
      watchLog,
    },
  };
}

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.dir = path.dirname(filePath);
    this.backupDir = path.join(this.dir, 'backups');
    this.data = { version: 1, settings: {}, anime: [] };
    this.warning = null;
  }

  _ensureDirs() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
  }

  load() {
    this._ensureDirs();
    if (!fs.existsSync(this.filePath)) {
      this.save();
      return this.data;
    }
    let raw;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('not object');
      this.data = {
        version: parsed.version || 1,
        settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
        anime: Array.isArray(parsed.anime) ? parsed.anime : [],

      };
    } catch (e) {
      const corrupt = `${this.filePath}.corrupt-${Date.now()}.json`;
      try { fs.renameSync(this.filePath, corrupt); } catch (_) { /* ignore */ }
      const restored = this._restoreFromBackup();
      this.warning = restored
        ? `检测到数据文件损坏，已从最近备份恢复（损坏文件已另存为 ${path.basename(corrupt)}）`
        : `检测到数据文件损坏且没有可用备份，已重建空数据（损坏文件已另存为 ${path.basename(corrupt)}）`;
    }
    return this.data;
  }

  _restoreFromBackup() {
    let files = [];
    try { files = fs.readdirSync(this.backupDir); } catch (_) { return null; }
    files = files.filter((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
    for (const f of files) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(this.backupDir, f), 'utf8'));
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.anime)) {
          this.data = {
            version: parsed.version || 1,
            settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
            anime: Array.isArray(parsed.anime) ? parsed.anime : [],

          };
          return f;
        }
      } catch (_) { /* try next */ }
    }
    return null;
  }

  save() {
    this._ensureDirs();
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
    const day = todayStr();
    const backupFile = path.join(this.backupDir, `data-${day}.json`);
    // 每次保存都覆盖当日备份，确保备份始终包含最新数据
    try { fs.copyFileSync(this.filePath, backupFile); } catch (_) { /* ignore */ }
    this._pruneBackups(30);
  }

  _pruneBackups(keep) {
    let files = [];
    try { files = fs.readdirSync(this.backupDir); } catch (_) { return; }
    files = files.filter((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    while (files.length > keep) {
      const f = files.shift();
      try { fs.unlinkSync(path.join(this.backupDir, f)); } catch (_) { /* ignore */ }
    }
  }

  list() { return this.data.anime; }
  count() { return this.data.anime.length; }

  backupCount() {
    try {
      return fs.readdirSync(this.backupDir).filter((f) => /^data-\d{4}-\d{2}-\d{2}\.json$/.test(f)).length;
    } catch (_) { return 0; }
  }

  get(id) { return this.data.anime.find((a) => a.id === id) || null; }

  add(input) {
    const { errors, entry } = validateEntry(input);
    if (errors.length) throw new Error(errors.join('；'));
    if (entry.status === 'completed') {
      entry.watchLog = this._ensureAllWatched(entry.watchLog, entry.totalEpisodes || entry.episode);
      entry.episode = entry.watchLog.length ? Math.max(...entry.watchLog.map((x) => x.episode)) : entry.episode;
    }
    const exists = this.data.anime.some((a) => a.title === entry.title && a.season === entry.season);
    if (exists) throw new Error(`\u5df2\u5b58\u5728\u300c${entry.title}\u300d\uff08${entry.season}\uff09`);
    const now = nowIso();
    const item = {
      id: crypto.randomUUID(),
      ...entry,
      createdAt: now,
      updatedAt: now,
    };
    this.data.anime.push(item);
    this.save();
    return item;
  }

  addMany(inputs) {
    const added = [];
    const skipped = [];
    for (const input of inputs) {
      const title = String((input && input.title) || '').trim();
      const season = normalizeSeason(input && input.season);
      const exists = this.data.anime.some((a) => a.title === title && a.season === season);
      if (exists) { skipped.push(title); continue; }
      try {
        const item = this.add({ ...input, status: input.status || 'plan', episode: input.episode || 0 });
        added.push(item);
      } catch (e) {
        skipped.push(`${title}（${e.message}）`);
      }
    }
    return { added, skipped };
  }

  update(id, patch) {
    const idx = this.data.anime.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error('条目不存在');
    const merged = { ...this.data.anime[idx], ...(patch || {}) };
    const { errors, entry } = validateEntry(merged);
    if (errors.length) throw new Error(errors.join('；'));
    if (entry.status === 'completed') {
      entry.watchLog = this._ensureAllWatched(entry.watchLog, entry.totalEpisodes || entry.episode);
      entry.episode = entry.watchLog.length ? Math.max(...entry.watchLog.map((x) => x.episode)) : entry.episode;
    }
    entry.id = id;
    entry.createdAt = this.data.anime[idx].createdAt;
    entry.updatedAt = nowIso();
    this.data.anime[idx] = entry;
    this.save();
    return entry;
  }

  remove(id) {
    const idx = this.data.anime.findIndex((a) => a.id === id);
    if (idx < 0) throw new Error('条目不存在');
    this.data.anime.splice(idx, 1);
    this.save();
  }

  // 状态变为「看完」时，把所有集数补进已看记录（缺失的集用同一时间戳补上）
  _ensureAllWatched(log, totalEpisodes) {
    const arr = log || [];
    if (!totalEpisodes || totalEpisodes < 1) return arr;
    const map = new Map(arr.map((e) => [e.episode, e.at]));
    const now = nowIso();
    for (let ep = 1; ep <= totalEpisodes; ep++) {
      if (!map.has(ep)) map.set(ep, now);
    }
    return Array.from(map.entries()).map(([episode, at]) => ({ episode, at }));
  }

  bump(id) {
    const a = this.get(id);
    if (!a) throw new Error('条目不存在');
    const next = (a.episode || 0) + 1;
    const completed = !!(a.totalEpisodes && next >= a.totalEpisodes);
    let watchLog = [...(a.watchLog || []), { episode: next, at: nowIso() }];
    if (completed) watchLog = this._ensureAllWatched(watchLog, a.totalEpisodes);
    const nextStatus = completed ? 'completed' : (a.status === 'plan' ? 'watching' : a.status);
    return this.update(id, {
      episode: next,
      status: nextStatus,
      watchLog,
    });
  }



  parseBackupFile(filePath) {
    let raw;
    try { raw = fs.readFileSync(filePath, 'utf8'); } catch (e) { throw new Error('无法读取文件：' + e.message); }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { throw new Error('不是有效的 JSON 文件'); }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.anime)) {
      throw new Error('备份文件格式不正确：缺少 anime 数组');
    }
    return {
      version: parsed.version || 1,
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
      anime: parsed.anime,
    };
  }

  importBackup(filePath) {
    const parsed = this.parseBackupFile(filePath);
    const pre = path.join(this.backupDir, `data-pre-import-${Date.now()}.json`);
    try { fs.copyFileSync(this.filePath, pre); } catch (_) { /* 首次导入无现有文件则跳过 */ }
    this.data = parsed;
    this.save();
    return { animeCount: parsed.anime.length, hasSettings: Object.keys(parsed.settings).length > 0 };
  }

  getSettings() { return this.data.settings; }
  updateSettings(patch) {
    this.data.settings = { ...this.data.settings, ...(patch || {}) };
    this.save();
    return this.data.settings;
  }
}

module.exports = { Store, validateEntry, normalizeSeason, VALID_STATUS };
