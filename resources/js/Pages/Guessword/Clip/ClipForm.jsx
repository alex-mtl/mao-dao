import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { extension } from '../Digest/livecenter.js';
import { candidates, defaultPicks, plan as makePlan } from './plan.js';

const ms = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const speechUrl = (room, live, round) => (room.foreign
    ? route('guessword.rooms.archive.speech', [room.id, live, round])
    : route('guessword.archive.speech', [live, round]));

/**
 * "Make a clip" for one hard round: the form (the host's remarks to keep, the hook) and the build, all in this
 * browser from the streamer's LIVE Center recording (Clip/build.js). Nothing is uploaded.
 */
export default function ClipForm({ room, live, round, onClose }) {
    const { t, currentLocale } = useLaravelReactI18n();
    const [data, setData] = useState(null);                 // {round, words} | 'none'
    const [picked, setPicked] = useState([]);
    const [hook, setHook] = useState('');
    const [withCover, setWithCover] = useState(true);
    const [state, setState] = useState({ stage: 'form' });
    const abortRef = useRef(null), canvasRef = useRef(null);
    const ext = extension();

    useEffect(() => {
        let gone = false;
        fetch(speechUrl(room, live.file, round.round), { headers: { Accept: 'application/json' } })
            .then((r) => (r.ok ? r.json() : 'none'))
            .then((d) => { if (!gone) setData(d); })
            .catch(() => { if (!gone) setData('none'); });
        return () => { gone = true; };
    }, [room, live.file, round.round]);

    const t0 = data?.round?.offset, t1 = data?.round ? data.round.offset + data.round.duration : 0;
    const minutes = Math.round((round.duration || 0) / 60);
    const cands = useMemo(() => (data && data !== 'none' ? candidates(data.words, t0, t1) : []), [data]);
    useEffect(() => {
        if (cands.length) setPicked(defaultPicks(cands, t0, t1));
        setHook(t('guessword.clip_hook_default', { n: minutes }));
    }, [cands]);   // eslint-disable-line react-hooks/exhaustive-deps

    const chosen = cands.filter((c) => picked.includes(c.id));
    // the length before the stall is known: the rewind is always 8 s, so the estimate holds
    const estimate = data && data !== 'none' ? makePlan({ t0, t1, stall: t0 + (t1 - t0) * 0.55, picks: chosen }).total : 0;
    const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

    const busy = ['finding', 'stall', 'building', 'mux', 'cover'].includes(state.stage);
    useEffect(() => {
        if (!busy) return undefined;
        const stay = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', stay);
        return () => window.removeEventListener('beforeunload', stay);
    }, [busy]);

    const why = (w) => t({ webcodecs: 'guessword.digest_no_webcodecs', decode: 'guessword.digest_no_decode', encode: 'guessword.digest_no_encode', format: 'guessword.digest_bad_format' }[w]);

    const generate = async () => {
        const ac = new AbortController();
        abortRef.current = ac;
        const t00 = performance.now();
        if (state.url) { URL.revokeObjectURL(state.url); if (state.coverUrl) URL.revokeObjectURL(state.coverUrl); }
        try {
            setState({ stage: 'finding' });
            const lc = await import('../Digest/livecenter.js');
            const replay = await lc.findReplay(live.tiktokRoom, live.epoch);
            if (!replay?.m3u8) { setState({ stage: 'error', message: t('guessword.digest_lc_notfound') }); return; }
            const hls = await lc.playlist(replay);
            const bad = await (await import('../Digest/build.js')).unsupportedHls(hls);
            if (bad) { setState({ stage: 'error', message: why(bad) }); return; }
            const { buildClip, detectStall } = await import('./build.js');

            setState({ stage: 'stall', n: 0, total: 1 });
            let stall = t0 + (t1 - t0) * 0.55;
            try {
                const d = await detectStall(hls, live.epoch, t0, t1, (n, total) => setState({ stage: 'stall', n, total }), ac.signal);
                if (d.stall !== null) stall = d.stall;
            } catch (e) { if (e.name === 'AbortError') throw e; /* the middle of the round stays */ }

            // the winner's avatar (the plate shows who guessed); initials are not drawn, no picture = no avatar
            let avatar = null;
            const key = data.round.winnerUid || data.round.winnerId;
            if (key) {
                try { const r = await fetch(route('guessword.avatar', key)); if (r.ok) avatar = await createImageBitmap(await r.blob()); } catch { /* none */ }
            }
            const pl = makePlan({ t0, t1, stall, picks: chosen });
            const labels = {
                rewind: t('guessword.clip_rewind'), cta1: t('guessword.clip_cta1'), cta2: t('guessword.clip_cta2'), guessedBy: t('guessword.clip_guessed_by'),
            };
            const { blob } = await buildClip({
                hls, liveStart: live.epoch, plan: pl, words: data.words, hook, labels, signal: ac.signal, canvas: canvasRef.current,
                round: { word: data.round.word || '', winner: data.round.winner, avatar },
                onProgress: (p) => setState({ stage: p.stage === 'mux' ? 'mux' : 'building', frame: p.frame, frames: p.frames }),
            });
            const url = URL.createObjectURL(blob);
            let coverUrl = null;
            if (withCover) {
                setState({ stage: 'cover' });
                const { buildCover } = await import('./cover.js');
                const date = (live.date || live.file.slice(0, 10)).split('-').reverse().join('.');
                const cv = await buildCover({
                    hls, liveStart: live.epoch, t1, date, username: room.tiktok,
                    labels: { game: t('guessword.clip_cover_game'), title1: t('guessword.clip_cover_title1'), title2: t('guessword.clip_cover_title2'), caption: t('guessword.clip_cover_caption', { n: minutes }) },
                });
                coverUrl = URL.createObjectURL(await cv.convertToBlob({ type: 'image/png' }));
            }
            setState({ stage: 'done', url, coverUrl, seconds: Math.round((performance.now() - t00) / 1000), length: Math.round(pl.total) });
        } catch (e) {
            setState(e.name === 'AbortError' ? { stage: 'form' } : { stage: 'error', message: t('guessword.digest_failed', { error: e.message }) });
        }
    };

    const base = `clip-${(live.date || live.file.slice(0, 10))}-round${round.round}`;
    return (
        <div className="mt-2 rounded-xl border border-primary-200 bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
                <p className="font-heading text-base font-bold text-ink-900">{t('guessword.clip_title', { n: round.round, word: round.word || '?' })}</p>
                <button type="button" onClick={onClose} className="text-sm font-semibold text-ink-500 hover:underline" disabled={busy}>{t('guessword.digest_close')}</button>
            </div>
            {data === null && <p className="mt-2 text-sm text-ink-500">{t('guessword.clip_loading')}</p>}
            {data === 'none' && <p className="mt-2 text-sm text-danger-700">{t('guessword.clip_no_speech')}</p>}
            {data && data !== 'none' && (
                <div className="mt-3 flex flex-wrap items-start gap-4">
                    <div className="min-w-0 flex-1 space-y-3">
                        <p className="text-sm text-ink-600">{t('guessword.clip_intro')}</p>
                        {!ext && <p className="rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-800">{t('guessword.digest_install')}</p>}
                        <label className="block text-sm font-semibold text-ink-800">
                            {t('guessword.clip_hook')}
                            <input type="text" value={hook} maxLength={60} onChange={(e) => setHook(e.target.value)} disabled={busy}
                                   className="mt-1 block w-full rounded-lg border border-warm-300 px-3 py-2 text-sm font-normal" />
                        </label>
                        <div>
                            <p className="text-sm font-semibold text-ink-800">{t('guessword.clip_phrases')}</p>
                            <p className="text-xs text-ink-500">{t('guessword.clip_phrases_hint')}</p>
                            {cands.length === 0 && <p className="mt-1 text-sm text-ink-500">{t('guessword.clip_phrases_none')}</p>}
                            <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto pr-1">
                                {cands.map((c) => (
                                    <li key={c.id}>
                                        <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm hover:bg-warm-100">
                                            <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} disabled={busy} className="mt-1 rounded border-warm-300" />
                                            <span className="min-w-0">
                                                <span className="mr-2 whitespace-nowrap text-xs text-ink-400">
                                                    {c.zone === 'after' ? `+${ms(c.from - t1)}` : ms(c.from - t0)} · {(c.to - c.from).toFixed(0)} {t('guessword.clip_s')} · {t('guessword.clip_zone_' + c.zone)}
                                                </span>
                                                <span className="text-ink-800">{c.text}</span>
                                            </span>
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <label className="flex items-center gap-2 text-sm text-ink-700">
                            <input type="checkbox" checked={withCover} onChange={(e) => setWithCover(e.target.checked)} disabled={busy} className="rounded border-warm-300" />
                            {t('guessword.clip_cover')}
                        </label>
                        <p className={`text-sm ${estimate < 30 || estimate > 60 ? 'text-warning-800' : 'text-ink-600'}`}>
                            {t('guessword.clip_length', { s: Math.round(estimate) })}{(estimate < 30 || estimate > 60) && ` · ${t('guessword.clip_length_warn')}`}
                        </p>
                        {!busy && state.stage !== 'done' && (
                            <PrimaryButton type="button" onClick={generate} disabled={!ext || !live.tiktokRoom}>{t('guessword.clip_generate')}</PrimaryButton>
                        )}
                        {busy && (
                            <div>
                                <p className="text-sm text-ink-600">
                                    {state.stage === 'finding' && t('guessword.digest_lc_finding')}
                                    {state.stage === 'stall' && t('guessword.clip_step_stall', { n: state.n, total: state.total })}
                                    {state.stage === 'building' && t('guessword.digest_progress', { n: state.frame, total: state.frames })}
                                    {state.stage === 'mux' && t('guessword.digest_mux')}
                                    {state.stage === 'cover' && t('guessword.clip_step_cover')}
                                </p>
                                <div className="mt-1 h-2 overflow-hidden rounded-full bg-warm-200">
                                    <div className="h-full bg-primary-500 transition-all"
                                         style={{ width: `${state.stage === 'building' && state.frames ? (100 * state.frame) / state.frames : state.stage === 'stall' ? (100 * state.n) / state.total : 5}%` }} />
                                </div>
                                <SecondaryButton className="mt-2" onClick={() => abortRef.current?.abort()}>{t('guessword.digest_cancel')}</SecondaryButton>
                            </div>
                        )}
                        {state.stage === 'done' && (
                            <div className="space-y-2">
                                <p className="text-sm font-semibold text-success-700">{t('guessword.clip_done', { s: state.length, took: state.seconds })}</p>
                                <video src={state.url} controls className="w-40 rounded-lg bg-ink-900" />
                                <div className="flex flex-wrap gap-2">
                                    <a href={state.url} download={`${base}.mp4`} className="inline-flex rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">{t('guessword.digest_download')}</a>
                                    {state.coverUrl && <a href={state.coverUrl} download={`${base}-cover.png`} className="inline-flex rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">{t('guessword.digest_cover_download')}</a>}
                                    <SecondaryButton onClick={() => setState({ stage: 'form' })}>{t('guessword.clip_again')}</SecondaryButton>
                                </div>
                            </div>
                        )}
                        {state.stage === 'error' && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{state.message}</p>}
                    </div>
                    <canvas ref={canvasRef} width={1080} height={1920}
                            className={(busy && state.stage === 'building' ? '' : 'hidden ') + 'w-28 shrink-0 rounded-lg bg-ink-900 sm:w-36'} />
                </div>
            )}
        </div>
    );
}
