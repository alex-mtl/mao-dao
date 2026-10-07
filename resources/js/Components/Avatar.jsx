const sizes = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-16 w-16 text-lg',
    xl: 'h-24 w-24 text-2xl',
};

export function initials(name) {
    if (!name) {
        return '?';
    }

    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';

    return (first + last).toUpperCase();
}

export default function Avatar({ name, src, size = 'md', className = '' }) {
    const sizeClasses = sizes[size] ?? sizes.md;

    if (src) {
        return (
            <img
                src={src}
                alt={name ?? ''}
                className={`shrink-0 rounded-full object-cover ring-2 ring-surface ${sizeClasses} ${className}`}
            />
        );
    }

    return (
        <span
            className={`inline-flex shrink-0 items-center justify-center rounded-full bg-primary-100 font-heading font-semibold text-primary-700 ring-2 ring-surface ${sizeClasses} ${className}`}
            aria-hidden="true"
        >
            {initials(name)}
        </span>
    );
}
