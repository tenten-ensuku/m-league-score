'use strict';

const STAGES = ['regular', 'semi', 'final'];
const round = v => Math.round((v + Number.EPSILON) * 10) / 10;
const normalizeName = name => String(name).normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff]/g, '').replace(/^[a-z]+(?=[^a-zA-Z])/, '').replace(/濵/g, '濱');

function rankPlayers(players) {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ja'));
  sorted.forEach((p, i) => { p.rank = i && p.score === sorted[i - 1].score ? sorted[i - 1].rank : i + 1; });
  return sorted;
}

function aggregate(roster, stages) {
  return rankPlayers(roster.map(person => {
    const out = { ...person, score: 0, games: 0, avg: null };
    let placeSum = 0;
    let exact = true;
    for (const key of STAGES) {
      const row = stages[key]?.players.find(p => p.name === person.name);
      out[`${key}_score`] = row?.score ?? 0;
      out[`${key}_games`] = row?.games ?? 0;
      out[`${key}_avg`] = row?.avg ?? null;
      out.score = round(out.score + (row?.score ?? 0));
      out.games += row?.games ?? 0;
      if (row?.games) {
        if (row.placements) placeSum += row.placements.reduce((s, n, i) => s + n * (i + 1), 0);
        else { placeSum += row.avg * row.games; exact = false; }
      }
    }
    out.avg = out.games ? Math.round(placeSum / out.games * 100) / 100 : null;
    out.avgApproximate = !exact;
    return out;
  }));
}

function teamTotals(players, draft, stage = 'total') {
  const scoreKey = stage === 'total' ? 'score' : `${stage}_score`;
  const map = new Map(players.map(p => [p.name, p]));
  const teams = draft.map(t => ({ ...t, score: round(t.members.reduce((sum, name) => {
    if (!map.has(name)) throw new Error(`Unknown draft player: ${name}`);
    return sum + map.get(name)[scoreKey];
  }, 0)) }));
  const sum = round(teams.reduce((s, t) => s + t.score, 0));
  return teams.map(t => ({ ...t, balance: round(3 * t.score - sum) }));
}

function validatePlayers(players, roster, { requireAll = false, minimumPlayers = 1 } = {}) {
  if (!Array.isArray(players) || !players.length) throw new Error('Empty player table');
  const known = new Set(roster.map(p => p.name));
  const seen = new Set();
  for (const p of players) {
    if (!known.has(p.name) || seen.has(p.name)) throw new Error(`Unknown or duplicate player: ${p.name}`);
    seen.add(p.name);
    if (!Number.isFinite(p.score) || !Number.isInteger(p.games) || p.games < 0 || p.games > 1000) throw new Error(`Invalid score/games: ${p.name}`);
    if (p.games && (!Number.isFinite(p.avg) || p.avg < 1 || p.avg > 4)) throw new Error(`Invalid average: ${p.name}`);
    if (!p.games && p.score !== 0) throw new Error(`Points without games: ${p.name}`);
    if (p.placements && (p.placements.length !== 4 || p.placements.some(n => !Number.isInteger(n) || n < 0) || p.placements.reduce((a, b) => a + b, 0) !== p.games)) throw new Error(`Invalid placement counts: ${p.name}`);
  }
  if (requireAll && seen.size !== known.size) throw new Error(`Incomplete roster: ${seen.size}/${known.size}`);
  if (seen.size < minimumPlayers) throw new Error(`Incomplete phase roster: ${seen.size}/${minimumPlayers}`);
  const appearances = players.reduce((sum, p) => sum + p.games, 0);
  if (appearances % 4) throw new Error('Incomplete match: player appearances must be divisible by four');
  return players;
}

function validateProgress(previous, next) {
  if (!previous) return;
  const map = new Map(next.players.map(p => [p.name, p]));
  for (const p of previous.players) {
    const fresh = map.get(p.name);
    if (!fresh || fresh.games < p.games) throw new Error(`Results disappeared or games decreased: ${p.name}`);
  }
}

function validateDraft(draft, roster) {
  if (!Array.isArray(draft) || draft.length !== 3 || new Set(draft.map(t => t.id)).size !== 3) throw new Error('Expected three draft teams');
  const known = new Set(roster.map(p => p.name));
  const seen = new Set();
  for (const t of draft) {
    if (!Array.isArray(t.members) || t.members.length !== 10) throw new Error(`Expected ten players: ${t.id}`);
    for (const name of t.members) {
      if (!known.has(name) || seen.has(name)) throw new Error(`Invalid draft pick: ${name}`);
      seen.add(name);
    }
  }
}

function validateSeason(state) {
  if (state.schemaVersion !== 2 || !/^\d{4}-\d{2}$/.test(state.id)) throw new Error('Unknown season schema');
  validateDraft(state.draft, state.roster);
  if (!Array.isArray(state.history)) throw new Error('Missing history');
  if (new Set(state.roster.map(p => p.name)).size !== state.roster.length || state.roster.length !== 40) throw new Error('Invalid season roster');
  validatePlayers(state.players, state.roster, { requireAll: true });
  if (!state.legacy) {
    for (const key of STAGES) if (state.stages[key]) validatePlayers(state.stages[key].players, state.roster, { requireAll: key === 'regular' });
    if (!state.stages.regular) throw new Error('Missing regular season');
  }
  let previousDate = '';
  for (const row of state.history) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || new Date(row.date).toISOString().slice(0, 10) !== row.date || row.date <= previousDate) throw new Error(`Invalid or duplicate history date: ${row.date}`);
    if (!row.date.startsWith(state.id.slice(0, 4)) && !row.date.startsWith(String(Number(state.id.slice(0, 4)) + 1))) throw new Error(`History belongs to another season: ${row.date}`);
    previousDate = row.date;
    for (const t of state.draft) {
      for (const suffix of ['pt', 'bk']) {
        const value = row[`${t.id}_${suffix}`];
        if (!Number.isFinite(value) && !(state.legacy && value === null)) throw new Error(`Invalid history value: ${row.date} ${t.id}_${suffix}`);
      }
    }
    if (!state.legacy) {
      if (!row.players || row.players.length !== state.roster.length || !row.stages) throw new Error(`Missing snapshot: ${row.date}`);
      validatePlayers(row.players, state.roster, { requireAll: true });
      for (const player of row.players) {
        if (STAGES.some(key => !Number.isFinite(player[`${key}_score`]) || !Number.isInteger(player[`${key}_games`]) || player[`${key}_games`] < 0)) throw new Error(`Invalid phase breakdown: ${row.date} ${player.name}`);
        if (round(STAGES.reduce((sum, key) => sum + player[`${key}_score`], 0)) !== player.score || STAGES.reduce((sum, key) => sum + player[`${key}_games`], 0) !== player.games) throw new Error(`Snapshot phase totals disagree: ${row.date} ${player.name}`);
      }
      for (const key of ['total', ...STAGES]) {
        const values = key === 'total' ? row : row.stages[key];
        for (const team of teamTotals(row.players, state.draft, key)) {
          if (values?.[`${team.id}_pt`] !== team.score || values?.[`${team.id}_bk`] !== team.balance) throw new Error(`Snapshot totals disagree: ${row.date} ${key} ${team.id}`);
        }
      }
    }
  }
  if (!state.legacy && !state.history.length) throw new Error('Refusing empty season history');
  if (!state.legacy) {
    const generated = aggregate(state.roster, state.stages);
    for (const rows of [state.players, state.history.at(-1).players]) {
      for (const p of generated) {
        const actual = rows.find(row => row.name === p.name);
        if (!actual || ['score', 'games', 'avg', ...STAGES.flatMap(key => [`${key}_score`, `${key}_games`])].some(key => actual[key] !== p[key])) throw new Error(`Latest snapshot differs from stage data: ${p.name}`);
      }
    }
  }
  return state;
}

function snapshot(date, players, draft, observedAt) {
  const result = { date, observedAt, players, stages: {} };
  for (const stage of ['total', ...STAGES]) {
    const totals = teamTotals(players, draft, stage);
    const values = Object.fromEntries(totals.flatMap(t => [[`${t.id}_pt`, t.score], [`${t.id}_bk`, t.balance]]));
    if (stage === 'total') Object.assign(result, values);
    else result.stages[stage] = values;
  }
  return result;
}

function updateHistory(history, entry) {
  const result = structuredClone(history);
  const last = result.at(-1);
  if (last && entry.date < last.date) throw new Error('Source date moved backwards');
  if (last?.date === entry.date) result[result.length - 1] = entry;
  else result.push(entry);
  return result;
}

function jstDate(now = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }

module.exports = { STAGES, round, normalizeName, rankPlayers, aggregate, teamTotals, validatePlayers, validateProgress, validateDraft, validateSeason, snapshot, updateHistory, jstDate };
