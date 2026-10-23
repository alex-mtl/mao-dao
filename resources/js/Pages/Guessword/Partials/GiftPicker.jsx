import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useEffect, useMemo, useRef, useState } from 'react';

const Icon = ({ g, size = 'h-6 w-6' }) =>
    g?.image ? <img src={g.image} alt="" loading="lazy" referrerPolicy="no-referrer" className={size + ' flex-none object-contain'} />
        : <span className={size + ' flex flex-none items-center justify-center rounded-full bg-warm-100 text-xs'}>🎁</span>;

/** 2-3 gifts overlapping: what "any gift from N coins" looks like */
const Stack = ({ gifts }) => (
    <span className="flex flex-none -space-x-2">
        {gifts.map((g) => (
            <span key={g.name} className="rounded-full bg-surface ring-2 ring-surface"><Icon g={g} /></span>
        ))}
    </span>
);

/**
 * Picks the gift for an action: none, any gift, any from N coins (with 2-3 popular gifts of that price),
 * or one gift - with its picture, searchable; gifts sent on our streams most often come first.
 * value: "" | "any" | "min:N" | "gift:<name>"
 */
export default function GiftPicker({ value, onChange, catalog, tiers }) {
    const { t } = useLaravelReactI18n();
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const ref = useRef(null);

    useEffect(() => {
        const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);

    // examples for each "from N coins": popular gifts priced from N up to the next step, with a picture
    const examples = useMemo(() => {
        const out = {};
        tiers.forEach((n, i) => {
            const top = tiers[i + 1] || Infinity;
            const inTier = catalog.filter((g) => g.image && g.coins >= n && g.coins < top);
            out[n] = [...inTier].sort((a, b) => (b.seen - a.seen) || (a.coins - b.coins)).slice(0, 3);
        });
        return out;
    }, [catalog, tiers]);
    const byName = useMemo(() => Object.fromEntries(catalog.map((g) => [g.name, g])), [catalog]);
    const found = useMemo(() => {
        const s = q.trim().toLowerCase();
        return (s ? catalog.filter((g) => g.name.toLowerCase().includes(s) || (g.ru || '').toLowerCase().includes(s)) : catalog).slice(0, 300);
    }, [catalog, q]);

    const label = (v) => {
        if (!v) return <span className="text-ink-500">{t('guessword.gift_none')}</span>;
        if (v === 'any') return <span>{t('guessword.gift_any')}</span>;
        if (v.startsWith('min:')) {
            const n = Number(v.slice(4));
            return <><Stack gifts={examples[n] || []} /><span>{t('guessword.gift_min', { n })}</span></>;
        }
        const g = byName[v.slice(5)] || { name: v.slice(5) };
        return <><Icon g={g} /><span className="truncate">{g.name}</span>
            {g.coins ? <span className="text-xs text-ink-500">· {t('guessword.gift_coins', { n: g.coins })}</span> : null}</>;
    };
    const pick = (v) => { onChange(v); setOpen(false); setQ(''); };
    const row = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-warm-50 ';

    return (
        <div className="relative w-full max-w-xs" ref={ref}>
            <button type="button" onClick={() => setOpen(!open)}
                    className="flex h-10 w-full items-center gap-2 rounded-lg border border-warm-300 bg-surface px-2.5 text-left text-sm text-ink-900">
                {label(value)}
                <span className="ml-auto text-ink-400">▾</span>
            </button>
            {open && (
                <div className="absolute left-0 right-0 top-11 z-30 rounded-xl border border-warm-200 bg-surface p-1.5 shadow-lg">
                    <button type="button" className={row} onClick={() => pick('')}>{label('')}</button>
                    <button type="button" className={row} onClick={() => pick('any')}>{label('any')}</button>
                    {tiers.map((n) => (
                        <button key={n} type="button" className={row} onClick={() => pick('min:' + n)}>{label('min:' + n)}</button>
                    ))}
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder={t('guessword.gift_search')}
                        className="my-1.5 h-9 w-full rounded-lg border-warm-300 bg-surface text-sm text-ink-900"
                    />
                    <div className="max-h-64 overflow-y-auto">
                        {found.map((g) => (
                            <button key={g.name} type="button" className={row + (value === 'gift:' + g.name ? 'bg-primary-50' : '')}
                                    onClick={() => pick('gift:' + g.name)}>
                                <Icon g={g} />
                                <span className="truncate">{g.name}{g.ru ? <span className="text-ink-500"> · {g.ru}</span> : null}</span>
                                {g.coins ? <span className="ml-auto text-xs text-ink-500">{t('guessword.gift_coins', { n: g.coins })}</span> : null}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
