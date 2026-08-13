'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parseFilename, scanFolder, normalizeTitle, matchExisting } = require('../lib/scanner');

test('parse 花织 style filenames', () => {
  const p = parseFilename('[Nekomoe kissaten][Hanaori-san wa Tensei shitemo Kenka ga Shitai][01][1080p][CHS].mp4');
  assert.ok(p);
  assert.equal(p.episode, 1);
  assert.equal(p.title, 'Hanaori-san wa Tensei shitemo Kenka ga Shitai');
});

test('parse common patterns', () => {
  assert.deepEqual(parseFilename('摇曳露营3 - 05.mkv'), { title: '摇曳露营3', episode: 5 });
  assert.deepEqual(parseFilename('[字幕组] 碧蓝之海第3期 [EP 07] [1080p].mkv'), { title: '碧蓝之海第3期', episode: 7 });
  assert.deepEqual(parseFilename('番剧第12话.mp4'), { title: '番剧', episode: 12 });
  assert.deepEqual(parseFilename('Title.03.mp4'), { title: 'Title', episode: 3 });
  assert.deepEqual(parseFilename('[Group]Kiseki[02].mkv'), { title: 'Kiseki', episode: 2 });
});

test('unparseable returns null', () => {
  assert.equal(parseFilename('文件夹说明.txt'), null);
  assert.equal(parseFilename('movie.mp4'), null);
});

test('normalizeTitle and matchExisting', () => {
  assert.equal(normalizeTitle('摇曳 露营3！！'), '摇曳露营3');
  const list = [
    { title: '摇曳露营3', id: 1, episode: 2 },
    { title: '上低音号3', id: 2, episode: 5 },
  ];
  assert.equal(matchExisting(list, '摇曳露营3').id, 1);
  assert.equal(matchExisting(list, '摇曳露营3 第二季'), null);
});

test('scanFolder aggregates episodes', () => {
  const dir = path.join(require('os').tmpdir(), 'anime-scan-' + Date.now());
  require('fs').mkdirSync(dir, { recursive: true });
  require('fs').writeFileSync(path.join(dir, '[Nekomoe kissaten][Hanaori-san wa Tensei shitemo Kenka ga Shitai][01][1080p][CHS].mp4'), 'x');
  require('fs').writeFileSync(path.join(dir, '[Nekomoe kissaten][Hanaori-san wa Tensei shitemo Kenka ga Shitai][02][1080p][CHS].mp4'), 'x');
  require('fs').writeFileSync(path.join(dir, '说明.txt'), 'x');
  const res = scanFolder(dir);
  assert.equal(res.totalFiles, 2);
  assert.equal(res.skipped, 0);
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0].maxEpisode, 2);
  assert.equal(res.groups[0].count, 2);
});

