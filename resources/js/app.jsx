import '../css/app.css';

import { createInertiaApp } from '@inertiajs/react';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { LaravelReactI18nProvider, useLaravelReactI18n } from 'laravel-react-i18n';
import ColorSchemeSync from './Components/ColorSchemeSync';

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

// The `@routes` Ziggy config is rendered once, by whichever section served
// the FIRST full page load (/quiz => root ".../quiz", /mafia => bare host —
// see AppServiceProvider::rootUrlFor()). Inertia then navigates client-side
// between the two sections without reloading it, so a quiz route (e.g. the
// profile color-scheme PATCH) called after landing via /mafia resolved to
// "https://host/profile/..." and hit the other app ("Cannot PATCH ...").
// Pin every plain route() call to the section its name belongs to; calls
// that pass their own config (useSectionRoutes) are left untouched.
const ziggyRoute = window.route;
if (typeof ziggyRoute === 'function' && typeof Ziggy !== 'undefined') {
    window.route = (name, params, absolute, config) => {
        if (!name || config) return ziggyRoute(name, params, absolute, config);
        const quizUrl = document.getElementById('app')?.dataset.page
            ? JSON.parse(document.getElementById('app').dataset.page).props.quizUrl
            : null;
        const url = name.startsWith('mafia.') ? window.location.origin : quizUrl;
        return url ? ziggyRoute(name, params, absolute ?? true, { ...Ziggy, url }) : ziggyRoute(name, params, absolute);
    };
}

// Inertia does not remount the app on client-side navigations, so the
// i18n provider's active locale must be re-synced from the page props on
// every visit (e.g. after logging in as a user with a non-English
// ui_language) rather than only once at initial page load.
function LocaleSync({ Component, props, key }) {
    const { setLocale, currentLocale } = useLaravelReactI18n();

    useEffect(() => {
        if (props.locale && props.locale !== currentLocale()) {
            setLocale(props.locale);
        }
    }, [props.locale]);

    return <Component {...props} key={key} />;
}

createInertiaApp({
    title: (title) => `${title} - ${appName}`,
    resolve: (name) =>
        resolvePageComponent(
            `./Pages/${name}.jsx`,
            import.meta.glob('./Pages/**/*.jsx'),
        ),
    setup({ el, App, props }) {
        const root = createRoot(el);
        const locale = props.initialPage.props.locale ?? 'en';

        root.render(
            <LaravelReactI18nProvider
                locale={locale}
                fallbackLocale="en"
                files={import.meta.glob('/lang/*.json')}
            >
                <App {...props}>
                    {(appProps) => (
                        <>
                            <ColorSchemeSync colorScheme={appProps.props.color_scheme} />
                            <LocaleSync {...appProps} />
                        </>
                    )}
                </App>
            </LaravelReactI18nProvider>,
        );
    },
    progress: {
        color: '#4B5563',
    },
});
