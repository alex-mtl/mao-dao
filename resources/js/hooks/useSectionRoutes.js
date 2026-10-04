import { usePage } from '@inertiajs/react';

/**
 * This app is mounted at two sibling URL prefixes from one codebase —
 * /quiz (routes defined bare) and /mafia (routes defined with a literal
 * "mafia/" prefix) — see AppServiceProvider::rootUrlFor(). That method
 * forces a single Ziggy/route() root for the whole request, based on
 * whichever prefix served it, so a route() call from a /mafia page to a
 * /quiz-domain route (or vice versa) always comes out wrong: there is no
 * single root that's correct for both. The shared nav
 * (AuthenticatedLayout/NavigationDrawer) renders on every page in both
 * sections and links into both, so it hits this directly.
 *
 * These wrap Ziggy's per-call config override (its 4th `route()` arg) to
 * pin a link to the section it actually belongs to, regardless of which
 * section's page is currently rendering it.
 */
export default function useSectionRoutes() {
    const { quizUrl } = usePage().props;

    // NOT `window.Ziggy` — the `@routes` Blade directive declares
    // `const Ziggy = {...}` in a classic (non-module) inline script.
    // Top-level `const`/`let` never becomes a property of `window`, only
    // a global-scope identifier — reachable as bare `Ziggy` (same as
    // Ziggy's own Router.js internals do: `typeof Ziggy !== 'undefined'
    // ? Ziggy : ...`), but `window.Ziggy` is always undefined. Spreading
    // that undefined silently dropped `.routes`, so every route() call
    // through these throw "Cannot read properties of undefined (reading
    // '<name>')" — caught via a real "/quiz/dashboard" console error.
    const quizRoute = (name, params) => route(name, params, true, { ...Ziggy, url: quizUrl });

    // Mafia's own routes carry their prefix in the route URI itself, so
    // they need a bare scheme+host root with no path — window.location.origin
    // always gives exactly that for the current domain.
    const mafiaRoute = (name, params) => route(name, params, true, { ...Ziggy, url: window.location.origin });

    return { quizRoute, mafiaRoute };
}
