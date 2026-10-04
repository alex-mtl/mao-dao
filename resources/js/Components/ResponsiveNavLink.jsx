import { Link } from '@inertiajs/react';

/**
 * A single navigation item inside the drawer (NavigationDrawer.jsx).
 * Active state is signalled by background + text color + font weight +
 * icon color together, not color alone.
 */
export default function ResponsiveNavLink({
    active = false,
    icon: Icon,
    className = '',
    children,
    ...props
}) {
    return (
        <Link
            {...props}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition duration-150 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                active
                    ? 'bg-primary-50 font-semibold text-primary-700'
                    : 'font-medium text-ink-600 hover:bg-warm-100 hover:text-ink-900'
            } ${className}`}
        >
            {Icon && (
                <Icon
                    className={`h-5 w-5 shrink-0 ${active ? 'text-primary-600' : 'text-ink-400'}`}
                    aria-hidden="true"
                />
            )}
            {children}
        </Link>
    );
}
