'use strict';

const teams = [
  ['jets', 'EARTH JETS', 'JETS', '#2498b8', ['石井一馬', '三浦智博', '逢川恵夢', 'HIRO柴田']],
  ['drivens', '赤坂ドリブンズ', 'ドリブンズ', '#bc592b', ['園田賢', '鈴木たろう', '浅見真紀', '渡辺太']],
  ['furinkazan', 'EX風林火山', '風林火山', '#bd3347', ['二階堂亜樹', '勝又健志', '永井孝典', '内川幸太郎']],
  ['sakura', 'KADOKAWAサクラナイツ', 'サクラナイツ', '#bd528a', ['岡田紗佳', '堀慎吾', '阿久津翔太', '尻無濱航']],
  ['konami', 'KONAMI麻雀格闘倶楽部', '麻雀格闘倶楽部', '#c83040', ['佐々木寿人', '高宮まり', '伊達朱里紗', '滝沢和典']],
  ['abemas', '渋谷ABEMAS', 'ABEMAS', '#917217', ['多井隆晴', '白鳥翔', '松本吉弘', '日向藍子']],
  ['phoenix', 'セガサミーフェニックス', 'フェニックス', '#c36321', ['茅森早香', '醍醐大', '竹内元太', '佐野ひなこ']],
  ['raiden', 'TEAM RAIDEN / 雷電', '雷電', '#897811', ['萩原聖人', '瀬戸熊直樹', '黒沢咲', '本田朋広']],
  ['beast', 'BEAST X', 'BEAST X', '#7a56a0', ['鈴木大介', '中田花奈', '下石戟', '東城りお']],
  ['pirates', 'U-NEXT Pirates', 'Pirates', '#128e91', ['瑞原明奈', '鈴木優', '仲林圭', '朝倉康心']],
].map(([id, name, short, color, names]) => ({ id, name, short, color, names }));

module.exports = {
  id: '2026-27', startYear: 2026, startsOn: '2026-09-14',
  draftUrl: 'https://m-league-draft-ten-aji-satoshi.naga-study.workers.dev/',
  teams,
  players: teams.flatMap(t => t.names.map((name, i) => ({ id: `${t.id}-${i + 1}`, name, teamId: t.id }))),
  participants: [
    { id: 'ten', name: 'てん', color: '#a96416' },
    { id: 'aji', name: 'あじ', color: '#16734b' },
    { id: 'sat', name: 'さとし', color: '#2969bd' },
  ],
  draftOrder: ['aji', 'sat', 'ten', 'ten', 'sat', 'aji'],
  stages: {
    regular: { label: 'レギュラー', tabId: 'tab_1', officialId: 'L001_S025', minimumPlayers: 40, kinmaUrl: 'https://kinmaweb.jp/archives/279394' },
    semi: { label: 'セミファイナル', tabId: 'tab_2', officialId: 'L001_S026', minimumPlayers: 24, kinmaUrl: null },
    final: { label: 'ファイナル', tabId: 'tab_3', officialId: 'L001_S027', minimumPlayers: 16, kinmaUrl: null },
  },
};
