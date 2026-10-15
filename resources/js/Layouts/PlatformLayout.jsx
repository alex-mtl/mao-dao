import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import SpectatorLayout from '@/Layouts/SpectatorLayout';
import { usePage } from '@inertiajs/react';

/**
 * The frame for every page that is open to visitors: the full signed-in
 * chrome (menu, notifications, profile) for members, and the slim bar with
 * "Log in" / "Register" for guests. Pages never need to know which one.
 */
export default function PlatformLayout(props) {
    const authUser = usePage().props.auth.user;

    return authUser ? (
        <AuthenticatedLayout {...props} />
    ) : (
        <SpectatorLayout loginLabelKey="auth_ui.log_in" showRegister {...props} />
    );
}
