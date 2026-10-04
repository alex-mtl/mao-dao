import ApplicationLogo from '@/Components/ApplicationLogo';
import Avatar from '@/Components/Avatar';
import Dropdown from '@/Components/Dropdown';
import NavigationDrawer from '@/Components/NavigationDrawer';
import { ArrowsPointingOutIcon, Bars3Icon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { Link, usePage } from '@inertiajs/react';
import { useState } from 'react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import useSectionRoutes from '@/hooks/useSectionRoutes';

/**
 * `hideChrome` (plan §2.7, corrected) suppresses this layout's own header
 * entirely — opt-in per page (only the Mafia Play page passes it), so
 * every other page's chrome is completely unaffected. The header must
 * fully disappear/reappear on demand rather than staying sticky and
 * having page content scroll underneath it — reported directly as wrong
 * for the fullscreen game screen — so the *trigger* to hide it lives
 * inside the header itself (`onEnterFullscreen`), and the page that asked
 * for `hideChrome` is responsible for its own way back in (Play.jsx
 * renders a compact menu + exit-fullscreen control once the header is
 * gone, anchored to its own info panel rather than floating over the
 * video grid).
 */
export default function AuthenticatedLayout({ header, children, hideChrome = false, onEnterFullscreen = null }) {
    const { t } = useLaravelReactI18n();
    const user = usePage().props.auth.user;
    const { quizRoute } = useSectionRoutes();

    const [drawerOpen, setDrawerOpen] = useState(false);

    return (
        <div className="min-h-screen bg-warm-100">
            <NavigationDrawer
                show={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                user={user}
            />

            {!hideChrome && (
                <header className="sticky top-0 z-30 border-b border-warm-200 bg-surface/90 backdrop-blur">
                    <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setDrawerOpen(true)}
                                aria-label={t('nav.open_menu')}
                                aria-expanded={drawerOpen}
                                className="-ms-2 flex h-10 w-10 items-center justify-center rounded-lg text-ink-500 transition hover:bg-warm-100 hover:text-ink-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
                            >
                                <Bars3Icon className="h-6 w-6" aria-hidden="true" />
                            </button>

                            <Link href={quizRoute('dashboard')} className="flex items-center gap-2">
                                <ApplicationLogo className="h-7 w-auto fill-current text-primary-600" />
                                <span className="hidden font-heading text-base font-bold text-ink-900 sm:inline">
                                    Quiz Platform
                                </span>
                            </Link>
                        </div>

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

                            <Dropdown>
                                <Dropdown.Trigger>
                                    <button
                                        type="button"
                                        className="flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 transition hover:bg-warm-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                    >
                                        <Avatar name={user.name} src={user.profile_photo_url} size="sm" />
                                        <span className="hidden text-sm font-medium text-ink-700 sm:inline">
                                            {user.name}
                                        </span>
                                        <ChevronDownIcon className="h-4 w-4 text-ink-400" aria-hidden="true" />
                                    </button>
                                </Dropdown.Trigger>

                                <Dropdown.Content>
                                    <Dropdown.Link href={quizRoute('profile.edit')}>
                                        {t('nav.profile')}
                                    </Dropdown.Link>
                                    <Dropdown.Link href={quizRoute('logout')} method="post" as="button">
                                        {t('nav.log_out')}
                                    </Dropdown.Link>
                                </Dropdown.Content>
                            </Dropdown>
                        </div>
                    </div>
                </header>
            )}

            {!hideChrome && header && (
                <div className="border-b border-warm-200 bg-surface">
                    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
                        {header}
                    </div>
                </div>
            )}

            <main>{children}</main>
        </div>
    );
}
