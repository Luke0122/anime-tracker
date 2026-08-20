'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { shouldUseMica, supportsMica } = require('../lib/platform');

test('supportsMica: Win11 22H2+ 返回 true', () => {
  assert.equal(supportsMica('win32', '10.0.22621'), true);
  assert.equal(supportsMica('win32', '10.0.22000'), true);
  assert.equal(supportsMica('win32', '10.0.26200'), true);
});

test('supportsMica: 旧版本 / 非 Windows / 非法输入返回 false', () => {
  assert.equal(supportsMica('win32', '10.0.19045'), false);
  assert.equal(supportsMica('win32', '6.3.9600'), false);
  assert.equal(supportsMica('darwin', '10.0.22621'), false);
  assert.equal(supportsMica('linux', '10.0.22621'), false);
  assert.equal(supportsMica('win32', 'not-a-version'), false);
  assert.equal(supportsMica('win32', ''), false);
});

test('shouldUseMica returns boolean on this machine', () => {
  assert.equal(typeof shouldUseMica(), 'boolean');
});
