export default function EmptyState({ icon: Icon, title, description, action, className = '' }) {
    return (
        <div className={`flex flex-col items-center justify-center px-6 py-12 text-center ${className}`}>
            {Icon && (
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-50">
                    <Icon className="h-6 w-6 text-primary-500" aria-hidden="true" />
                </div>
            )}
            <p className="font-heading text-base font-semibold text-ink-800">{title}</p>
            {description && (
                <p className="mt-1 max-w-sm text-sm text-ink-500">{description}</p>
            )}
            {action && <div className="mt-4">{action}</div>}
        </div>
    );
}
