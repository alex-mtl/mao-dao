import ApplicationLogo from '@/Components/ApplicationLogo';
import { Link, usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import useSectionRoutes from '@/hooks/useSectionRoutes';

/**
 * True on any /mafia/* page. The site hosts two games (quizzes and Mafia)
 * under one header, so the brand name tells you which one you are in.
 */
export function useIsMafiaSection() {
    const { url } = usePage();
    return url.startsWith('/mafia') || window.location.pathname.startsWith('/mafia');
}

/** Section name for the header: "Quiz Platform" or "Mafia" (localized). */
export function useSectionName() {
    const { t } = useLaravelReactI18n();
    return useIsMafiaSection() ? t('mafia.index_heading') : 'Quiz Platform';
}

/** Logo + section name, linking to the section's home. */
export default function SectionBrand({ guest = false }) {
    const isMafia = useIsMafiaSection();
    const name = useSectionName();
    const { quizRoute, mafiaRoute } = useSectionRoutes();
    const href = isMafia ? mafiaRoute('mafia.index') : quizRoute(guest ? 'welcome' : 'dashboard');

    return (
        <Link href={href} className="flex items-center gap-2">
            <ApplicationLogo className="h-7 w-auto fill-current text-primary-600" />
            <span className="hidden font-heading text-base font-bold text-ink-900 sm:inline">{name}</span>
        </Link>
    );
}
