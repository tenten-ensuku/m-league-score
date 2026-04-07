/**
 * Mリーグ成績 自動スクレイパー
 * 実行: node scrape.js
 * 必要: Node.js 14以上（追加パッケージ不要）
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ─── ドラフトチーム構成 ──────────────────────────────────────────
const FANTASY_TEAMS = {
  ten: ['下石戟','竹内元太','渋川難波','石井一馬','伊達朱里紗','醍醐大','鈴木優','仲林圭','岡田紗佳','松本吉弘'],
  aji: ['滝沢和典','二階堂亜樹','多井隆晴','佐々木寿人','逢川恵夢','浅井堂岐','鈴木大介','勝又健志','小林剛','堀慎吾'],
  sat: ['永井孝典','白鳥翔','渡辺太','園田賢','東城りお','浅見真紀','瑞原明奈','鈴木たろう','三浦智博','HIRO柴田'],
};

// ─── HTTP取得（リダイレクト対応）───────────────────────────────
function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) { reject(new Error('リダイレクトが多すぎます')); return; }

    const mod = url.startsWith('https://') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent'      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
        'Accept'          : 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language' : 'ja,en-US;q=0.9',
        'Accept-Encoding' : 'identity',
        'Connection'      : 'close',
      }
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        resolve(fetchUrl(next, redirectCount + 1));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── 選手名の正規化（小文字ASCII誤植を除去。HIRO柴田の大文字は保持）────
function normalizeName(name) {
  return name.replace(/^[a-z]+/, '');
}

// ─── HTMLテーブルをパース ────────────────────────────────────────
function parseRankingTable(html) {
  const tableRe = /<table[^>]*>[\s\S]*?<\/table>/gi;
  const tables  = [];
  let m;
  while ((m = tableRe.exec(html)) !== null) tables.push(m[0]);

  let target = '';
  for (const t of tables) {
    const hasCol   = t.includes('選手名') || t.includes('雀士');
    const rowCount = (t.match(/<tr/gi) || []).length;
    if (hasCol && rowCount > 30) { target = t; break; }
  }
  if (!target && tables.length > 1) target = tables[1];
  if (!target) return [];

  const players = [];
  const trRe    = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;

  while ((tr = trRe.exec(target)) !== null) {
    const cells  = [];
    const cellRe = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
    let cell;
    while ((cell = cellRe.exec(tr[1])) !== null) {
      const text = cell[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
      cells.push(text);
    }
    if (cells.length < 4) continue;

    const rank = parseInt(cells[0]);
    if (isNaN(rank) || rank < 1 || rank > 60) continue;

    const name = normalizeName(cells[1].split(/[\s　\n\r]+/)[0].trim());
    if (!name) continue;

    const raw   = cells[2].replace(/,/g, '').replace(/\+/g, '').trim();
    const score = parseFloat(raw.startsWith('▲') ? '-' + raw.slice(1) : raw);
    if (isNaN(score)) continue;

    const games = parseInt(cells[3]);
    const avg   = parseFloat(cells[4] || '0');
    if (isNaN(games)) continue;

    players.push({ rank, name, score, games, avg });
  }

  return players;
}

// ─── CSV パーサー ────────────────────────────────────────────────
function parseCSVLine(line) {
  const cells = [];
  let cur = '', inQ = false;
  for (const c of line) {
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
    else { cur += c; }
  }
  cells.push(cur.trim());
  return cells;
}

function parseNum(s) {
  const v = parseFloat((s || '').replace(/,/g, '').trim());
  return isNaN(v) ? null : v;
}

// ─── 前回スコア読み込み ──────────────────────────────────────────
function loadPrevScores() {
  const dataPath = path.join(__dirname, 'data.js');
  if (!fs.existsSync(dataPath)) return {};
  const content = fs.readFileSync(dataPath, 'utf-8');
  const match = content.match(/window\.MLEAGUE_PLAYERS\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return {};
  try {
    const players = JSON.parse(match[1]);
    const map = {};
    players.forEach(p => { map[normalizeName(p.name)] = { score: p.score, rank: p.rank }; });
    return map;
  } catch { return {}; }
}

// ─── 既存 history.js 読み込み ────────────────────────────────────
function loadHistory() {
  const histPath = path.join(__dirname, 'history.js');
  if (!fs.existsSync(histPath)) return [];
  const content = fs.readFileSync(histPath, 'utf-8');
  const match = content.match(/window\.MLEAGUE_HISTORY\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return [];
  try { return JSON.parse(match[1]); } catch { return []; }
}

// ─── 履歴更新（CSV + 自動蓄積）──────────────────────────────────
function updateHistory(players, dateShort, dateStr) {
  const round1   = v => Math.round(v * 10) / 10;
  const scoreMap = {};
  players.forEach(p => { scoreMap[p.name] = p.score; });

  // 今日のチーム合計を計算
  const ten_pt = round1(FANTASY_TEAMS.ten.reduce((s, n) => s + (scoreMap[n] ?? 0), 0));
  const aji_pt = round1(FANTASY_TEAMS.aji.reduce((s, n) => s + (scoreMap[n] ?? 0), 0));
  const sat_pt = round1(FANTASY_TEAMS.sat.reduce((s, n) => s + (scoreMap[n] ?? 0), 0));
  const todayEntry = {
    date: dateShort, ten_pt, aji_pt, sat_pt,
    ten_bk: round1(2*ten_pt - aji_pt - sat_pt),
    aji_bk: round1(2*aji_pt - ten_pt - sat_pt),
    sat_bk: round1(2*sat_pt - ten_pt - aji_pt),
  };

  process.stdout.write('履歴データ更新中... ');

  // CSV から基礎データを読み込む
  let history = [];
  const csvPath = path.join(__dirname, 'Mリーグ  - 履歴2.csv');
  if (fs.existsSync(csvPath)) {
    const lines = fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/);
    for (let i = 2; i < lines.length; i++) {
      const row  = parseCSVLine(lines[i]);
      const date = (row[0] || '').trim();
      if (!date) continue;
      const tenPT = parseNum(row[1]), ajiPT = parseNum(row[3]), satPT = parseNum(row[5]);
      if (tenPT === null && ajiPT === null && satPT === null) continue;
      const csvTenBK = parseNum(row[2]), csvAjiBK = parseNum(row[4]), csvSatBK = parseNum(row[6]);
      const allPT = tenPT !== null && ajiPT !== null && satPT !== null;
      const tenBK = csvTenBK !== null ? csvTenBK : (allPT ? round1(2*tenPT - ajiPT - satPT) : null);
      const ajiBK = csvAjiBK !== null ? csvAjiBK : (allPT ? round1(2*ajiPT - tenPT - satPT) : null);
      const satBK = csvSatBK !== null ? csvSatBK : (allPT ? round1(2*satPT - tenPT - ajiPT) : null);
      const ds = date.replace(/^\d{4}\//, '').replace(/^0(\d)\//, '$1/').replace(/\/0(\d)$/, '/$1');
      history.push({ date: ds, ten_pt: tenPT, aji_pt: ajiPT, sat_pt: satPT,
                     ten_bk: tenBK, aji_bk: ajiBK, sat_bk: satBK });
    }
  }

  // history.js にある CSV 以降の自動エントリを引き継ぐ
  const csvDates = new Set(history.map(e => e.date));
  loadHistory().forEach(e => { if (!csvDates.has(e.date)) history.push(e); });

  // 今日のエントリを追加 / 更新
  const idx = history.findIndex(e => e.date === dateShort);
  if (idx >= 0) history[idx] = todayEntry;
  else history.push(todayEntry);

  console.log(`${history.length}件`);

  const out =
`// Mリーグ ドラフトチーム 履歴データ（自動生成 - scrape.js が更新します）
// 収支 = 2×自PT − 他2チームPT の合計
// 更新日時: ${dateStr}
window.MLEAGUE_HISTORY = ${JSON.stringify(history, null, 2)};
window.MLEAGUE_HISTORY_UPDATED = "${dateStr}";
`;
  fs.writeFileSync(path.join(__dirname, 'history.js'), out, 'utf-8');
  console.log('💾 history.js を書き出しました');
}

// ─── Chart.js ローカル保存（オフライン対応）─────────────────────
async function downloadChartJs() {
  const dest = path.join(__dirname, 'chart.min.js');
  if (fs.existsSync(dest)) return;

  process.stdout.write('Chart.js をダウンロード中... ');
  try {
    const content = await fetchUrl(
      'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js'
    );
    fs.writeFileSync(dest, content, 'utf-8');
    console.log('完了（chart.min.js を保存しました）');
  } catch (err) {
    console.log('スキップ（CDN を使用）');
  }
}

// ─── メイン ──────────────────────────────────────────────────────
async function main() {
  const REGULAR_URL = 'https://kinmaweb.jp/mleague-ranking/2025-regular';
  const SEMI_URL    = 'https://kinmaweb.jp/mleague-ranking/2025-semifinal';
  const round1      = v => Math.round(v * 10) / 10;

  console.log('====================================');
  console.log('  Mリーグ成績表 自動更新ツール');
  console.log('====================================');
  console.log(`取得先: ${REGULAR_URL}`);
  console.log(`      + ${SEMI_URL}\n`);

  // 前回スコアを先に読んでおく
  const prevScores = loadPrevScores();
  const hasPrev = Object.keys(prevScores).length > 0;

  // レギュラー・セミファイナルを並行取得
  let regularHtml, semiHtml;
  try {
    process.stdout.write('データ取得中（レギュラー＋セミファイナル並行）... ');
    [regularHtml, semiHtml] = await Promise.all([
      fetchUrl(REGULAR_URL),
      fetchUrl(SEMI_URL),
    ]);
    console.log('完了');
  } catch (err) {
    console.error('\n❌ 取得失敗:', err.message);
    console.error('   インターネット接続を確認してください。');
    process.exit(1);
  }

  // パース
  process.stdout.write('データ解析中... ');
  const regularPlayers = parseRankingTable(regularHtml);
  const semiPlayers    = parseRankingTable(semiHtml);
  console.log(`レギュラー ${regularPlayers.length}名 / セミファイナル ${semiPlayers.length}名を取得`);

  if (regularPlayers.length < 10) {
    console.error('\n❌ レギュラーデータが少なすぎます（サイト構造が変わった可能性があります）');
    process.exit(1);
  }

  // セミファイナルをname→playerのMapに変換
  const semiMap = {};
  semiPlayers.forEach(p => { semiMap[p.name] = p; });

  // マージ：レギュラーをベースにセミを合算
  const players = regularPlayers.map(p => {
    const s = semiMap[p.name] || { score: 0, games: 0 };
    return {
      ...p,
      regular_score: p.score,
      semi_score:    s.score,
      score:         round1(p.score + s.score),
      regular_games: p.games,
      semi_games:    s.games,
      games:         p.games + s.games,
    };
  });

  // 合計スコアで再ソート＆rank再付番
  players.sort((a, b) => b.score - a.score);
  players.forEach((p, i) => { p.rank = i + 1; });

  // 前回比を付加
  players.forEach(p => {
    const prev = prevScores[p.name];
    p.score_delta = (prev != null) ? Math.round((p.score - prev.score) * 10) / 10 : null;
    p.rank_delta  = (prev != null) ? prev.rank - p.rank : null;
  });

  // 上位5名を表示
  console.log('\n【上位5名】');
  players.slice(0, 5).forEach(p => {
    const sc    = p.score >= 0 ? `+${p.score.toFixed(1)}` : `▲${Math.abs(p.score).toFixed(1)}`;
    const delta = p.score_delta != null
      ? ` (前回比: ${p.score_delta >= 0 ? '+' : '▲'}${Math.abs(p.score_delta).toFixed(1)})` : '';
    console.log(`  ${String(p.rank).padStart(2)}位 ${p.name} : ${sc}PT${delta}`);
  });
  console.log('  ...\n');

  // 更新日
  const now       = new Date();
  const date      = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
  const dateShort = `${now.getMonth()+1}/${now.getDate()}`;

  // data.js 書き出し
  const content =
`// Mリーグ成績データ（自動生成 - scrape.js が更新します）
// 更新日時: ${date}
window.MLEAGUE_PLAYERS = ${JSON.stringify(players, null, 2)};
window.MLEAGUE_UPDATED = "${date}";
`;
  fs.writeFileSync(path.join(__dirname, 'data.js'), content, 'utf-8');
  console.log(`💾 data.js を書き出しました${hasPrev ? '（前回比データ付き）' : '（初回取得）'}`);

  // 履歴更新
  console.log('');
  updateHistory(players, dateShort, date);

  // Chart.js をローカルに保存（初回のみ）
  await downloadChartJs();

  console.log(`\n📅 更新日: ${date}`);
  console.log('\n✨ 完了！index.html をブラウザで開いてください。');
}

main().catch(err => {
  console.error('予期しないエラー:', err);
  process.exit(1);
});
