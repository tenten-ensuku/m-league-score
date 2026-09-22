'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const bundle = window.MLEAGUE_APP;
  const labels = { total: '通算', regular: 'レギュラー', semi: 'セミファイナル', final: 'ファイナル' };
  const stageKeys = ['regular', 'semi', 'final'];
  const round = value => Math.round(value * 10) / 10;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const fmt = value => value == null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}`;
  const tone = value => value > 0 ? 'positive' : value < 0 ? 'negative' : 'zero';
  const shortDate = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const icons = () => window.lucide?.createIcons();
  const params = new URLSearchParams(location.search);
  const state = { season: params.get('season') || bundle?.activeSeason, stage: params.get('stage') || 'total', view: 'teams', owner: 'all', team: 'all', rosterOwner: 'ten', query: '', playedOnly: false, sort: 'score', direction: -1, metric: 'pt', range: 'all', logCount: 25 };
  let charts = [];
  let playerChart;
  let toastTimer;
  if (!bundle?.seasons?.length) {
    $('data-notice').hidden = false;
    $('data-notice').classList.add('warning');
    $('data-notice').textContent = '成績データを読み込めませんでした。時間を置いて再読み込みしてください。';
    icons();
    return;
  }
  if (!bundle.seasons.some(s => s.id === state.season)) state.season = bundle.activeSeason;
  if (!labels[state.stage]) state.stage = 'total';
  const season = () => bundle.seasons.find(s => s.id === state.season);
  const phaseStarted = () => state.stage === 'total' || season().legacy || season().stages[state.stage]?.status === 'started';
  const fullDate = date => date.replaceAll('-', '/');
  const teamMeta = id => season().teams.find(t => t.id === id);
  const ownerOf = name => season().draft.find(t => t.members.includes(name));
  const ownerStyle = t => `--team-color:${t.color};--team-tint:${t.color}0b`;
  const avgLabel = () => season().legacy && state.stage === 'total' ? '平均着順（R）' : '平均着順';

  function scopePlayers(key = state.stage, rows = season().players) {
    const mapped = rows.map(p => {
      const roster = season().roster.find(r => r.name === p.name);
      const games = key === 'total' ? p.games : p[`${key}_games`] ?? (key === 'regular' ? p.games : 0);
      const score = key === 'total' ? p.score : p[`${key}_score`] ?? (key === 'regular' ? p.score : 0);
      let avg = key === 'total' ? p.avg : p[`${key}_avg`];
      if (season().legacy) avg = ['total', 'regular'].includes(key) ? p.avg : null;
      return { ...p, teamId: roster?.teamId, score, games, avg: games && Number.isFinite(avg) ? avg : null };
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ja'));
    mapped.forEach((p, i) => { p.rank = i && p.score === mapped[i - 1].score ? mapped[i - 1].rank : i + 1; });
    return mapped;
  }

  function previousPlayers(key = state.stage) {
    return season().history.at(-2)?.players ? new Map(scopePlayers(key, season().history.at(-2).players).map(p => [p.name, p])) : new Map();
  }

  function playerDelta(player, prev = previousPlayers()) {
    if (!phaseStarted()) return null;
    const old = prev.get(player.name);
    if (old) return round(player.score - old.score);
    if (season().legacy && state.stage === 'total') return player.score_delta;
    return null;
  }

  function totals() {
    const players = scopePlayers();
    const previous = previousPlayers();
    const teams = season().draft.map(t => {
      const members = players.filter(p => t.members.includes(p.name));
      const score = round(members.reduce((sum, p) => sum + p.score, 0));
      const deltas = members.map(p => playerDelta(p, previous));
      const prevLog = season().history.at(-2);
      const delta = deltas.every(v => v != null) ? round(deltas.reduce((a, b) => a + b, 0)) : season().legacy && state.stage === 'total' && prevLog?.[`${t.id}_pt`] != null ? round(score - prevLog[`${t.id}_pt`]) : null;
      return { ...t, members, score, delta };
    }).sort((a, b) => b.score - a.score || season().draft.findIndex(t => t.id === a.id) - season().draft.findIndex(t => t.id === b.id));
    const sum = round(teams.reduce((s, t) => s + t.score, 0));
    teams.forEach((t, i) => { t.rank = i && t.score === teams[i - 1].score ? teams[i - 1].rank : i + 1; t.balance = round(3 * t.score - sum); t.gap = round(teams[0].score - t.score); });
    return teams;
  }

  function change(value) { return `<span class="numeric ${tone(value)}">${fmt(value)}</span>`; }
  function point(value) { return `<span class="numeric ${tone(value)}">${fmt(phaseStarted() ? value : null)}</span>`; }
  function selectedHistory() {
    if (season().legacy && state.stage !== 'total') return [];
    let rows = season().history.map(row => state.stage === 'total' ? row : { ...row, ...row.stages?.[state.stage] });
    if (state.range !== 'all') rows = rows.slice(-Number(state.range));
    return phaseStarted() ? rows : [];
  }

  function syncURL() {
    const query = new URLSearchParams();
    if (state.season !== bundle.activeSeason) query.set('season', state.season);
    if (state.stage !== 'total') query.set('stage', state.stage);
    history.replaceState(null, '', `${location.pathname}${query.size ? '?' + query : ''}#${state.view}`);
  }

  function render() {
    charts.forEach(chart => chart.destroy());
    charts = [];
    const s = season();
    state.view = ['teams', 'players', 'history'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'teams';
    document.querySelectorAll('[data-view]').forEach(a => a.setAttribute('aria-current', a.dataset.view === state.view ? 'page' : 'false'));
    document.querySelectorAll('[data-stage]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.stage === state.stage)));
    $('page-title').textContent = { teams: 'チーム成績', players: '選手一覧', history: '推移・履歴' }[state.view];
    $('season-label').textContent = `${s.id} SEASON / FANTASY DRAFT`;
    document.title = `Mリーグ ${s.id} ${$('page-title').textContent}`;
    const games = scopePlayers().reduce((sum, p) => sum + p.games, 0) / 4;
    const updateTime = s.updatedAt.includes('T') ? new Date(s.updatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : fullDate(s.updatedAt);
    $('freshness').innerHTML = `<strong><span class="status-dot"></span>${s.legacy ? `${s.id} 終了` : `${shortDate(s.resultDate)} ${s.dateKind === 'observed' ? '取得時点' : '終了時点'}`}</strong><small>データ更新 ${esc(updateTime)}${s.legacy ? '' : ' JST'}</small>`;
    $('scope-note').textContent = `${labels[state.stage]}${phaseStarted() ? ` · ${Number.isInteger(games) ? games : '—'}試合` : ' · 未開始'}${state.stage === 'total' ? ' · 持ち越し減算なし' : ''}`;
    const notice = $('data-notice');
    let message = '';
    if (!phaseStarted()) message = `${labels[state.stage]}は未開始です。`;
    else if (s.legacy && state.stage === 'total') message = '昨季の保存データです。平均着順はレギュラーシーズンの記録です。';
    else if (s.legacy && state.stage !== 'total') message = '昨季のステージ別ポイントは保存済みです。ステージ別の推移・平均着順は一部記録がありません。';
    notice.textContent = message;
    notice.hidden = !message;
    $('draft-link').hidden = s.legacy;
    $('page-content').innerHTML = state.view === 'teams' ? renderTeams() : state.view === 'players' ? renderPlayers() : renderHistory();
    if (state.view === 'teams') {
      const teams = totals();
      const selector = document.createElement('div');
      selector.className = 'segmented mobile-roster-tabs';
      selector.setAttribute('role', 'group');
      selector.setAttribute('aria-label', '指名選手のチーム');
      selector.innerHTML = teams.map(t => `<button type="button" data-roster="${t.id}" aria-pressed="${state.rosterOwner === t.id}" style="${ownerStyle(t)}"><span class="team-dot"></span>${esc(t.name)}</button>`).join('');
      document.querySelector('.rosters').before(selector);
      document.querySelectorAll('.roster').forEach((roster, i) => { roster.dataset.selected = String(teams[i].id === state.rosterOwner); });
      drawChart('overview-chart', selectedHistory(), 'pt');
    }
    if (state.view === 'history') drawChart('history-chart', selectedHistory(), state.metric);
    if (state.view === 'players') populatePlayers();
    icons();
    fitScores();
    syncURL();
  }

  function fitScores() {
    document.querySelectorAll('.big-score').forEach(element => {
      element.style.fontSize = '';
      let size = parseFloat(getComputedStyle(element).fontSize);
      while (element.scrollWidth > element.clientWidth && size > 12) element.style.fontSize = `${--size}px`;
    });
  }

  function renderTeams() {
    const teams = totals();
    return `<section class="scoreboard" aria-label="ドラフトチーム順位">${teams.map(t => `<article class="score-card ${t.rank === 1 ? 'leader' : ''}" style="${ownerStyle(t)}" data-owner="${t.id}"><div class="score-card-top"><span class="team-dot"></span><h2>${esc(t.name)}</h2><span class="rank-tag">${phaseStarted() ? t.rank + '位' : '未開始'}</span>${t.rank === 1 && phaseStarted() ? `<span class="leader-text">${icon('flag')}LEADER</span>` : ''}</div><div class="big-score numeric" data-testid="team-total">${fmt(phaseStarted() ? t.score : null)}<small>pt</small></div><div class="score-change"><span><span class="change-label">前回比</span>${change(t.delta)}</span><span class="gap-line">${phaseStarted() ? t.gap ? `首位まで ${t.gap.toFixed(1)}` : teams.filter(x => x.rank === 1).length > 1 ? '同率首位' : `2位と ${round(t.score - teams[1].score).toFixed(1)}差` : '—'}</span></div><div class="score-card-bottom"><span>収支</span>${point(t.balance)}</div></article>`).join('')}</section>
    <section aria-labelledby="roster-title"><div class="section-heading"><h2 id="roster-title">指名選手<small>各チーム10名</small></h2><a class="section-link" href="#players">全選手を見る${icon('arrow-right')}</a></div><div class="rosters">${teams.map(t => `<div class="roster" style="${ownerStyle(t)}"><div class="roster-header"><span class="team-dot"></span><h3>チーム${esc(t.name)}</h3><small>${t.members.filter(p => p.games).length} / 10名 出場済み</small></div>${t.members.map((p, i) => `<button class="roster-row" data-player="${esc(p.name)}" type="button" aria-label="${esc(p.name)} ${fmt(p.score)}ポイント 詳細"><span class="roster-number">${String(i + 1).padStart(2, '0')}</span><span><span class="player-name">${esc(p.name)}</span><span class="player-team">${esc(teamMeta(p.teamId)?.short)}</span></span><span class="roster-score">${point(p.score)}<small class="${tone(playerDelta(p))}">${p.games ? playerDelta(p) ? fmt(playerDelta(p)) : `${p.games}試合` : '未出場'}</small></span></button>`).join('')}<div class="roster-sum"><span>${labels[state.stage]}合計</span>${point(t.score)}</div></div>`).join('')}</div></section>
    <section class="inline-chart-section"><div class="section-heading"><h2>チームポイントの推移</h2><a class="section-link" href="#history">推移・履歴へ${icon('arrow-right')}</a></div><div class="legend">${legend()}</div><div class="chart-area compact"><canvas id="overview-chart" role="img" aria-label="3チームのポイント推移"></canvas></div></section>`;
  }

  function legend() { return season().draft.map(t => `<span style="${ownerStyle(t)}"><i class="legend-line"></i>${esc(t.name)}</span>`).join(''); }

  function sortHeading(key, label, css = '') {
    return `<th class="${css}" scope="col" ${key === state.sort ? `aria-sort="${state.direction === 1 ? 'ascending' : 'descending'}"` : ''}><button type="button" class="table-sort ${key === state.sort ? 'active' : ''}" data-sort="${key}">${label}${icon(key === state.sort ? state.direction === 1 ? 'arrow-up' : 'arrow-down' : 'chevrons-up-down')}</button></th>`;
  }

  function renderPlayers() {
    return `<section aria-label="選手ランキング"><div class="filter-toolbar"><label class="search">${icon('search')}<input id="player-search" type="search" placeholder="選手名を検索" aria-label="選手名を検索" value="${esc(state.query)}"></label><label class="select-wrap"><span class="sr-only">所属チーム</span><select id="team-filter" aria-label="所属チーム"><option value="all">すべての所属チーム</option>${season().teams.map(t => `<option value="${esc(t.id)}" ${t.id === state.team ? 'selected' : ''}>${esc(t.short)}</option>`).join('')}</select>${icon('chevron-down')}</label><div class="segmented" role="group" aria-label="ドラフトチームで絞り込み">${[{ id: 'all', name: '全員' }, ...season().draft, { id: 'none', name: '未指名' }].map(t => `<button type="button" data-filter-owner="${t.id}" aria-pressed="${state.owner === t.id}">${esc(t.name)}</button>`).join('')}</div><label class="checkbox"><input type="checkbox" id="played-only" ${state.playedOnly ? 'checked' : ''}>出場済みのみ</label></div><div class="results-meta"><span id="results-count"></span><button class="text-button" type="button" data-export="players">${icon('download')}CSV</button></div><div class="table-scroll"><table class="ranking-table"><thead><tr><th class="rank-cell">順位</th><th class="player-cell" scope="col">選手 / 所属</th><th class="left" scope="col">指名</th>${sortHeading('score', labels[state.stage] + 'PT')}${stageKeys.map(k => `<th scope="col" class="stage-col">${k === 'regular' ? 'レギュラー' : k === 'semi' ? 'セミ' : 'ファイナル'}</th>`).join('')}${sortHeading('delta', '前回比')}${sortHeading('games', '試合数')}${sortHeading('avg', avgLabel())}</tr></thead><tbody id="ranking-body"></tbody></table></div><p class="source-meta" id="filter-message" hidden></p></section>`;
  }

  function filteredPlayers() {
    const normalize = name => name.normalize('NFKC').replace(/\s/g, '').toLowerCase();
    const previous = previousPlayers();
    return scopePlayers().map(p => ({ ...p, delta: playerDelta(p, previous) })).filter(p => {
      const owner = ownerOf(p.name);
      return (!state.query || normalize(p.name).includes(normalize(state.query))) && (state.team === 'all' || p.teamId === state.team) && (state.owner === 'all' || state.owner === 'none' && !owner || owner?.id === state.owner) && (!state.playedOnly || p.games > 0);
    }).sort((a, b) => {
      const av = a[state.sort], bv = b[state.sort];
      if (av == null) return bv == null ? a.rank - b.rank : 1;
      if (bv == null) return -1;
      return state.direction * (av - bv) || a.rank - b.rank;
    });
  }

  function populatePlayers() {
    const rows = filteredPlayers();
    const prev = previousPlayers();
    $('results-count').innerHTML = `<strong>${rows.length}</strong> / ${season().roster.length}名 <span class="footer-dot">·</span> 表示選手の合計 <strong class="numeric">${fmt(phaseStarted() ? round(rows.reduce((s, p) => s + p.score, 0)) : null)}</strong> pt`;
    $('ranking-body').innerHTML = rows.map(p => {
      const owner = ownerOf(p.name);
      const rankDelta = prev.get(p.name)?.games ? prev.get(p.name).rank - p.rank : null;
      return `<tr><td class="rank-cell"><span>${phaseStarted() && p.games ? p.rank : '—'}</span><span class="rank-change ${tone(rankDelta)}">${rankDelta ? `${rankDelta > 0 ? '↑' : '↓'}${Math.abs(rankDelta)}` : ''}</span></td><td class="player-cell"><button data-player="${esc(p.name)}" type="button"><span class="player-name">${esc(p.name)}</span><span class="player-team">${esc(teamMeta(p.teamId)?.name)}</span></button></td><td class="left">${owner ? `<span class="owner-name" style="${ownerStyle(owner)}"><span class="team-dot"></span>${esc(owner.name)}</span>` : '<span class="dim">—</span>'}</td><td class="total-cell">${point(p.score)}</td>${stageKeys.map(k => `<td class="stage-col ${state.stage === k ? 'phase-head' : ''}">${season().legacy || season().stages[k]?.status === 'started' ? fmt(p[`${k}_score`] ?? 0) : '—'}</td>`).join('')}<td>${change(p.delta)}</td><td>${p.games || '—'}</td><td>${p.avg?.toFixed(2) ?? '—'}</td></tr>`;
    }).join('') || '<tr><td colspan="10" class="empty">該当する選手はいません</td></tr>';
    document.querySelectorAll('#ranking-body tr').forEach((row, i) => {
      const cell = row.querySelector('.player-team');
      const owner = rows[i] && ownerOf(rows[i].name);
      if (cell && owner) {
        const label = document.createElement('span');
        label.className = 'mobile-player-owner';
        label.textContent = ` · ${owner.name}`;
        label.style.color = owner.color;
        cell.append(label);
      }
    });
    icons();
  }

  function renderHistory() {
    const rows = selectedHistory();
    const shown = rows.filter(r => !r.baseline).slice().reverse();
    return `<section><div class="history-toolbar"><div class="segmented" role="group" aria-label="推移グラフの種類"><button data-metric="pt" aria-pressed="${state.metric === 'pt'}">合計ポイント</button><button data-metric="bk" aria-pressed="${state.metric === 'bk'}">収支</button></div><label class="select-wrap"><span class="sr-only">表示期間</span><select id="history-range" aria-label="表示期間">${[['all', '全期間'], ['30', '直近30更新'], ['10', '直近10更新']].map(([v, label]) => `<option value="${v}" ${v === state.range ? 'selected' : ''}>${label}</option>`).join('')}</select>${icon('chevron-down')}</label></div><div class="history-chart"><div class="history-summary">${totals().map(t => `<span style="${ownerStyle(t)}"><i class="team-dot"></i>${esc(t.name)}<strong class="numeric">${fmt(rows.length ? state.metric === 'pt' ? t.score : t.balance : null)}</strong></span>`).join('')}</div><div class="chart-area"><canvas id="history-chart" role="img" aria-label="${labels[state.stage]}の${state.metric === 'pt' ? 'ポイント' : '収支'}推移"></canvas></div></div><div class="section-heading"><h2>DATA LOG <small>${shown.length}件</small></h2><button class="text-button" data-export="history" type="button">${icon('download')}CSV</button></div>${shown.length ? `<div class="table-scroll"><table class="log-table"><caption>${season().legacy ? '昨季の保存済みログ。日付は旧アプリの集計日です。' : '掲載日のあるデータは試合終了日、掲載日のないデータは取得日を表示。'}</caption><thead><tr><th rowspan="2" class="date-cell" scope="col">日付</th>${season().draft.map(t => `<th class="group-head" scope="colgroup" colspan="2" style="color:${t.color}">${esc(t.name)}</th>`).join('')}</tr><tr>${season().draft.map(() => '<th class="group-start" scope="col">合計PT</th><th scope="col">収支</th>').join('')}</tr></thead><tbody>${shown.slice(0, state.logCount).map(row => `<tr><td class="date-cell">${fullDate(row.date)}${row.dateKind === 'observed' ? '<span class="dim"> 取得</span>' : ''}</td>${season().draft.map(t => `<td class="group-start ${tone(row[`${t.id}_pt`])}">${fmt(row[`${t.id}_pt`])}</td><td class="${tone(row[`${t.id}_bk`])}">${fmt(row[`${t.id}_bk`])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${shown.length > state.logCount ? `<button class="show-more" data-more type="button">すべての履歴を表示（${shown.length}件）</button>` : ''}` : `<div class="empty"><strong>${phaseStarted() ? 'この集計範囲の履歴はありません' : labels[state.stage] + 'は未開始です'}</strong>${season().legacy ? '昨季の通算履歴は保存されています。' : '成績が確定すると記録されます。'}</div>`}</section>`;
  }

  function drawChart(id, rows, metric) {
    const canvas = $(id);
    if (!canvas) return;
    if (!window.Chart) { canvas.parentElement.innerHTML = '<div class="empty">グラフを読み込めませんでした。履歴表で成績を確認できます。</div>'; return; }
    const dark = '#69766f';
    const chart = new Chart(canvas, { type: 'line', data: { labels: rows.map(r => r.baseline ? '開幕前' : shortDate(r.date)), datasets: season().draft.map(t => ({ label: t.name, data: rows.map(r => r[`${t.id}_${metric}`]), borderColor: t.color, backgroundColor: t.color, tension: 0, borderWidth: 2, pointRadius: rows.length < 12 ? 3 : 0, pointHoverRadius: 5, spanGaps: false })) }, options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#253d30', padding: 12, callbacks: { label: ctx => `${ctx.dataset.label}  ${fmt(ctx.parsed.y)} pt` } } }, layout: { padding: { top: 22, right: 12, left: 0, bottom: 0 } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: innerWidth < 600 ? 5 : 12, maxRotation: 0, color: dark, font: { size: 10 } } }, y: { beginAtZero: true, border: { display: false }, grid: { color: ctx => ctx.tick.value === 0 ? '#b7c6bb' : '#edf0ed' }, ticks: { color: dark, maxTicksLimit: 5, font: { size: 10 }, callback: v => Number(v).toLocaleString('ja-JP') } } } } });
    charts.push(chart);
  }

  function openPlayer(name) {
    const p = scopePlayers().find(p => p.name === name);
    if (!p) return;
    const original = season().players.find(row => row.name === name);
    const owner = ownerOf(name);
    $('player-content').innerHTML = `<div class="dialog-heading"><div><small>${esc(teamMeta(p.teamId)?.name)}${owner ? ` · チーム${esc(owner.name)}` : ' · 未指名'}</small><h2 id="player-title">${esc(p.name)}</h2></div><button class="icon-button" data-close="player-dialog" aria-label="閉じる" data-tooltip="閉じる">${icon('x')}</button></div><div class="dialog-score"><strong class="numeric ${tone(p.score)}">${fmt(phaseStarted() ? p.score : null)}</strong><span>${labels[state.stage]} pt</span><div class="dialog-stats">${p.games}試合<br>${avgLabel()} ${p.avg?.toFixed(2) ?? '—'}</div></div><table class="phase-table"><thead><tr><th class="left">ステージ</th><th>ポイント</th><th>試合数</th><th>平均着順</th></tr></thead><tbody>${stageKeys.map(k => { const started = season().legacy || season().stages[k]?.status === 'started'; const avg = season().legacy ? k === 'regular' ? original.avg : null : original[`${k}_avg`]; return `<tr><td>${labels[k]}</td><td class="numeric ${tone(original[`${k}_score`])}">${fmt(started ? original[`${k}_score`] : null)}</td><td>${original[`${k}_games`] || '—'}</td><td>${avg?.toFixed(2) ?? '—'}</td></tr>`; }).join('')}</tbody></table><h3 class="dialog-subheading">${labels[state.stage]}ポイントの推移</h3>${season().history.some(r => r.players) ? '<div class="dialog-chart"><canvas id="player-chart" role="img" aria-label="選手ポイントの推移"></canvas></div>' : '<p class="source-meta">昨季の個人別推移は記録されていません。</p>'}`;
    icons();
    $('player-dialog').showModal();
    playerChart?.destroy();
    const canvas = $('player-chart');
    if (canvas && window.Chart) {
      const rows = season().history.filter(r => r.players);
      const key = state.stage === 'total' ? 'score' : `${state.stage}_score`;
      playerChart = new Chart(canvas, { type: 'line', data: { labels: rows.map(r => r.baseline ? '開幕前' : shortDate(r.date)), datasets: [{ data: rows.map(r => r.players.find(p => p.name === name)?.[key] ?? null), borderColor: owner?.color || '#16734b', backgroundColor: owner?.color || '#16734b', borderWidth: 2, pointRadius: rows.length < 15 ? 3 : 0, tension: 0 }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${fmt(c.parsed.y)} pt` } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, font: { size: 10 } } }, y: { beginAtZero: true, ticks: { maxTicksLimit: 4, font: { size: 10 } }, grid: { color: '#edf0ed' } } } } });
    }
  }

  function openSources() {
    const s = season();
    $('source-content').innerHTML = `<div class="formula"><p><b>チームPT</b> = 指名10選手の個人ポイント合計</p><p><b>通算</b> = レギュラー + セミファイナル + ファイナル</p><p><b>収支</b> = 2 × 自チームPT − 他2チームのPT合計</p></div><div class="source-list">${stageKeys.map(k => `<div><b>${labels[k]}</b>${s.legacy ? '<small>昨季の保存データ</small>' : s.stages[k] ? s.stages[k].sources.map(src => `<a href="${esc(src.url)}" target="_blank" rel="noopener noreferrer">${esc(src.name)}${icon('arrow-up-right')}</a>`).join('') : '<small>未開始</small>'}</div>`).join('')}</div><p class="source-meta">前回比は、直前の記録日からの増減です。同日中の追加更新は同じ記録日に反映します。試合がない日の重複記録はありません。</p><p class="source-meta">平均着順は全ステージの着順回数から計算しています。昨季は保存されているレギュラー平均着順を表示します。</p>${s.draftSource ? `<p class="source-meta">ドラフト確定 ${esc(new Date(s.draftSource.updatedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' }))} · 30名</p>` : '<p class="source-meta"><a href="archive/2025-26/index.html">昨季の旧アプリを開く</a></p>'}<p class="source-meta">自動取得予定: 火・水・金・土 2:07、2:37、3:07、3:37、6:07 JST。起動や取得元の掲載状況により遅れる場合があります。</p><p class="source-meta"><a href="https://github.com/tenten-ensuku/m-league-score/actions/workflows/update.yml" target="_blank" rel="noopener noreferrer">自動更新の実行状況${icon('arrow-up-right')}</a></p>`;
    icons();
    $('source-content').insertAdjacentHTML('beforeend', (s.warnings || []).map(warning => `<p class="source-meta">${esc(warning)}</p>`).join(''));
    $('source-dialog').showModal();
  }

  function download(kind) {
    let rows;
    if (kind === 'players') rows = [['順位', '選手', '所属', '指名', `${labels[state.stage]}PT`, 'レギュラーPT', 'セミPT', 'ファイナルPT', '前回比', '試合数', avgLabel()], ...filteredPlayers().map(p => [p.games ? p.rank : '', p.name, teamMeta(p.teamId)?.name || '', ownerOf(p.name)?.name || '', phaseStarted() ? p.score : '', p.regular_score, p.semi_score, p.final_score, p.delta, p.games, p.avg])];
    else rows = [['日付', ...season().draft.flatMap(t => [t.name + ' PT', t.name + ' 収支'])], ...selectedHistory().filter(r => !r.baseline).map(r => [r.date, ...season().draft.flatMap(t => [r[`${t.id}_pt`], r[`${t.id}_bk`]])])];
    const blob = new Blob(['\ufeff' + rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `m-league-${state.season}-${state.stage}-${kind}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('toast').textContent = 'CSVを書き出しました'; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3000);
  }

  $('season').innerHTML = bundle.seasons.map(s => `<option value="${s.id}" ${state.season === s.id ? 'selected' : ''}>${s.id}${s.legacy ? ' 昨季' : ''}</option>`).join('');
  $('season').addEventListener('change', e => { state.season = e.target.value; state.owner = 'all'; state.team = 'all'; state.query = ''; state.logCount = 25; render(); });
  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.stage) { state.stage = target.dataset.stage; render(); }
    if (target.dataset.roster) { state.rosterOwner = target.dataset.roster; render(); }
    if (target.dataset.player) openPlayer(target.dataset.player);
    if (target.dataset.close) $(target.dataset.close).close();
    if (target.dataset.filterOwner) { state.owner = target.dataset.filterOwner; document.querySelectorAll('[data-filter-owner]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filterOwner === state.owner))); populatePlayers(); }
    if (target.dataset.sort) { if (state.sort === target.dataset.sort) state.direction *= -1; else { state.sort = target.dataset.sort; state.direction = state.sort === 'avg' ? 1 : -1; } render(); }
    if (target.dataset.metric) { state.metric = target.dataset.metric; render(); }
    if (target.hasAttribute('data-more')) { state.logCount = Infinity; render(); }
    if (target.dataset.export) download(target.dataset.export);
  });
  document.addEventListener('input', e => { if (e.target.id === 'player-search') { state.query = e.target.value; populatePlayers(); } });
  document.addEventListener('change', e => {
    if (e.target.id === 'team-filter') { state.team = e.target.value; populatePlayers(); }
    if (e.target.id === 'played-only') { state.playedOnly = e.target.checked; populatePlayers(); }
    if (e.target.id === 'history-range') { state.range = e.target.value; render(); }
  });
  $('source-button').addEventListener('click', openSources);
  $('player-dialog').addEventListener('close', () => { playerChart?.destroy(); playerChart = null; });
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog && (e.clientX < dialog.getBoundingClientRect().left || e.clientX > dialog.getBoundingClientRect().right || e.clientY < dialog.getBoundingClientRect().top || e.clientY > dialog.getBoundingClientRect().bottom)) dialog.close(); }));
  window.addEventListener('hashchange', render);
  window.addEventListener('resize', fitScores);
  render();
})();
