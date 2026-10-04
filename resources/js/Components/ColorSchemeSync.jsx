import { useEffect } from 'react';

// Inertia does not remount the app on client-side navigations, so the
// active theme must be re-applied to <html data-theme> from the page props
// on every visit (e.g. after logging in as a user with a different
// color_scheme) rather than only once at initial page load — the same
// staleness issue LocaleSync exists to solve for the locale.
export default function ColorSchemeSync({ colorScheme }) {
    useEffect(() => {
        if (colorScheme && document.documentElement.dataset.theme !== colorScheme) {
            document.documentElement.dataset.theme = colorScheme;
        }
    }, [colorScheme]);

    return null;
}
