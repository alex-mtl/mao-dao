import PrimaryButton from '@/Components/PrimaryButton';
import GuestLayout from '@/Layouts/GuestLayout';
import { Head, Link, useForm } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

export default function VerifyEmail({ status }) {
    const { t } = useLaravelReactI18n();
    const { post, processing } = useForm({});

    const submit = (e) => {
        e.preventDefault();

        post(route('verification.send'));
    };

    return (
        <GuestLayout>
            <Head title={t('auth_ui.verify_email_title')} />

            <div className="mb-4 text-sm text-ink-600">
                {t('auth_ui.verify_email_intro')}
            </div>

            {status === 'verification-link-sent' && (
                <div className="mb-4 text-sm font-medium text-success-600">
                    {t('auth_ui.verification_link_sent')}
                </div>
            )}

            <form onSubmit={submit}>
                <div className="mt-4 flex items-center justify-between">
                    <PrimaryButton disabled={processing}>
                        {t('auth_ui.resend_verification_email')}
                    </PrimaryButton>

                    <Link
                        href={route('logout')}
                        method="post"
                        as="button"
                        className="rounded-lg text-sm text-ink-600 underline hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                    >
                        {t('auth_ui.log_out')}
                    </Link>
                </div>
            </form>
        </GuestLayout>
    );
}
