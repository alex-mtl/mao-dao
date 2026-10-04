import { useLaravelReactI18n } from 'laravel-react-i18n';
import TelegramLoginButton from '@/Components/TelegramLoginButton';

export default function SocialLoginButtons() {
    const { t } = useLaravelReactI18n();

    return (
        <div className="mt-6">
            <div className="flex items-center">
                <div className="h-px flex-1 bg-warm-200" />
                <span className="px-3 text-xs text-ink-500">
                    {t('auth_ui.or_continue_with')}
                </span>
                <div className="h-px flex-1 bg-warm-200" />
            </div>

            <div className="mt-4 flex flex-col gap-3">
                <a
                    href={route('social.redirect', 'google')}
                    className="flex items-center justify-center rounded-lg border border-warm-300 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-warm-50"
                >
                    {t('auth_ui.continue_with_google')}
                </a>

                <a
                    href={route('social.redirect', 'facebook')}
                    className="flex items-center justify-center rounded-lg border border-warm-300 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-warm-50"
                >
                    {t('auth_ui.continue_with_facebook')}
                </a>

                <TelegramLoginButton />
            </div>
        </div>
    );
}
