import Spinner from '@/Components/Spinner';

export default function PrimaryButton({
    type,
    className = '',
    disabled,
    loading = false,
    children,
    ...props
}) {
    return (
        <button
            {...props}
            type={type}
            disabled={disabled || loading}
            className={
                'inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition duration-150 ease-in-out hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 active:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50 ' +
                className
            }
        >
            {loading && <Spinner />}
            {children}
        </button>
    );
}
