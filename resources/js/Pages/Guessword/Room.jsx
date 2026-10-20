import InputError from '@/Components/InputError';
import InputLabel from '@/Components/InputLabel';
import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import TextInput from '@/Components/TextInput';
import PlatformLayout from '@/Layouts/PlatformLayout';
import { Head, router, useForm } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useState } from 'react';

/**
 * The streamer's Guess the Word room: TikTok username, language and Euler key; start / stop;
 * the TikTok LIVE Studio link; below, the game's own menu (settings and the game itself) served
 * by the stream engine.
 */
export default function Room({ room, languages, notice, problem }) {
    const { t } = useLaravelReactI18n();
    const [copied, setCopied] = useState(false);
    const form = useForm({ tiktok: room.tiktok || '', lang: room.lang, euler_key: '', clear_euler_key: false });

    const save = (e) => {
        e.preventDefault();
        form.post(route('guessword.room.update'), { preserveScroll: true, onSuccess: () => form.setData('euler_key', '') });
    };
    const post = (name) => router.post(route(name), {}, { preserveScroll: true });
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(room.overlayUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            window.prompt(t('guessword.studio_heading'), room.overlayUrl);
        }
    };
    const card = 'mt-6 rounded-xl border-2 border-warm-200 bg-surface p-5 shadow-soft';

    return (
        <PlatformLayout>
            <Head title={t('guessword.room_title')} />

            <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
                <h1 className="font-heading text-2xl font-bold text-ink-900">{t('guessword.room_title')}</h1>

                {notice && <p className="mt-4 rounded-lg bg-primary-50 px-4 py-2 text-sm text-primary-800">{notice}</p>}
                {problem && <p className="mt-4 rounded-lg bg-danger-50 px-4 py-2 text-sm text-danger-700">{problem}</p>}
                {!room.engineOnline && <p className="mt-4 rounded-lg bg-danger-50 px-4 py-2 text-sm text-danger-700">{t('guessword.engine_offline')}</p>}

                <section className={card}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="font-heading text-lg font-bold text-ink-900">{t('guessword.status_heading')}</h2>
                            <p className="mt-0.5 text-sm text-ink-600">
                                <span className={room.running ? 'font-semibold text-primary-700' : 'text-ink-500'}>
                                    {t(room.running ? 'guessword.status_running' : 'guessword.status_stopped')}
                                </span>
                                {room.running && (
                                    <span className="text-ink-500">
                                        {' · '}
                                        {t(room.tiktokStatus === 'connected' ? 'guessword.tiktok_connected' : 'guessword.tiktok_waiting')}
                                    </span>
                                )}
                            </p>
                        </div>
                        {room.running ? (
                            <SecondaryButton onClick={() => post('guessword.room.stop')}>{t('guessword.stop')}</SecondaryButton>
                        ) : (
                            <PrimaryButton onClick={() => post('guessword.room.start')} disabled={!room.tiktok}>
                                {t('guessword.start')}
                            </PrimaryButton>
                        )}
                    </div>
                </section>

                <section className={card}>
                    <h2 className="font-heading text-lg font-bold text-ink-900">{t('guessword.studio_heading')}</h2>
                    <p className="mt-1 text-sm text-ink-600">{t('guessword.studio_help')}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-lg bg-warm-50 px-3 py-2 text-xs text-ink-700">{room.overlayUrl}</code>
                        <SecondaryButton onClick={copy}>{t(copied ? 'guessword.copied' : 'guessword.copy')}</SecondaryButton>
                        <SecondaryButton
                            onClick={() => window.confirm(t('guessword.regenerate_confirm')) && post('guessword.room.link')}
                        >
                            {t('guessword.regenerate')}
                        </SecondaryButton>
                    </div>
                </section>

                <form onSubmit={save} className={card}>
                    <h2 className="font-heading text-lg font-bold text-ink-900">{t('guessword.settings_heading')}</h2>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                            <InputLabel htmlFor="gw-tiktok" value={t('guessword.tiktok_label')} />
                            <TextInput
                                id="gw-tiktok"
                                className="mt-1 block w-full"
                                value={form.data.tiktok}
                                placeholder="@nickname"
                                onChange={(e) => form.setData('tiktok', e.target.value)}
                            />
                            <InputError className="mt-1" message={form.errors.tiktok} />
                        </div>
                        <div>
                            <InputLabel htmlFor="gw-lang" value={t('guessword.lang_label')} />
                            <select
                                id="gw-lang"
                                className="mt-1 block w-full rounded-md border-warm-300 bg-surface text-ink-900 shadow-sm"
                                value={form.data.lang}
                                onChange={(e) => form.setData('lang', e.target.value)}
                            >
                                {languages.map((l) => (
                                    <option key={l} value={l}>{l.toUpperCase()}</option>
                                ))}
                            </select>
                        </div>
                        <div className="sm:col-span-2">
                            <InputLabel htmlFor="gw-euler" value={t('guessword.euler_label')} />
                            <TextInput
                                id="gw-euler"
                                type="password"
                                autoComplete="off"
                                className="mt-1 block w-full"
                                value={form.data.euler_key}
                                onChange={(e) => form.setData('euler_key', e.target.value)}
                            />
                            <p className="mt-1 text-xs text-ink-500">
                                {room.hasEulerKey ? t('guessword.euler_set') : t('guessword.euler_help')}
                            </p>
                            {room.hasEulerKey && (
                                <label className="mt-1 inline-flex items-center gap-2 text-xs text-ink-600">
                                    <input
                                        type="checkbox"
                                        checked={form.data.clear_euler_key}
                                        onChange={(e) => form.setData('clear_euler_key', e.target.checked)}
                                    />
                                    {t('guessword.euler_clear')}
                                </label>
                            )}
                            <InputError className="mt-1" message={form.errors.euler_key} />
                        </div>
                    </div>
                    <div className="mt-4">
                        <PrimaryButton disabled={form.processing}>{t('guessword.save')}</PrimaryButton>
                    </div>
                </form>

                <section className={card}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="font-heading text-lg font-bold text-ink-900">{t('guessword.game_heading')}</h2>
                        <a href={room.controlUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary-700 hover:underline">
                            {t('guessword.open_full')}
                        </a>
                    </div>
                    {room.engineOnline && (
                        <iframe
                            title={t('guessword.game_heading')}
                            src={room.controlUrl}
                            className="mt-3 h-[80vh] w-full rounded-lg border border-warm-200 bg-ink-900"
                            allow="autoplay; clipboard-write"
                        />
                    )}
                </section>
            </div>
        </PlatformLayout>
    );
}
