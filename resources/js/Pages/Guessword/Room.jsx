import InputError from '@/Components/InputError';
import InputLabel from '@/Components/InputLabel';
import Modal from '@/Components/Modal';
import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import TextInput from '@/Components/TextInput';
import PlatformLayout from '@/Layouts/PlatformLayout';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';
import { Head, router, useForm } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useEffect, useRef, useState } from 'react';
import SettingsPanel, { MODES } from './Partials/SettingsPanel';
import qrcode from 'qrcode-generator';
import useEngineSettings from './Partials/useEngineSettings';

/**
 * The streamer's room: one workspace. Left - the game as it looks in TikTok LIVE Studio (a silent
 * 9:20 preview) with Start (choose the mode) / ⚙ (account and Studio link) / Apply; right - the
 * settings of each mode, read from and applied to the stream engine.
 */
export default function Room({ room, languages, notice, problem }) {
    const { t } = useLaravelReactI18n();
    const s = useEngineSettings(room.controlUrl, room.engineOnline);
    const [mode, setMode] = useState('guess');
    const [menu, setMenu] = useState(false);
    const [account, setAccount] = useState(false);
    const [flash, setFlash] = useState(null);           // "applied" / "failed" under the buttons
    const menuRef = useRef(null);
    const active = s.info?.active;

    useEffect(() => { if (active && MODES.includes(active)) setMode(active); }, [active]);
    useEffect(() => {
        const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, []);

    const apply = async () => {
        const ok = await s.apply();
        setFlash(ok ? 'applied' : 'failed');
        setTimeout(() => setFlash(null), 2000);
    };
    // start in a mode: the engine switches the game first, then the platform starts the room;
    // while running, the same menu switches the mode or stops
    const start = async (game) => {
        setMenu(false);
        try { await s.setActive(game); } catch (e) { /* the platform's start reports the engine problem */ }
        setMode(game);
        if (!room.running) router.post(route('guessword.room.start'), {}, { preserveScroll: true });
    };
    const stop = () => { setMenu(false); router.post(route('guessword.room.stop'), {}, { preserveScroll: true }); };

    const applyBtn = (cls = '') => (
        <PrimaryButton type="button" className={'justify-center ' + cls} onClick={apply} disabled={s.busy || !s.changes}>
            <span className="truncate">{t('guessword.apply')}</span>
        </PrimaryButton>
    );

    return (
        <PlatformLayout>
            <Head title={t('guessword.room_title')} />

            <div className="mx-auto max-w-7xl px-3 py-5 sm:px-5">
                {notice && <p className="mb-3 rounded-lg bg-primary-50 px-4 py-2 text-sm text-primary-800">{notice}</p>}
                {problem && <p className="mb-3 rounded-lg bg-danger-50 px-4 py-2 text-sm text-danger-700">{problem}</p>}
                {!room.running && room.stopReason === 'no_live' && (
                    <p className="mb-3 rounded-lg bg-warm-50 px-4 py-2 text-sm text-ink-700">{t('guessword.no_live_stopped', { nick: room.tiktok || '' })}</p>
                )}
                {!room.engineOnline && <p className="mb-3 rounded-lg bg-danger-50 px-4 py-2 text-sm text-danger-700">{t('guessword.engine_offline')}</p>}

                <div className="grid items-start gap-5 lg:grid-cols-[340px_1fr]">
                    {/* left: buttons + the live preview */}
                    <div className="mx-auto w-full max-w-sm rounded-2xl border-2 border-warm-200 bg-surface p-3.5 shadow-soft lg:sticky lg:top-20 lg:max-w-none">
                        <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                            <div className="relative" ref={menuRef}>
                                {room.running ? (
                                    <SecondaryButton type="button" className="w-full min-w-0 justify-center gap-2 px-2" onClick={() => setMenu(!menu)}>
                                        <span className="h-2.5 w-2.5 rounded-full bg-success-500 ring-4 ring-success-100" />
                                        <span className="truncate">{t('guessword.mode_' + (active || mode))}</span> ▾
                                    </SecondaryButton>
                                ) : (
                                    <PrimaryButton type="button" className="w-full min-w-0 justify-center px-2" onClick={() => setMenu(!menu)} disabled={!room.tiktok}>
                                        <span className="truncate">{t('guessword.start_menu')} ▾</span>
                                    </PrimaryButton>
                                )}
                                {menu && (
                                    <div className="absolute left-0 top-12 z-20 w-72 rounded-xl border border-warm-200 bg-surface p-1.5 shadow-lg">
                                        {MODES.filter((m) => !(room.running && m === active)).map((m) => (
                                            <button key={m} type="button" onClick={() => start(m)}
                                                    className="flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-warm-50">
                                                <span className="text-sm font-semibold text-ink-900">{t('guessword.mode_' + m)}</span>
                                                <span className="text-xs text-ink-500">{t('guessword.mode_' + m + '_d')}</span>
                                            </button>
                                        ))}
                                        {room.running && (
                                            <button type="button" onClick={stop}
                                                    className="mt-1 w-full rounded-lg border-t border-warm-100 px-3 py-2 text-left text-sm font-semibold text-danger-700 hover:bg-danger-50">
                                                {t('guessword.stop_game')}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                            <button type="button" title={t('guessword.account')} onClick={() => setAccount(true)}
                                    className="flex h-10 w-10 items-center justify-center rounded-xl border border-warm-200 bg-surface text-ink-700 hover:bg-warm-50">
                                <Cog6ToothIcon className="h-5 w-5" />
                            </button>
                            {applyBtn('w-full min-w-0 px-2')}
                        </div>

                        {/* the stream's own dark (not a theme token: TikTok shows the game on a dark picture in every scheme) */}
                        <div className="relative aspect-[9/20] w-full overflow-hidden rounded-xl" style={{ background: '#0b0614' }}>
                            {room.engineOnline && (
                                <iframe title={t('guessword.game_heading')} src={room.overlayUrl + '&preview=1'} className="h-full w-full" />
                            )}
                            {flash && (
                                <span className={'absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-semibold text-white ' +
                                                 (flash === 'applied' ? 'bg-success-600' : 'bg-danger-600')}>
                                    {flash === 'applied' ? t('guessword.applied') : t('guessword.apply_failed')}
                                </span>
                            )}
                        </div>
                        <p className="mt-2.5 text-xs text-ink-500">
                            {t('guessword.preview_note')}{' '}
                            <a href={room.controlUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-700 hover:underline">
                                {t('guessword.open_full')} ↗
                            </a>
                        </p>
                    </div>

                    {/* right: settings of the mode */}
                    <SettingsPanel
                        s={s}
                        mode={mode}
                        setMode={setMode}
                        footer={
                            <div className="sticky bottom-0 flex items-center gap-3 rounded-b-2xl border-t border-warm-200 bg-surface/95 px-5 py-3 backdrop-blur">
                                <span className="text-sm text-ink-500">
                                    {s.changes ? t('guessword.changes', { n: s.changes }) : t('guessword.no_changes')}
                                </span>
                                <span className="flex-1" />
                                <SecondaryButton type="button" onClick={s.reset} disabled={!s.changes}>{t('guessword.reset')}</SecondaryButton>
                                {applyBtn()}
                            </div>
                        }
                    />
                </div>
            </div>

            <AccountModal show={account} onClose={() => setAccount(false)} room={room} languages={languages} />
        </PlatformLayout>
    );
}

/** TikTok username, game language, Euler key and the Studio link (they will live in the profile's streamer pack). */
/** The streamer becomes the host in the Telegram bot: a one-time link (10 min) + its QR, to open on the phone. */
function HostBot({ room }) {
    const { t } = useLaravelReactI18n();
    const [state, setState] = useState(null);      // null | 'busy' | {link, qr} | {error}
    const get = () => {
        setState('busy');
        fetch(room.controlUrl + 'api/tg/host-link', { method: 'POST' })
            .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((d) => {
                const q = qrcode(0, 'M');
                q.addData(d.link);
                q.make();
                setState({ link: d.link, qr: q.createSvgTag({ cellSize: 4, margin: 2 }) });
            })
            .catch((e) => setState({ error: t(e === 404 ? 'guessword.host_bot_not_running' : 'guessword.host_bot_error') }));
    };
    return (
        <div className="mt-4 rounded-xl border border-warm-200 p-3">
            <InputLabel value={t('guessword.host_bot')} />
            <p className="mt-1 text-xs text-ink-500">{t('guessword.host_bot_help')}</p>
            <SecondaryButton type="button" className="mt-2" disabled={state === 'busy'} onClick={get}>📲 {t('guessword.host_bot_btn')}</SecondaryButton>
            {state?.link && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className="rounded-lg bg-white p-1" dangerouslySetInnerHTML={{ __html: state.qr }} />
                    <span className="min-w-0 flex-1 text-sm">
                        <a href={state.link} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-primary-700 hover:underline">{state.link}</a>
                        <span className="mt-1 block text-xs text-danger-600">{t('guessword.host_bot_note')}</span>
                    </span>
                </div>
            )}
            {state?.error && <p className="mt-2 text-sm text-danger-600">{state.error}</p>}
        </div>
    );
}

function AccountModal({ show, onClose, room, languages }) {
    const { t } = useLaravelReactI18n();
    const [copied, setCopied] = useState(false);
    const form = useForm({ tiktok: room.tiktok || '', lang: room.lang, euler_key: '', clear_euler_key: false });

    const save = (e) => {
        e.preventDefault();
        form.post(route('guessword.room.update'), {
            preserveScroll: true,
            onSuccess: () => { form.setData('euler_key', ''); onClose(); },
        });
    };
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(room.overlayUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            window.prompt(t('guessword.studio_heading'), room.overlayUrl);
        }
    };

    return (
        <Modal show={show} onClose={onClose} maxWidth="2xl">
            <form onSubmit={save} className="p-6">
                <h2 className="font-heading text-xl font-bold text-ink-900">{t('guessword.account')}</h2>

                <InputLabel className="mt-4" value={t('guessword.studio_heading')} />
                <div className="mt-1 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-warm-50 px-3 py-2 text-xs text-ink-700">{room.overlayUrl}</code>
                    <SecondaryButton type="button" onClick={copy}>{t(copied ? 'guessword.copied' : 'guessword.copy')}</SecondaryButton>
                    <SecondaryButton
                        type="button"
                        onClick={() => window.confirm(t('guessword.regenerate_confirm')) &&
                            router.post(route('guessword.room.link'), {}, { preserveScroll: true })}
                    >
                        {t('guessword.regenerate')}
                    </SecondaryButton>
                </div>
                <p className="mt-1 text-xs text-ink-500">{t('guessword.studio_help')}</p>

                <HostBot room={room} />

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                        <InputLabel htmlFor="gw-tiktok" value={t('guessword.tiktok_label')} />
                        <TextInput id="gw-tiktok" className="mt-1 block w-full" value={form.data.tiktok} placeholder="@nickname"
                                   onChange={(e) => form.setData('tiktok', e.target.value)} />
                        <InputError className="mt-1" message={form.errors.tiktok} />
                    </div>
                    <div>
                        <InputLabel htmlFor="gw-lang" value={t('guessword.lang_label')} />
                        <select id="gw-lang" className="mt-1 block w-full rounded-md border-warm-300 bg-surface text-ink-900 shadow-sm"
                                value={form.data.lang} onChange={(e) => form.setData('lang', e.target.value)}>
                            {languages.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
                        </select>
                    </div>
                    <div className="sm:col-span-2">
                        <InputLabel htmlFor="gw-euler" value={t('guessword.euler_label')} />
                        <TextInput id="gw-euler" type="password" autoComplete="off" className="mt-1 block w-full"
                                   value={form.data.euler_key} onChange={(e) => form.setData('euler_key', e.target.value)} />
                        <p className="mt-1 text-xs text-ink-500">{room.hasEulerKey ? t('guessword.euler_set') : t('guessword.euler_help')}</p>
                        {room.hasEulerKey && (
                            <label className="mt-1 inline-flex items-center gap-2 text-xs text-ink-600">
                                <input type="checkbox" checked={form.data.clear_euler_key}
                                       onChange={(e) => form.setData('clear_euler_key', e.target.checked)} />
                                {t('guessword.euler_clear')}
                            </label>
                        )}
                        <InputError className="mt-1" message={form.errors.euler_key} />
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                    <SecondaryButton type="button" onClick={onClose}>{t('guessword.cancel')}</SecondaryButton>
                    <PrimaryButton disabled={form.processing}>{t('guessword.save')}</PrimaryButton>
                </div>
            </form>
        </Modal>
    );
}
