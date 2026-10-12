import { router, usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useState } from 'react';
import useSectionRoutes from '@/hooks/useSectionRoutes';

/** Small "pending validation" pill for the header, shown while the email is unconfirmed. */
export function PendingValidationBadge() {
    const { t } = useLaravelReactI18n();
    const verification = usePage().props.emailVerification;

    if (!verification || verification.state !== 'pending') {
        return null;
    }

    return (
        <span
            className="inline-flex items-center rounded-full border border-warning-300 bg-warning-100 px-2 py-0.5 text-xs font-semibold text-warning-800"
            title={t('account.pending_badge')}
        >
            {t('account.pending_badge')}
        </span>
    );
}

/**
 * Reminder under the header while the email is unconfirmed: where the link
 * went, how long is left (when there is a deadline) and a "send again" button.
 */
export function PendingValidationBanner() {
    const { t } = useLaravelReactI18n();
    const { auth, emailVerification } = usePage().props;
    const { quizRoute } = useSectionRoutes();
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);

    if (!emailVerification || emailVerification.state !== 'pending') {
        return null;
    }

    const resend = () => {
        setSending(true);
        router.post(
            quizRoute('verification.send'),
            {},
            {
                preserveScroll: true,
                onSuccess: () => setSent(true),
                onFinish: () => setSending(false),
            },
        );
    };

    const text =
        emailVerification.hoursLeft !== null
            ? t('account.pending_banner', { email: auth.user.email, hours: Math.max(1, emailVerification.hoursLeft) })
            : t('account.pending_banner_no_deadline', { email: auth.user.email });

    return (
        <div role="status" className="border-b border-warning-300 bg-warning-50">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm text-ink-800 sm:px-6 lg:px-8">
                <span className="min-w-0 flex-1">{text}</span>
                {sent ? (
                    <span className="font-medium text-success-700">{t('account.resend_sent')}</span>
                ) : (
                    <button
                        type="button"
                        onClick={resend}
                        disabled={sending}
                        className="shrink-0 rounded-lg border border-warning-400 bg-surface px-3 py-1.5 text-sm font-semibold text-ink-800 transition hover:bg-warning-100 disabled:opacity-50"
                    >
                        {t('account.resend_button')}
                    </button>
                )}
            </div>
        </div>
    );
}
