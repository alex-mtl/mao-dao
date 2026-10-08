import { UserIcon } from '@heroicons/react/24/solid';
import { initials } from '@/Components/Avatar';
import { useLaravelReactI18n } from 'laravel-react-i18n';

const MAX_SHOWN = 8;

/**
 * Who is watching the room: a row of small round avatars (photo, initials
 * or — for a guest — a plain person icon) with a count. Sizes come from the
 * grid's vw-based `--spectator-avatar` / `--info-*` variables, like
 * everything else on these screens, so it scales with the table. Renders
 * nothing when nobody is watching.
 */
export default function SpectatorsStrip({ spectators = [] }) {
    const { t } = useLaravelReactI18n();

    if (spectators.length === 0) {
        return null;
    }

    const shown = spectators.slice(0, MAX_SHOWN);
    const extra = spectators.length - shown.length;
    const circle =
        'flex h-[var(--spectator-avatar)] w-[var(--spectator-avatar)] shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ring-surface';

    return (
        <div className="flex items-center justify-center gap-[var(--info-menu-pad)]" data-testid="spectators-strip">
            <span className="text-[length:var(--info-label)] text-ink-500">
                {t('mafia.spectators_heading', { count: spectators.length })}
            </span>
            <ul className="flex items-center -space-x-[0.25em]">
                {shown.map((spectator) => {
                    const label = spectator.name ?? t('mafia.spectator_guest');

                    return (
                        <li key={spectator.id} title={label} className={`${circle} bg-warm-200 text-ink-500`}>
                            {spectator.avatarUrl ? (
                                <img src={spectator.avatarUrl} alt="" aria-hidden="true" className="h-full w-full object-cover" />
                            ) : spectator.isGuest ? (
                                <UserIcon className="h-[60%] w-[60%]" aria-hidden="true" />
                            ) : (
                                <span className="text-[length:calc(var(--spectator-avatar)*0.42)] font-bold leading-none text-primary-700">
                                    {initials(spectator.name)}
                                </span>
                            )}
                            <span className="sr-only">{label}</span>
                        </li>
                    );
                })}
                {extra > 0 && (
                    <li className={`${circle} bg-warm-300 text-[length:calc(var(--spectator-avatar)*0.4)] font-bold leading-none text-ink-700`}>
                        +{extra}
                    </li>
                )}
            </ul>
        </div>
    );
}
