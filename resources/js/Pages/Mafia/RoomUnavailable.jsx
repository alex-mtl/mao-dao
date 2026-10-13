import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import SpectatorLayout from '@/Layouts/SpectatorLayout';
import RoomForms from '@/Components/Mafia/RoomForms';
import { Head, Link, usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import useSectionRoutes from '@/hooks/useSectionRoutes';

/**
 * Shown (with a 404/403 status) for any /mafia/... address that points at a
 * game that does not exist, or one this visitor may not enter. Looks like
 * the rest of the section — header, create/join controls — with the
 * explanation as the biggest thing on the page.
 */
export default function RoomUnavailable({ code = null }) {
    const { t } = useLaravelReactI18n();
    const authUser = usePage().props.auth.user;
    const Layout = authUser ? AuthenticatedLayout : SpectatorLayout;
    const { quizRoute } = useSectionRoutes();

    return (
        <Layout>
            <Head title={t('error_pages.mafia_unavailable_title')} />

            <div className="px-4 py-10 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-2xl text-center" role="alert">
                    {code && (
                        <p className="font-heading text-sm font-semibold uppercase tracking-[0.3em] text-ink-400">
                            {code}
                        </p>
                    )}
                    <h1 className="mt-3 font-heading text-3xl font-extrabold leading-tight text-ink-900 sm:text-5xl">
                        {t('error_pages.mafia_unavailable_title')}
                    </h1>
                    <p className="mx-auto mt-4 max-w-xl text-lg text-ink-600">
                        {t(authUser ? 'error_pages.mafia_unavailable_text' : 'error_pages.mafia_unavailable_text_guest')}
                    </p>
                </div>

                <div className="mt-10">
                    {authUser ? (
                        <RoomForms />
                    ) : (
                        <div className="mx-auto max-w-md text-center">
                            <Link
                                href={quizRoute('login')}
                                className="inline-flex rounded-lg bg-primary-600 px-6 py-3 text-base font-semibold text-white shadow-soft transition hover:bg-primary-700"
                            >
                                {t('mafia.log_in_to_play')}
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </Layout>
    );
}
