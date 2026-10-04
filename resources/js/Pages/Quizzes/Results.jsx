import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, Link } from '@inertiajs/react';
import { useState } from 'react';
import QuizCard from '@/Components/QuizCard';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { formatSeconds } from '@/utils/duration';
import { CheckCircleIcon, XCircleIcon, ClockIcon } from '@heroicons/react/24/solid';
import {
    BookOpenIcon,
    ClockIcon as ClockOutlineIcon,
    ArrowPathIcon,
    ShareIcon,
} from '@heroicons/react/24/outline';

function ScoreRing({ percentage, passed }) {
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;
    const color = passed ? '#059669' : '#DC2626';

    return (
        <div className="relative flex h-32 w-32 shrink-0 items-center justify-center">
            <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r={radius} fill="none" stroke="#F3F0EA" strokeWidth="10" />
                <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    className="transition-all duration-700 ease-out"
                />
            </svg>
            <span className="absolute font-heading text-3xl font-bold text-ink-900">
                {percentage}%
            </span>
        </div>
    );
}

export default function Results({ attempt, similar_quizzes: similarQuizzes = [] }) {
    const { t } = useLaravelReactI18n();
    const seconds = attempt.time_spent_seconds;
    const timeSpent =
        seconds !== null && seconds !== undefined && seconds < 60
            ? t('quiz_player.time_seconds', { count: seconds })
            : formatSeconds(seconds);
    const [copied, setCopied] = useState(false);

    const share = async () => {
        const url = route('quizzes.show', attempt.quiz_id);
        const text = t('quiz_player.share_text', { title: attempt.quiz_title });

        if (navigator.share) {
            try {
                await navigator.share({ title: attempt.quiz_title, text, url });
                return;
            } catch (e) {
                if (e?.name === 'AbortError') return;
            }
        }

        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch (e) {
            window.prompt(text, url);
        }
    };

    return (
        <AuthenticatedLayout>
            <Head title={t('quiz_player.results_title')} />

            <div className="py-8">
                <div className="mx-auto max-w-2xl space-y-4 px-4 sm:px-6 lg:px-8">
                    <div className="rounded-2xl border border-warm-200 bg-surface p-6 shadow-soft sm:p-8">
                        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
                            <ScoreRing percentage={attempt.percentage} passed={attempt.passed} />

                            <div>
                                <p className="text-sm font-medium text-ink-500">
                                    {attempt.quiz_title}
                                </p>
                                <p
                                    className={
                                        'mt-1 font-heading text-xl font-bold ' +
                                        (attempt.passed ? 'text-success-600' : 'text-danger-600')
                                    }
                                >
                                    {attempt.passed
                                        ? t('quiz_player.you_passed')
                                        : t('quiz_player.you_failed')}
                                </p>
                                <p className="mt-1 text-ink-600">
                                    {t('quiz_player.score_summary', {
                                        correct: attempt.correct_count,
                                        total: attempt.total_questions,
                                        percentage: attempt.percentage,
                                    })}
                                </p>
                                {timeSpent && (
                                    <p className="mt-1 inline-flex items-center gap-1 text-sm text-ink-400">
                                        <ClockOutlineIcon className="h-4 w-4" aria-hidden="true" />
                                        {t('quiz_player.time_spent', { time: timeSpent })}
                                    </p>
                                )}
                            </div>
                        </div>

                        <h2 className="mt-8 font-heading text-base font-semibold text-ink-900">
                            {t('quiz_player.review_heading')}
                        </h2>

                        <div className="mt-3 space-y-2">
                            {attempt.answers.map((answer, index) => (
                                <div
                                    key={index}
                                    className={
                                        'flex items-start gap-3 rounded-xl border p-3 ' +
                                        (answer.is_correct
                                            ? 'border-success-200 bg-success-50'
                                            : 'border-danger-200 bg-danger-50')
                                    }
                                >
                                    {answer.is_correct ? (
                                        <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-success-600" />
                                    ) : (
                                        <XCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-danger-600" />
                                    )}
                                    <div>
                                        <p className="font-medium text-ink-900">
                                            {index + 1}. {answer.question_text}
                                        </p>
                                        <p className="text-sm text-ink-600">
                                            {answer.chosen_answer_text
                                                ? t('quiz_player.your_answer', {
                                                      answer: answer.chosen_answer_text,
                                                  })
                                                : t('quiz_player.no_answer')}
                                        </p>
                                        {!answer.is_correct && answer.correct_answer_text && (
                                            <p className="text-sm font-medium text-success-700">
                                                {t('quiz_player.correct_answer', {
                                                    answer: answer.correct_answer_text,
                                                })}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-warm-100 pt-4">
                            <Link
                                href={route('quizzes.play', attempt.quiz_id)}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-primary-700"
                            >
                                <ArrowPathIcon className="h-4 w-4" aria-hidden="true" />
                                {t('quiz_player.try_again')}
                            </Link>
                            <button
                                type="button"
                                onClick={share}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-warm-300 bg-surface px-4 py-2 text-sm font-semibold text-ink-700 shadow-soft hover:bg-warm-50"
                            >
                                <ShareIcon className="h-4 w-4" aria-hidden="true" />
                                {copied ? t('quiz_player.link_copied') : t('quiz_player.share')}
                            </button>
                            <span className="sr-only" role="status" aria-live="polite">
                                {copied ? t('quiz_player.link_copied') : ''}
                            </span>
                            <Link
                                href={route('library.index')}
                                className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-primary-700"
                            >
                                <BookOpenIcon className="h-4 w-4" aria-hidden="true" />
                                {t('quiz_player.back_to_library')}
                            </Link>
                            <Link
                                href={route('quiz-attempts.history')}
                                className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-primary-700"
                            >
                                <ClockIcon className="h-4 w-4" aria-hidden="true" />
                                {t('quiz_player.view_history')}
                            </Link>
                        </div>
                    </div>

                    {similarQuizzes.length > 0 && (
                        <div className="pt-4">
                            <h2 className="font-heading text-base font-semibold text-ink-900">
                                {t('quiz_player.similar_quizzes')}
                            </h2>
                            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                                {similarQuizzes.map((quiz) => (
                                    <QuizCard
                                        key={quiz.id}
                                        quiz={quiz}
                                        href={route('quizzes.show', quiz.id)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
