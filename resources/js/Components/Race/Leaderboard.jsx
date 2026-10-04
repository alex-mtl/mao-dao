import Badge from '@/Components/Badge';
import { useLaravelReactI18n } from 'laravel-react-i18n';

export default function Leaderboard({ players, className = '' }) {
    const { t } = useLaravelReactI18n();

    return (
        <ol className={`animate-in space-y-2 ${className}`}>
            {players.map((player, index) => (
                <li
                    key={player.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-warm-200 bg-surface px-3 py-2"
                >
                    <span className="flex min-w-0 items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warm-100 text-xs font-bold text-ink-600">
                            {index + 1}
                        </span>
                        <span className="min-w-0 truncate font-medium text-ink-900">{player.nickname}</span>
                        {player.isHost && (
                            <Badge color="primary" className="shrink-0">
                                {t('race.host_badge')}
                            </Badge>
                        )}
                    </span>
                    <span className="shrink-0 font-heading font-bold text-primary-700">
                        {player.score.toLocaleString()}
                    </span>
                </li>
            ))}
        </ol>
    );
}
