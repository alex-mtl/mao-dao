import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import PageHeader from '@/Components/PageHeader';
import QuizCard from '@/Components/QuizCard';
import Pagination from '@/Components/Pagination';
import EmptyState from '@/Components/EmptyState';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { Head } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

export default function Explorer({ quizzes }) {
    const { t } = useLaravelReactI18n();

    return (
        <AuthenticatedLayout
            header={<PageHeader title={t('explorer.title')} description={t('explorer.subtitle')} />}
        >
            <Head title={t('explorer.title')} />

            <div className="py-8">
                <div className="mx-auto max-w-6xl space-y-6 px-4 sm:px-6 lg:px-8">
                    {quizzes.data.length === 0 ? (
                        <div className="rounded-xl border border-warm-200 bg-surface">
                            <EmptyState
                                icon={SparklesIcon}
                                title={t('explorer.no_results')}
                            />
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {quizzes.data.map((quiz) => (
                                <QuizCard
                                    key={quiz.id}
                                    quiz={quiz}
                                    href={route('quizzes.show', quiz.id)}
                                />
                            ))}
                        </div>
                    )}

                    <Pagination links={quizzes.links} />
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
