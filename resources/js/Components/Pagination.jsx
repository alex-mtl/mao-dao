import { router } from '@inertiajs/react';

/**
 * Renders Laravel's default paginator `links` array
 * ({ url, label, active }[]) — used by any page passing an Inertia
 * paginated resource (quizzes.links, attempts.links, etc.).
 */
export default function Pagination({ links, className = '' }) {
    if (!links || links.length <= 3) {
        return null;
    }

    return (
        <div className={`flex flex-wrap justify-center gap-1.5 ${className}`}>
            {links.map((link, index) => (
                <button
                    key={index}
                    type="button"
                    disabled={!link.url}
                    onClick={() => link.url && router.visit(link.url, { preserveState: true })}
                    className={
                        'min-w-[2.25rem] rounded-lg border px-3 py-1.5 text-sm font-medium transition ' +
                        (link.active
                            ? 'border-primary-600 bg-primary-600 text-white'
                            : 'border-warm-300 bg-surface text-ink-600 hover:bg-warm-50 disabled:cursor-not-allowed disabled:opacity-40')
                    }
                    dangerouslySetInnerHTML={{ __html: link.label }}
                />
            ))}
        </div>
    );
}
