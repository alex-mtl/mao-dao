import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useEffect, useState } from 'react';
import { Seg, Switch } from './SettingsPanel';

// what the overlay shows besides the game: the engine's GuessGame.SCREEN (guess options), changed live during a stream
const TOPS = ['stream', 'planes', 'balloons'];
const VIEWS = ['line', 'tiles', 'ticker', 'column'];
const LINE_DURS = [5, 10, 15];               // "one by one": seconds per gift
const BOX_DURS = [10, 20, 30, 60];           // the other views: seconds on screen
const clock = (s) => Math.floor(s / 60) + ':' + String(Math.round(s) % 60).padStart(2, '0');

/** on screen now? the overlay's own rule: every N min for N s on the wall clock */
function airState(mode, every, dur, now) {
    if (mode === 'always') return { on: true };
    if (mode !== 'periodic') return { off: true };
    const p = every * 60, ph = now % p;
    return ph < dur ? { on: true, next: dur - ph } : { on: false, next: p - ph };
}

/** live settings: every click goes to the engine at once; a failure is shown under the tab */
function useScreen(s) {
    const [error, setError] = useState(false);
    const v = s.draft.guess || {};
    const put = (values) => s.setNow('guess', values).then(() => setError(false), () => setError(true));
    return { v, put, error };
}

function Row({ title, sub, status, disabled, children }) {
    return (
        <div className="grid gap-x-4 gap-y-2 border-t border-warm-100 py-2.5 first:border-t-0 sm:grid-cols-[minmax(150px,30%)_1fr]">
            <div>
                <div className="text-sm font-semibold text-ink-900">{title}</div>
                {sub && <div className="text-xs text-ink-500">{sub}</div>}
                {status}
            </div>
            <div className={'flex min-w-0 flex-col gap-2 ' + (disabled ? 'pointer-events-none opacity-40' : '')}>{children}</div>
        </div>
    );
}

function Group({ title, sub, right, children }) {
    return (
        <div className="border-b border-warm-100 py-3 last:border-b-0">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="font-heading text-base font-bold text-ink-900">{title}</h3>
                {sub && <span className="text-xs text-ink-500">{sub}</span>}
                {right && <span className="ml-auto flex items-center gap-2 text-sm font-semibold text-ink-800">{right}</span>}
            </div>
            {children}
        </div>
    );
}

export default function ScreenTab({ s }) {
    const { t } = useLaravelReactI18n();
    const { v, put, error } = useScreen(s);
    const [now, setNow] = useState(() => Date.now() / 1000);
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now() / 1000), 1000);
        return () => clearInterval(id);
    }, []);
    const modes = (list, key, extra = {}) => (
        <Seg value={v[key]} options={list} label={(m) => t('guessword.scr_mode_' + m)} onChange={(m) => put({ [key]: m, ...extra })} />
    );
    const status = (st) => {
        if (!v.screen) return <Status>{t('guessword.scr_st_hidden')}</Status>;
        if (st.carousel) return <Status>{t('guessword.scr_st_turn')}</Status>;
        if (st.off) return <Status>{t('guessword.scr_st_off')}</Status>;
        if (st.on) return <Status on>{st.next != null ? t('guessword.scr_st_hides', { t: clock(st.next) }) : t('guessword.scr_st_on')}</Status>;
        return <Status>{t('guessword.scr_st_shows', { t: clock(st.next) })}</Status>;
    };
    const periodic = (prefix, durs = BOX_DURS, durLabel = (n) => t('guessword.sec', { n }), durWord = t('guessword.scr_for')) => (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-ink-500">
            {t('guessword.scr_every')}
            <Seg value={v[prefix + '_every']} options={[1, 2, 3, 5, 10]} label={(n) => t('guessword.min', { n })}
                 onChange={(n) => put({ [prefix + '_every']: n })} />
            {durWord}
            <Seg value={v[prefix + '_dur']} options={durs} label={durLabel} onChange={(n) => put({ [prefix + '_dur']: n })} />
        </div>
    );
    const ring = TOPS.filter((k) => v['top_' + k] === 'carousel');
    const line = v.gifts_view === 'line';
    const zone = !!v.chat_zone;

    return (
        <div className="pb-2">
            <div className={'mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-xl border px-3.5 py-3 ' +
                            (v.screen ? 'border-warm-200 bg-warm-50' : 'border-transparent bg-warning-100')}>
                <Switch on={!!v.screen} onChange={(on) => put({ screen: on ? 1 : 0 })} />
                <b className="font-heading text-base">{t(v.screen ? 'guessword.scr_all_on' : 'guessword.scr_all_off')}</b>
                <span className="min-w-[200px] flex-1 text-xs text-ink-500">{t(v.screen ? 'guessword.scr_all_on_d' : 'guessword.scr_all_off_d')}</span>
            </div>
            {error && <p className="mt-2 text-sm text-danger-600">{t('guessword.apply_failed')}</p>}

            <Group title={t('guessword.scr_tops')} sub={t('guessword.scr_tops_d')}
                   right={<>{t('guessword.scr_tops_all')}<Switch on={!!v.tops} onChange={(on) => put({ tops: on ? 1 : 0 })} /></>}>
                {TOPS.map((k) => {
                    const key = 'top_' + k, mode = v[key];
                    const st = !v.tops ? { off: true } : mode === 'carousel' ? { carousel: true } : airState(mode, v[key + '_every'], v[key + '_dur'], now);
                    return (
                        <Row key={k} title={t('guessword.scr_top_' + k)} sub={t('guessword.scr_top_' + k + '_d')} status={status(st)}
                             disabled={!v.screen || !v.tops}>
                            {modes(['always', 'periodic', 'carousel', 'never'], key)}
                            {mode === 'periodic' && periodic(key)}
                        </Row>
                    );
                })}
                <Row title={t('guessword.scr_carousel')}
                     sub={ring.length ? t('guessword.scr_carousel_d', { list: ring.map((k) => t('guessword.scr_top_' + k)).join(' → ') })
                                      : t('guessword.scr_carousel_none')}
                     disabled={!v.screen || !v.tops || !ring.length}>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-ink-500">
                        {t('guessword.scr_slot')}
                        <Seg value={v.carousel_slot} options={[10, 15, 20, 30]} label={(n) => t('guessword.sec', { n })}
                             onChange={(n) => put({ carousel_slot: n })} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-ink-500">
                        {t('guessword.scr_pause')}
                        <Seg value={v.carousel_pause} options={[0, 1, 2, 5]}
                             label={(n) => (n ? t('guessword.min', { n }) : t('guessword.scr_pause_none'))}
                             onChange={(n) => put({ carousel_pause: n })} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-ink-500">
                        {t('guessword.scr_side')}
                        <Seg value={v.carousel_side} options={['l', 'r']} label={(x) => t('guessword.scr_side_' + x)}
                             onChange={(x) => put({ carousel_side: x })} />
                    </div>
                </Row>
            </Group>

            <Group title={t('guessword.scr_bot')} sub={t('guessword.scr_bot_d')}>
                <Row title={t('guessword.scr_bot_row')} sub={t('guessword.scr_bot_row_d')}
                     status={status(airState(v.bot, v.bot_every, v.bot_dur, now))} disabled={!v.screen}>
                    {modes(['always', 'periodic', 'never'], 'bot')}
                    {v.bot === 'periodic' && periodic('bot')}
                </Row>
            </Group>

            <Group title={t('guessword.scr_gifts')} sub={t('guessword.scr_gifts_d')}>
                <Row title={t('guessword.scr_gifts_show')} sub={t('guessword.scr_gifts_show_d')}
                     status={line && v.gifts === 'periodic' ? null : status(airState(v.gifts, v.gifts_every, v.gifts_dur, now))}
                     disabled={!v.screen}>
                    {modes(['always', 'periodic', 'never'], 'gifts')}
                    {v.gifts !== 'never' && line && (
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-ink-500">
                            {t('guessword.scr_per_gift')}
                            <Seg value={v.gifts_dur} options={LINE_DURS} label={(n) => t('guessword.sec', { n })}
                                 onChange={(n) => put({ gifts_dur: n })} />
                        </div>
                    )}
                    {v.gifts === 'periodic' && (line
                        ? <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-ink-500">
                              {t('guessword.scr_series')}
                              <Seg value={v.gifts_every} options={[1, 2, 3, 5, 10]} label={(n) => t('guessword.min', { n })}
                                   onChange={(n) => put({ gifts_every: n })} />
                          </div>
                        : periodic('gifts'))}
                </Row>
                <Row title={t('guessword.scr_view')} sub={t('guessword.scr_view_' + v.gifts_view + '_d')} disabled={!v.screen || v.gifts === 'never'}>
                    <Seg value={v.gifts_view} options={VIEWS} label={(x) => t('guessword.scr_view_' + x)}
                         onChange={(x) => put({ gifts_view: x, gifts_dur: x === 'line' ? 10 : 30 })} />
                </Row>
                <Row title={t('guessword.scr_place')} sub={t('guessword.scr_place_' + v.gifts_place + '_d')} disabled={!v.screen || v.gifts === 'never'}>
                    <span className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg bg-warm-100 p-0.5">
                        {['host', 'bottom'].map((x) => (
                            <button key={x} type="button" disabled={x === 'bottom' && !zone} onClick={() => put({ gifts_place: x })}
                                    className={'rounded-md px-2.5 py-1 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ' +
                                        (x === v.gifts_place ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800')}>
                                {t('guessword.scr_place_' + x)}
                            </button>
                        ))}
                    </span>
                    {!zone && <span className="text-xs text-warning-700">{t('guessword.scr_place_need_zone')}</span>}
                </Row>
            </Group>
        </div>
    );
}

function Status({ on, children }) {
    return <div className={'mt-1 text-xs font-semibold tabular-nums ' + (on ? 'text-success-600' : 'text-ink-500')}>{children}</div>;
}

/** the same switches in short, over the game monitor: tops, the bot, the gifts, hide everything */
export function ScreenQuick({ s }) {
    const { t } = useLaravelReactI18n();
    const { v, put, error } = useScreen(s);
    const [last, setLast] = useState({ bot: 'always', gifts: 'periodic' });   // what a switched-off row comes back to
    const flip = (key) => {
        if (v[key] === 'never') put({ [key]: last[key] });
        else { setLast({ ...last, [key]: v[key] }); put({ [key]: 'never' }); }
    };
    const Btn = ({ on, onClick, warn, children }) => (
        <button type="button" onClick={onClick}
                className={'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ' +
                    (warn && on ? 'border-transparent bg-warning-100 text-ink-900' : 'border-warm-300 bg-surface text-ink-800 hover:bg-warm-50')}>
            <i className={'h-2 w-2 rounded-full ' + (on ? 'bg-success-500' : 'bg-warm-300')} />
            {children}
        </button>
    );
    return (
        <div className="flex flex-wrap items-center gap-2 border-b border-warm-200 bg-warm-50 px-5 py-2.5">
            <span className="mr-1 text-sm font-bold text-ink-900">{t('guessword.scr_quick')}</span>
            <Btn on={!!v.screen && !!v.tops} onClick={() => put({ tops: v.tops ? 0 : 1 })}>{t('guessword.scr_quick_tops')}</Btn>
            <Btn on={!!v.screen && v.bot !== 'never'} onClick={() => flip('bot')}>{t('guessword.scr_quick_bot')}</Btn>
            <Btn on={!!v.screen && v.gifts !== 'never'} onClick={() => flip('gifts')}>{t('guessword.scr_quick_gifts')}</Btn>
            <Btn warn on={!v.screen} onClick={() => put({ screen: v.screen ? 0 : 1 })}>
                {t(v.screen ? 'guessword.scr_quick_hide' : 'guessword.scr_quick_back')}
            </Btn>
            {error && <span className="text-sm text-danger-600">{t('guessword.apply_failed')}</span>}
        </div>
    );
}
