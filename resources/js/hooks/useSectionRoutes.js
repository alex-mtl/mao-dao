/**
 * The platform's sections (/quiz, /mafia, ...) all live under one host and
 * one router, so a plain Ziggy `route()` is correct everywhere. These two
 * helpers remain only so the many call sites that name the section they link
 * into keep reading well; they do nothing special.
 */
export default function useSectionRoutes() {
    const quizRoute = (name, params) => route(name, params);
    const mafiaRoute = (name, params) => route(name, params);

    return { quizRoute, mafiaRoute };
}
