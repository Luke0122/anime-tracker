'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getData: () => ipcRenderer.invoke('data:get'),
  addAnime: (input) => ipcRenderer.invoke('anime:add', input),
  updateAnime: (id, patch) => ipcRenderer.invoke('anime:update', id, patch),
  deleteAnime: (id) => ipcRenderer.invoke('anime:delete', id),
  bumpAnime: (id) => ipcRenderer.invoke('anime:bump', id),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  listSeasons: () => ipcRenderer.invoke('season:list'),
  seasonShows: (key) => ipcRenderer.invoke('season:shows', key),
  searchBangumi: (keyword) => ipcRenderer.invoke('bangumi:search', keyword),
  bangumiDetail: (id) => ipcRenderer.invoke('bangumi:detail', id),
  pickAndScan: () => ipcRenderer.invoke('scan:pickFolder'),
  scanFolder: (folder) => ipcRenderer.invoke('scan:run', folder),
  exportExcel: () => ipcRenderer.invoke('data:exportExcel'),
  exportJson: () => ipcRenderer.invoke('data:exportJson'),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  exportChart: (dataUrl) => ipcRenderer.invoke('data:exportChart', dataUrl),
  exportHtmlReport: (content, defaultName) => ipcRenderer.invoke('data:exportHtmlReport', content, defaultName),
  exportCalendarExcel: (data) => ipcRenderer.invoke('data:exportCalendarExcel', data),
  bangumiCollections: (uid) => ipcRenderer.invoke('bangumi:collections', uid),
  fetchAirdates: (id) => ipcRenderer.invoke('bangumi:airdates', id),
  cacheCover: (url) => ipcRenderer.invoke('cover:cache', url),
  importJson: () => ipcRenderer.invoke('data:importJson'),
  importJsonApply: (filePath) => ipcRenderer.invoke('data:importJsonApply', filePath),

};

contextBridge.exposeInMainWorld('api', api);
