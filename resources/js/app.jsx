import '../css/app.css';

import { createInertiaApp } from '@inertiajs/react';
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers';
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { LaravelReactI18nProvider, useLaravelReactI18n } from 'laravel-react-i18n';
import ColorSchemeSync from './Components/ColorSchemeSync';

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

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
