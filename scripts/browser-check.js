'use strict';

const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { teamTotals } = require('../lib/model');
const { readJSON } = require('../lib/store');

async function main() {
  const root = path.resolve(__dirname, '../dist');
  const out = path.resolve(__dirname, '../verification');
  fs.mkdirSync(out, { recursive: true });
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = process.env.TEST_URL || `http://127.0.0.1:${server.address().port}`;
  let browser;
  const results = [];
  const active = readJSON(path.join(__dirname, '../data/seasons/2026-27.json'));
  const expectedTotals = teamTotals(active.players, active.draft).sort((a, b) => b.score - a.score).map(t => `${t.score > 0 ? '+' : t.score < 0 ? '−' : ''}${Math.abs(t.score).toFixed(1)}pt`);
  try {
    browser = await chromium.launch({ ...(process.env.CI ? {} : { channel: 'chrome' }), headless: true });
    for (const [width, height] of [[1440, 1000], [390, 844], [360, 800], [768, 1024]]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: true });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', response => { if (response.status() >= 400 && response.url().startsWith(base)) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
      await page.goto(base, { waitUntil: 'networkidle' });
      assert.equal(await page.locator('.roster-row').count(), 30);
      const totals = await page.locator('[data-testid="team-total"]').allTextContents();
      assert.deepEqual(totals, expectedTotals);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}`);
      await page.screenshot({ path: path.join(out, `teams-${width}.png`), fullPage: true });
      await page.screenshot({ path: path.join(out, `first-screen-${width}.png`) });
      await page.locator('#source-button').click();
      await expect(page.locator('#source-content')).toContainText('自動取得予定: 火・水・金・土 2:07、2:37、3:07、3:37、6:07 JST');
      await expect(page.locator('#source-content')).toContainText('遅れる場合があります');
      await expect(page.getByRole('link', { name: '自動更新の実行状況' })).toHaveAttribute('href', 'https://github.com/tenten-ensuku/m-league-score/actions/workflows/update.yml');
      assert.equal(await page.locator('#source-dialog').evaluate(el => el.scrollWidth > el.clientWidth), false, `Source dialog overflow at ${width}`);
      await page.screenshot({ path: path.join(out, `sources-${width}.png`), fullPage: true });
      await page.keyboard.press('Escape');
      if (width < 760) {
        await page.locator('[data-roster="sat"]').click();
        await expect(page.locator('.roster-row:visible')).toHaveCount(10);
        await expect(page.locator('.roster[data-selected="true"] h3')).toHaveText('チームさとし');
        await page.locator('[data-roster="ten"]').click();
      }
      await page.locator('[data-player="朝倉康心"]').click();
      assert.equal(await page.locator('#player-dialog').evaluate(e => e.open), true);
      assert.equal(await page.locator('#player-title').textContent(), '朝倉康心');
      await page.keyboard.press('Escape');
      await page.locator('a[data-view="players"]').click();
      await expect(page.locator('#ranking-body tr')).toHaveCount(40);
      await page.locator('#player-search').fill('朝倉');
      await expect(page.locator('#ranking-body tr')).toHaveCount(1);
      await page.locator('#player-search').fill('存在しない選手');
      assert.match(await page.locator('#ranking-body').textContent(), /該当する選手はいません/);
      await page.locator('#player-search').fill('');
      await page.locator('[data-filter-owner="ten"]').click();
      await expect(page.locator('#ranking-body tr')).toHaveCount(10);
      await page.locator('[data-filter-owner="none"]').click();
      await expect(page.locator('#ranking-body tr')).toHaveCount(10);
      await page.locator('[data-filter-owner="all"]').click();
      await page.locator('#team-filter').selectOption('pirates');
      await expect(page.locator('#ranking-body tr')).toHaveCount(4);
      await page.locator('#team-filter').selectOption('all');
      await page.locator('#played-only').check();
      await expect(page.locator('#ranking-body tr')).toHaveCount(active.players.filter(p => p.games > 0).length);
      await page.locator('#played-only').uncheck();
      await page.locator('[data-sort="games"]').click();
      const downloadPromise = page.waitForEvent('download');
      await page.locator('[data-export="players"]').click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /2026-27-total-players.csv/);
      await page.screenshot({ path: path.join(out, `players-${width}.png`), fullPage: true });
      await page.locator('[data-stage="semi"]').click();
      if (active.stages.semi?.status !== 'started') assert.match(await page.locator('#data-notice').textContent(), /未開始/);
      await page.locator('[data-stage="total"]').click();
      await page.locator('a[data-view="history"]').click();
      await page.locator('[data-metric="bk"]').click();
      await expect(page.locator('.log-table tbody tr')).toHaveCount(Math.min(active.history.filter(r => !r.baseline).length, 25));
      const pixels = await page.locator('#history-chart').evaluate(canvas => { const values = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let visible = 0; for (let i = 3; i < values.length; i += 4) if (values[i] > 0) visible++; return visible; });
      assert.ok(pixels > 1000, `Blank chart at ${width}`);
      await page.screenshot({ path: path.join(out, `history-${width}.png`), fullPage: true });
      await page.locator('#season').selectOption('2025-26');
      await page.locator('[data-more]').click();
      await expect(page.locator('.log-table tbody tr')).toHaveCount(81);
      await page.locator('a[data-view="players"]').click();
      await expect(page.locator('#ranking-body tr')).toHaveCount(40);
      await page.locator('[data-stage="final"]').click();
      await page.locator('#source-button').click();
      assert.equal(await page.locator('#source-dialog').evaluate(e => e.open), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      results.push({ width, height, totals, chartPixels: pixels, errors, passed: true });
      await page.close();
    }
    const page = await browser.newPage();
    await page.goto(base + '/charts.html');
    await page.waitForURL('**/index.html#history');
    assert.match(await page.locator('h1').textContent(), /推移/);
    await page.goto(base + '/archive/2025-26/index.html');
    assert.equal(await page.locator('#ranking-tbody tr').count(), 40);
    assert.equal(await page.locator('#log-tbody tr').count(), 81);
    await page.close();
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
