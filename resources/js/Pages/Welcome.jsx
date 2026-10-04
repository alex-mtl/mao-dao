import ApplicationLogo from '@/Components/ApplicationLogo';
import { Head, Link } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

export default function Welcome({ canLogin, canRegister }) {
    const { t } = useLaravelReactI18n();

    return (
        <>
            <Head title={t('welcome.heading')} />

            <div className="flex min-h-screen flex-col items-center justify-center bg-warm-100 px-4">
                <ApplicationLogo className="h-16 w-16 fill-current text-primary-600" />

                <h1 className="mt-4 font-heading text-3xl font-bold text-ink-900">
                    {t('welcome.heading')}
                </h1>

                <p className="mt-2 text-center text-ink-500">
                    {t('welcome.tagline')}
                </p>

                <div className="mt-6 flex items-center gap-3">
                    {canLogin && (
                        <Link
                            href={route('login')}
                            className="rounded-lg border border-warm-300 bg-surface px-4 py-2.5 text-sm font-semibold text-ink-700 shadow-soft hover:bg-warm-50"
                        >
                            {t('auth_ui.log_in')}
                        </Link>
                    )}

                    {canRegister && (
                        <Link
                            href={route('register')}
                            className="rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-soft hover:bg-primary-700"
                        >
                            {t('auth_ui.register')}
                        </Link>
                    )}
                </div>
            </div>
        </>
    );
}
