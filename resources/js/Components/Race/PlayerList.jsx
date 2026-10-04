import Badge from '@/Components/Badge';
import { useLaravelReactI18n } from 'laravel-react-i18n';

export default function PlayerList({ players, className = '' }) {
    const { t } = useLaravelReactI18n();

    if (players.length === 0) {
        return <p className={`text-sm text-ink-400 ${className}`}>{t('race.waiting_for_players')}</p>;
    }

    return (
        <ul className={`animate-in space-y-2 ${className}`}>
            {players.map((player) => (
                <li
                    key={player.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-warm-200 bg-surface px-3 py-2"
                >
                    <span className="min-w-0 truncate font-medium text-ink-900">{player.nickname}</span>
                    {player.isHost && (
                        <Badge color="primary" className="shrink-0">
                            {t('race.host_badge')}
                        </Badge>
                    )}
                </li>
            ))}
        </ul>
    );
}
