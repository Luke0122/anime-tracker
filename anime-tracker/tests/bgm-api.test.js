'use strict';

const test = require('node:test');
const assert = require('node:assert');
const bangumi = require('../lib/bangumi');

function mockFetch(responses) {
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    const key = String(url);
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    let match = null;
    for (const [k, v] of Object.entries(responses)) {
      if (key.includes(k)) match = v;
    }
    if (body && body.keyword && responses[body.keyword]) match = responses[body.keyword];
    if (!match) throw new Error('no mock for ' + key);
    return { ok: true, status: 200, json: async () => match };
  };
  return () => { global.fetch = orig; };
}

test('search normalizes Bangumi v0 results', async () => {
  const restore = mockFetch({
    '/v0/search/subjects': {
      data: [{
        id: 456081,
        name: 'name-jp',
        name_cn: '最强废渣皇子暗中活跃于帝位之争',
        date: '2026-07-06',
        images: { large: 'https://lain.bgm.tv/x.jpg' },
        rating: { score: 7.5, rank: 100 },
      }],
    },
  });
  try {
    const res = await bangumi.search('最强废渣');
    assert.equal(res.length, 1);
    assert.equal(res[0].bgmId, 456081);
    assert.equal(res[0].title, '最强废渣皇子暗中活跃于帝位之争');
    assert.equal(res[0].rating, 7.5);
    assert.equal(res[0].imageUrl, 'https://lain.bgm.tv/x.jpg');
  } finally {
    restore();
  }
});

test('search falls back to legacy API when v0 fails', async () => {
  const restore = mockFetch({
    '/search/subject/': {
      code: 0,
      result: [{
        id: 123,
        name: 'yuru-camp',
        name_cn: '摇曳露营',
        date: '2022-04-01',
        images: { large: 'https://lain.bgm.tv/y.jpg' },
        rating: { score: 8.1, rank: 55 },
      }],
    },
  });
  try {
    const res = await bangumi.search('摇曳露营');
    assert.equal(res.length, 1);
    assert.equal(res[0].bgmId, 123);
    assert.equal(res[0].title, '摇曳露营');
    assert.equal(res[0].rating, 8.1);
  } finally {
    restore();
  }
});

test('search throws network error when everything fails', async () => {
  const restore = mockFetch({});
  try {
    await assert.rejects(() => bangumi.search('不存在'), /网络连接失败/);
  } finally {
    restore();
  }
});

test('detail normalizes total episodes and summary', async () => {
  const restore = mockFetch({
    '/v0/subjects/456081': {
      id: 456081,
      name: 'name-jp',
      name_cn: '最强废渣皇子暗中活跃于帝位之争',
      date: '2026-07-06',
      total_episodes: 12,
      eps: [{}, {}, {}],
      rating: { score: 7.2, rank: 90 },
      summary: '简介内容',
      images: { large: 'https://lain.bgm.tv/y.jpg' },
    },
  });
  try {
    const d = await bangumi.detail(456081);
    assert.equal(d.totalEpisodes, 12);
    assert.equal(d.eps, 3);
    assert.equal(d.summary, '简介内容');
    assert.equal(d.rating, 7.2);
  } finally {
    restore();
  }
});

test('fetchAirdates maps and dedupes episode air dates', async () => {
  const restore = mockFetch({
    '/eps': {
      total: 3,
      data: [
        { ep: 1, airdate: '2026-07-06' },
        { ep: 2, airdate: '2026-07-13' },
        { ep: 3, airdate: '2026-07-06' },
        { ep: 4, air_date: '2026-07-20' },
      ],
    },
  });
  try {
    const aired = await bangumi.fetchAirdates(456081);
    assert.deepEqual(await aired, ['2026-07-06', '2026-07-13', '2026-07-20']);
  } finally {
    restore();
  }
});

test('fetchAirdates returns [] when eps endpoint is unavailable', async () => {
  const restore = mockFetch({}); // no /eps mock -> every fetch fails
  try {
    const aired = await bangumi.fetchAirdates(456081);
    assert.deepEqual(await aired, []);
  } finally {
    restore();
  }
});

test('empty keyword throws', async () => {
  await assert.rejects(() => bangumi.search('   '), /关键词/);
});
