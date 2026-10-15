import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import SpectatorLayout from '@/Layouts/SpectatorLayout';
import { Head, Link, usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

// Accent per game: border / title colour come from the theme tokens, so the
// cards recolour with the selected colour scheme (and glow in the neon one).
const ACCENTS = {
    cyan: {
        card: 'border-secondary-400 hover:shadow-[0_0_2vw_rgb(var(--color-secondary-500)/0.45)]',
        title: 'text-secondary-600',
        button: 'bg-secondary-600 text-white hover:bg-secondary-700',
    },
    magenta: {
        card: 'border-primary-400 hover:shadow-[0_0_2vw_rgb(var(--color-primary-500)/0.45)]',
        title: 'text-primary-600',
        button: 'bg-primary-600 text-white hover:bg-primary-700',
    },
};

/**
 * Platform home: one block per game with a way into its section. The list of
 * rooms open for joining (and which friends are in them) is a template for now:
 * `game.openRooms` is always empty until the mechanic is built.
 */
export default function Home({ games, canLogin, canRegister }) {
    const { t } = useLaravelReactI18n();
    const authUser = usePage().props.auth.user;
    const Layout = authUser ? AuthenticatedLayout : SpectatorLayout;

    return (
        <Layout loginLabelKey="auth_ui.log_in" showRegister={canRegister}>
            <Head title={t('platform.home_title')} />

            <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
                <div className="text-center">
                    <h1 className="font-heading text-4xl font-extrabold tracking-wide text-ink-900 sm:text-5xl">
                        {t('platform.home_title')}
                    </h1>
                    <p className="mt-3 text-sm font-semibold uppercase tracking-[0.3em] text-ink-400">
                        {t('platform.home_tagline')}
                    </p>
                </div>

                <div className="mt-10 grid gap-6 md:grid-cols-2">
                    {games.map((game) => {
                        const accent = ACCENTS[game.accent] ?? ACCENTS.magenta;

                        return (
                            <section
                                key={game.key}
                                className={`flex flex-col rounded-2xl border-2 bg-surface p-6 shadow-soft transition ${accent.card}`}
                                aria-labelledby={`game-${game.key}`}
                            >
                                <h2 id={`game-${game.key}`} className={`font-heading text-3xl font-extrabold uppercase ${accent.title}`}>
                                    {t(`platform.${game.key}_name`)}
                                </h2>
                                <p className="mt-2 text-ink-600">{t(`platform.${game.key}_description`)}</p>

                                <div className="mt-5 flex flex-wrap gap-3">
                                    <Link
                                        href={game.url}
                                        className={`rounded-lg px-4 py-2.5 text-sm font-semibold shadow-soft transition ${accent.button}`}
                                    >
                                        {t('platform.open_section')}
                                    </Link>
                                    {game.createUrl && (
                                        <Link
                                            href={game.createUrl}
                                            className="rounded-lg border border-warm-300 bg-surface px-4 py-2.5 text-sm font-semibold text-ink-700 transition hover:bg-warm-50"
                                        >
                                            {t('platform.create_game')}
                                        </Link>
                                    )}
                                </div>

                                <div className="mt-6 border-t border-warm-200 pt-4">
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                                        {t('platform.open_rooms_heading')}
                                    </h3>
                                    {game.openRooms.length === 0 ? (
                                        <p className="mt-2 text-sm text-ink-400">{t('platform.no_open_rooms')}</p>
                                    ) : (
                                        <ul className="mt-2 space-y-2">
                                            {game.openRooms.map((room) => (
                                                <li
                                                    key={room.code}
                                                    className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
                                                        room.hasFriends ? 'border-accent-400 bg-accent-50' : 'border-warm-200'
                                                    }`}
                                                >
                                                    <span className="min-w-0 truncate text-ink-700">
                                                        {room.players.join(', ')}
                                                    </span>
                                                    <Link href={room.url} className="shrink-0 font-semibold text-primary-700 hover:underline">
                                                        {t('platform.join_room')}
                                                    </Link>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </section>
                        );
                    })}
                </div>

                {!authUser && canLogin && (
                    <p className="mt-8 text-center text-sm text-ink-500">{t('platform.sign_in_to_play')}</p>
                )}
            </div>
        </Layout>
    );
}
