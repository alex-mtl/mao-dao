// Russian genitive of place names, without a model: «Столица Финляндии?», «Высота Монблана?».
// Exceptions first (multi-word, plural, fleeting vowels, indeclinable), then rules for one word; names learned from
// earlier GigaChat runs (data/kaggle/*GigaChat*.json) are trusted too. null = unsure -> the caller uses wording
// that needs no declension.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXCEPTIONS = {
  'Египет': 'Египта', 'Тонга': 'Тонга', 'Самоа': 'Самоа', 'Никарагуа': 'Никарагуа', 'Бруней': 'Брунея',
  'Нидерланды': 'Нидерландов', 'Филиппины': 'Филиппин', 'Багамы': 'Багам', 'Мальдивы': 'Мальдив', 'Сейшелы': 'Сейшел',
  'Коморы': 'Комор', 'Объединённые Арабские Эмираты': 'Объединённых Арабских Эмиратов',
  'Маршалловы Острова': 'Маршалловых Островов', 'Соломоновы Острова': 'Соломоновых Островов',
  'Багамские Острова': 'Багамских Островов', 'Сейшельские Острова': 'Сейшельских Островов', 'Коморские Острова': 'Коморских Островов',
  'Острова Кука': 'Островов Кука', 'Федеративные Штаты Микронезии': 'Федеративных Штатов Микронезии',
  'Тринидад и Тобаго': 'Тринидада и Тобаго', 'Антигуа и Барбуда': 'Антигуа и Барбуды', 'Сент-Китс и Невис': 'Сент-Китса и Невиса',
  'Сент-Винсент и Гренадины': 'Сент-Винсента и Гренадин', 'Сан-Томе и Принсипи': 'Сан-Томе и Принсипи',
  'Босния и Герцеговина': 'Боснии и Герцеговины', 'Папуа — Новая Гвинея': 'Папуа — Новой Гвинеи', 'Гвинея-Бисау': 'Гвинеи-Бисау',
  'Демократическая Республика Конго': 'Демократической Республики Конго', 'Республика Конго': 'Республики Конго',
  'Центральноафриканская Республика': 'Центральноафриканской Республики', 'Доминиканская Республика': 'Доминиканской Республики',
  'Китайская Республика': 'Китайской Республики', 'Республика Корея': 'Республики Корея', 'Государство Палестина': 'Государства Палестина',
  'Сент-Люсия': 'Сент-Люсии', 'Шри-Ланка': 'Шри-Ланки', 'Коста-Рика': 'Коста-Рики', 'Сьерра-Леоне': 'Сьерра-Леоне',
  'Буркина-Фасо': 'Буркина-Фасо', 'Кабо-Верде': 'Кабо-Верде', 'Сан-Марино': 'Сан-Марино', 'Кот-д’Ивуар': 'Кот-д’Ивуара',
  'Восточный Тимор': 'Восточного Тимора', 'Южный Судан': 'Южного Судана', 'Новая Зеландия': 'Новой Зеландии',
  'Южная Корея': 'Южной Кореи', 'Северная Корея': 'Северной Кореи', 'Северная Македония': 'Северной Македонии',
  'Экваториальная Гвинея': 'Экваториальной Гвинеи', 'Саудовская Аравия': 'Саудовской Аравии', 'Южно-Африканская Республика': 'Южно-Африканской Республики',
  'Ватикан': 'Ватикана', 'Эсватини': 'Эсватини', 'Мьянма': 'Мьянмы', 'Тувалу': 'Тувалу', 'Науру': 'Науру', 'Палау': 'Палау',
  'Вануату': 'Вануату', 'Кирибати': 'Кирибати', 'Гондурас': 'Гондураса', 'Эквадор': 'Эквадора',
  'Беларусь': 'Беларуси', 'Датское королевство': 'Датского королевства', 'Королевство Нидерландов': 'Королевства Нидерландов',
  'Республика Косово': 'Республики Косово',
};

const VOWELS_INDECL = /[оеиуюэы]$/;
function oneWord(w) {
  if (/^[А-ЯЁ]{2,}$/.test(w)) return w;                        // США, ЮАР, КНДР
  if (/(ия|ея)$/.test(w)) return w.slice(0, -1) + 'и';         // Россия, Корея
  if (/[оуи]а$/.test(w)) return w;                              // Никарагуа, Самоа-like
  if (/[гкхжчшщ]а$/.test(w)) return w.slice(0, -1) + 'и';       // Америка, Коста-Рика
  if (/а$/.test(w)) return w.slice(0, -1) + 'ы';                // Канада, Куба
  if (/я$/.test(w)) return w.slice(0, -1) + 'и';
  if (/й$/.test(w)) return w.slice(0, -1) + 'я';                // Китай
  if (/ь$/.test(w)) return w.slice(0, -1) + 'я';                // Израиль
  if (VOWELS_INDECL.test(w)) return w;                          // Перу, Чили, Того, Монако
  if (/[бвгдзклмнпрстфхцчшщж]$/.test(w)) return w + 'а';        // Ирак, Иран, Казахстан
  return null;
}

const learned = new Map();
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'kaggle');
if (existsSync(dir)) {
  for (const f of readdirSync(dir).filter((x) => /GigaChat.*\.json$/.test(x))) {
    const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    for (const [n, g] of Object.entries(r.genitives ?? {})) if (g) learned.set(n, g);
  }
}

/** genitive of a country (rules allowed) */
export function countryGenitive(name) {
  if (EXCEPTIONS[name]) return EXCEPTIONS[name];
  if (learned.has(name)) return learned.get(name);
  if (/\s/.test(name)) return null; // other multi-word names: unsure
  if (name.includes('-')) {         // Гвинея-Бисау-like handled above; "X-Y" declines the last part
    const parts = name.split('-');
    const last = oneWord(parts.pop());
    return last ? [...parts, last].join('-') : null;
  }
  return oneWord(name);
}

/** genitive of a mountain etc.: only what an earlier run learned or an exception lists - no guessing */
export function knownGenitive(name) {
  return EXCEPTIONS[name] ?? learned.get(name) ?? null;
}
