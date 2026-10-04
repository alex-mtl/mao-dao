import ApplicationLogo from '@/Components/ApplicationLogo';
import { Link } from '@inertiajs/react';

export default function GuestLayout({ children }) {
    return (
        <div className="flex min-h-screen flex-col items-center bg-warm-100 pt-6 sm:justify-center sm:pt-0">
            <div>
                <Link href={route('welcome')} className="flex items-center gap-2">
                    <ApplicationLogo className="h-14 w-14 fill-current text-primary-600" />
                    <span className="font-heading text-xl font-bold text-ink-900">
                        Quiz Platform
                    </span>
                </Link>
            </div>

            <div className="mt-6 w-full overflow-hidden rounded-xl bg-surface px-6 py-6 shadow-elevated sm:max-w-md">
                {children}
            </div>
        </div>
    );
}
