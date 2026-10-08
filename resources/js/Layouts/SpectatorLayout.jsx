import ApplicationLogo from '@/Components/ApplicationLogo';
import { ArrowsPointingOutIcon } from '@heroicons/react/24/outline';
import { Link } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import useSectionRoutes from '@/hooks/useSectionRoutes';

/**
 * The page frame for someone watching a Mafia room without an account:
 * AuthenticatedLayout assumes a signed-in user (nav drawer, profile menu,
 * notifications), so a guest gets this slim bar instead — logo, an optional
 * fullscreen toggle, and a way to log in and take part. Takes the same
 * \`hideChrome\` / \`onEnterFullscreen\` props as AuthenticatedLayout, so the
 * game screen can swap one for the other.
 */
export default function SpectatorLayout({ children, hideChrome = false, onEnterFullscreen = null }) {
    const { t } = useLaravelReactI18n();
    const { quizRoute } = useSectionRoutes();

    return (
        <div className="min-h-screen bg-warm-100">
            {!hideChrome && (
                <header className="sticky top-0 z-30 border-b border-warm-200 bg-surface/90 backdrop-blur">
                    <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
                        <Link href={quizRoute('welcome')} className="flex items-center gap-2">
                            <ApplicationLogo className="h-7 w-auto fill-current text-primary-600" />
                            <span className="hidden font-heading text-base font-bold text-ink-900 sm:inline">
                                Quiz Platform
                            </span>
                        </Link>

                        <div className="flex items-center gap-2">
                            {onEnterFullscreen && (
                                <button
                                    type="button"
                                    onClick={onEnterFullscreen}
                                    aria-label={t('mafia.fullscreen_enter_button')}
                                    className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-500 transition hover:bg-warm-100 hover:text-ink-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                >
                                    <ArrowsPointingOutIcon className="h-5 w-5" aria-hidden="true" />
                                </button>
                            )}

                            <Link
                                href={quizRoute('login')}
                                className="rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white shadow-soft hover:bg-primary-700"
                            >
                                {t('mafia.log_in_to_play')}
                            </Link>
                        </div>
                    </div>
                </header>
            )}

            <main>{children}</main>
        </div>
    );
}
