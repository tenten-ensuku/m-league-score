'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config/season');
const { fetchText, officialURL, parseOfficial, parseKinma, reconcile } = require('./lib/sources');
const { readJSON, readAssignment, writeJSON, fingerprint } = require('./lib/store');
const { STAGES, aggregate, validateDraft, validateSeason, validateProgress, snapshot, updateHistory, jstDate } = require('./lib/model');

async function collect({ root = __dirname, fetcher = fetchText, now = new Date(), initialize = false, dryRun = false } = {}) {
  const statePath = path.join(root, `data/seasons/${config.id}.json`);
  const exists = fs.existsSync(statePath);
  if (!exists && !initialize) throw new Error('Season state missing. Use --init only when creating a reviewed new season.');
  if (exists && initialize) throw new Error('Season already exists; --init cannot reset it.');
  const previous = exists ? validateSeason(readJSON(statePath)) : null;
  if (previous && previous.id !== config.id) throw new Error('Stored season ID differs from the active configuration');
  const seasonFolder = path.join(root, 'data/seasons');
  for (const file of fs.existsSync(seasonFolder) ? fs.readdirSync(seasonFolder) : []) {
    if (/^\d{4}-\d{2}\.json$/.test(file)) validateSeason(readJSON(path.join(seasonFolder, file)));
  }
  for (const [file, variable] of [['data.js', 'MLEAGUE_PLAYERS'], ['history.js', 'MLEAGUE_HISTORY']]) {
    if (fs.existsSync(path.join(root, file))) readAssignment(path.join(root, file), variable);
  }
  const draftFile = readJSON(path.join(root, `data/draft-${config.id}.json`));
  if (draftFile.season !== config.id) throw new Error('Draft belongs to another season');
  validateDraft(draftFile.teams, config.players);
  if (previous && fingerprint(previous.draft) !== fingerprint(draftFile.teams)) throw new Error('Locked draft roster changed; review a roster migration');
  const regularHtml = await fetcher(officialURL(config.stages.regular.officialId));
  const regular = parseOfficial(regularHtml, config, 'regular');
  const stages = {};
  const observedAt = now.toISOString();
  for (const key of STAGES) {
    const definition = config.stages[key];
    if (!regular.available[key]) {
      if (previous?.stages[key]) throw new Error(`Previously active phase disappeared: ${key}`);
      stages[key] = null;
      continue;
    }
    if (key === 'final' && !regular.available.semi) throw new Error('Final appeared without semifinal');
    const official = key === 'regular' ? regular : parseOfficial(await fetcher(regular.available[key]), config, key);
    let players = official.players;
    let resultDate = null;
    const sources = [{ name: 'Mリーグ公式', url: official.source }];
    if (definition.kinmaUrl) {
      const kinma = parseKinma(await fetcher(definition.kinmaUrl), config, key, definition.kinmaUrl);
      players = reconcile(kinma, official);
      resultDate = kinma.resultDate;
      sources.unshift({ name: 'キンマweb', url: definition.kinmaUrl });
    }
    if (resultDate && resultDate > jstDate(now)) throw new Error('Source result date is in the future');
    stages[key] = { players, sources, resultDate, observedAt, status: players.some(p => p.games) ? 'started' : 'pending' };
    validateProgress(previous?.stages[key], stages[key]);
    console.log(`${key}: ${players.length} players, ${players.reduce((s, p) => s + p.games, 0) / 4} matches, ${sources.length} source(s)`);
  }
  const signature = value => Object.fromEntries(STAGES.map(k => [k, value[k] ? [...value[k].players].sort((a, b) => a.name.localeCompare(b.name)) : null]));
  const changed = !previous || fingerprint(signature(previous.stages)) !== fingerprint(signature(stages));
  if (!changed) {
    if (!dryRun) require('./scripts/build').build(root);
    console.log('Verified: no score changes. History and previous-match deltas retained.');
    return previous;
  }
  const players = aggregate(config.players, stages);
  const activeStage = [...STAGES].reverse().find(k => stages[k]?.status === 'started') || 'regular';
  const active = stages[activeStage];
  const resultDate = active.resultDate || jstDate(now);
  let history = previous?.history || [];
  if (!history.length) {
    const zero = aggregate(config.players, {});
    const baseline = new Date(config.startsOn + 'T00:00:00Z');
    baseline.setUTCDate(baseline.getUTCDate() - 1);
    history = [snapshot(baseline.toISOString().slice(0, 10), zero, draftFile.teams, observedAt)];
    history[0].baseline = true;
  }
  const newSnapshot = snapshot(resultDate, players, draftFile.teams, observedAt);
  newSnapshot.dateKind = active.resultDate ? 'result' : 'observed';
  const next = { schemaVersion: 2, id: config.id, status: 'active', activeStage, updatedAt: observedAt, resultDate, dateKind: newSnapshot.dateKind, roster: config.players, teams: config.teams.map(({ names, ...t }) => t), draft: draftFile.teams, draftSource: { url: draftFile.source, revision: draftFile.revision, updatedAt: draftFile.updatedAt }, stages, players, history: updateHistory(history, newSnapshot), warnings: [] };
  validateSeason(next);
  if (!dryRun) {
    // Commit the canonical season and all snapshots as one atomic replacement.
    writeJSON(statePath, next);
    require('./scripts/build').build(root);
  }
  console.log(`${dryRun ? 'Validated' : 'Saved'} ${next.id}, ${next.history.length} history snapshots, as of ${resultDate}`);
  return next;
}

if (require.main === module) collect({ initialize: process.argv.includes('--init'), dryRun: process.argv.includes('--dry-run') }).catch(error => {
  console.error(`Update stopped; published data retained. ${error.message}`);
  process.exitCode = 1;
});

module.exports = { collect };
