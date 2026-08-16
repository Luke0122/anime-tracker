'use strict';

const fs = require('fs');
const path = require('path');

const NAME_RE = /^番剧记录-备份-.*\.json$/;

function exportDataFile(data, folder, keep = 30) {
  fs.mkdirSync(folder, { recursive: true });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const name = `番剧记录-备份-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
  const filePath = path.join(folder, name);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

  let files = [];
  try {
    files = fs.readdirSync(folder).filter((f) => NAME_RE.test(f)).sort();
  } catch (_) { files = []; }
  while (files.length > keep) {
    try { fs.unlinkSync(path.join(folder, files.shift())); } catch (_) { /* ignore */ }
  }
  return filePath;
}

function isDue(cfg, now = new Date()) {
  if (!cfg || !cfg.enabled) return false;
  if (!cfg.lastAt) return true;
  const last = new Date(cfg.lastAt);
  if (Number.isNaN(last.getTime())) return true;
  if (cfg.interval === 'weekly') {
    const a = new Date(last.getFullYear(), last.getMonth(), last.getDate());
    const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor((b - a) / 86400000) >= 7;
  }
  return last.toDateString() !== now.toDateString();
}

module.exports = { exportDataFile, isDue };
