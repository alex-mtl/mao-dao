import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, Link } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

export default function Preview({ quiz }) {
    const { t } = useLaravelReactI18n();

    return (
        <AuthenticatedLayout>
            <Head title={quiz.title} />

            <div className="py-8">
                <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-6 lg:px-8">
                    <Link
                        href={route('quizzes.edit', quiz.id)}
                        className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-primary-700"
                    >
                        <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
                        {t('quiz_editor.edit_title')}
                    </Link>

                    <div className="rounded-2xl border border-warm-200 bg-surface p-6 shadow-soft sm:p-8">
                        <h1 className="font-heading text-2xl font-bold text-ink-900">
                            {quiz.title}
                        </h1>
                        {quiz.description && (
                            <p className="mt-2 text-ink-600">{quiz.description}</p>
                        )}

                        <div className="mt-6 space-y-6">
                            {quiz.questions.map((question, qIndex) => (
                                <div key={qIndex}>
                                    <p className="flex items-center gap-2 font-heading font-semibold text-ink-900">
                                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-bold text-primary-700">
                                            {qIndex + 1}
                                        </span>
                                        {question.text}
                                    </p>

                                    <ul className="mt-2 space-y-1.5 pl-8">
                                        {question.answers.map((answer, aIndex) => (
                                            <li
                                                key={aIndex}
                                                className={
                                                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ' +
                                                    (answer.is_correct
                                                        ? 'border-success-300 bg-success-50 text-success-800'
                                                        : 'border-warm-200 text-ink-600')
                                                }
                                            >
                                                {answer.is_correct && (
                                                    <CheckCircleIcon className="h-4 w-4 shrink-0 text-success-600" />
                                                )}
                                                {answer.text}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
