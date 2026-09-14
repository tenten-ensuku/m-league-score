'use strict';

const { load } = require('cheerio');
const { normalizeName, validatePlayers } = require('./model');

async function fetchText(url) {
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'MLeagueDraftScores/2.0 (+https://github.com/tenten-ensuku/m-league-score)', Accept: 'text/html,application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return await response.text();
    } catch (error) { failure = error; }
  }
  throw failure;
}

function number(text, label) {
  const clean = text.normalize('NFKC').replace(/[,\s]/g, '').replace(/[▲△−－]/g, '-').replace(/(?:pt|PT)$/, '');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(clean)) throw new Error(`Invalid number (${label}): ${text}`);
  return Number(clean);
}

function officialURL(id) { return `https://m-league.jp/stats/?season=${id}`; }

function parseOfficial(html, config, stage) {
  const $ = load(html);
  if (!$('.c-title').text().includes(config.id)) throw new Error('Official page belongs to a different season');
  const selected = $('[role="tab"][aria-selected="true"]');
  const expected = config.stages[stage];
  if (selected.length !== 1 || selected.attr('id') !== expected.tabId || new URL(selected.attr('href'), 'https://m-league.jp').searchParams.get('season') !== expected.officialId) throw new Error(`Official page returned wrong phase: ${stage}`);
  const available = {};
  for (const [key, definition] of Object.entries(config.stages)) {
    const anchor = $(`a#${definition.tabId}[role="tab"]`);
    if (anchor.length) {
      const url = new URL(anchor.attr('href'), 'https://m-league.jp');
      if (url.origin !== 'https://m-league.jp' || url.pathname !== '/stats/' || url.searchParams.get('season') !== definition.officialId) throw new Error(`Official phase URL changed: ${key}`);
      available[key] = url.href;
    }
  }
  const players = [];
  $('table.p-stats__table').each((_, table) => {
    const rows = new Map();
    $(table).find('tr').each((_, tr) => {
      const cells = $(tr).children('th,td').map((_, cell) => $(cell).text().trim()).get();
      rows.set(cells[0], cells.slice(1));
    });
    const names = rows.get('選手名');
    if (!names?.length) throw new Error('Official player header missing');
    const required = ['試合数', 'ポイント', '平着', '1位', '2位', '3位', '4位'];
    for (const key of required) if (rows.get(key)?.length !== names.length) throw new Error(`Official column missing: ${key}`);
    names.forEach((rawName, i) => {
      const name = normalizeName(rawName);
      const games = number(rows.get('試合数')[i], name);
      const placements = ['1位', '2位', '3位', '4位'].map(key => number(rows.get(key)[i], name));
      const listedAvg = number(rows.get('平着')[i], name);
      const avg = games ? placements.reduce((sum, n, rank) => sum + n * (rank + 1), 0) / games : null;
      if (games && Math.abs(listedAvg - avg) > 0.02) throw new Error(`Official average disagrees with placements: ${name}`);
      players.push({ name, score: number(rows.get('ポイント')[i], name), games, avg, placements });
    });
  });
  validatePlayers(players, config.players, { requireAll: stage === 'regular', minimumPlayers: expected.minimumPlayers });
  return { players, available, source: officialURL(expected.officialId) };
}

function parseKinma(html, config, stage, url) {
  const $ = load(html);
  const title = $('h1.entry-title').text().normalize('NFKC');
  const label = config.stages[stage].label;
  if (!title.includes(label) || !/(?:個人成績|個人ランキング|チーム・個人)/.test(title)) throw new Error('Kinma title/phase mismatch');
  // The verified 2026 opener has a publisher typo (202-27) in its headline.
  const knownTypo = url === 'https://kinmaweb.jp/archives/279394' && title.includes('202-27') && $('meta[property="og:image"]').attr('content')?.includes('2026-27');
  if (!title.includes(config.id) && !knownTypo) throw new Error('Kinma page belongs to another season');
  const dateMatch = title.match(/(\d{1,2})月(\d{1,2})日更新/);
  if (!dateMatch) throw new Error('Kinma result date missing');
  const month = Number(dateMatch[1]);
  const year = config.startYear + (month < 7 ? 1 : 0);
  const resultDate = `${year}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`;
  if (Number.isNaN(Date.parse(resultDate)) || new Date(resultDate).toISOString().slice(0, 10) !== resultDate || resultDate < config.startsOn) throw new Error('Invalid source result date');
  const matches = [];
  $('table').each((_, table) => {
    const rows = $(table).find('tr').toArray();
    const headerIndex = rows.findIndex(tr => $(tr).children('td,th').toArray().some(cell => ['雀士', '選手名'].includes($(cell).text().trim())));
    if (headerIndex < 0) return;
    const header = $(rows[headerIndex]).children('td,th').map((_, e) => $(e).text().trim()).get();
    const nameColumn = header.findIndex(h => ['雀士', '選手名'].includes(h));
    const scoreColumn = header.findIndex(h => ['合計PT', 'ポイント', 'PT'].includes(h));
    const gameColumn = header.findIndex(h => ['試合数', 'ゲーム数'].includes(h));
    const avgColumn = header.findIndex(h => ['平均着順', '平着'].includes(h));
    if ([nameColumn, scoreColumn, gameColumn, avgColumn].includes(-1)) throw new Error('Kinma ranking columns changed');
    const players = rows.slice(headerIndex + 1).map(tr => {
      const cells = $(tr).children('td,th');
      if (cells.length !== header.length) throw new Error('Kinma ranking row is truncated');
      const cell = cells.eq(nameColumn);
      const name = normalizeName(cell.find('a[href*="/janshi/"]').first().text() || load((cell.html() || '').split(/<br\s*\/?>/i)[0]).text());
      const games = number(cells.eq(gameColumn).text(), name);
      return { name, score: number(cells.eq(scoreColumn).text(), name), games, avg: games ? number(cells.eq(avgColumn).text(), name) : null };
    });
    matches.push(players);
  });
  if (matches.length !== 1) throw new Error(`Expected one individual ranking table, got ${matches.length}`);
  validatePlayers(matches[0], config.players, { requireAll: stage === 'regular', minimumPlayers: config.stages[stage].minimumPlayers });
  return { players: matches[0], resultDate, source: url };
}

function reconcile(kinma, official) {
  const k = new Map(kinma.players.map(p => [p.name, p]));
  const o = new Map(official.players.map(p => [p.name, p]));
  for (const name of new Set([...k.keys(), ...o.keys()])) {
    const a = k.get(name), b = o.get(name);
    if (!a || !b || a.games !== b.games || Math.abs(a.score - b.score) > 0.01 || (a.games && Math.abs(a.avg - b.avg) > 0.02)) throw new Error(`Sources disagree: ${name}; retaining the last verified data`);
  }
  return official.players;
}

module.exports = { fetchText, number, officialURL, parseOfficial, parseKinma, reconcile };
