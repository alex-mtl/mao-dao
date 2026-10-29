import PlatformLayout from '@/Layouts/PlatformLayout';
import { Head, Link } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

/** Super admins: every streamer's Guess the Word room, running ones first by last start; each opens the room page. */
export default function Rooms({ rooms, engineOnline }) {
    const { t } = useLaravelReactI18n();
    const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—');
    const list = [...rooms].sort((a, b) => Number(b.running) - Number(a.running));

    return (
        <PlatformLayout>
            <Head title={t('guessword.all_rooms')} />

            <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h1 className="font-heading text-2xl font-bold text-ink-900">{t('guessword.all_rooms')}</h1>
                    <Link href={route('guessword.index')} className="text-sm font-semibold text-primary-700 hover:underline">
                        {t('guessword.title')}
                    </Link>
                </div>
                {!engineOnline && (
                    <p className="mt-4 rounded-lg bg-danger-50 px-4 py-2 text-sm text-danger-700">{t('guessword.engine_offline')}</p>
                )}

                {rooms.length === 0 ? (
                    <p className="mt-6 rounded-xl border border-warm-200 bg-surface p-6 text-center text-ink-500">{t('guessword.no_rooms')}</p>
                ) : (
                    <ul className="mt-6 space-y-3">
                        {list.map((r) => (
                            <li key={r.id}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-warm-200 bg-surface px-4 py-3 shadow-soft">
                                <div className="min-w-0">
                                    <p className="truncate font-heading text-lg font-bold text-ink-900">
                                        {r.streamer}
                                        {r.tiktok && <span className="ml-2 text-sm font-semibold text-ink-400">@{r.tiktok}</span>}
                                    </p>
                                    <p className="mt-0.5 truncate text-xs text-ink-500">
                                        <span className={r.running ? 'font-semibold text-success-700' : ''}>
                                            {r.running ? t('guessword.status_running') : t('guessword.status_stopped')}
                                        </span>
                                        {' · '}{r.email}{' · '}{t('guessword.last_started', { time: when(r.lastStarted) })}
                                    </p>
                                </div>
                                <Link href={route('guessword.rooms.show', r.id)}
                                      className="shrink-0 rounded-lg border-2 border-primary-600 px-4 py-2 text-sm font-semibold text-primary-700 transition hover:bg-primary-50">
                                    {t('guessword.open_room')}
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </PlatformLayout>
    );
}
