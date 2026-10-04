import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import PageHeader from '@/Components/PageHeader';
import Badge from '@/Components/Badge';
import Pagination from '@/Components/Pagination';
import EmptyState from '@/Components/EmptyState';
import { Head } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { PuzzlePieceIcon } from '@heroicons/react/24/outline';

export default function History({ games }) {
    const { t } = useLaravelReactI18n();

    return (
        <AuthenticatedLayout header={<PageHeader title={t('mafia.history_title')} />}>
            <Head title={t('mafia.history_title')} />

            <div className="py-8">
                <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-6 lg:px-8">
                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft">
                        {games.data.length === 0 ? (
                            <EmptyState icon={PuzzlePieceIcon} title={t('mafia.no_games')} />
                        ) : (
                            <ul className="divide-y divide-warm-100">
                                {games.data.map((game) => (
                                    <li key={game.id} className="flex items-center justify-between gap-3 py-3">
                                        <div>
                                            <div className="font-medium text-ink-900">
                                                {t('mafia.history_room', { code: game.roomCode })}
                                            </div>
                                            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-500">
                                                <span>{t('mafia.play_your_role', { role: t(`mafia.role_${game.role}`) })}</span>
                                                <Badge color={game.won ? 'success' : 'danger'}>
                                                    {game.won ? t('mafia.history_won') : t('mafia.history_lost')}
                                                </Badge>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <Pagination links={games.links} />
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
