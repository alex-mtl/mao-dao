import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import SpectatorLayout from '@/Layouts/SpectatorLayout';
import { Head, Link, usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import useSectionRoutes from '@/hooks/useSectionRoutes';

const KNOWN = [403, 404, 419, 429, 500, 503];

/** Styled error page (404 / 403 / 419 / 429 / 5xx) with the normal site header. */
export default function Error({ status = 404 }) {
    const { t } = useLaravelReactI18n();
    const authUser = usePage().props.auth.user;
    const Layout = authUser ? AuthenticatedLayout : SpectatorLayout;
    const { quizRoute } = useSectionRoutes();
    const key = KNOWN.includes(status) ? status : 500;

    return (
        <Layout loginLabelKey="auth_ui.log_in">
            <Head title={t(`error_pages.title_${key}`)} />

            <div className="px-4 py-16 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-xl text-center" role="alert">
                    <p className="font-heading text-8xl font-extrabold leading-none text-primary-600 sm:text-9xl">{status}</p>
                    <h1 className="mt-6 font-heading text-3xl font-bold text-ink-900">{t(`error_pages.title_${key}`)}</h1>
                    <p className="mt-3 text-lg text-ink-600">{t(`error_pages.text_${key}`)}</p>

                    <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                        <Link
                            href={quizRoute(authUser ? 'dashboard' : 'welcome')}
                            className="rounded-lg bg-primary-600 px-5 py-3 text-base font-semibold text-white shadow-soft transition hover:bg-primary-700"
                        >
                            {t('error_pages.home_button')}
                        </Link>
                        <button
                            type="button"
                            onClick={() => window.history.back()}
                            className="rounded-lg border border-warm-300 bg-surface px-5 py-3 text-base font-semibold text-ink-700 transition hover:bg-warm-50"
                        >
                            {t('error_pages.back_button')}
                        </button>
                    </div>
                </div>
            </div>
        </Layout>
    );
}
