import { Link } from '@inertiajs/react';
import { QuestionMarkCircleIcon, HeartIcon, ClockIcon } from '@heroicons/react/20/solid';
import Badge from '@/Components/Badge';
import { formatMinutes } from '@/utils/duration';

/**
 * Shared card for any quiz listing (Library, My Quizzes,
 * Dashboard widgets). `quiz.user`/`quiz.tags`/`quiz.likes_count`/
 * `quiz.status` are all optional — pages that don't load them (e.g. "My
 * Quizzes", which is always the current user) simply omit that part of
 * the card. Pass `actions` to replace the default title-link-only footer
 * with page-specific buttons (e.g. Preview + Edit on "My Quizzes").
 */
export default function QuizCard({ quiz, href, actions, statusLabel }) {
    const estimated = formatMinutes(quiz.estimated_minutes);

    return (
        <div className="group flex h-full flex-col rounded-xl border border-warm-200 bg-surface p-5 shadow-soft transition duration-150 hover:-translate-y-0.5 hover:shadow-elevated">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {quiz.language && (
                    <Badge color="primary">{quiz.language.toUpperCase()}</Badge>
                )}
                {statusLabel && (
                    <Badge color={quiz.status === 'published' ? 'success' : 'neutral'}>
                        {statusLabel}
                    </Badge>
                )}
            </div>

            <Link
                href={href}
                className="font-heading text-base font-semibold leading-snug text-ink-900 hover:text-primary-700"
            >
                {quiz.title}
            </Link>

            {quiz.description && (
                <p className="mt-1 line-clamp-2 text-sm text-ink-500">{quiz.description}</p>
            )}

            {quiz.tags?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {quiz.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag.id}>{tag.name}</Badge>
                    ))}
                    {quiz.tags.length > 3 && (
                        <Badge>+{quiz.tags.length - 3}</Badge>
                    )}
                </div>
            )}

            <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-4 text-xs text-ink-400">
                {quiz.user && <span className="text-ink-600">{quiz.user.name}</span>}
                {typeof quiz.questions_count === 'number' && (
                    <span className="inline-flex items-center gap-1">
                        <QuestionMarkCircleIcon className="h-4 w-4" aria-hidden="true" />
                        {quiz.questions_count}
                    </span>
                )}
                {typeof quiz.likes_count === 'number' && (
                    <span className="inline-flex items-center gap-1">
                        <HeartIcon className="h-4 w-4" aria-hidden="true" />
                        {quiz.likes_count}
                    </span>
                )}
                {estimated && (
                    <span className="inline-flex items-center gap-1">
                        <ClockIcon className="h-4 w-4" aria-hidden="true" />
                        {estimated}
                    </span>
                )}
            </div>

            {actions && (
                <div className="mt-4 flex gap-2 border-t border-warm-100 pt-4">
                    {actions}
                </div>
            )}
        </div>
    );
}
