const colors = {
    neutral: 'bg-warm-200 text-ink-700',
    primary: 'bg-primary-100 text-primary-700',
    secondary: 'bg-secondary-100 text-secondary-700',
    accent: 'bg-accent-100 text-accent-800',
    success: 'bg-success-100 text-success-700',
    warning: 'bg-warning-100 text-warning-800',
    danger: 'bg-danger-100 text-danger-700',
};

export default function Badge({ children, color = 'neutral', className = '', ...props }) {
    return (
        <span
            {...props}
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${colors[color] ?? colors.neutral} ${className}`}
        >
            {children}
        </span>
    );
}
