'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { load } = require('cheerio');
const config = require('../config/season');
const { parseOfficial, parseKinma, reconcile, number } = require('../lib/sources');
const { STAGES, normalizeName, aggregate, teamTotals, validateSeason, validatePlayers, validateProgress, snapshot, updateHistory, jstDate } = require('../lib/model');
const { readJSON, readAssignment, writeJSON, fingerprint, assertClean } = require('../lib/store');
const { withDeltas } = require('../scripts/build');
const { collect } = require('../scrape');
const root = path.resolve(__dirname, '..');
const officialHTML = fs.readFileSync(path.join(__dirname, 'fixtures/official-2026-09-14.html'), 'utf8');
const kinmaHTML = fs.readFileSync(path.join(__dirname, 'fixtures/kinma-2026-09-14.html'), 'utf8');
const draft = readJSON(path.join(root, 'data/draft-2026-27.json')).teams;
const original = readJSON(path.join(__dirname, 'fixtures/season-opener.json'));
const official = () => parseOfficial(officialHTML, config, 'regular');
const kinma = () => parseKinma(kinmaHTML, config, 'regular', config.stages.regular.kinmaUrl);

test('live opener fixtures reconcile all forty players and exact fantasy totals', () => {
  const rows = reconcile(kinma(), official());
  assert.equal(rows.length, 40);
  assert.equal(kinma().resultDate, '2026-09-14');
  const totals = teamTotals(aggregate(config.players, { regular: { players: rows } }), draft);
  assert.deepEqual(totals.map(t => [t.id, t.score, t.balance]), [['ten', 54.7, 144.6], ['aji', -56.3, -188.4], ['sat', 21.1, 43.8]]);
});

test('name variants and strict numeric parsing preserve HIRO', () => {
  assert.equal(normalizeName(' ＨＩＲＯ　柴田 '), 'HIRO柴田');
  assert.equal(normalizeName('a尻無濵　航'), '尻無濱航');
  assert.equal(number('▲1,234.5pt', 'test'), -1234.5);
  for (const value of ['1.2broken', '', '—', '1/2', 'NaN', 'Infinity']) assert.throws(() => number(value, 'test'));
});

test('wrong season, mislabeled phase and absent ranking table fail closed', () => {
  assert.throws(() => parseOfficial(officialHTML.replace('2026-27', '2025-26'), config, 'regular'), /different season/);
  assert.throws(() => parseOfficial(officialHTML, config, 'semi'), /wrong phase/);
  assert.throws(() => parseKinma(kinmaHTML.replaceAll('2026-27', '2025-26').replace('202-27', '2025-26'), config, 'regular', config.stages.regular.kinmaUrl), /another season/);
  assert.throws(() => parseKinma(kinmaHTML.replaceAll('雀士', '不明'), config, 'regular', config.stages.regular.kinmaUrl), /one individual/);
});

test('truncated, unknown and duplicate players cannot erase results', () => {
  const rows = official().players;
  assert.throws(() => validatePlayers(rows.slice(1), config.players, { requireAll: true }), /Incomplete roster/);
  assert.throws(() => validatePlayers([...rows, rows[0]], config.players), /duplicate/);
  assert.throws(() => validatePlayers([{ ...rows[0], name: '架空選手' }, ...rows.slice(1)], config.players), /Unknown/);
  const malformed = load(officialHTML);
  malformed('table').first().find('tr').filter((_, tr) => malformed(tr).find('th').first().text() === 'ポイント').find('td').first().text('broken');
  assert.throws(() => parseOfficial(malformed.html(), config, 'regular'), /Invalid number/);
});

test('source disagreement stops instead of substituting zeros or stale points', () => {
  const k = kinma();
  k.players.find(p => p.name === '朝倉康心').score += 0.1;
  assert.throws(() => reconcile(k, official()), /Sources disagree/);
});

test('game counts may grow but never disappear or go backwards', () => {
  const a = official();
  const b = official();
  b.players.find(p => p.name === '朝倉康心').games = 0;
  assert.throws(() => validateProgress(a, b), /decreased/);
  assert.throws(() => validateProgress(a, { players: b.players.slice(1) }), /disappeared/);
});

function playoffHTML(stage, finalEnabled = false) {
  const $ = load(officialHTML);
  $('.p-stats__tab').html(STAGES.filter(k => k !== 'final' || finalEnabled).map(k => `<a role="tab" aria-selected="${k === stage}" id="${config.stages[k].tabId}" href="/stats/?season=${config.stages[k].officialId}">${config.stages[k].label}</a>`).join(''));
  if (stage !== 'regular') {
    const count = stage === 'semi' ? 6 : 4;
    $('table').slice(count).remove();
    $('table').each((tableIndex, table) => {
      $(table).find('tr').each((_, tr) => {
        const title = $(tr).find('th').first().text().trim();
        if (title === '選手名') return;
        $(tr).find('td').each((i, td) => {
          let value = 0;
          if (tableIndex === 0) {
            if (title === '試合数') value = 1;
            if (title === 'ポイント') value = [50, 10, -10, -50][i];
            if (title === '平着') value = i + 1;
            if (title === `${i + 1}位`) value = 1;
          }
          $(td).text(value);
        });
      });
    });
  }
  return $.html();
}

test('semifinal and final discover only active official links, never commented future URLs', () => {
  assert.deepEqual(Object.keys(official().available), ['regular']);
  const semi = parseOfficial(playoffHTML('semi'), config, 'semi');
  const final = parseOfficial(playoffHTML('final', true), config, 'final');
  assert.equal(semi.players.length, 24);
  assert.equal(final.players.length, 16);
  const truncated = load(playoffHTML('semi'));
  truncated('table').slice(1).remove();
  assert.throws(() => parseOfficial(truncated.html(), config, 'semi'), /Incomplete phase roster/);
  const players = aggregate(config.players, { regular: official(), semi, final });
  const p = players.find(p => p.name === '逢川恵夢');
  assert.equal(p.score, 38);
  assert.equal(p.games, 3);
  assert.equal(p.avg, 2.33);
  assert.equal(players.find(p => p.name === '朝倉康心').score, 54.7);
  assert.equal(players.length, 40);
});

test('same-day updates replace a snapshot and keep previous-day deltas; reruns do not append', () => {
  const next = structuredClone(original.history.at(-1));
  next.observedAt = '2026-09-15T01:00:00Z';
  const history = updateHistory(original.history, next);
  assert.equal(history.length, original.history.length);
  assert.equal(history[0].baseline, true);
  assert.equal(withDeltas({ ...original, history }).find(p => p.name === '朝倉康心').score_delta, 54.7);
  assert.throws(() => updateHistory(history, { ...next, date: '2026-09-12' }), /backwards/);
  assert.equal(jstDate(new Date('2026-12-31T16:00:00Z')), '2027-01-01');
});

test('corrupt history, altered totals, missing stages and crossed seasons are rejected', () => {
  assert.throws(() => assertClean('<'.repeat(7) + ' HEAD\nbad\n' + '='.repeat(7), 'history.js'), /conflict/);
  for (const mutate of [
    s => { s.history = []; },
    s => { s.history[1].date = s.history[0].date; },
    s => { s.history[1].date = '2028-01-01'; },
    s => { s.history[1].ten_pt += 1; },
    s => { s.history[1].players[0].regular_score += 1; },
    s => { s.history[1].players[0].name = '不明'; },
    s => { s.stages.regular = null; },
    s => { s.players[0].score += 1; },
  ]) {
    const altered = structuredClone(original); mutate(altered);
    assert.throws(() => validateSeason(altered));
  }
});

function tempRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mleague-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'data/seasons'), { recursive: true });
  fs.copyFileSync(path.join(root, 'data/draft-2026-27.json'), path.join(dir, 'data/draft-2026-27.json'));
  writeJSON(path.join(dir, 'data/seasons/2026-27.json'), original);
  return dir;
}

test('collector keeps files byte-identical after network and parse failures', async t => {
  const dir = tempRepo(t);
  const file = path.join(dir, 'data/seasons/2026-27.json');
  const hash = fingerprint(fs.readFileSync(file));
  await assert.rejects(collect({ root: dir, fetcher: async () => { throw new Error('HTTP 503'); }, dryRun: true }), /503/);
  await assert.rejects(collect({ root: dir, fetcher: async () => '<html>error</html>', dryRun: true }), /different season/);
  assert.equal(fingerprint(fs.readFileSync(file)), hash);
});

test('collector aborts on broken generated history before even fetching', async t => {
  const dir = tempRepo(t);
  fs.writeFileSync(path.join(dir, 'history.js'), 'window.MLEAGUE_HISTORY = ' + '<'.repeat(7) + ' HEAD;\n');
  let fetched = false;
  await assert.rejects(collect({ root: dir, fetcher: async () => { fetched = true; return officialHTML; }, dryRun: true }));
  assert.equal(fetched, false);
});

test('collector regular -> semi -> final preserves eliminated players and all previous history', async t => {
  const dir = tempRepo(t);
  const initialHash = fingerprint(original.history);
  let finalEnabled = false;
  const fetcher = async url => {
    if (url === config.stages.regular.kinmaUrl) return kinmaHTML;
    const key = STAGES.find(k => new URL(url).searchParams.get('season') === config.stages[k].officialId);
    return playoffHTML(key, finalEnabled);
  };
  const semi = await collect({ root: dir, fetcher, now: new Date('2027-04-05T17:00:00Z'), dryRun: true });
  assert.equal(semi.activeStage, 'semi');
  assert.equal(semi.history.length, 3);
  assert.equal(fingerprint(semi.history.slice(0, 2)), initialHash);
  writeJSON(path.join(dir, 'data/seasons/2026-27.json'), semi);
  finalEnabled = true;
  const final = await collect({ root: dir, fetcher, now: new Date('2027-05-05T17:00:00Z'), dryRun: true });
  assert.equal(final.activeStage, 'final');
  assert.equal(final.history.length, 4);
  assert.equal(final.players.find(p => p.name === '朝倉康心').score, 54.7);
  validateSeason(final);
  writeJSON(path.join(dir, 'data/seasons/2026-27.json'), final);
  const repeat = await collect({ root: dir, fetcher, now: new Date('2027-05-06T17:00:00Z'), dryRun: true });
  assert.deepEqual(repeat, final);
  finalEnabled = false;
  await assert.rejects(collect({ root: dir, fetcher, now: new Date('2027-05-07T17:00:00Z'), dryRun: true }), /disappeared/);
});

test('legacy migration preserves every original log value and original app', () => {
  const legacy = readJSON(path.join(root, 'data/seasons/2025-26.json'));
  const old = readAssignment(path.join(root, 'archive/2025-26/history.js'), 'MLEAGUE_HISTORY');
  assert.equal(legacy.history.length, 81);
  assert.equal(legacy.provenance.originalHistoryHash, fingerprint(old));
  for (const row of old) {
    const match = legacy.history.find(h => `${Number(h.date.slice(5, 7))}/${Number(h.date.slice(8, 10))}` === row.date);
    for (const [key, value] of Object.entries(row)) if (key !== 'date') assert.equal(match[key], value);
  }
  validateSeason(legacy);
});
