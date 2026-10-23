import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useMemo, useState } from 'react';

// themes of the hand-made list (stream-engine/app/data/gifts_ru.tsv), in the order of the chips
export const THEMES = ['love', 'flower', 'animal', 'food', 'music', 'party', 'halloween', 'magic', 'space', 'sport',
                       'sea', 'transport', 'wear', 'treasure', 'tiktok', 'other'];
const PRICES = [[0, Infinity], [1, 1], [2, 9], [10, 99], [100, 999], [1000, 9999], [10000, Infinity]];

/** Every TikTok gift with its picture and price: search by name (English or Russian) or price, collections. */
export default function GiftCatalog({ catalog }) {
    const { t } = useLaravelReactI18n();
    const [q, setQ] = useState('');
    const [group, setGroup] = useState('all');
    const [price, setPrice] = useState(0);

    const counts = useMemo(() => {
        const c = { all: catalog.length, seen: 0, audio: 0, combo: 0 };
        catalog.forEach((g) => {
            c[g.theme] = (c[g.theme] || 0) + 1;
            if (g.seen) c.seen++;
            if (g.audio) c.audio++;
            if (g.combo) c.combo++;
        });
        return c;
    }, [catalog]);

    const list = useMemo(() => {
        const s = q.trim().toLowerCase();
        const num = /^\d+$/.test(s) ? Number(s) : null;          // a number: that exact price
        const [lo, hi] = PRICES[price];
        return catalog.filter((g) => {
            if (group === 'seen' && !g.seen) return false;
            if (group === 'audio' && !g.audio) return false;
            if (group === 'combo' && !g.combo) return false;
            if (!['all', 'seen', 'audio', 'combo'].includes(group) && g.theme !== group) return false;
            if (g.coins < lo || g.coins > hi) return false;
            if (num !== null) return g.coins === num;
            return !s || g.name.toLowerCase().includes(s) || (g.ru || '').toLowerCase().includes(s);
        });
    }, [catalog, q, group, price]);

    const chip = (key, label) => counts[key] ? (
        <button key={key} type="button" onClick={() => setGroup(key)}
                className={'rounded-full px-3 py-1 text-xs font-semibold ' +
                           (group === key ? 'bg-primary-500 text-white' : 'bg-warm-100 text-ink-600 hover:text-ink-900')}>
            {label} <span className="opacity-70">{counts[key]}</span>
        </button>
    ) : null;

    return (
        <div className="py-3">
            <div className="flex flex-wrap items-center gap-2">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('guessword.catalog_search')}
                       className="h-9 min-w-[200px] flex-1 rounded-lg border-warm-300 bg-surface text-sm text-ink-900" />
                <select value={price} onChange={(e) => setPrice(Number(e.target.value))}
                        className="h-9 rounded-lg border-warm-300 bg-surface py-0 text-sm text-ink-900">
                    {PRICES.map(([lo, hi], i) => (
                        <option key={i} value={i}>
                            {i === 0 ? t('guessword.catalog_any_price')
                                : hi === Infinity ? t('guessword.catalog_from', { n: lo })
                                : lo === hi ? t('guessword.gift_coins', { n: lo }) : `${lo}–${hi}`}
                        </option>
                    ))}
                </select>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
                {chip('all', t('guessword.catalog_all'))}
                {chip('seen', t('guessword.catalog_seen'))}
                {THEMES.map((th) => chip(th, t('guessword.theme_' + th)))}
                {chip('audio', t('guessword.catalog_audio'))}
                {chip('combo', t('guessword.catalog_combo'))}
            </div>
            <p className="mt-2 text-xs text-ink-500">{t('guessword.catalog_found', { n: list.length })}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {list.slice(0, 400).map((g) => (
                    <div key={g.name} className="flex items-center gap-2 rounded-xl border border-warm-200 p-2">
                        {g.image ? <img src={g.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-10 w-10 flex-none object-contain" />
                            : <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-warm-100">🎁</span>}
                        <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-ink-900">{g.name}</span>
                            {g.ru && <span className="block truncate text-xs text-ink-600">{g.ru}</span>}
                            <span className="block text-xs text-ink-500">
                                🪙 {g.coins || '?'}{g.seen ? ' · ' + t('guessword.catalog_sent', { n: g.seen }) : ''}{g.audio ? ' · 🔊' : ''}
                            </span>
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
