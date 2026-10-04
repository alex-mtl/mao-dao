import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import PageHeader from '@/Components/PageHeader';
import Badge from '@/Components/Badge';
import Pagination from '@/Components/Pagination';
import EmptyState from '@/Components/EmptyState';
import { Head, Link } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { formatSeconds } from '@/utils/duration';
import { ClockIcon } from '@heroicons/react/24/outline';

export default function History({ attempts }) {
    const { t } = useLaravelReactI18n();

    return (
        <AuthenticatedLayout header={<PageHeader title={t('quiz_player.history_title')} />}>
            <Head title={t('quiz_player.history_title')} />

            <div className="py-8">
                <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-6 lg:px-8">
                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft">
                        {attempts.data.length === 0 ? (
                            <EmptyState icon={ClockIcon} title={t('quiz_player.no_attempts')} />
                        ) : (
                            <ul className="divide-y divide-warm-100">
                                {attempts.data.map((attempt) => (
                                    <li
                                        key={attempt.id}
                                        className="flex items-center justify-between gap-3 py-3"
                                    >
                                        <div>
                                            <div className="font-medium text-ink-900">
                                                {attempt.quiz.title}
                                            </div>
                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
                                                <span>
                                                    {t('quiz_player.score_summary', {
                                                        correct: attempt.correct_count,
                                                        total: attempt.total_questions,
                                                        percentage: attempt.percentage,
                                                    })}
                                                </span>
                                                <Badge color={attempt.passed ? 'success' : 'danger'}>
                                                    {attempt.passed
                                                        ? t('quiz_player.you_passed')
                                                        : t('quiz_player.you_failed')}
                                                </Badge>
                                                {formatSeconds(attempt.time_spent_seconds) && (
                                                    <span className="text-ink-400">
                                                        {t('quiz_player.time_spent', {
                                                            time: formatSeconds(
                                                                attempt.time_spent_seconds,
                                                            ),
                                                        })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <Link href={route('quiz-attempts.show', attempt.id)}>
                                            <span className="inline-flex items-center rounded-lg border border-warm-300 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-warm-50">
                                                {t('quiz_player.view_results')}
                                            </span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <Pagination links={attempts.links} />
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
