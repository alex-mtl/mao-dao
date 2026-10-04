import Spinner from '@/Components/Spinner';

const variants = {
    outline: 'border border-warm-300 bg-surface text-ink-700 shadow-soft hover:bg-warm-50 focus:ring-primary-500',
    ghost: 'border border-transparent bg-transparent text-ink-600 hover:bg-warm-200 focus:ring-primary-500',
};

export default function SecondaryButton({
    type = 'button',
    className = '',
    disabled,
    loading = false,
    variant = 'outline',
    children,
    ...props
}) {
    return (
        <button
            {...props}
            type={type}
            disabled={disabled || loading}
            className={
                `inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ` +
                className
            }
        >
            {loading && <Spinner />}
            {children}
        </button>
    );
}
