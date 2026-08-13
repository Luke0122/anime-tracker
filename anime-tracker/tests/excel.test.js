'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { importExcel, exportExcel } = require('../lib/excel');

const OLD_FILE = 'D:\\ANIME\\已经 将要 看.xlsx';

test('imports the real old-format Excel', () => {
  const items = importExcel(OLD_FILE);
  assert.ok(items.length >= 3, 'should find at least 3, got ' + items.length);
  const hibike = items.find((x) => x.title === '上低音号3');
  assert.ok(hibike);
  assert.equal(hibike.season, '2024-04');
  assert.ok(items.some((x) => x.title === '摇曳露营3'));
});

test('export then re-import roundtrip (new flat format)', async () => {
  const file = path.join(os.tmpdir(), 'anime-export-' + Date.now() + '.xlsx');
  const anime = [
    { title: '上低音号3', season: '2024-04', status: 'completed', episode: 13, totalEpisodes: 13, updateDay: 3, rating: 9, comment: '太好看了' },
    { title: '摇曳露营3', season: '2024-04', status: 'watching', episode: 4, totalEpisodes: 12, updateDay: 5, rating: 8, comment: '' },
  ];
  await exportExcel(file, anime);
  assert.ok(fs.existsSync(file));

  const wb = XLSX.readFile(file);
  assert.ok(wb.SheetNames.includes('总览'));
  assert.ok(wb.SheetNames.includes('季度明细'));
  assert.ok(wb.SheetNames.includes('全部记录'));

  const items = importExcel(file);
  assert.equal(items.length, 2);
  const a = items.find((x) => x.title === '上低音号3');
  assert.equal(a.season, '2024-04');
  assert.equal(a.status, 'completed');
  assert.equal(a.episode, 13);
  assert.equal(a.totalEpisodes, 13);
  assert.equal(a.rating, 9);

  fs.rmSync(file, { force: true });
});