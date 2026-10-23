import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useEffect, useMemo, useRef, useState } from 'react';

export const Avatar = ({ v, size = 'h-6 w-6' }) =>
    v.avatar ? <img src={v.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" className={size + ' flex-none rounded-full object-cover'} />
        : <span className={size + ' flex flex-none items-center justify-center rounded-full bg-primary-500 text-xs font-bold text-white'}>
            {[...v.name.replace(/[^\p{L}\p{N}]/gu, '')][0] || '?'}
        </span>;

/**
 * Picks a viewer of the stream (the latest active first, searchable by nickname) - the streamer then does a
 * gift's action for them. viewers: [{id, name, avatar}]
 */
export default function ViewerPicker({ value, onChange, viewers }) {
    const { t } = useLaravelReactI18n();
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const ref = useRef(null);

    useEffect(() => {
        const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);

    const found = useMemo(() => {
        const s = q.trim().toLowerCase();
        return viewers.filter((v) => !s || v.name.toLowerCase().includes(s) || v.id.toLowerCase().includes(s)).slice(0, 100);
    }, [viewers, q]);
    const row = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-warm-50';

    return (
        <div className="relative w-full" ref={ref}>
            <button type="button" onClick={() => setOpen(!open)}
                    className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-warm-300 bg-surface px-2.5 text-left text-sm text-ink-900">
                {value ? <><Avatar v={value} /><span className="truncate">{value.name}</span></>
                    : <span className="truncate text-ink-500">{t('guessword.viewer_pick')}</span>}
                <span className="ml-auto text-ink-400">▾</span>
            </button>
            {open && (
                <div className="absolute left-0 right-0 top-11 z-30 rounded-xl border border-warm-200 bg-surface p-1.5 shadow-lg">
                    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('guessword.viewer_search')}
                           className="mb-1.5 h-9 w-full rounded-lg border-warm-300 bg-surface text-sm text-ink-900" />
                    <div className="max-h-64 overflow-y-auto">
                        {found.map((v) => (
                            <button key={v.id} type="button" className={row} onClick={() => { onChange(v); setOpen(false); setQ(''); }}>
                                <Avatar v={v} /><span className="truncate">{v.name}</span>
                                {v.name.toLowerCase() !== v.id.toLowerCase() && <span className="ml-auto truncate text-xs text-ink-500">@{v.id}</span>}
                            </button>
                        ))}
                        {!found.length && <p className="px-2.5 py-2 text-sm text-ink-500">{t('guessword.viewer_none')}</p>}
                    </div>
                </div>
            )}
        </div>
    );
}
