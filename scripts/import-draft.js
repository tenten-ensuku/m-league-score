'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config/season');
const { fetchText } = require('../lib/sources');
const { validateDraft } = require('../lib/model');
const { writeJSON } = require('../lib/store');

async function main() {
  const file = path.join(__dirname, `../data/draft-${config.id}.json`);
  if (fs.existsSync(file)) throw new Error('Draft already locked. Review a roster change explicitly instead of reimporting.');
  const { state } = JSON.parse(await fetchText(new URL('api/draft/state', config.draftUrl)));
  if (!state || state.picks?.length !== 30 || !Number.isInteger(state.revision)) throw new Error('The shared draft is not complete');
  const teams = config.participants.map(t => ({ ...t, members: state.picks.flatMap((id, i) => {
    const player = config.players.find(p => p.id === id);
    if (!player) throw new Error(`Unknown draft ID: ${id}`);
    return config.draftOrder[i % 6] === t.id ? [player.name] : [];
  }) }));
  validateDraft(teams, config.players);
  writeJSON(file, { season: config.id, source: config.draftUrl, revision: state.revision, updatedAt: state.updatedAt, picks: state.picks, teams });
  console.log(JSON.stringify(teams, null, 2));
}

main().catch(e => { console.error(e.message); process.exitCode = 1; });
