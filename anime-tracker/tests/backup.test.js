'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exportDataFile, isDue } = require('../lib/backup');

test('exportDataFile creates dated backup and prunes old ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-bak-'));
  fs.writeFileSync(path.join(dir, '番剧记录-备份-2026-01-01.json'), 'a');
  fs.writeFileSync(path.join(dir, '番剧记录-备份-2026-01-02.json'), 'b');
  const p = exportDataFile({ anime: [] }, dir, 2);
  assert.ok(fs.existsSync(p));
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('番剧记录-备份-'));
  assert.equal(files.length, 2);
});

test('isDue daily and weekly logic', () => {
  const now = new Date('2026-08-16T12:00:00');
  assert.equal(isDue({ enabled: false, lastAt: '2026-01-01' }, now), false);
  assert.equal(isDue({ enabled: true }, now), true);
  assert.equal(isDue({ enabled: true, interval: 'daily', lastAt: '2026-08-16T08:00:00' }, now), false);
  assert.equal(isDue({ enabled: true, interval: 'daily', lastAt: '2026-08-15T08:00:00' }, now), true);
  assert.equal(isDue({ enabled: true, interval: 'weekly', lastAt: '2026-08-09T08:00:00' }, now), true);
  assert.equal(isDue({ enabled: true, interval: 'weekly', lastAt: '2026-08-12T08:00:00' }, now), false);
});
