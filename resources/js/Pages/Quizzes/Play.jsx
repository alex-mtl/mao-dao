import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import { Head, Link, router } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useState } from 'react';
import { formatMinutes } from '@/utils/duration';
import { XMarkIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

const letters = ['A', 'B', 'C', 'D'];

export default function Play({ quiz }) {
    const { t } = useLaravelReactI18n();
    const [selections, setSelections] = useState({});
    const [currentIndex, setCurrentIndex] = useState(0);
    const [submitting, setSubmitting] = useState(false);

    const total = quiz.questions.length;
    const question = quiz.questions[currentIndex];
    const selectedAnswerId = selections[question.id];
    const isLast = currentIndex === total - 1;
    const progress = ((currentIndex + 1) / total) * 100;

    const selectAnswer = (answerId) => {
        setSelections((current) => ({ ...current, [question.id]: answerId }));
    };

    const goBack = () => {
        setCurrentIndex((i) => Math.max(0, i - 1));
    };

    const submit = (finalSelections) => {
        setSubmitting(true);

        router.post(
            route('quiz-attempts.store', quiz.id),
            {
                answers: Object.entries(finalSelections).map(([questionId, answerId]) => ({
                    question_id: Number(questionId),
                    answer_id: answerId,
                })),
            },
            { onFinish: () => setSubmitting(false) },
        );
    };

    const goNext = () => {
        if (isLast) {
            submit(selections);
        } else {
            setCurrentIndex((i) => Math.min(total - 1, i + 1));
        }
    };

    return (
        <AuthenticatedLayout>
            <Head title={quiz.title} />

            <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-2xl flex-col px-4 py-6 sm:px-6">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-warm-200">
                            <div
                                className="h-full rounded-full bg-primary-600 transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <p className="mt-2 text-sm font-medium text-ink-500">
                            {t('quiz_player.question_progress', {
                                current: currentIndex + 1,
                                total,
                            })}
                            {formatMinutes(quiz.estimated_minutes) && (
                                <span className="text-ink-400">
                                    {' · '}
                                    {t('quiz_player.estimated_time', {
                                        time: formatMinutes(quiz.estimated_minutes),
                                    })}
                                </span>
                            )}
                        </p>
                    </div>

                    <Link
                        href={route('quizzes.show', quiz.id)}
                        aria-label={t('quiz_player.exit_quiz')}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-400 hover:bg-warm-200 hover:text-ink-700"
                    >
                        <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                    </Link>
                </div>

                <div className="mt-8 flex flex-1 flex-col" key={question.id}>
                    <h1 className="animate-in font-heading text-xl font-bold leading-snug text-ink-900 sm:text-2xl">
                        {question.text}
                    </h1>

                    <div className="animate-in mt-6 space-y-3">
                        {question.answers.map((answer, index) => {
                            const selected = selectedAnswerId === answer.id;

                            return (
                                <button
                                    key={answer.id}
                                    type="button"
                                    onClick={() => selectAnswer(answer.id)}
                                    className={
                                        'flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition duration-150 ' +
                                        (selected
                                            ? 'border-primary-600 bg-primary-50'
                                            : 'border-warm-200 bg-surface hover:border-primary-300 hover:bg-warm-50')
                                    }
                                >
                                    <span
                                        className={
                                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ' +
                                            (selected
                                                ? 'bg-primary-600 text-white'
                                                : 'bg-warm-200 text-ink-600')
                                        }
                                    >
                                        {letters[index]}
                                    </span>
                                    <span className="flex-1 font-medium text-ink-900">
                                        {answer.text}
                                    </span>
                                    {selected && (
                                        <CheckCircleIcon className="h-5 w-5 shrink-0 text-primary-600" />
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-3 pt-8">
                        <SecondaryButton
                            variant="ghost"
                            onClick={goBack}
                            disabled={currentIndex === 0}
                            className={currentIndex === 0 ? 'invisible' : ''}
                        >
                            <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
                            {t('quiz_player.back')}
                        </SecondaryButton>

                        <PrimaryButton
                            onClick={goNext}
                            disabled={selectedAnswerId === undefined}
                            loading={submitting}
                            className="min-w-[7rem]"
                        >
                            {isLast ? t('quiz_player.finish') : t('quiz_player.next')}
                        </PrimaryButton>
                    </div>
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
