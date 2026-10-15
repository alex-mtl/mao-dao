import ApplicationLogo from '@/Components/ApplicationLogo';
import { Link, usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

/** The section of the platform the current address belongs to: 'mafia' | 'quiz' | null (platform pages). */
export function useCurrentSection() {
    const { url } = usePage();
    const path = (url || window.location.pathname).split('?')[0];

    if (path === '/mafia' || path.startsWith('/mafia/')) return 'mafia';
    if (path === '/quiz' || path.startsWith('/quiz/')) return 'quiz';

    return null;
}

/** True on any /mafia/* page (the game screens are sized to the viewport: no banner, no footer). */
export function useIsMafiaSection() {
    return useCurrentSection() === 'mafia';
}

/** Section display name (localized), or null on platform pages. */
export function useSectionName() {
    const { t } = useLaravelReactI18n();
    const section = useCurrentSection();

    return section ? t(`platform.section_${section}`) : null;
}

/**
 * Logo + "Mao Dao" (always linking to the platform home) and, inside a game,
 * the game's name linking to that game's section.
 */
export default function SectionBrand() {
    const { t } = useLaravelReactI18n();
    const section = useCurrentSection();
    const sectionHome = section === 'mafia' ? route('mafia.index') : section === 'quiz' ? route('dashboard') : null;

    return (
        <div className="flex items-center gap-2">
            <Link href={route('welcome')} className="flex items-center gap-2">
                <ApplicationLogo className="h-7 w-auto fill-current text-primary-600" />
                <span className="hidden font-heading text-base font-bold text-ink-900 sm:inline">
                    {t('platform.site_name')}
                </span>
            </Link>
            {section && (
                <>
                    <span className="text-ink-300" aria-hidden="true">/</span>
                    <Link href={sectionHome} className="font-heading text-base font-bold text-primary-700 hover:text-primary-900">
                        {t(`platform.section_${section}`)}
                    </Link>
                </>
            )}
        </div>
    );
}
