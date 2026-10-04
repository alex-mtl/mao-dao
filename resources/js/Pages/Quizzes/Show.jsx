import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import SecondaryButton from '@/Components/SecondaryButton';
import PrimaryButton from '@/Components/PrimaryButton';
import Badge from '@/Components/Badge';
import { Head, Link, router } from '@inertiajs/react';
import { useState } from 'react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { formatMinutes } from '@/utils/duration';
import {
    ArrowLeftIcon,
    QuestionMarkCircleIcon,
    ClockIcon,
    DocumentDuplicateIcon,
    PencilSquareIcon,
    PlayIcon,
    UserGroupIcon,
} from '@heroicons/react/24/outline';
import { HeartIcon } from '@heroicons/react/24/solid';
import { HeartIcon as HeartOutlineIcon } from '@heroicons/react/24/outline';

function Stat({ icon: Icon, children }) {
    return (
        <span className="inline-flex items-center gap-1.5 text-sm text-ink-500">
            <Icon className="h-4 w-4" aria-hidden="true" />
            {children}
        </span>
    );
}

export default function Show({ quiz }) {
    const { t } = useLaravelReactI18n();

    const toggleLike = () => {
        if (quiz.liked_by_user) {
            router.delete(route('quizzes.unlike', quiz.id), { preserveScroll: true });
        } else {
            router.post(route('quizzes.like', quiz.id), {}, { preserveScroll: true });
        }
    };

    const copyQuiz = () => {
        router.post(route('quizzes.copy', quiz.id));
    };

    const [startingRace, setStartingRace] = useState(false);
    const startRace = () => {
        setStartingRace(true);
        router.post(route('race.store', quiz.id), {}, { onFinish: () => setStartingRace(false) });
    };

    const estimated = formatMinutes(quiz.estimated_minutes);
    const averageTime = formatMinutes(quiz.average_time_spent_minutes);

    return (
        <AuthenticatedLayout>
            <Head title={quiz.title} />

            <div className="py-8">
                <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-6 lg:px-8">
                    <Link
                        href={route('library.index')}
                        className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-primary-700"
                    >
                        <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
                        {t('library.back_to_library')}
                    </Link>

                    <div className="rounded-2xl border border-warm-200 bg-surface p-6 shadow-soft sm:p-8">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge color="primary">{quiz.language.toUpperCase()}</Badge>
                            {quiz.tags.map((tag) => (
                                <Badge key={tag.id}>{tag.name}</Badge>
                            ))}
                        </div>

                        <h1 className="mt-3 font-heading text-2xl font-bold text-ink-900">
                            {quiz.title}
                        </h1>

                        {quiz.description && (
                            <p className="mt-2 text-ink-600">{quiz.description}</p>
                        )}

                        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-warm-100 pt-4">
                            <span className="text-sm text-ink-500">
                                {t('library.created_by', { name: quiz.owner.name })}
                            </span>
                            <Stat icon={QuestionMarkCircleIcon}>
                                {t('library.questions_count', { count: quiz.questions_count })}
                            </Stat>
                            <button
                                type="button"
                                onClick={toggleLike}
                                className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-secondary-600"
                            >
                                {quiz.liked_by_user ? (
                                    <HeartIcon className="h-4 w-4 text-secondary-500" aria-hidden="true" />
                                ) : (
                                    <HeartOutlineIcon className="h-4 w-4" aria-hidden="true" />
                                )}
                                {t('library.likes_count', { count: quiz.likes_count })}
                            </button>
                            {estimated && <Stat icon={ClockIcon}>{estimated}</Stat>}
                        </div>

                        {quiz.attempts_count > 0 && (
                            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-warm-100 px-3 py-2 text-sm text-ink-600">
                                <span>{t('library.average_score', { percentage: quiz.average_percentage })}</span>
                                {averageTime && (
                                    <span>{t('library.average_time', { time: averageTime })}</span>
                                )}
                                <span className="text-ink-400">
                                    {t('library.attempts_count', { count: quiz.attempts_count })}
                                </span>
                            </div>
                        )}

                        <div className="mt-6 flex flex-wrap gap-2">
                            <Link href={route('quizzes.play', quiz.id)}>
                                <PrimaryButton>
                                    <PlayIcon className="h-4 w-4" aria-hidden="true" />
                                    {t('quiz_player.start_quiz')}
                                </PrimaryButton>
                            </Link>

                            {quiz.status === 'published' && (
                                <SecondaryButton onClick={startRace} loading={startingRace} disabled={startingRace}>
                                    <UserGroupIcon className="h-4 w-4" aria-hidden="true" />
                                    {t('race.start_a_race')}
                                </SecondaryButton>
                            )}

                            {quiz.can_copy && (
                                <SecondaryButton onClick={copyQuiz}>
                                    <DocumentDuplicateIcon className="h-4 w-4" aria-hidden="true" />
                                    {t('library.copy_quiz')}
                                </SecondaryButton>
                            )}

                            {quiz.is_owner && (
                                <Link href={route('quizzes.edit', quiz.id)}>
                                    <SecondaryButton>
                                        <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
                                        {t('quiz_editor.edit_title')}
                                    </SecondaryButton>
                                </Link>
                            )}
                        </div>

                        {quiz.can_copy && !quiz.is_owner && (
                            <p className="mt-2 text-xs text-ink-400">
                                {t('library.copy_explanation')}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
