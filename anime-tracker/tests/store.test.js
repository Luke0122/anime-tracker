'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-store-'));
  return new Store(path.join(dir, 'data.json'));
}

test('add / list / bump / update / remove', () => {
  const s = tmpStore();
  s.load();
  const a = s.add({ title: '上低音号3', season: '2024-04', status: 'watching', episode: 3, totalEpisodes: 13 });
  assert.equal(s.count(), 1);
  assert.equal(a.episode, 3);
  assert.equal(a.status, 'watching');
  const b = s.bump(a.id);
  assert.equal(b.episode, 4);
  const c = s.bump(a.id);
  assert.equal(c.episode, 5);
  const u = s.update(a.id, { rating: 9, comment: '太棒了' });
  assert.equal(u.rating, 9);
  s.remove(a.id);
  assert.equal(s.count(), 0);
});

test('bump to total auto-completes', () => {
  const s = tmpStore();
  s.load();
  const a = s.add({ title: '测试番', season: '2025-10', status: 'watching', episode: 11, totalEpisodes: 12 });
  const b = s.bump(a.id);
  assert.equal(b.episode, 12);
  assert.equal(b.status, 'completed');
});

test('validation rejects bad data', () => {
  const s = tmpStore();
  s.load();
  assert.throws(() => s.add({ title: '', season: '2024-04', status: 'watching', episode: 0 }));
  assert.throws(() => s.add({ title: 'x', season: '2024-05', status: 'watching', episode: 0 }));
  assert.throws(() => s.add({ title: 'x', season: '2024-04', status: 'watched', episode: 0 }));
  assert.throws(() => s.add({ title: 'x', season: '2024-04', status: 'watching', episode: -1 }));
  assert.throws(() => s.add({ title: 'x', season: '2024-04', status: 'watching', episode: 0, rating: 11 }));
});

test('persists across instances', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-store-'));
  const file = path.join(dir, 'data.json');
  const s1 = new Store(file);
  s1.load();
  s1.add({ title: '摇曳露营3', season: '2024-04', status: 'watching', episode: 1 });
  const s2 = new Store(file);
  s2.load();
  assert.equal(s2.count(), 1);
  assert.equal(s2.list()[0].title, '摇曳露营3');
});

test('corrupt file is recovered from backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-store-'));
  const file = path.join(dir, 'data.json');
  const s1 = new Store(file);
  s1.load();
  s1.add({ title: '花织', season: '2026-07', status: 'watching', episode: 2 });
  fs.writeFileSync(file, '{ not valid json !!!', 'utf8');
  const s2 = new Store(file);
  s2.load();
  assert.equal(s2.count(), 1);
  assert.equal(s2.list()[0].title, '花织');
  assert.ok(s2.warning);
});

test('corrupt file without backup starts fresh and keeps corrupt copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-store-'));
  const file = path.join(dir, 'data.json');
  fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
  fs.writeFileSync(file, 'garbage', 'utf8');
  const s = new Store(file);
  s.load();
  assert.equal(s.count(), 0);
  assert.ok(s.warning);
  const corrupts = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  assert.equal(corrupts.length, 1);
});

test('addMany skips duplicates', () => {
  const s = tmpStore();
  s.load();
  s.add({ title: 'A', season: '2024-01', status: 'plan', episode: 0 });
  const res = s.addMany([
    { title: 'A', season: '2024-01', status: 'plan', episode: 0 },
    { title: 'B', season: '2024-04', status: 'plan', episode: 0 },
  ]);
  assert.equal(res.added.length, 1);
  assert.equal(res.skipped.length, 1);
  assert.equal(s.count(), 2);
});

test('importBackup replaces data and creates pre-import backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-store-'));
  const file = path.join(dir, 'data.json');
  const s1 = new Store(file);
  s1.load();
  s1.add({ title: '旧番', season: '2024-01', status: 'watching', episode: 2 });

  const backupFile = path.join(dir, 'backup.json');
  fs.writeFileSync(backupFile, JSON.stringify({
    version: 1,
    settings: { animeInfoBaseDir: 'D:\\\\fake' },
    anime: [
      { id: 'x1', title: '新番A', season: '2026-07', status: 'watching', episode: 3, totalEpisodes: 12 },
      { id: 'x2', title: '新番B', season: '2026-10', status: 'plan', episode: 0 },
    ],
  }), 'utf8');

  const res = s1.importBackup(backupFile);
  assert.equal(res.animeCount, 2);
  assert.equal(s1.count(), 2);
  assert.equal(s1.list()[0].title, '新番A');
  assert.equal(s1.getSettings().animeInfoBaseDir, 'D:\\\\fake');

  const pre = fs.readdirSync(path.join(dir, 'backups')).filter((f) => f.includes('data-pre-import-'));
  assert.equal(pre.length, 1);
  const restored = JSON.parse(fs.readFileSync(path.join(dir, 'backups', pre[0]), 'utf8'));
  assert.equal(restored.anime.length, 1);
  assert.equal(restored.anime[0].title, '旧番');
});

test('parseBackupFile rejects invalid input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-store-'));
  const file = path.join(dir, 'data.json');
  const s = new Store(file);
  s.load();
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, 'not json', 'utf8');
  assert.throws(() => s.parseBackupFile(bad), /JSON/);
  fs.writeFileSync(bad, JSON.stringify({ foo: 1 }), 'utf8');
  assert.throws(() => s.parseBackupFile(bad), /anime/);
});