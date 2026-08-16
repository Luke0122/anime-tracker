'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const yucLive = require('../lib/yucLive');
const seasonData = require('../lib/seasonData');

const CARD_HTML = `
<table class="date_" width="100%"><tr><td class="date">周一</td></tr></table>
<div>
<div class="div_date"><p class="imgep">(全12话)</p><img width="120px" data-src="https://x/1.jpg"></div>
<div><table width="120px"><tr><td colspan="3" class="date_title1">测试番A</td></tr><tr><td><p class="area">大陆</p></td></tr></table></div>
</div>
<table class="date_" width="100%"><tr><td class="date2">周二</td></tr></table>
<div>
<div class="div_date"><p class="imgep">(全24话)</p><img width="120px" data-src="https://x/2.jpg"></div>
<div><table width="120px"><tr><td colspan="3" class="date_title_">测试番B</td></tr></table></div>
</div>`;

test('yucLive.parsePage handles card format (date/date2 + date_title variants)', () => {
  const shows = yucLive.parsePage(CARD_HTML);
  assert.equal(shows.length, 2);
  assert.equal(shows[0].title, '测试番A');
  assert.equal(shows[0].weekday, '周一');
  assert.equal(shows[0].eps, '全12话');
  assert.equal(shows[0].coverUrl, 'https://x/1.jpg');
  assert.equal(shows[1].title, '测试番B');
  assert.equal(shows[1].weekday, '周二');
});

test('yucLive.parsePage handles old format', () => {
  const html = '<div><p class="title_cn">22/7</p></div><div style="float:left"><img width="180px" data-src="https://x/o.jpg"></div><div><p class="title_cn">number24</p></div>';
  const shows = yucLive.parsePage(html);
  assert.ok(shows.length >= 2);
  assert.equal(shows[0].title, '22/7');
});

test('loadSeasonListLive fetches from yuc.wiki', async () => {
  const orig = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => CARD_HTML });
  try {
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuc-cache-'));
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'yuc-base-'));
    const res = await seasonData.loadSeasonListLive(base, '2026-07', cacheDir);
    assert.equal(res.source, 'yuc-live');
    assert.equal(res.items.length, 2);
    assert.ok(res.items[0].title);
    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  } finally {
    global.fetch = orig;
  }
});
