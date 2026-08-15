'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store } = require('./lib/store');
const seasonData = require('./lib/seasonData');
const scanner = require('./lib/scanner');
const bangumi = require('./lib/bangumi');
const excel = require('./lib/excel');

app.setName('番剧记录');
// 数据目录保持稳定，避免改名后丢失已有数据（%APPDATA%\anime-tracker）
app.setPath('userData', path.join(app.getPath('appData'), 'anime-tracker'));

let mainWindow = null;
let store = null;

const DEFAULT_INFO_BASE = 'D:\\ANIME\\日本TV动画信息';

function infoBase() {
  const s = store.getSettings().animeInfoBaseDir;
  return s && fs.existsSync(s) ? s : DEFAULT_INFO_BASE;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: '番剧记录',
    backgroundColor: '#000000',
    icon: path.join(__dirname, 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#000000',
      symbolColor: '#ffd9c9',
      height: 44,
    },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
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

  ipcMain.handle('settings:update', handle((patch) => store.updateSettings(patch)));

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

  ipcMain.handle('season:shows', handle((key) => seasonData.loadSeasonList(infoBase(), key)));

  ipcMain.handle('bangumi:search', handle((keyword) => bangumi.search(keyword)));
  ipcMain.handle('bangumi:detail', handle((id) => bangumi.detail(id)));

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

  ipcMain.handle('excel:import', handle(async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Excel 文件', extensions: ['xlsx', 'xls'] }],
      title: '选择要导入的 Excel（如 已经 将要 看.xlsx）',
    });
    if (r.canceled || !r.filePaths.length) return null;
    const items = excel.importExcel(r.filePaths[0]);
    const fresh = [];
    const skipped = [];
    for (const it of items) {
      const exists = store.list().some((a) => a.title === it.title && a.season === it.season);
      if (exists) skipped.push(it); else fresh.push(it);
    }
    return { file: r.filePaths[0], total: items.length, fresh, skipped };
  }));

  ipcMain.handle('excel:importApply', handle((items) => store.addMany(items)));

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
  if (!settings.animeInfoBaseDir) {
    store.updateSettings({ animeInfoBaseDir: DEFAULT_INFO_BASE });
  }
  registerIpc();
  createWindow();
    app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});