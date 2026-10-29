import PlatformLayout from '@/Layouts/PlatformLayout';
import { Head, Link } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

/**
 * Guess the Word for TikTok LIVE: the streams playing it right now and, for streamers with
 * access to the TikTok mode, the way into their own room. Public, like every section.
 */
export default function Index({ games, engineOnline, canStart, isAdmin }) {
    const { t } = useLaravelReactI18n();
    const time = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

    return (
        <PlatformLayout>
            <Head title={t('guessword.title')} />

            <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                        <h1 className="font-heading text-2xl font-bold text-ink-900">{t('guessword.title')}</h1>
                        <p className="mt-1 text-sm text-ink-500">{t('guessword.subtitle')}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                        {isAdmin && (
                            <Link
                                href={route('guessword.rooms')}
                                className="rounded-lg border-2 border-primary-600 px-4 py-2 text-sm font-semibold text-primary-700 transition hover:bg-primary-50"
                            >
                                {t('guessword.all_rooms')}
                            </Link>
                        )}
                        {canStart && (
                            <Link
                                href={route('guessword.room')}
                                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-primary-700"
                            >
                                {t('guessword.start_game')}
                            </Link>
                        )}
                    </div>
                </div>

                <section aria-labelledby="gw-running" className="mt-8">
                    <h2 id="gw-running" className="font-heading text-lg font-bold text-ink-900">
                        {t('guessword.running_heading')}
                    </h2>

                    {!engineOnline ? (
                        <p className="mt-3 rounded-xl border border-warm-200 bg-surface p-6 text-center text-ink-500">
                            {t('guessword.engine_offline')}
                        </p>
                    ) : games.length === 0 ? (
                        <p className="mt-3 rounded-xl border border-warm-200 bg-surface p-6 text-center text-ink-500">
                            {t('guessword.none_running')}
                        </p>
                    ) : (
                        <ul className="mt-4 space-y-3">
                            {games.map((g) => (
                                <li
                                    key={g.tiktok || g.streamer}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-warm-200 bg-surface px-4 py-3 shadow-soft"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate font-heading text-lg font-bold text-ink-900">
                                            {g.streamer}
                                            {g.tiktok && <span className="ml-2 text-sm font-semibold text-ink-400">@{g.tiktok}</span>}
                                        </p>
                                        {g.since && <p className="mt-0.5 text-xs text-ink-500">{t('guessword.since', { time: time(g.since) })}</p>}
                                    </div>
                                    {g.tiktokUrl && (
                                        <a
                                            href={g.tiktokUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="shrink-0 rounded-lg border-2 border-primary-600 px-4 py-2 text-sm font-semibold text-primary-700 transition hover:bg-primary-50"
                                        >
                                            {t('guessword.watch_on_tiktok')}
                                        </a>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </PlatformLayout>
    );
}
