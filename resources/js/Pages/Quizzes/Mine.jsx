import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import PageHeader from '@/Components/PageHeader';
import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import QuizCard from '@/Components/QuizCard';
import EmptyState from '@/Components/EmptyState';
import { Squares2X2Icon, PlusCircleIcon } from '@heroicons/react/24/outline';
import { Head, Link, router } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

export default function Mine({ quizzes }) {
    const { t } = useLaravelReactI18n();

    return (
        <AuthenticatedLayout
            header={
                <PageHeader
                    title={t('quizzes_mine.title')}
                    action={
                        <Link href={route('quizzes.create')}>
                            <PrimaryButton>
                                <PlusCircleIcon className="h-4 w-4" aria-hidden="true" />
                                {t('quizzes_mine.create_button')}
                            </PrimaryButton>
                        </Link>
                    }
                />
            }
        >
            <Head title={t('quizzes_mine.title')} />

            <div className="py-8">
                <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
                    {quizzes.length === 0 ? (
                        <div className="rounded-xl border border-warm-200 bg-surface">
                            <EmptyState
                                icon={Squares2X2Icon}
                                title={t('quizzes_mine.no_quizzes')}
                                action={
                                    <Link href={route('quizzes.create')}>
                                        <PrimaryButton>
                                            {t('quizzes_mine.create_button')}
                                        </PrimaryButton>
                                    </Link>
                                }
                            />
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {quizzes.map((quiz) => (
                                <QuizCard
                                    key={quiz.id}
                                    quiz={quiz}
                                    href={route('quizzes.edit', quiz.id)}
                                    statusLabel={t(
                                        quiz.status === 'published'
                                            ? 'quiz_editor.status_published'
                                            : 'quiz_editor.status_draft',
                                    )}
                                    actions={
                                        <>
                                            <SecondaryButton
                                                className="flex-1 !px-2 !py-1.5 text-xs"
                                                onClick={() =>
                                                    router.visit(route('quizzes.preview', quiz.id))
                                                }
                                            >
                                                {t('quizzes_mine.preview')}
                                            </SecondaryButton>
                                            <SecondaryButton
                                                className="flex-1 !px-2 !py-1.5 text-xs"
                                                onClick={() =>
                                                    router.visit(route('quizzes.edit', quiz.id))
                                                }
                                            >
                                                {t('quizzes_mine.edit')}
                                            </SecondaryButton>
                                        </>
                                    }
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
