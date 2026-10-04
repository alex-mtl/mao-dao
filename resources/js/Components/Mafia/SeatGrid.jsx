import Badge from '@/Components/Badge';
import Avatar from '@/Components/Avatar';
import { useLaravelReactI18n } from 'laravel-react-i18n';

/**
 * All 10 seats, occupied or not — a room can start short-handed (empty
 * seats become "dummy" players once the game deals roles, see plan §7),
 * so showing every seat rather than just a list of joined players makes
 * that headroom visible before the game starts.
 */
export default function SeatGrid({ seats, players, className = '' }) {
    const { t } = useLaravelReactI18n();
    const bySlot = new Map(players.map((p) => [p.slot, p]));

    return (
        <ul className={`grid grid-cols-2 gap-2 sm:grid-cols-5 ${className}`}>
            {Array.from({ length: seats }, (_, i) => i + 1).map((slot) => {
                const player = bySlot.get(slot);

                return (
                    <li
                        key={slot}
                        className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-center ${
                            player ? 'border-warm-200 bg-surface' : 'border-dashed border-warm-300 bg-warm-50'
                        }`}
                    >
                        {player ? (
                            <>
                                <Avatar name={player.name} size="sm" />
                                <span className="w-full truncate text-xs font-medium text-ink-900">
                                    {player.name}
                                </span>
                                <div className="flex flex-wrap justify-center gap-1">
                                    {player.isGameHost && (
                                        <Badge color="primary">{t('mafia.game_host_badge')}</Badge>
                                    )}
                                    {player.isReady && (
                                        <Badge color="success">{t('mafia.ready_badge')}</Badge>
                                    )}
                                </div>
                            </>
                        ) : (
                            <span className="text-xs text-ink-400">{t('mafia.empty_seat')}</span>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
