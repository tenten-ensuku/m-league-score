'use strict';

const { load } = require('cheerio');
const { number } = require('./sources');
const { normalizeName, round, aggregate, snapshot, validatePlayers } = require('./model');
const GAMES_URL = 'https://m-league.jp/games/';

function recoverRegularHistory(previous, next, html) {
  if (!previous || previous.activeStage !== 'regular' || next.activeStage !== 'regular' || previous.stages.semi || next.stages.semi || next.dateKind !== 'result' || previous.resultDate >= next.resultDate) {
    throw new Error('History recovery requires an advancing regular-season result date');
  }
  const $ = load(html);
  const days = new Map();
  const seen = new Set();
  const known = new Set(next.roster.map(p => p.name));
  $('.p-gamesResult').each((_, result) => {
    const id = $(result).closest('.c-modal2').attr('id');
    if (id === 'js-modal-key年0000-試合番号') return;
    const match = id?.match(/^js-modal-key(\d{4})(\d{2})(\d{2})-(\d+)$/);
    if (!match || seen.has(id)) throw new Error(`Invalid or duplicate result ID: ${id}`);
    seen.add(id);
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    if (new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid result date');
    if (date <= previous.resultDate) return;
    if (date > next.resultDate) throw new Error('Daily results are newer than verified standings');
    const displayed = $(result).find('.p-gamesResult__date').text();
    if (!displayed.startsWith(`${Number(match[2])}/${Number(match[3])}(`)) throw new Error('Result ID and displayed date disagree');
    const columns = $(result).find('.p-gamesResult__column').toArray();
    if (columns.length !== 2) throw new Error(`Incomplete daily result: ${id}`);
    const entries = days.get(date) || [];
    columns.forEach((column, index) => {
      if ($(column).find('.p-gamesResult__number').text().trim() !== `第${index + 1}回戦`) throw new Error('Unexpected round order');
      const rows = $(column).find('.p-gamesResult__rank-item').toArray().map(row => ({
        name: normalizeName($(row).find('.p-gamesResult__name').text()),
        score: number($(row).find('.p-gamesResult__point').text(), id),
        rank: number($(row).find('.p-gamesResult__rank-badge').text(), id),
      }));
      if (rows.length !== 4 || new Set(rows.map(p => p.name)).size !== 4 || rows.some((p, i) => !known.has(p.name) || p.rank !== i + 1) || round(rows.reduce((sum, p) => sum + p.score, 0)) !== 0) throw new Error(`Invalid match result: ${id}`);
      entries.push({ id: `${id}/${index + 1}`, rows });
    });
    days.set(date, entries);
  });
  if (!days.size || !days.has(next.resultDate)) throw new Error('Missing daily results for recovery');
  const players = structuredClone(previous.stages.regular.players);
  const map = new Map(players.map(p => [p.name, p]));
  const history = structuredClone(previous.history);
  for (const [date, matches] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    for (const match of matches) for (const row of match.rows) {
      const player = map.get(row.name);
      if (!player?.placements) throw new Error('Missing original placement counts');
      player.score = round(player.score + row.score);
      player.games++;
      player.placements[row.rank - 1]++;
      player.avg = player.placements.reduce((sum, n, i) => sum + n * (i + 1), 0) / player.games;
    }
    validatePlayers(players, next.roster, { requireAll: true });
    const stages = { ...previous.stages, regular: { ...previous.stages.regular, players } };
    const entry = snapshot(date, aggregate(next.roster, stages), next.draft, next.updatedAt);
    entry.dateKind = 'result';
    entry.recovery = { source: GAMES_URL, matchIds: matches.map(m => m.id) };
    history.push(entry);
  }
  // The entire recovered interval must reproduce every verified cumulative result.
  for (const expected of next.stages.regular.players) {
    const actual = map.get(expected.name);
    if (actual.score !== expected.score || actual.games !== expected.games || JSON.stringify(actual.placements) !== JSON.stringify(expected.placements)) {
      throw new Error(`Recovered history disagrees with standings: ${expected.name}`);
    }
  }
  return history;
}

module.exports = { recoverRegularHistory, GAMES_URL };
