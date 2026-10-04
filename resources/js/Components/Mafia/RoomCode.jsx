import { useState } from 'react';
import { ClipboardDocumentIcon, CheckIcon, ShareIcon } from '@heroicons/react/24/outline';
import SecondaryButton from '@/Components/SecondaryButton';
import { useLaravelReactI18n } from 'laravel-react-i18n';

// Near-identical to Components/Race/RoomCode.jsx — kept as its own copy
// rather than a shared import so the Mafia and Race feature areas stay
// independent of each other's internals (same reasoning the rest of the
// Mafia build follows: parallel structure, no cross-feature coupling).
export default function RoomCode({ code, inviteUrl, className = '' }) {
    const { t } = useLaravelReactI18n();
    const [copied, setCopied] = useState(false);

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard API unavailable — the link is still visible/
            // selectable in the UI, so this is non-fatal.
        }
    };

    const share = () => {
        if (navigator.share) {
            navigator.share({ url: inviteUrl }).catch(() => {});
        } else {
            copyLink();
        }
    };

    const canShare = typeof navigator !== 'undefined' && !!navigator.share;

    return (
        <div className={`rounded-xl border border-warm-200 bg-warm-50 p-4 text-center ${className}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                {t('mafia.room_label')}
            </p>
            <p className="mt-1 break-all font-heading text-3xl font-bold tracking-[0.2em] text-primary-700 sm:text-4xl sm:tracking-[0.3em]">
                {code}
            </p>

            <div className="mt-3 flex flex-wrap justify-center gap-2">
                <SecondaryButton type="button" onClick={copyLink}>
                    {copied ? (
                        <CheckIcon className="h-4 w-4 text-success-600" aria-hidden="true" />
                    ) : (
                        <ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />
                    )}
                    {copied ? t('mafia.link_copied') : t('mafia.copy_invite_link')}
                </SecondaryButton>

                {canShare && (
                    <SecondaryButton type="button" onClick={share}>
                        <ShareIcon className="h-4 w-4" aria-hidden="true" />
                        {t('mafia.share')}
                    </SecondaryButton>
                )}
            </div>
        </div>
    );
}
