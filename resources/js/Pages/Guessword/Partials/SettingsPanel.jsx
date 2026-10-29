import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useState } from 'react';
import GameMonitor from './GameMonitor';
import GiftCatalog from './GiftCatalog';
import ScreenTab, { ScreenQuick } from './ScreenTab';
import { GiftsTab, ToastsTab } from './ToastsAndGifts';

// the panel's modes (engine game names) and the sections of each mode
export const MODES = ['battle', 'guess', 'streamer'];
const SECTIONS = {
    battle: ['gifts', 'toasts', 'likes', 'catalog'],
    guess: ['game', 'frame', 'screen', 'gifts', 'toasts', 'likes', 'catalog'],
    streamer: ['frame', 'gifts', 'toasts', 'likes', 'catalog'],
};
const LIVE_SECTIONS = ['screen'];            // applied at once, no Apply button
const TAB_KEY = { game: 'guessword.tab_game', frame: 'guessword.tab_frame', screen: 'guessword.tab_screen', gifts: 'guessword.tab_gifts',
                  toasts: 'guessword.tab_toasts', likes: 'guessword.tab_likes', catalog: 'guessword.tab_catalog' };
// like thresholds the streamer picks from (every N likes of one viewer), the same for every show; 0 = off.
// Any other whole number in LIKES_MIN..LIKES_MAX can be typed in (the engine's LIKE_STEPS / LIKES_RANGE).
const LIKE_STEPS = [100, 200, 300, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 250000, 500000, 1000000];
const LIKES_MIN = 10;
const LIKES_MAX = 10000000;
const kilo = (n) => (n >= 1000000 ? n / 1000000 + 'M' : n >= 1000 ? n / 1000 + 'K' : String(n));

export function Seg({ value, options, onChange, label = String }) {
    return (
        <span className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-warm-100 p-0.5">
            {options.map((o) => (
                <button
                    key={o}
                    type="button"
                    onClick={() => onChange(o)}
                    className={
                        'rounded-md px-2.5 py-1 text-sm font-semibold transition ' +
                        (o === value ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800')
                    }
                >
                    {label(o)}
                </button>
            ))}
        </span>
    );
}

export function Switch({ on, onChange, title }) {
    return (
        <button
            type="button"
            title={title}
            onClick={() => onChange(!on)}
            className={'relative h-6 w-10 flex-none rounded-full transition ' + (on ? 'bg-primary-500' : 'bg-warm-300')}
        >
            <span className={'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' + (on ? 'left-[18px]' : 'left-0.5')} />
        </button>
    );
}

function Field({ label, children }) {
    return (
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-800">
            {label}
            <span>{children}</span>
        </label>
    );
}

/** One row "thing — on/off — every N likes": off = 0, on brings back the last threshold (or the first step). */
function LikesRow({ title, sub, value, onChange }) {
    const { t } = useLaravelReactI18n();
    const [last, setLast] = useState(value || LIKE_STEPS[0]);
    // a value outside the list (typed in, or saved before the list changed) shows as the custom one
    const [custom, setCustom] = useState(!!value && !LIKE_STEPS.includes(value));
    const [text, setText] = useState(value ? String(value) : '');
    const on = !!value;
    const pick = (v) => { setLast(v); onChange(v); };
    const typed = (str) => {
        setText(str);
        const n = Number(str);
        if (Number.isInteger(n) && n >= LIKES_MIN && n <= LIKES_MAX) pick(n);
    };
    const bad = custom && on && Number(text) !== value;
    return (
        <tr className="border-t border-warm-100 first:border-t-0">
            <td className="w-[40%] py-2.5 pr-3">
                <div className="text-sm font-medium text-ink-900">{title}</div>
                <div className="text-xs text-ink-500">{sub}</div>
            </td>
            <td className="py-2.5 pr-3">
                <Switch on={on} onChange={(v) => onChange(v ? last : 0)} />
            </td>
            <td className={'py-2.5 ' + (on ? '' : 'pointer-events-none opacity-40')}>
                <span className="flex flex-wrap items-center gap-2">
                    <select
                        className="h-9 rounded-lg border-warm-300 bg-surface py-0 text-sm font-semibold text-ink-900"
                        value={custom ? 'custom' : (value || last)}
                        disabled={!on}
                        onChange={(e) => {
                            if (e.target.value === 'custom') {
                                setCustom(true);
                                setText(String(value || last));
                            } else {
                                setCustom(false);
                                pick(Number(e.target.value));
                            }
                        }}
                    >
                        {LIKE_STEPS.map((n) => <option key={n} value={n}>{kilo(n)}</option>)}
                        <option value="custom">{t('guessword.likes_custom')}</option>
                    </select>
                    {custom && (
                        <input
                            type="number"
                            min={LIKES_MIN}
                            max={LIKES_MAX}
                            step="1"
                            className={'h-9 w-32 rounded-lg bg-surface py-0 text-sm text-ink-900 ' + (bad ? 'border-red-400' : 'border-warm-300')}
                            value={text}
                            disabled={!on}
                            onChange={(e) => typed(e.target.value)}
                            title={t('guessword.likes_custom_hint', { min: LIKES_MIN, max: kilo(LIKES_MAX) })}
                        />
                    )}
                </span>
            </td>
        </tr>
    );
}

export default function SettingsPanel({ s, mode, setMode, footer }) {
    const { t } = useLaravelReactI18n();
    const [tab, setTab] = useState({ battle: 'gifts', guess: 'game', streamer: 'frame' });
    const section = tab[mode];
    // the panel turns over: the settings, or the monitor of the guess game (remembered on this device)
    const [view, setViewState] = useState(() => { try { return localStorage.getItem('gw-panel-view') || 'settings'; } catch { return 'settings'; } });
    const setView = (v) => { setViewState(v); try { localStorage.setItem('gw-panel-view', v); } catch { /* private mode */ } };
    const monitor = view === 'monitor' && mode === 'guess';
    const g = s.draft.guess || {};
    const gl = s.draft.global || {};
    const sec = (n) => t('guessword.sec', { n });

    const frameSeg = (game) => (
        <Field label={t('guessword.opt_frame')}>
            <Seg value={s.draft[game]?.frame} options={s.choices(game, 'frame')} label={(v) => '9:' + v}
                 onChange={(v) => s.set(game, 'frame', v)} />
        </Field>
    );

    return (
        <div className="rounded-2xl border-2 border-warm-200 bg-surface shadow-soft">
            <div className="sticky top-14 z-10 rounded-t-2xl border-b border-warm-200 bg-surface">
                <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-3">
                    <div className="flex gap-1 rounded-xl bg-warm-100 p-1">
                        {MODES.map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setMode(m)}
                                className={
                                    'h-9 whitespace-nowrap rounded-lg px-3.5 text-sm font-semibold transition ' +
                                    (m === mode ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800')
                                }
                            >
                                {t('guessword.mode_' + m)}
                            </button>
                        ))}
                    </div>
                    {mode === 'guess' && (
                        <button type="button" onClick={() => setView(monitor ? 'settings' : 'monitor')}
                                className="ml-auto flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-warm-300 bg-surface px-3 text-sm font-semibold text-ink-800 hover:bg-warm-50">
                            <span className={monitor ? 'text-ink-500' : 'text-ink-900'}>⚙ {t('guessword.view_settings')}</span>
                            <span className="text-primary-500">⇄</span>
                            <span className={monitor ? 'text-ink-900' : 'text-ink-500'}>📊 {t('guessword.view_monitor')}</span>
                        </button>
                    )}
                </div>
                {!monitor && <div className="flex items-center gap-1 overflow-x-auto px-3">
                    {SECTIONS[mode].map((k) => (
                        <button
                            key={k}
                            type="button"
                            onClick={() => setTab({ ...tab, [mode]: k })}
                            className={
                                'h-10 whitespace-nowrap border-b-2 px-3 text-sm font-semibold ' +
                                (k === section ? 'border-primary-500 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800')
                            }
                        >
                            {t(TAB_KEY[k])}
                        </button>
                    ))}
                    <span className="flex-1" />
                    {LIVE_SECTIONS.includes(section)
                        ? <span className="whitespace-nowrap text-xs font-semibold text-success-600">{t('guessword.scr_live')}</span>
                        : <span className="whitespace-nowrap text-xs text-ink-500">
                              {s.changes ? t('guessword.changes', { n: s.changes }) : t('guessword.no_changes')}
                          </span>}
                </div>}
            </div>

            {monitor && !s.failed && s.info && <ScreenQuick s={s} />}
            {monitor && <GameMonitor s={s} />}

            <div className={'px-5 py-2' + (monitor ? ' hidden' : '')}>
                {s.failed && <p className="py-4 text-sm text-danger-700">{t('guessword.settings_offline')}</p>}

                {!s.failed && s.info && mode === 'guess' && section === 'game' && (
                    <>
                        <div className="border-b border-warm-100 py-3">
                            <h3 className="mb-3 font-heading text-base font-bold text-ink-900">{t('guessword.group_rounds')}</h3>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label={t('guessword.opt_round_min')}>
                                    <Seg value={g.round_min} options={s.choices('guess', 'round_min')} label={(n) => t('guessword.min', { n })}
                                         onChange={(v) => s.set('guess', 'round_min', v)} />
                                </Field>
                                <Field label={t('guessword.opt_pause')}>
                                    <Seg value={g.pause} options={s.choices('guess', 'pause')}
                                         label={(n) => (n >= 60 ? t('guessword.min', { n: n / 60 }) : n ? sec(n) : '0')}
                                         onChange={(v) => s.set('guess', 'pause', v)} />
                                </Field>
                                <Field label={t('guessword.opt_level')}>
                                    <Seg value={g.level} options={s.choices('guess', 'level')} label={(n) => t('guessword.opt_level_' + n)}
                                         onChange={(v) => s.set('guess', 'level', v)} />
                                </Field>
                                <Field label={t('guessword.opt_row_anim')}>
                                    <Seg value={g.row_anim} options={s.choices('guess', 'row_anim')} label={sec}
                                         onChange={(v) => s.set('guess', 'row_anim', v)} />
                                </Field>
                                <Field label={t('guessword.opt_hint_cd')}>
                                    <Seg value={g.hint_cd} options={s.choices('guess', 'hint_cd')} label={sec}
                                         onChange={(v) => s.set('guess', 'hint_cd', v)} />
                                </Field>
                            </div>
                        </div>
                        <div className="py-3">
                            <h3 className="mb-3 font-heading text-base font-bold text-ink-900">{t('guessword.group_players')}</h3>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label={t('guessword.opt_follow')}>
                                    <Seg value={g.follow} options={s.choices('guess', 'follow')} label={(n) => t('guessword.opt_follow_' + n)}
                                         onChange={(v) => s.set('guess', 'follow', v)} />
                                </Field>
                                <Field label={t('guessword.opt_grace')}>
                                    <Seg value={g.grace} options={s.choices('guess', 'grace')} label={sec}
                                         onChange={(v) => s.set('guess', 'grace', v)} />
                                </Field>
                                {g.follow === 2 && (
                                    <Field label={t('guessword.opt_fan_min')}>
                                        <Seg value={g.fan_min} options={s.choices('guess', 'fan_min')} label={(n) => t('guessword.opt_fan_min_v', { n })}
                                             onChange={(v) => s.set('guess', 'fan_min', v)} />
                                    </Field>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {!s.failed && s.info && mode === 'guess' && section === 'frame' && (
                    <div className="grid gap-4 py-3 sm:grid-cols-2">
                        {frameSeg('guess')}
                        <Field label={t('guessword.opt_chat_zone')}>
                            <Seg value={g.chat_zone} options={s.choices('guess', 'chat_zone')}
                                 label={(n) => (n ? n + '%' : t('guessword.opt_chat_zone_off'))}
                                 onChange={(v) => s.set('guess', 'chat_zone', v)} />
                        </Field>
                        <Field label={t('guessword.opt_chroma')}>
                            <span className="flex items-center gap-3">
                                <Switch on={!!g.chroma} onChange={(v) => s.set('guess', 'chroma', v ? 1 : 0)} />
                                <select
                                    className={'h-9 rounded-lg border-warm-300 bg-surface py-0 text-sm text-ink-900 ' + (g.chroma ? '' : 'opacity-40')}
                                    value={g.chroma_top}
                                    disabled={!g.chroma}
                                    onChange={(e) => s.set('guess', 'chroma_top', Number(e.target.value))}
                                >
                                    {s.choices('guess', 'chroma_top').map((n) => (
                                        <option key={n} value={n}>{t('guessword.opt_chroma_top', { n })}</option>
                                    ))}
                                </select>
                            </span>
                        </Field>
                    </div>
                )}

                {!s.failed && s.info && mode === 'guess' && section === 'screen' && <ScreenTab s={s} />}

                {!s.failed && s.info && mode === 'streamer' && section === 'frame' &&<div className="py-3">{frameSeg('streamer')}</div>}

                {!s.failed && s.info && section === 'toasts' && <ToastsTab s={s} mode={mode} />}
                {!s.failed && s.info && section === 'gifts' && <GiftsTab s={s} mode={mode} />}
                {!s.failed && s.info && section === 'catalog' && <GiftCatalog catalog={s.info.gifts?.catalog || []} />}

                {!s.failed && s.info && section === 'likes' && (
                    <>
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                                    <th className="py-2">{t('guessword.col_anim')}</th>
                                    <th className="py-2">{t('guessword.col_on')}</th>
                                    <th className="py-2">{t('guessword.col_likes')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <LikesRow title={t('guessword.balloon')} sub={t('guessword.balloon_d')}
                                          value={gl.balloon_likes} onChange={(v) => s.set('global', 'balloon_likes', v)} />
                                <LikesRow title={t('guessword.plane')} sub={t('guessword.plane_d')}
                                          value={gl.plane_auto} onChange={(v) => s.set('global', 'plane_auto', v)} />
                                <LikesRow title={t('guessword.bomber')} sub={t('guessword.plane_d')}
                                          value={gl.bomber} onChange={(v) => s.set('global', 'bomber', v)} />
                                <LikesRow title={t('guessword.snowball')} sub={t('guessword.plane_d')}
                                          value={gl.snowball} onChange={(v) => s.set('global', 'snowball', v)} />
                                <LikesRow title={t('guessword.cake')} sub={t('guessword.plane_d')}
                                          value={gl.cake} onChange={(v) => s.set('global', 'cake', v)} />
                            </tbody>
                        </table>
                    </>
                )}
            </div>

            {!monitor && footer}
        </div>
    );
}
