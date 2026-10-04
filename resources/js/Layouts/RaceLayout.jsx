import ApplicationLogo from '@/Components/ApplicationLogo';
import { Link } from '@inertiajs/react';

/**
 * Minimal, focused chrome for every Race Mode page (join/lobby/play/
 * results) — reachable by anonymous guests as well as authenticated
 * users, so it deliberately doesn't use AuthenticatedLayout's nav/avatar
 * dropdown. Mobile-first: most Race players join from a phone via a
 * shared link.
 */
export default function RaceLayout({ children }) {
    return (
        <div className="flex min-h-screen flex-col items-center bg-warm-100 px-4 py-8 sm:justify-center">
            <Link href={route('welcome')} className="flex items-center gap-2">
                <ApplicationLogo className="h-10 w-10 fill-current text-primary-600" />
                <span className="font-heading text-lg font-bold text-ink-900">Quiz Platform</span>
            </Link>

            <div className="mt-6 w-full max-w-md rounded-2xl border border-warm-200 bg-surface p-6 shadow-elevated sm:p-8">
                {children}
            </div>
        </div>
    );
}
