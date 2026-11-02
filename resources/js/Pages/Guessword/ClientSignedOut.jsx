import { Head } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

/** The streamer app's sign-in address was used up or is too old: no site chrome, only what to do. */
export default function ClientSignedOut() {
    const { t } = useLaravelReactI18n();

    return (
        <div className="flex min-h-screen items-center justify-center bg-warm-100 px-4">
            <Head title={t('guessword.client_signed_out_title')} />
            <div className="max-w-md rounded-2xl border-2 border-warm-200 bg-surface p-6 text-center shadow-soft">
                <h1 className="font-heading text-xl font-bold text-ink-900">{t('guessword.client_signed_out_title')}</h1>
                <p className="mt-2 text-sm text-ink-600">{t('guessword.client_signed_out_text')}</p>
            </div>
        </div>
    );
}
