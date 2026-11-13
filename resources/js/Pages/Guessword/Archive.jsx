import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import PlatformLayout from '@/Layouts/PlatformLayout';
import { Head, Link } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { extension } from './Digest/livecenter.js';
import { digestModel, factsFromLive, temperature, TEMPS } from './Digest/model.js';

// the digest's caption: the LIVE's leaders first (places 1-3 of the word race and of the planes, then the
// top gift giver and balloon launcher) as mentions - @their TikTok login, so TikTok tells them they are in
// the video - then the platform's tags. No login known (a journal-rebuilt LIVE where they never chatted):
// @ and the nickname's letters and digits.
const DEFAULT_TAGS = ['#tiktoklive', '#гонкачемпионов', '#угадайслово', '#маодайджест', '#maodigest'];
const LEADERS = ['wins', 'planes', 'gifts', 'balloons'];
function hashtags(live) {
    const own = LEADERS.flatMap((k) => live.podiums?.[k] || [live.leaders?.[k]]).filter(Boolean)
        .map((p) => '@' + (p.id || (p.name || '').replace(/[^\p{L}\p{N}_]/gu, '')))
        .filter((t) => t.length > 1);
    const seen = new Set();
    return [...own, ...DEFAULT_TAGS].filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

function Tags({ live }) {
    const { t } = useLaravelReactI18n();
    const [copied, setCopied] = useState(false);
    const tags = hashtags(live).join(' ');
    const l = live.leaders || {};
    const extra = [
        l.planes && `✈ ${l.planes.name} (${l.planes.n})`,
        l.gifts && `🎁 ${l.gifts.name} (${t('guessword.archive_coins', { n: l.gifts.n })})`,
        l.balloons && `🎈 ${l.balloons.name} (${l.balloons.n})`,
    ].filter(Boolean);
    const copy = async () => {
        try { await navigator.clipboard.writeText(tags); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
    };
    return (
        <div className="mt-2 space-y-1">
            {extra.length > 0 && <p className="truncate text-xs text-ink-500">{extra.join(' · ')}</p>}
            <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 break-words text-xs font-semibold text-primary-700">{tags}</p>
                <button type="button" onClick={copy}
                        className="shrink-0 rounded-md border border-warm-300 px-2 py-0.5 text-xs font-semibold text-ink-700 hover:bg-warm-100">
                    {copied ? t('guessword.archive_tags_copied') : t('guessword.archive_tags_copy')}
                </button>
            </div>
        </div>
    );
}

const hm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
const hms = (s) => `${hm(s)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const eventsUrl = (room, file) => (room.foreign ? route('guessword.rooms.archive.events', [room.id, file]) : route('guessword.archive.events', file));

/** the stream's temperature as a small curve, colored like the game's word temperature (hot = top) */
function Curve({ bins, label }) {
    const id = useId();
    const T = temperature(bins);
    if (T.length < 2) return null;
    const pts = T.map((v, i) => `${((i / (T.length - 1)) * 200).toFixed(1)},${(38 - v * 34).toFixed(1)}`).join(' ');
    return (
        <svg viewBox="0 0 200 40" className="h-10 w-full max-w-[220px]" role="img" aria-label={label}>
            <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                    {TEMPS.map((c, i) => <stop key={c} offset={i / (TEMPS.length - 1)} stopColor={c} />)}
                </linearGradient>
            </defs>
            <polygon points={`0,40 ${pts} 200,40`} fill={`url(#${id})`} opacity=".25" />
            <polyline points={pts} fill="none" stroke={`url(#${id})`} strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
    );
}

/**
 * "Champion race" digest from the streamer's own recording: the file is checked against the stream's
 * length and built in this browser (Digest/build.js, WebCodecs); nothing is uploaded.
 */
function DigestBuilder({ room, live }) {
    const { t, currentLocale } = useLaravelReactI18n();
    const [state, setState] = useState({ stage: 'pick' });
    const srcRef = useRef(null), canvasRef = useRef(null), abortRef = useRef(null);
    const fileName = `digest-${live.date || live.file.slice(0, 10)}.mp4`, coverName = fileName.replace('.mp4', '-cover.png');
    const why = (w) => t({ webcodecs: 'guessword.digest_no_webcodecs', decode: 'guessword.digest_no_decode', encode: 'guessword.digest_no_encode', format: 'guessword.digest_bad_format' }[w]);

    const pick = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (state.url) { URL.revokeObjectURL(state.url); URL.revokeObjectURL(state.coverUrl); }
        setState({ stage: 'checking' });
        const build = await import('./Digest/build.js');
        const w = await build.unsupported(file);
        if (w) { setState({ stage: 'error', message: why(w) }); return; }
        const info = await build.probe(file);
        srcRef.current = { file, stream: info.duration };
        const off = Math.abs(info.duration - live.duration) > Math.max(300, live.duration * 0.05);
        setState({ stage: off ? 'mismatch' : 'ready', duration: info.duration });
    };

    // the recording straight from TikTok LIVE Center (browser extension): found by the LIVE's TikTok id,
    // placed by the playlist's clock, so no length check is needed
    const fromLiveCenter = async () => {
        if (state.url) { URL.revokeObjectURL(state.url); URL.revokeObjectURL(state.coverUrl); }
        setState({ stage: 'finding' });
        try {
            const lc = await import('./Digest/livecenter.js');
            const replay = await lc.findReplay(live.tiktokRoom, live.epoch);
            if (!replay?.m3u8) { setState({ stage: 'error', message: t('guessword.digest_lc_notfound') }); return; }
            const hls = await lc.playlist(replay);
            const w = await (await import('./Digest/build.js')).unsupportedHls(hls);
            if (w) { setState({ stage: 'error', message: why(w) }); return; }
            srcRef.current = { hls, liveStart: live.epoch, stream: hls.end - live.epoch };
        } catch (e) {
            setState({ stage: 'error', message: t('guessword.digest_failed', { error: e.message }) });
            return;
        }
        // the recording is found: build at once, no second click
        start({ duration: srcRef.current.hls.end - srcRef.current.hls.start, lc: true });
    };

    const run = () => start(state);

    const start = async ({ duration, lc }) => {
        const src = srcRef.current;
        const ac = new AbortController();
        abortRef.current = ac;
        const t0 = performance.now();
        try {
            setState({ stage: 'avatars', duration, lc });
            const lines = await (await fetch(eventsUrl(room, live.file), { headers: { Accept: 'application/json' } })).json();
            const facts = factsFromLive(lines);
            const model = digestModel(facts, { stream: src.stream });
            // avatars of everybody in the races, six at a time; a missing one is drawn as initials
            const ids = [...new Set(Object.values(model.people).map((p) => p.avatar).filter(Boolean))];
            const avatars = new Map();
            for (let i = 0; i < ids.length; i += 6) {
                await Promise.all(ids.slice(i, i + 6).map(async (k) => {
                    try {
                        const r = await fetch(route('guessword.avatar', k));
                        if (r.ok) avatars.set(k, await createImageBitmap(await r.blob()));
                    } catch { /* initials */ }
                }));
            }
            // the TikTok cover: podium, hardest words, totals (Digest/cover.js); also the clip's first frame
            const { drawCover, W: CW, H: CH } = await import('./Digest/cover.js');
            const cv = new OffscreenCanvas(CW, CH);
            const c = (k) => t('guessword.digest_cover_' + k);
            drawCover(cv.getContext('2d'), model, {
                avatars,
                labels: {
                    lang: currentLocale(), game: c('game'), title: c('title'), subtitle: c('subtitle'), wins: c('wins'), rounds: c('rounds'),
                    stream: c('stream'), balloons: c('balloons'), planes: c('planes'), footer: c('tag'),
                },
            });
            const coverUrl = URL.createObjectURL(await cv.convertToBlob({ type: 'image/png' }));
            const { buildDigest } = await import('./Digest/build.js');
            let lost = 0;
            const blob = await buildDigest({
                file: src.file, hls: src.hls, liveStart: src.liveStart, model, avatars, cover: cv, canvas: canvasRef.current, signal: ac.signal,
                labels: { round: t('guessword.digest_round_tag') },
                onProgress: (p) => { lost = p.lost || 0; setState({ stage: p.stage === 'mux' ? 'mux' : 'building', duration, lc, frame: p.frame, frames: p.frames, mb: p.mb }); },
            });
            const url = URL.createObjectURL(blob);
            setState({ stage: 'done', duration, lc, url, coverUrl, seconds: Math.round((performance.now() - t0) / 1000), lost });
            // saved at once: the video lives only in this tab's memory until then
            for (const [href, download] of [[url, fileName], [coverUrl, coverName]]) {
                const a = Object.assign(document.createElement('a'), { href, download });
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        } catch (e) {
            setState(e.name === 'AbortError' ? { stage: 'ready', duration, lc } : { stage: 'error', message: t('guessword.digest_failed', { error: e.message }) });
        }
    };

    const busy = ['avatars', 'building', 'mux', 'finding'].includes(state.stage);
    // closing the tab mid-build loses the work: let the browser ask first
    useEffect(() => {
        if (!busy) return undefined;
        const stay = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', stay);
        return () => window.removeEventListener('beforeunload', stay);
    }, [busy]);
    const ext = extension();
    return (
        <div className="mt-3 rounded-xl border border-warm-200 bg-warm-50 p-4">
            <p className="text-sm text-ink-600">{t('guessword.digest_intro')}</p>
            <div className="mt-3 flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1 space-y-3">
                    {ext && live.tiktokRoom ? (
                        <PrimaryButton type="button" onClick={fromLiveCenter} disabled={busy}>{t('guessword.digest_from_livecenter')}</PrimaryButton>
                    ) : (
                        <p className="text-xs text-ink-500">
                            {t('guessword.digest_install')}{' '}
                            <a href="https://github.com/alex-mtl/mao-dao/tree/main/browser-extension#readme" target="_blank" rel="noreferrer"
                               className="font-semibold text-primary-700 hover:underline">{t('guessword.digest_install_link')}</a>
                        </p>
                    )}
                    {state.stage === 'finding' && <p className="text-sm text-ink-500">{t('guessword.digest_lc_finding')}</p>}
                    <label className="block text-sm font-semibold text-ink-800">
                        {ext && live.tiktokRoom ? t('guessword.digest_or_file') : t('guessword.digest_pick')}
                        <input type="file" accept="video/mp4,.mp4" onChange={pick} disabled={busy}
                               className="mt-1 block w-full text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-600 file:px-3 file:py-2 file:font-semibold file:text-white" />
                    </label>
                    {state.stage === 'checking' && <p className="text-sm text-ink-500">{t('guessword.digest_checking')}</p>}
                    {state.duration !== undefined && (
                        <p className="text-sm text-ink-600">
                            {state.lc ? t('guessword.digest_lc_found', { duration: hms(state.duration) }) : t('guessword.digest_file_duration', { file: hms(state.duration), live: hms(live.duration) })}
                        </p>
                    )}
                    {state.stage === 'mismatch' && (
                        <div className="rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-800">
                            {t('guessword.digest_mismatch', { file: hms(state.duration), live: hms(live.duration) })}
                            <SecondaryButton className="ml-3 mt-2" onClick={run}>{t('guessword.digest_build_anyway')}</SecondaryButton>
                        </div>
                    )}
                    {state.stage === 'ready' && <PrimaryButton type="button" onClick={run}>{t('guessword.digest_build')}</PrimaryButton>}
                    {busy && (
                        <div>
                            <p className="text-sm text-ink-600">
                                {state.stage === 'avatars' && t('guessword.digest_avatars')}
                                {state.stage === 'building' && t('guessword.digest_progress', { n: state.frame, total: state.frames })}
                                {state.stage === 'building' && state.lc && ` · ${t('guessword.digest_mb', { mb: state.mb || 0 })}`}
                                {state.stage === 'mux' && t('guessword.digest_mux')}
                            </p>
                            <div className="mt-1 h-2 overflow-hidden rounded-full bg-warm-200">
                                <div className="h-full bg-primary-500 transition-all" style={{ width: `${state.frames ? (100 * state.frame) / state.frames : 3}%` }} />
                            </div>
                            <SecondaryButton className="mt-2" onClick={() => abortRef.current?.abort()}>{t('guessword.digest_cancel')}</SecondaryButton>
                        </div>
                    )}
                    {state.stage === 'done' && (
                        <div className="space-y-2">
                            <p className="text-sm font-semibold text-success-700">{t('guessword.digest_done', { s: state.seconds })}</p>
                            {state.lost > 0 && <p className="text-xs text-ink-500">{t('guessword.digest_lost', { n: state.lost })}</p>}
                            <p className="text-xs text-ink-500">{t('guessword.digest_saved')}</p>
                            <a href={state.url} download={fileName}
                               className="inline-flex rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
                                {t('guessword.digest_download')}
                            </a>
                            {state.coverUrl && (
                                <a href={state.coverUrl} download={coverName}
                                   className="ml-2 inline-flex rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
                                    {t('guessword.digest_cover_download')}
                                </a>
                            )}
                        </div>
                    )}
                    {state.stage === 'error' && <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{state.message}</p>}
                </div>
                {/* the frame being built (also the drawing surface of the encoder) */}
                <canvas ref={canvasRef} width={1080} height={1920}
                        className={((busy && state.stage !== 'finding') || state.stage === 'done' ? '' : 'hidden ') +'w-28 shrink-0 rounded-lg bg-ink-900 sm:w-36'} />
            </div>
        </div>
    );
}

// a round of 10 minutes or more is a "hard" one: the clips pipeline looks there first
const HARD = 600;
const ms = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const roundsUrl = (room, key) => (room.foreign ? route('guessword.rooms.archive.rounds', [room.id, key]) : route('guessword.archive.rounds', key));
const reasonColor = (r) => (r === 'exact' ? 'bg-success-500' : r === 'timeout' ? 'bg-warning-500' : r === 'skip' ? 'bg-ink-300' : 'bg-primary-300');

/**
 * Every round of the LIVE as one strip: a bar's width is the round's length, its color how it ended (guessed /
 * time ran out / skipped), hard rounds (10 min+) are taller; a dot = a clip (filled) or moments found (ring).
 */
function RoundStrip({ rounds, label }) {
    if (!rounds?.length) return null;
    const total = rounds.reduce((a, [d]) => a + Math.max(d, 20), 0);
    return (
        <div className="mt-2 flex h-6 w-full items-end gap-px overflow-hidden rounded" role="img" aria-label={label}>
            {rounds.map(([d, reason, mark], i) => (
                <div key={i} className="relative h-full" style={{ width: `${(100 * Math.max(d, 20)) / total}%` }}
                     title={`${ms(d)}${reason ? ' · ' + reason : ''}`}>
                    <div className={`absolute bottom-0 left-0 right-0 ${reasonColor(reason)} ${d >= HARD ? 'h-full' : 'h-1/2 opacity-70'}`} />
                    {mark > 0 && <span className={`absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full ${mark === 1 ? 'bg-primary-700' : 'border-2 border-primary-700'}`} />}
                </div>
            ))}
        </div>
    );
}

/** the table of every round of one LIVE (loaded when opened); "hard only" keeps rounds of 10 min and more */
function RoundsTable({ room, liveKey }) {
    const { t } = useLaravelReactI18n();
    const [rows, setRows] = useState(null);
    const [hardOnly, setHardOnly] = useState(false);
    useEffect(() => {
        let gone = false;
        fetch(roundsUrl(room, liveKey), { headers: { Accept: 'application/json' } })
            .then((r) => (r.ok ? r.json() : []))
            .then((d) => { if (!gone) setRows(d); })
            .catch(() => { if (!gone) setRows([]); });
        return () => { gone = true; };
    }, [room, liveKey]);
    if (rows === null) return <p className="mt-3 text-sm text-ink-500">{t('guessword.rounds_loading')}</p>;
    if (rows.length === 0) return <p className="mt-3 text-sm text-ink-500">{t('guessword.rounds_none')}</p>;
    const shown = hardOnly ? rows.filter((r) => (r.duration || 0) >= HARD) : rows;
    const hard = rows.filter((r) => (r.duration || 0) >= HARD).length;
    const result = (r) => (r.reason === 'exact' || (!r.reason && r.winner)
        ? `🏆 ${r.winner || '?'}`
        : t('guessword.rounds_reason_' + (r.reason || 'unknown')));
    return (
        <div className="mt-3 rounded-xl border border-warm-200 bg-warm-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink-600">{t('guessword.rounds_summary', { n: rows.length, hard })}</p>
                <label className="flex items-center gap-2 text-sm text-ink-700">
                    <input type="checkbox" checked={hardOnly} onChange={(e) => setHardOnly(e.target.checked)} className="rounded border-warm-300" />
                    {t('guessword.rounds_hard_only')}
                </label>
            </div>
            <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="text-xs uppercase text-ink-500">
                        <tr>
                            {['no', 'at', 'word', 'length', 'result', 'guesses', 'players', 'clip'].map((c) => (
                                <th key={c} className="px-2 py-1 font-semibold">{t('guessword.rounds_col_' + c)}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((r) => (
                            <tr key={r.round} className={`border-t border-warm-200 align-top ${(r.duration || 0) >= HARD ? 'bg-warning-50' : ''}`}>
                                <td className="px-2 py-1 text-ink-500">{r.round}</td>
                                <td className="whitespace-nowrap px-2 py-1 text-ink-600">
                                    {r.offset !== null ? hms(r.offset) : '—'}
                                    {r.started && <span className="block text-xs text-ink-400">{new Date(r.started).toLocaleTimeString([], { timeStyle: 'short' })}</span>}
                                </td>
                                <td className="px-2 py-1 font-semibold text-ink-900">
                                    {r.word || '—'}
                                    {r.tier && <span className="ml-1 text-xs font-normal text-ink-400">{r.tier}</span>}
                                    {r.moments?.length > 0 && (
                                        <ul className="mt-1 space-y-0.5 text-xs font-normal text-ink-600">
                                            {r.moments.map((m, i) => <li key={i}>💬 {m.at !== undefined && <span className="text-ink-400">{hms(m.at)} </span>}{m.text}</li>)}
                                        </ul>
                                    )}
                                </td>
                                <td className={`whitespace-nowrap px-2 py-1 ${(r.duration || 0) >= HARD ? 'font-bold text-warning-800' : 'text-ink-700'}`}>
                                    {r.duration !== null ? ms(r.duration) : '—'}
                                </td>
                                <td className="max-w-[12rem] truncate px-2 py-1 text-ink-700" title={r.winnerId ? '@' + r.winnerId : undefined}>{result(r)}</td>
                                <td className="px-2 py-1 text-ink-600">{r.guesses ?? '—'}</td>
                                <td className="px-2 py-1 text-ink-600">{r.players ?? '—'}</td>
                                <td className="px-2 py-1">
                                    {r.clip
                                        ? <a href={r.clip} target="_blank" rel="noreferrer" className="font-semibold text-primary-700 hover:underline">{r.clipTitle || t('guessword.rounds_clip_open')}</a>
                                        : <span className="text-ink-300">—</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/** The streamer's archive: every TikTok LIVE the game was connected to, newest first, with the digest builder. */
export default function Archive({ room, lives, recorded = [], strips = {}, engineOnline }) {
    const { t } = useLaravelReactI18n();
    const [open, setOpen] = useState(null);
    const [roundsOpen, setRoundsOpen] = useState(null);
    const toggleRounds = (key) => setRoundsOpen(roundsOpen === key ? null : key);
    const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

    return (
        <PlatformLayout>
            <Head title={t('guessword.archive_title')} />
            <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h1 className="font-heading text-2xl font-bold text-ink-900">
                        {t('guessword.archive_title')}
                        {room.tiktok && <span className="ml-2 text-base font-semibold text-ink-400">@{room.tiktok}</span>}
                    </h1>
                    <Link href={room.foreign ? route('guessword.rooms.show', room.id) : route('guessword.room')}
                          className="text-sm font-semibold text-primary-700 hover:underline">
                        {room.foreign ? t('guessword.foreign_room', { name: room.foreign }) : t('guessword.room_title')}
                    </Link>
                </div>
                <p className="mt-2 text-sm text-ink-600">{t('guessword.archive_intro')}</p>
                {!engineOnline && <p className="mt-4 rounded-lg bg-danger-50 px-4 py-2 text-sm text-danger-700">{t('guessword.engine_offline')}</p>}

                {engineOnline && lives.length === 0 ? (
                    <p className="mt-6 rounded-xl border border-warm-200 bg-surface p-6 text-center text-ink-500">{t('guessword.archive_empty')}</p>
                ) : (
                    <ul className="mt-6 space-y-3">
                        {lives.map((l) => (
                            <li key={l.file} className="rounded-xl border-2 border-warm-200 bg-surface px-4 py-3 shadow-soft">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-heading text-lg font-bold text-ink-900">
                                            {when(l.started)} <span className="ml-1 text-sm font-semibold text-ink-500">{hm(l.duration)}</span>
                                        </p>
                                        {l.journal && <p className="text-xs text-ink-400">{t('guessword.archive_journal')}</p>}
                                        <p className="mt-0.5 text-xs text-ink-500">
                                            {[['rounds', l.rounds], ['wins', l.wins], ['planes', l.planes], ['balloons', l.balloons], ['cakes', l.cakes]]
                                                .map(([k, n]) => `${n} ${t('guessword.archive_' + k)}`).join(' · ')}
                                        </p>
                                        {l.champion && (
                                            <p className="mt-1 truncate text-sm font-semibold text-ink-800">
                                                🏆 {t('guessword.archive_champion', { name: l.champion.name, n: l.champion.wins })}
                                            </p>
                                        )}
                                    </div>
                                    <Curve bins={l.bins} label={t('guessword.archive_temperature')} />
                                    <SecondaryButton onClick={() => setOpen(open === l.file ? null : l.file)}>
                                        {open === l.file ? t('guessword.digest_close') : t('guessword.digest_make')}
                                    </SecondaryButton>
                                </div>
                                <RoundStrip rounds={strips[l.file]} label={t('guessword.rounds_strip')} />
                                <button type="button" onClick={() => toggleRounds(l.file)}
                                        className="mt-1 text-sm font-semibold text-primary-700 hover:underline">
                                    {roundsOpen === l.file ? t('guessword.rounds_hide') : t('guessword.rounds_show')}
                                </button>
                                {roundsOpen === l.file && <RoundsTable room={room} liveKey={l.file} />}
                                <Tags live={l} />
                                {open === l.file && <DigestBuilder room={room} live={l} />}
                            </li>
                        ))}
                    </ul>
                )}

                {recorded.length > 0 && (
                    <>
                        <h2 className="mt-10 font-heading text-lg font-bold text-ink-900">{t('guessword.rounds_recorded_title')}</h2>
                        <p className="mt-1 text-sm text-ink-600">{t('guessword.rounds_recorded_intro')}</p>
                        <ul className="mt-4 space-y-3">
                            {recorded.map((l) => (
                                <li key={l.file} className="rounded-xl border-2 border-warm-200 bg-surface px-4 py-3 shadow-soft">
                                    <p className="font-heading text-lg font-bold text-ink-900">
                                        {l.started ? when(l.started) : l.date} <span className="ml-1 text-sm font-semibold text-ink-500">{hm(l.duration)}</span>
                                    </p>
                                    <p className="mt-0.5 text-xs text-ink-500">
                                        {`${l.rounds} ${t('guessword.archive_rounds')} · ${l.wins} ${t('guessword.archive_wins')}`}
                                        {l.recording && ` · ${l.recording}`}
                                    </p>
                                    {l.champion && (
                                        <p className="mt-1 truncate text-sm font-semibold text-ink-800">
                                            🏆 {t('guessword.archive_champion', { name: l.champion.name, n: l.champion.wins })}
                                        </p>
                                    )}
                                    <RoundStrip rounds={strips[l.file]} label={t('guessword.rounds_strip')} />
                                    <button type="button" onClick={() => toggleRounds(l.file)}
                                            className="mt-1 text-sm font-semibold text-primary-700 hover:underline">
                                        {roundsOpen === l.file ? t('guessword.rounds_hide') : t('guessword.rounds_show')}
                                    </button>
                                    {roundsOpen === l.file && <RoundsTable room={room} liveKey={l.file} />}
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </div>
        </PlatformLayout>
    );
}
