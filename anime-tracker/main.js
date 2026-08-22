'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store } = require('./lib/store');
const seasonData = require('./lib/seasonData');
const scanner = require('./lib/scanner');
const bangumi = require('./lib/bangumi');
const excel = require('./lib/excel');
const backup = require('./lib/backup');
const { shouldUseMica } = require('./lib/platform');
const crypto = require('crypto');
const DEFAULT_BACKUP_FOLDER = 'D:\\ANIME\\anime-tracker\\自动备份';
const COVER_CACHE_DIR = () => path.join(app.getPath('userData'), 'covers');
const BUNDLED_COVER_DIR = () => path.join(__dirname, 'data', 'covers');

// 注册封面自定义协议（从应用包内读取内置封面）
protocol.registerSchemesAsPrivileged([
  { scheme: 'cover', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

app.setName('番剧记录');
// 数据目录保持稳定，避免改名后丢失已有数据（%APPDATA%\anime-tracker）
app.setPath('userData', path.join(app.getPath('appData'), 'anime-tracker'));

let mainWindow = null;
let store = null;

const THEME_VALUES = new Set(['system', 'dark', 'light']);

function applyTheme(theme) {
  if (THEME_VALUES.has(theme)) nativeTheme.themeSource = theme;
  else nativeTheme.themeSource = 'system';
  updateOverlayColors();
}

function updateOverlayColors() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const mica = shouldUseMica();
  const dark = nativeTheme.shouldUseDarkColors;
  mainWindow.setTitleBarOverlay({
    color: mica ? '#00000000' : (dark ? '#000000' : '#f4f4f8'),
    symbolColor: dark ? '#ffd9c9' : '#3a3a45',
    height: 44,
  });
}

nativeTheme.on('updated', () => {
  if (mainWindow && !mainWindow.isDestroyed()) updateOverlayColors();
});

const DEFAULT_INFO_BASE = 'D:\\ANIME\\日本TV动画信息';

function infoBase() {
  const s = store.getSettings().animeInfoBaseDir;
  return s && fs.existsSync(s) ? s : DEFAULT_INFO_BASE;
}

function createWindow() {
  const mica = shouldUseMica();
  const winOpts = {
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: '番剧记录',
    backgroundColor: mica ? '#00000000' : '#000000',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: mica ? '#00000000' : (nativeTheme.shouldUseDarkColors ? '#000000' : '#f4f4f8'),
      symbolColor: nativeTheme.shouldUseDarkColors ? '#ffd9c9' : '#3a3a45',
      height: 44,
    },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  };
  if (mica) winOpts.backgroundMaterial = 'mica';
  mainWindow = new BrowserWindow(winOpts);
  updateOverlayColors();
  Menu.setApplicationMenu(null);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function ok(data) { return { ok: true, data }; }
function fail(error) { return { ok: false, error: String((error && error.message) || error) }; }
function handle(fn) {
  return async (_event, ...args) => {
    try { return ok(await fn(...args)); } catch (err) { return fail(err); }
  };
}

function buildMatches(groups) {
  const list = store.list();
  return (groups || []).map((g) => {
    const matched = scanner.matchExisting(list, g.title);
    return {
      group: g,
      matched: matched ? { id: matched.id, title: matched.title, episode: matched.episode } : null,
    };
  });
}

function registerIpc() {
  ipcMain.handle('anime:list', handle(() => store.list()));
  ipcMain.handle('anime:add', handle((input) => store.add(input)));
  ipcMain.handle('anime:update', handle((id, patch) => store.update(id, patch)));
  ipcMain.handle('anime:delete', handle((id) => store.remove(id)));
  ipcMain.handle('anime:bump', handle((id) => store.bump(id)));

  ipcMain.handle('data:get', handle(() => ({
    anime: store.list(),
    settings: store.getSettings(),
    dataFile: store.filePath,
    backupCount: store.backupCount(),
    warning: store.warning,
  })));

  ipcMain.handle('settings:update', handle((patch) => {
    const saved = store.updateSettings(patch);
    if (patch && patch.theme) applyTheme(patch.theme);
    return saved;
  }));

  // 把远程封面下载到本地缓存，返回 cover://local/<md5>.jpg（命中内置/缓存则直接返回）
  ipcMain.handle('cover:cache', handle(async (url) => {
    const src = String(url || '').trim();
    if (!src) return null;
    if (/^(cover|data):/i.test(src)) return src;
    if (!/^https?:\/\//i.test(src)) return src;
    try {
      const name = crypto.createHash('md5').update(src, 'utf8').digest('hex') + '.jpg';
      if (!fs.existsSync(path.join(BUNDLED_COVER_DIR(), name)) && !fs.existsSync(path.join(COVER_CACHE_DIR(), name))) {
        fs.mkdirSync(COVER_CACHE_DIR(), { recursive: true });
        const res = await global.fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AnimeAutoBot/1.0' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(path.join(COVER_CACHE_DIR(), name), buf);
      }
      return 'cover://local/' + name;
    } catch (_) {
      return src; // 失败回退远程地址
    }
  }));

  ipcMain.handle('season:list', handle(() => {
    const dirs = seasonData.discoverSeasons(infoBase());
    const have = new Set(store.list().map((a) => a.season));
    const keys = new Set(dirs.map((d) => d.key));
    for (const k of have) keys.add(k);
    const counts = {};
    for (const a of store.list()) counts[a.season] = (counts[a.season] || 0) + 1;
    const all = Array.from(keys).sort().reverse().map((key) => {
      const d = dirs.find((x) => x.key === key);
      return {
        key,
        label: d ? d.label : seasonData.keyToLabel(key),
        hasInfo: !!d,
        count: counts[key] || 0,
      };
    });
    return all;
  }));

  ipcMain.handle('season:shows', handle(async (key) => {
    if (key === 'all') return seasonData.loadAllShows(infoBase());
    const cacheDir = path.join(app.getPath('userData'), 'yuc-cache');
    return seasonData.loadSeasonListLive(infoBase(), key, cacheDir);
  }));

  ipcMain.handle('bangumi:search', handle((keyword) => bangumi.search(keyword)));
  ipcMain.handle('bangumi:detail', handle((id) => bangumi.detail(id)));
  ipcMain.handle('bangumi:collections', handle((uid) => bangumi.collections(uid)));

  ipcMain.handle('data:exportCalendarExcel', handle(async (data) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: (data && data.defaultName) || `番剧记录-日历-${new Date().toISOString().slice(0, 7)}.xlsx`,
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
    });
    if (r.canceled || !r.filePath) return null;
    return excel.exportCalendarExcel(r.filePath, data);
  }));

  ipcMain.handle('scan:pickFolder', handle(async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: '选择要扫描的下载目录（如 D:\\ANIME\\花织）',
    });
    if (r.canceled || !r.filePaths.length) return null;
    const result = scanner.scanFolder(r.filePaths[0]);
    return { ...result, matches: buildMatches(result.groups) };
  }));

  ipcMain.handle('scan:run', handle((folder) => {
    const result = scanner.scanFolder(folder);
    return { ...result, matches: buildMatches(result.groups) };
  }));

  ipcMain.handle('data:exportHtmlReport', handle(async (content, defaultName) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName || `番剧记录-报告-${new Date().toISOString().slice(0, 10)}.html`,
      filters: [{ name: 'HTML 报告', extensions: ['html'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, String(content || ''), 'utf8');
    return r.filePath;
  }));

  ipcMain.handle('data:exportChart', handle(async (dataUrl) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `番剧记录-统计-${new Date().toISOString().slice(0, 10)}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const base64 = String(dataUrl || '').replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(r.filePath, Buffer.from(base64, 'base64'));
    return r.filePath;
  }));

  ipcMain.handle('data:exportExcel', handle(async () => {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `番剧记录-${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel 文件', extensions: ['xlsx'] }],
    });
    if (r.canceled || !r.filePath) return null;
    return excel.exportExcel(r.filePath, store.list());
  }));

  ipcMain.handle('data:importJson', handle(async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'JSON 备份文件', extensions: ['json'] }],
      title: '选择要导入的 JSON 备份',
    });
    if (r.canceled || !r.filePaths.length) return null;
    const parsed = store.parseBackupFile(r.filePaths[0]);
    return {
      file: r.filePaths[0],
      animeCount: parsed.anime.length,
      hasSettings: Object.keys(parsed.settings).length > 0,
      firstTitles: parsed.anime.slice(0, 5).map((a) => a.title),
    };
  }));

  ipcMain.handle('data:importJsonApply', handle((filePath) => store.importBackup(filePath)));

  ipcMain.handle('backup:now', handle(() => {
    const cfg = store.getSettings().autoBackup || {};
    const folder = cfg.folder || DEFAULT_BACKUP_FOLDER;
    const keep = Number(cfg.keep) || 30;
    const filePath = backup.exportDataFile(store.data, folder, keep);
    store.updateSettings({
      autoBackup: { ...cfg, enabled: !!cfg.enabled, interval: cfg.interval || 'daily', folder, keep, lastAt: new Date().toISOString() },
    });
    return { path: filePath };
  }));

  ipcMain.handle('data:exportJson', handle(async () => {
    const r = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `番剧记录-备份-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(store.data, null, 2), 'utf8');
    return r.filePath;
  }));

}

app.whenReady().then(() => {
    store = new Store(path.join(app.getPath('userData'), 'data.json'));
  store.load();
  const settings = store.getSettings();
  applyTheme(settings.theme);
  if (!settings.animeInfoBaseDir) {
    store.updateSettings({ animeInfoBaseDir: DEFAULT_INFO_BASE });
  }
  protocol.handle('cover', async (request) => {
    try {
      const u = new URL(request.url);
      const name = path.basename(u.pathname);
      const cachePath = path.join(COVER_CACHE_DIR(), name);
      const bundledPath = path.join(BUNDLED_COVER_DIR(), name);
      let file = cachePath;
      if (!fs.existsSync(cachePath)) file = bundledPath;
      const data = await fs.promises.readFile(file);
      return new Response(data, { headers: { 'Content-Type': 'image/jpeg' } });
    } catch (_) {
      return new Response('', { status: 404 });
    }
  });
  function checkAutoBackup() {
    const cfg = store.getSettings().autoBackup || {};
    if (!backup.isDue(cfg)) return null;
    const folder = cfg.folder || DEFAULT_BACKUP_FOLDER;
    const keep = Number(cfg.keep) || 30;
    const filePath = backup.exportDataFile(store.data, folder, keep);
    store.updateSettings({
      autoBackup: { ...cfg, enabled: !!cfg.enabled, interval: cfg.interval || 'daily', folder, keep, lastAt: new Date().toISOString() },
    });
    return filePath;
  }
  checkAutoBackup();
  setInterval(checkAutoBackup, 30 * 60 * 1000);
  registerIpc();
  createWindow();
    app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});