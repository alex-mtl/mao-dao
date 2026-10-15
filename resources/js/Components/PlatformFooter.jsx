import { Link, usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

/** Footer shared by every non-game page of the platform. */
export default function PlatformFooter() {
    const { t } = useLaravelReactI18n();
    const authUser = usePage().props.auth.user;

    return (
        <footer className="mt-12 border-t border-warm-200 bg-surface/80">
            <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-start sm:justify-between sm:px-6 lg:px-8">
                <div>
                    <p className="font-heading text-lg font-bold text-ink-900">{t('platform.site_name')}</p>
                    <p className="mt-1 text-sm text-ink-500">{t('platform.footer_tagline')}</p>
                </div>

                <nav className="flex flex-wrap gap-x-12 gap-y-4 text-sm" aria-label="Footer">
                    <div className="space-y-2">
                        <p className="font-semibold text-ink-700">{t('platform.footer_games')}</p>
                        <Link href={route('dashboard')} className="block text-ink-500 hover:text-ink-900">
                            {t('platform.section_quiz')}
                        </Link>
                        <Link href={route('mafia.index')} className="block text-ink-500 hover:text-ink-900">
                            {t('platform.section_mafia')}
                        </Link>
                    </div>
                    <div className="space-y-2">
                        <p className="font-semibold text-ink-700">{t('platform.footer_account')}</p>
                        {authUser ? (
                            <Link href={route('profile.edit')} className="block text-ink-500 hover:text-ink-900">
                                {t('nav.profile')}
                            </Link>
                        ) : (
                            <>
                                <Link href={route('login')} className="block text-ink-500 hover:text-ink-900">
                                    {t('auth_ui.log_in')}
                                </Link>
                                <Link href={route('register')} className="block text-ink-500 hover:text-ink-900">
                                    {t('auth_ui.register')}
                                </Link>
                            </>
                        )}
                    </div>
                </nav>
            </div>
            <p className="border-t border-warm-200 px-4 py-4 text-center text-xs text-ink-400">
                © {new Date().getFullYear()} {t('platform.site_name')}. {t('platform.footer_rights')}
            </p>
        </footer>
    );
}
