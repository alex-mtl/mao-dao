export default function PageHeader({ title, description, action, className = '' }) {
    return (
        <div className={`flex flex-wrap items-start justify-between gap-4 ${className}`}>
            <div>
                <h1 className="font-heading text-2xl font-bold text-ink-900">{title}</h1>
                {description && (
                    <p className="mt-1 text-sm text-ink-500">{description}</p>
                )}
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
    );
}
