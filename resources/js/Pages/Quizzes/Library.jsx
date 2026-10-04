import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import PageHeader from '@/Components/PageHeader';
import TextInput from '@/Components/TextInput';
import PrimaryButton from '@/Components/PrimaryButton';
import QuizCard from '@/Components/QuizCard';
import Pagination from '@/Components/Pagination';
import EmptyState from '@/Components/EmptyState';
import { MagnifyingGlassIcon, BookOpenIcon } from '@heroicons/react/24/outline';
import { Head, router, usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useState } from 'react';

export default function Library({ quizzes, tags, filters }) {
    const { t } = useLaravelReactI18n();
    const localeOptions = usePage().props.locale_options;

    const [search, setSearch] = useState(filters.search ?? '');

    const applyFilters = (overrides = {}) => {
        router.get(
            route('library.index'),
            {
                search,
                tag: filters.tag,
                language: filters.language,
                ...overrides,
            },
            { preserveState: true, replace: true },
        );
    };

    const submitSearch = (e) => {
        e.preventDefault();
        applyFilters({ search });
    };

    return (
        <AuthenticatedLayout header={<PageHeader title={t('library.title')} />}>
            <Head title={t('library.title')} />

            <div className="py-8">
                <div className="mx-auto max-w-6xl space-y-6 px-4 sm:px-6 lg:px-8">
                    <form
                        onSubmit={submitSearch}
                        className="flex flex-wrap gap-2 rounded-xl border border-warm-200 bg-surface p-4 shadow-soft"
                    >
                        <div className="relative flex-1">
                            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                            <TextInput
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={t('library.search_placeholder')}
                                className="w-full pl-9"
                            />
                        </div>

                        <select
                            className="rounded-lg border-warm-300 text-sm text-ink-700 shadow-soft focus:border-primary-500 focus:ring-primary-500"
                            value={filters.tag ?? ''}
                            onChange={(e) => applyFilters({ tag: e.target.value || null })}
                        >
                            <option value="">{t('library.all_tags')}</option>
                            {tags.map((tag) => (
                                <option key={tag.id} value={tag.id}>
                                    {tag.name}
                                </option>
                            ))}
                        </select>

                        <select
                            className="rounded-lg border-warm-300 text-sm text-ink-700 shadow-soft focus:border-primary-500 focus:ring-primary-500"
                            value={filters.language ?? ''}
                            onChange={(e) => applyFilters({ language: e.target.value || null })}
                        >
                            <option value="">{t('library.all_languages')}</option>
                            {localeOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>

                        <PrimaryButton type="submit">{t('friends.search_button')}</PrimaryButton>
                    </form>

                    {quizzes.data.length === 0 ? (
                        <div className="rounded-xl border border-warm-200 bg-surface">
                            <EmptyState icon={BookOpenIcon} title={t('library.no_results')} />
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
