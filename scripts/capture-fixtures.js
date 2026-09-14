'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const { fetchText } = require('../lib/sources');

async function main() {
  const out = path.join(__dirname, '../tests/fixtures');
  fs.mkdirSync(out, { recursive: true });
  const official = load(await fetchText('https://m-league.jp/stats/?season=L001_S025'));
  const kinma = load(await fetchText('https://kinmaweb.jp/archives/279394'));
  const wrap = html => '<!doctype html><html lang="ja"><head><meta charset="utf-8"></head><body>' + html + '</body></html>\n';
  fs.writeFileSync(path.join(out, 'official-2026-09-14.html'), wrap(official('.c-title').toString() + official('.p-stats__tab').toString() + official('table.p-stats__table').toString()));
  fs.writeFileSync(path.join(out, 'kinma-2026-09-14.html'), wrap(kinma('meta[property="og:image"]').toString() + kinma('h1.entry-title').toString() + kinma('table').toString()));
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/seasons/2026-27.json'), 'utf8'));
  if (state.resultDate !== '2026-09-14') throw new Error('Only the opening-day state can seed this fixture');
  fs.writeFileSync(path.join(out, 'season-opener.json'), JSON.stringify(state, null, 2) + '\n');
  console.log('Saved the factual ranking tables and source identity headers for regression tests.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
