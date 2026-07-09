// お題(単語)ソース。タイピングゲーム(gameplay.js)から言語別にランダム抽出して使う。
// SKK辞書はゲーム向けでない語(古語・専門語等)を返す可能性があるため使わず、
// 日常語のみを手動収録した固定リストを既定ソースとする。
//
// 差し替え設計:
//   gameplay.js は本ファイルの getWordList(lang) / pickRandomWord(lang, ...) しか呼ばない。
//   将来 辞書API・頻度リスト等に差し替える場合は WORD_SOURCES の該当エントリ
//   (関数) を差し替えるだけでよく、gameplay.js 側の変更は不要。
//
// エントリ形式: { text: string, hint?: string }
//   text: 実際に入力させる文字列 (JPはひらがなのみ = フリック入力の出力と一致させる。
//         カタカナ語は運指表に無いため対象外)
//   hint: 参考表示 (JPは漢字表記、ENは未使用)

const JAPANESE_WORDS = [
  { text: "ねこ", hint: "猫" }, { text: "いぬ", hint: "犬" }, { text: "とり", hint: "鳥" },
  { text: "さかな", hint: "魚" }, { text: "うさぎ", hint: "兎" }, { text: "ぞう", hint: "象" },
  { text: "くま", hint: "熊" }, { text: "うま", hint: "馬" }, { text: "ひつじ", hint: "羊" },
  { text: "きつね", hint: "狐" }, { text: "はな", hint: "花" }, { text: "くさ", hint: "草" },
  { text: "き", hint: "木" }, { text: "もり", hint: "森" }, { text: "やま", hint: "山" },
  { text: "かわ", hint: "川" }, { text: "うみ", hint: "海" }, { text: "そら", hint: "空" },
  { text: "くも", hint: "雲" }, { text: "ほし", hint: "星" }, { text: "つき", hint: "月" },
  { text: "あめ", hint: "雨" }, { text: "ゆき", hint: "雪" }, { text: "かぜ", hint: "風" },
  { text: "なつ", hint: "夏" }, { text: "ふゆ", hint: "冬" }, { text: "はる", hint: "春" },
  { text: "あき", hint: "秋" }, { text: "あさ", hint: "朝" }, { text: "ひる", hint: "昼" },
  { text: "よる", hint: "夜" }, { text: "きのう", hint: "昨日" }, { text: "きょう", hint: "今日" },
  { text: "あした", hint: "明日" }, { text: "とけい", hint: "時計" }, { text: "でんわ", hint: "電話" },
  { text: "てがみ", hint: "手紙" }, { text: "ほん", hint: "本" }, { text: "かさ", hint: "傘" },
  { text: "くつ", hint: "靴" }, { text: "ふく", hint: "服" }, { text: "めがね", hint: "眼鏡" },
  { text: "かばん", hint: "鞄" }, { text: "さいふ", hint: "財布" }, { text: "つくえ", hint: "机" },
  { text: "いす", hint: "椅子" }, { text: "まど", hint: "窓" }, { text: "かぎ", hint: "鍵" },
  { text: "はこ", hint: "箱" }, { text: "たまご", hint: "卵" }, { text: "みず", hint: "水" },
  { text: "おちゃ", hint: "お茶" }, { text: "ごはん", hint: "ご飯" }, { text: "やさい", hint: "野菜" },
  { text: "くだもの", hint: "果物" }, { text: "にく", hint: "肉" }, { text: "たまねぎ", hint: "玉葱" },
  { text: "じかん", hint: "時間" }, { text: "がっこう", hint: "学校" }, { text: "せんせい", hint: "先生" },
  { text: "がくせい", hint: "学生" }, { text: "ともだち", hint: "友達" }, { text: "かぞく", hint: "家族" },
  { text: "あね", hint: "姉" }, { text: "あに", hint: "兄" }, { text: "いもうと", hint: "妹" },
  { text: "おとうと", hint: "弟" }, { text: "ちち", hint: "父" }, { text: "はは", hint: "母" },
  { text: "あたま", hint: "頭" }, { text: "かお", hint: "顔" }, { text: "め", hint: "目" },
  { text: "みみ", hint: "耳" }, { text: "くち", hint: "口" }, { text: "て", hint: "手" },
  { text: "あし", hint: "足" }, { text: "からだ", hint: "体" }, { text: "こころ", hint: "心" },
  { text: "いろ", hint: "色" }, { text: "あか", hint: "赤" }, { text: "あお", hint: "青" },
  { text: "しろ", hint: "白" }, { text: "くろ", hint: "黒" }, { text: "きいろ", hint: "黄色" },
  { text: "おおきい", hint: "大きい" }, { text: "ちいさい", hint: "小さい" }, { text: "はやい", hint: "早い" },
  { text: "おそい", hint: "遅い" }, { text: "たかい", hint: "高い" }, { text: "やすい", hint: "安い" },
  { text: "あたらしい", hint: "新しい" }, { text: "ふるい", hint: "古い" },
];

const ENGLISH_WORDS = [
  { text: "cat" }, { text: "dog" }, { text: "bird" }, { text: "fish" }, { text: "lion" },
  { text: "bear" }, { text: "wolf" }, { text: "mouse" }, { text: "horse" }, { text: "sheep" },
  { text: "apple" }, { text: "bread" }, { text: "water" }, { text: "juice" }, { text: "milk" },
  { text: "coffee" }, { text: "sugar" }, { text: "salt" }, { text: "rice" }, { text: "meat" },
  { text: "fruit" }, { text: "chair" }, { text: "table" }, { text: "house" }, { text: "window" },
  { text: "door" }, { text: "phone" }, { text: "book" }, { text: "pen" }, { text: "pencil" },
  { text: "paper" }, { text: "school" }, { text: "teacher" }, { text: "student" }, { text: "friend" },
  { text: "family" }, { text: "mother" }, { text: "father" }, { text: "sister" }, { text: "brother" },
  { text: "child" }, { text: "baby" }, { text: "hand" }, { text: "foot" }, { text: "head" },
  { text: "eye" }, { text: "ear" }, { text: "nose" }, { text: "mouth" }, { text: "heart" },
  { text: "body" }, { text: "color" }, { text: "red" }, { text: "blue" }, { text: "green" },
  { text: "yellow" }, { text: "black" }, { text: "white" }, { text: "big" }, { text: "small" },
  { text: "tall" }, { text: "short" }, { text: "fast" }, { text: "slow" }, { text: "happy" },
  { text: "sad" }, { text: "hot" }, { text: "cold" }, { text: "new" }, { text: "old" },
  { text: "good" }, { text: "bad" }, { text: "sun" }, { text: "moon" }, { text: "star" },
  { text: "sky" }, { text: "cloud" }, { text: "rain" }, { text: "snow" }, { text: "wind" },
  { text: "summer" }, { text: "winter" }, { text: "spring" }, { text: "autumn" }, { text: "morning" },
  { text: "night" }, { text: "today" }, { text: "time" }, { text: "clock" }, { text: "car" },
  { text: "train" }, { text: "bus" }, { text: "bike" }, { text: "road" }, { text: "city" },
  { text: "town" }, { text: "park" }, { text: "garden" }, { text: "tree" }, { text: "flower" },
  { text: "grass" }, { text: "mountain" }, { text: "river" }, { text: "sea" }, { text: "ocean" },
  { text: "world" }, { text: "earth" }, { text: "music" }, { text: "movie" }, { text: "game" },
  { text: "sport" }, { text: "soccer" }, { text: "tennis" }, { text: "run" }, { text: "walk" },
  { text: "jump" }, { text: "swim" }, { text: "read" }, { text: "write" }, { text: "speak" },
  { text: "listen" }, { text: "sleep" }, { text: "eat" }, { text: "drink" }, { text: "love" },
  { text: "like" }, { text: "want" }, { text: "need" }, { text: "know" }, { text: "think" },
  { text: "work" }, { text: "play" }, { text: "learn" }, { text: "teach" }, { text: "open" },
  { text: "close" }, { text: "start" }, { text: "stop" }, { text: "smile" }, { text: "laugh" },
];

// lang -> エントリ配列を返す関数。差し替え時はここだけ変更すればよい。
const WORD_SOURCES = {
  japanese: () => JAPANESE_WORDS,
  english: () => ENGLISH_WORDS,
};

export function getWordList(lang) {
  const source = WORD_SOURCES[lang];
  if (!source) throw new Error(`unknown word list lang: ${lang}`);
  return source();
}

// 直前と同じ語が連続しないようにランダム抽出する。
export function pickRandomWord(lang, excludeText = null) {
  const list = getWordList(lang);
  if (!list.length) throw new Error(`empty word list: ${lang}`);
  if (list.length === 1) return list[0];
  let w;
  do { w = list[Math.floor(Math.random() * list.length)]; } while (w.text === excludeText);
  return w;
}
