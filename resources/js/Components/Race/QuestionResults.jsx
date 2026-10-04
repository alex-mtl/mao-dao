import Leaderboard from '@/Components/Race/Leaderboard';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid';
import { useLaravelReactI18n } from 'laravel-react-i18n';

export default function QuestionResults({ hasAnswered, wasCorrect, leaderboard, className = '' }) {
    const { t } = useLaravelReactI18n();

    return (
        <div className={className}>
            <div className="flex flex-col items-center text-center" aria-live="polite">
                {hasAnswered ? (
                    wasCorrect ? (
                        <>
                            <CheckCircleIcon className="h-12 w-12 text-success-500" aria-hidden="true" />
                            <p className="mt-2 font-heading text-xl font-bold text-success-600">
                                {t('race.correct')}
                            </p>
                        </>
                    ) : (
                        <>
                            <XCircleIcon className="h-12 w-12 text-danger-500" aria-hidden="true" />
                            <p className="mt-2 font-heading text-xl font-bold text-danger-600">
                                {t('race.incorrect')}
                            </p>
                        </>
                    )
                ) : (
                    <p className="font-heading text-xl font-bold text-ink-500">{t('race.no_answer')}</p>
                )}
            </div>

            <p className="mt-6 text-sm font-semibold text-ink-700">{t('race.leaderboard_heading')}</p>
            <Leaderboard players={leaderboard} className="mt-2" />
        </div>
    );
}
