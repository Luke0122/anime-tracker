'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const seasonData = require('../lib/seasonData');
const docxParser = require('../lib/docxParser');

const BASE = 'D:\\ANIME\\日本TV动画信息';
const DOCX = 'D:\\ANIME\\日本TV动画信息\\2026年7月\\2026年7月新番信息.docx';
const JSONP = 'D:\\ANIME\\日本TV动画信息\\scripts\\_runtime\\data\\bangumi_202607.json';

test('discoverSeasons finds 2026年7月', () => {
  const seasons = seasonData.discoverSeasons(BASE);
  assert.ok(seasons.some((s) => s.key === '2026-07'), 'should find 2026-07');
});

test('loadSeasonList 当季新番只来自内置 yuc.wiki 目录（不读 bangumi JSON / Word JSON）', () => {
  const res = seasonData.loadSeasonList(BASE, '2026-07');
  assert.equal(res.source, 'bundled-catalog');
  assert.equal(res.items.length, 78, '2026-07 应为 78 部，实际 ' + res.items.length);
  const mushoku = res.items.filter((x) => String(x.title).includes('无职转生'));
  assert.equal(mushoku.length, 1, '2026-07 应只有 1 部无职转生，实际 ' + mushoku.length);
  assert.equal(mushoku[0].weekday, '周日');
  assert.equal(mushoku[0].weekdayNum, 0);
  assert.ok(!res.items.some((x) => /#\d/.test(String(x.title))), '不应包含已注释隐藏的先行放送卡片');
});

test('loadSeasonList ignores season-folder JSON / docx（不再从 Word 信息读取新番）', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-season-'));
  const seasonDir = path.join(base, '2026年10月');
  fs.mkdirSync(seasonDir, { recursive: true });
  fs.writeFileSync(path.join(seasonDir, '2026年10月新番信息.json'), JSON.stringify({
    season: '202610',
    items: [{ title: '测试番A', weekday: '周三', time: '22:00', eps: 12 }],
  }), 'utf8');
  try {
    const res = seasonData.loadSeasonList(base, '2026-10');
    assert.equal(res.source, 'none');
    assert.equal(res.items.length, 0);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('loadSeasonList falls back to bundled yuc catalog for old seasons', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-empty-'));
  try {
    const res = seasonData.loadSeasonList(base, '2020-01');
    assert.equal(res.source, 'bundled-catalog');
    assert.ok(res.items.length >= 30, '2020-01 should have many shows, got ' + res.items.length);
    assert.ok(res.items[0].title);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('docxParser reads the real 一览表', () => {
  const items = docxParser.parseNewAnimeDocx(DOCX);
  assert.ok(items.length >= 70, 'docx should list ~80 shows, got ' + items.length);
  const it = items[0];
  assert.ok(it.title);
  assert.ok(it.weekday);
  assert.ok(it.eps > 0);
});

test('currentSeasonKey returns 2026-07 for 2026-08', () => {
  const key = seasonData.currentSeasonKey();
  assert.match(key, /^\d{4}-(01|04|07|10)$/);
});

test('JSON file itself is valid and rich', () => {
  const data = JSON.parse(fs.readFileSync(JSONP, 'utf8'));
  assert.equal(data.items.length, 80);
  const keys = Object.keys(data.items[0]);
  for (const k of ['title', 'weekday', 'time', 'eps', 'bgm_id', 'rating', 'summary', 'studio']) {
    assert.ok(keys.includes(k), 'missing key ' + k);
  }
});
