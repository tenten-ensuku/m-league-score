'use strict';

const { load } = require('cheerio');
const { parseKinma, number } = require('./sources');
const { validateMatchRows } = require('./recovery');
const { normalizeName, round, aggregate, snapshot, validatePlayers, validateProgress } = require('./model');

async function recoverFromKinma(previous, config, fetcher, observedAt) {
  if (!previous || previous.activeStage !== 'regular' || previous.stages.semi || previous.stages.final) throw new Error('Kinma recovery requires an existing regular season');
  const ranking = load(await fetcher(config.stages.regular.kinmaUrl));
  const corrected = [];
  ranking('tr').each((_, tr) => {
    const cells = ranking(tr).children('td,th');
    if (cells.length !== 5) return;
    const text = ranking(cells[3]).text().trim();
    if (/^\d+n$/.test(text)) {
      corrected.push(ranking(cells[1]).text().trim().split(/\s+/)[0]);
      ranking(cells[3]).text(text.slice(0, -1));
    }
  });
  const kinma = parseKinma(ranking.html(), config, 'regular', config.stages.regular.kinmaUrl);
  if (kinma.resultDate < previous.resultDate) throw new Error('Kinma result date moved backwards');
  const days = new Map();
  const monthlySources = [];
  const first = new Date(previous.resultDate.slice(0, 7) + '-01T00:00:00Z');
  const last = new Date(kinma.resultDate.slice(0, 7) + '-01T00:00:00Z');
  const known = new Set(config.players.map(p => p.name));
  for (let month = first; month <= last; month.setUTCMonth(month.getUTCMonth() + 1)) {
    const url = `https://kinmaweb.jp/${month.toISOString().slice(0, 7)}-result`;
    monthlySources.push(url);
    const $ = load(await fetcher(url));
    $('h2').each((_, heading) => {
      const m = $(heading).text().match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (!m) return;
      const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      if (date <= previous.resultDate || date > kinma.resultDate) return;
      if (date.slice(0, 7) !== month.toISOString().slice(0, 7)) throw new Error('Kinma result belongs to another month');
      const table = $(heading).next('table.m_league_dailyscore');
      if (table.length !== 1) throw new Error(`Kinma daily table missing: ${date}`);
      const matches = days.get(date) || [];
      let rows = null;
      let roundIndex = 0;
      table.find('tr').each((_, tr) => {
        const cells = $(tr).children('td,th');
        if (cells.length === 1) {
          if (rows) { validateMatchRows(rows, known, date); matches.push(rows); }
          roundIndex++;
          if ($(cells[0]).text().trim() !== `第${roundIndex}試合` || roundIndex > 2) throw new Error(`Unexpected Kinma round: ${date}`);
          rows = [];
        } else if (cells.length === 3 && rows) {
          const rank = $(cells[0]).text().trim().match(/^(\d+)着$/);
          if (!rank) throw new Error(`Invalid Kinma rank: ${date}`);
          rows.push({ name: normalizeName($(cells[1]).find('a').first().text()), rank: Number(rank[1]), score: number($(cells[2]).text(), date) });
        } else throw new Error(`Invalid Kinma row: ${date}`);
      });
      if (!rows || roundIndex !== 2) throw new Error(`Kinma round missing: ${date}`);
      validateMatchRows(rows, known, date); matches.push(rows);
      days.set(date, matches);
    });
  }
  const players = structuredClone(previous.stages.regular.players);
  const map = new Map(players.map(p => [p.name, p]));
  const history = structuredClone(previous.history);
  for (const [date, matches] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    if (![2, 4].includes(matches.length)) throw new Error(`Incomplete Kinma day: ${date}`);
    for (const rows of matches) for (const row of rows) {
      const p = map.get(row.name);
      if (!p?.placements) throw new Error(`Missing original placements: ${row.name}`);
      p.score = round(p.score + row.score); p.games++; p.placements[row.rank - 1]++;
      p.avg = p.placements.reduce((sum, n, i) => sum + n * (i + 1), 0) / p.games;
    }
    validatePlayers(players, config.players, { requireAll: true });
    const stages = { ...previous.stages, regular: { ...previous.stages.regular, players } };
    const entry = snapshot(date, aggregate(config.players, stages), previous.draft, observedAt);
    entry.dateKind = 'result'; entry.recovery = { source: monthlySources.find(u => u.includes(date.slice(0, 7))), provisional: true };
    history.push(entry);
  }
  if (kinma.resultDate > previous.resultDate && !days.has(kinma.resultDate)) throw new Error('Kinma latest daily results missing');
  for (const p of kinma.players) {
    const actual = map.get(p.name);
    if (!actual || actual.score !== p.score || actual.games !== p.games) throw new Error(`Kinma daily results disagree with standings: ${p.name}`);
  }
  validateProgress(previous.stages.regular, { players });
  return { players, history, resultDate: kinma.resultDate, corrected, monthlySources };
}

module.exports = { recoverFromKinma };
