'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readAssignment, writeJSON, fingerprint } = require('../lib/store');
const { validateSeason, normalizeName } = require('../lib/model');
const config = require('../config/season');
const root = path.join(__dirname, '..');

function main() {
  const dest = path.join(root, 'data/seasons/2025-26.json');
  if (fs.existsSync(dest)) throw new Error('Legacy archive exists; do not overwrite it');
  const players = readAssignment(path.join(root, 'data.js'), 'MLEAGUE_PLAYERS');
  const rawHistory = readAssignment(path.join(root, 'history.js'), 'MLEAGUE_HISTORY');
  const updated = readAssignment(path.join(root, 'data.js'), 'MLEAGUE_UPDATED');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const context = {};
  // Only the original local roster object literals are read, not the page scripts.
  for (const name of ['FANTASY_CONFIG', 'PLAYER_TEAMS']) {
    const match = html.match(new RegExp('const ' + name + ' = ([\\s\\S]*?);'));
    if (!match) throw new Error(`Missing legacy ${name}`);
    context[name] = vm.runInNewContext(`(${match[1]})`, {}, { timeout: 1000 });
  }
  const teamNames = [...new Set(Object.values(context.PLAYER_TEAMS))];
  const teams = teamNames.map((name, i) => {
    const match = config.teams.find(t => name.includes(t.short) || t.name === name || (name.includes('パイレーツ') && t.id === 'pirates'));
    return { id: match?.id || `legacy-${i}`, name, short: match?.short || name, color: match?.color || '#68736e' };
  });
  const roster = players.map((p, i) => ({ id: `legacy-${i}`, name: normalizeName(p.name), teamId: teams.find(t => t.name === context.PLAYER_TEAMS[p.name])?.id }));
  const draft = context.FANTASY_CONFIG.map(t => ({ id: t.id, name: t.name.replace('チーム', ''), color: config.participants.find(p => p.id === t.id).color, members: t.members }));
  const history = rawHistory.map(row => {
    const [month, day] = row.date.split('/').map(Number);
    return { ...row, date: `${month >= 7 ? 2025 : 2026}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const state = { schemaVersion: 2, id: '2025-26', legacy: true, status: 'complete', updatedAt: updated.replaceAll('/', '-'), resultDate: history.at(-1).date, roster, teams, draft, stages: {}, players, history, legacyAverageScope: 'regular', provenance: { commit: '6c72530', originalHistoryHash: fingerprint(rawHistory), originalHistoryCount: rawHistory.length } };
  validateSeason(state);
  writeJSON(dest, state);
  const archive = path.join(root, 'archive/2025-26');
  fs.mkdirSync(archive, { recursive: true });
  for (const name of ['index.html', 'charts.html', 'data.js', 'history.js', 'chart.min.js']) fs.copyFileSync(path.join(root, name), path.join(archive, name));
  console.log(`Archived ${players.length} players and all ${history.length} DATA LOG entries. Original app: archive/2025-26/`);
}

main();
