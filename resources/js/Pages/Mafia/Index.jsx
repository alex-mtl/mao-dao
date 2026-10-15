import PlatformLayout from '@/Layouts/PlatformLayout';
import RoomForms from '@/Components/Mafia/RoomForms';
import { Head, Link, usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

/**
 * The Mafia section is public: anyone sees the rooms open right now and can
 * watch a game. Starting or joining a game as a player needs an account.
 */
export default function Index({ rooms }) {
    const { t } = useLaravelReactI18n();
    const authUser = usePage().props.auth.user;

    return (
        <PlatformLayout>
            <Head title={t('mafia.index_title')} />

            <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
                <section aria-labelledby="open-rooms">
                    <h1 id="open-rooms" className="font-heading text-2xl font-bold text-ink-900">
                        {t('platform.open_rooms_heading')}
                    </h1>

                    {rooms.length === 0 ? (
                        <p className="mt-3 rounded-xl border border-warm-200 bg-surface p-6 text-center text-ink-500">
                            {t('platform.no_open_rooms')}
                        </p>
                    ) : (
                        <ul className="mt-4 space-y-3">
                            {rooms.map((room) => (
                                <li
                                    key={room.code}
                                    className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 bg-surface px-4 py-3 shadow-soft ${
                                        room.hasFriends ? 'border-accent-400' : 'border-warm-200'
                                    }`}
                                >
                                    <div className="min-w-0">
                                        <p className="font-heading text-lg font-bold tracking-widest text-ink-900">
                                            {room.code}
                                            <span className="ml-3 text-xs font-semibold uppercase tracking-wide text-ink-400">
                                                {t(room.status === 'lobby' ? 'platform.room_status_lobby' : 'platform.room_status_playing')}
                                            </span>
                                        </p>
                                        <p className="mt-0.5 truncate text-sm text-ink-500">
                                            {t('mafia.player_count', { count: room.playersCount, max: room.seats })}
                                            {room.players.length > 0 && ` · ${room.players.join(', ')}`}
                                        </p>
                                        {room.hasFriends && (
                                            <p className="mt-0.5 text-xs font-semibold text-accent-700">{t('platform.friends_playing')}</p>
                                        )}
                                    </div>
                                    <Link
                                        href={room.url}
                                        className="shrink-0 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-soft transition hover:bg-primary-700"
                                    >
                                        {t(room.canJoin && authUser ? 'platform.join_room' : 'platform.watch_room')}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                <div className="mt-10">
                    {authUser ? (
                        <RoomForms />
                    ) : (
                        <div className="rounded-2xl border border-warm-200 bg-surface p-6 text-center shadow-soft">
                            <p className="text-ink-600">{t('platform.login_to_create_room')}</p>
                            <div className="mt-4 flex flex-wrap justify-center gap-3">
                                <Link
                                    href={route('login')}
                                    className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-primary-700"
                                >
                                    {t('auth_ui.log_in')}
                                </Link>
                                <Link
                                    href={route('register')}
                                    className="rounded-lg border border-warm-300 bg-surface px-5 py-2.5 text-sm font-semibold text-ink-700 hover:bg-warm-50"
                                >
                                    {t('auth_ui.register')}
                                </Link>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </PlatformLayout>
    );
}
