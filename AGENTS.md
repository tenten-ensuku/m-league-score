# Project instructions

- `data.js`, `history.js`, and `app-data.js` are generated. Change the generator or season configuration, never edit those files manually.
- Canonical state is in `data/seasons/`. Invalid JSON, conflict markers, unknown players, missing previously observed results, and decreasing game counts must stop an update before publishing.
- Preserve every existing season, its draft roster, and its DATA LOG. Never seed a new season from last season's scores or CSV.
- Draft scores are the unweighted sum of regular, semifinal, and final individual points. Balance is `2 * own points - other team points`.
- Use `npm test` and `npm run build` before publishing. Verify responsive UI after layout changes.
- Default to a blank icon (`<link rel="icon" href="data:,">`). Do not add app, home-screen, or manifest icons without explicit user approval. Preserve any dedicated icon already present.
