import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import PageHeader from '@/Components/PageHeader';
import Badge from '@/Components/Badge';
import { Head, Link } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import {
    SparklesIcon,
    ClockIcon,
    Squares2X2Icon,
    HeartIcon,
    UserPlusIcon,
    UserGroupIcon,
} from '@heroicons/react/24/outline';

function DashboardCard({ icon: Icon, title, viewAllHref, viewAllLabel, children, isEmpty, emptyMessage }) {
    return (
        <div className="flex flex-col rounded-xl border border-warm-200 bg-surface p-5 shadow-soft">
            <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-heading text-base font-semibold text-ink-900">
                    <Icon className="h-5 w-5 text-primary-500" aria-hidden="true" />
                    {title}
                </h3>
                {viewAllHref && !isEmpty && (
                    <Link
                        href={viewAllHref}
                        className="text-sm font-medium text-primary-600 hover:text-primary-700"
                    >
                        {viewAllLabel}
                    </Link>
                )}
            </div>

            {isEmpty ? (
                <p className="mt-3 text-sm text-ink-400">{emptyMessage}</p>
            ) : (
                <ul className="mt-2 divide-y divide-warm-100">{children}</ul>
            )}
        </div>
    );
}

export default function Dashboard({
    recommendedQuizzes,
    recentAttempts,
    myQuizzes,
    likedQuizzes,
    pendingFriendRequests,
    groups,
}) {
    const { t } = useLaravelReactI18n();

    return (
        <AuthenticatedLayout header={<PageHeader title={t('nav.dashboard')} />}>
            <Head title={t('nav.dashboard')} />

            <div className="py-8">
                <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 sm:px-6 md:grid-cols-2 lg:px-8">
                    <DashboardCard
                        icon={SparklesIcon}
                        title={t('dashboard.recommended_quizzes')}
                        viewAllHref={route('explorer.index')}
                        viewAllLabel={t('dashboard.view_all')}
                        isEmpty={recommendedQuizzes.length === 0}
                        emptyMessage={t('dashboard.empty_recommended')}
                    >
                        {recommendedQuizzes.map((quiz) => (
                            <li key={quiz.id} className="py-2.5">
                                <Link
                                    href={route('quizzes.show', quiz.id)}
                                    className="font-medium text-ink-800 hover:text-primary-700"
                                >
                                    {quiz.title}
                                </Link>
                                <div className="text-sm text-ink-500">
                                    {t('dashboard.by_author', { name: quiz.user.name })}
                                </div>
                            </li>
                        ))}
                    </DashboardCard>

                    <DashboardCard
                        icon={ClockIcon}
                        title={t('dashboard.recent_activity')}
                        viewAllHref={route('quiz-attempts.history')}
                        viewAllLabel={t('dashboard.view_all')}
                        isEmpty={recentAttempts.length === 0}
                        emptyMessage={t('dashboard.empty_recent')}
                    >
                        {recentAttempts.map((attempt) => (
                            <li key={attempt.id} className="flex items-center justify-between py-2.5">
                                <Link
                                    href={route('quiz-attempts.show', attempt.id)}
                                    className="font-medium text-ink-800 hover:text-primary-700"
                                >
                                    {attempt.quiz.title}
                                </Link>
                                <Badge color={attempt.passed ? 'success' : 'neutral'}>
                                    {attempt.correct_count}/{attempt.total_questions} · {attempt.percentage}%
                                </Badge>
                            </li>
                        ))}
                    </DashboardCard>

                    <DashboardCard
                        icon={Squares2X2Icon}
                        title={t('dashboard.my_quizzes_heading')}
                        viewAllHref={route('quizzes.mine')}
                        viewAllLabel={t('dashboard.view_all')}
                        isEmpty={myQuizzes.length === 0}
                        emptyMessage={t('dashboard.empty_my_quizzes')}
                    >
                        {myQuizzes.map((quiz) => (
                            <li key={quiz.id} className="flex items-center justify-between py-2.5">
                                <Link
                                    href={route('quizzes.edit', quiz.id)}
                                    className="font-medium text-ink-800 hover:text-primary-700"
                                >
                                    {quiz.title}
                                </Link>
                                <Badge color={quiz.status === 'published' ? 'success' : 'neutral'}>
                                    {t(
                                        quiz.status === 'published'
                                            ? 'quiz_editor.status_published'
                                            : 'quiz_editor.status_draft',
                                    )}
                                </Badge>
                            </li>
                        ))}
                    </DashboardCard>

                    <DashboardCard
                        icon={HeartIcon}
                        title={t('dashboard.liked_quizzes_heading')}
                        isEmpty={likedQuizzes.length === 0}
                        emptyMessage={t('dashboard.empty_liked')}
                    >
                        {likedQuizzes.map((quiz) => (
                            <li key={quiz.id} className="py-2.5">
                                <Link
                                    href={route('quizzes.show', quiz.id)}
                                    className="font-medium text-ink-800 hover:text-primary-700"
                                >
                                    {quiz.title}
                                </Link>
                            </li>
                        ))}
                    </DashboardCard>

                    <DashboardCard
                        icon={UserPlusIcon}
                        title={t('dashboard.pending_requests_heading')}
                        viewAllHref={route('friends.index')}
                        viewAllLabel={t('dashboard.view_all')}
                        isEmpty={pendingFriendRequests.length === 0}
                        emptyMessage={t('dashboard.empty_requests')}
                    >
                        {pendingFriendRequests.map((request) => (
                            <li key={request.id} className="py-2.5 font-medium text-ink-800">
                                {request.sender.name}
                            </li>
                        ))}
                    </DashboardCard>

                    <DashboardCard
                        icon={UserGroupIcon}
                        title={t('dashboard.groups_heading')}
                        viewAllHref={route('groups.index')}
                        viewAllLabel={t('dashboard.view_all')}
                        isEmpty={groups.length === 0}
                        emptyMessage={t('dashboard.empty_groups')}
                    >
                        {groups.map((group) => (
                            <li key={group.id} className="py-2.5">
                                <Link
                                    href={route('groups.show', group.id)}
                                    className="font-medium text-ink-800 hover:text-primary-700"
                                >
                                    {group.name}
                                </Link>
                            </li>
                        ))}
                    </DashboardCard>
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
