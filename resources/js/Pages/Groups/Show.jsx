import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import SecondaryButton from '@/Components/SecondaryButton';
import DangerButton from '@/Components/DangerButton';
import Avatar from '@/Components/Avatar';
import Badge from '@/Components/Badge';
import { Head, Link, router } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';

export default function Show({ group, members, isOwner, friendsNotInGroup }) {
    const { t } = useLaravelReactI18n();

    const addMember = (userId) => {
        router.post(route('groups.members.add', group.id), { user_id: userId }, {
            preserveScroll: true,
        });
    };

    const removeMember = (userId) => {
        router.delete(route('groups.members.remove', [group.id, userId]), {
            preserveScroll: true,
        });
    };

    const leaveGroup = () => {
        if (window.confirm(t('groups.leave_group') + '?')) {
            router.post(route('groups.leave', group.id));
        }
    };

    const deleteGroup = () => {
        if (window.confirm(t('groups.delete_group') + '?')) {
            router.delete(route('groups.destroy', group.id));
        }
    };

    return (
        <AuthenticatedLayout>
            <Head title={group.name} />

            <div className="py-8">
                <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-6 lg:px-8">
                    <Link
                        href={route('groups.index')}
                        className="inline-flex items-center gap-1 text-sm font-medium text-ink-500 hover:text-primary-700"
                    >
                        <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
                        {t('groups.back_to_groups')}
                    </Link>

                    <div className="rounded-2xl border border-warm-200 bg-surface p-6 shadow-soft sm:p-8">
                        <h1 className="font-heading text-2xl font-bold text-ink-900">
                            {group.name}
                        </h1>

                        <h3 className="mt-6 font-heading text-base font-semibold text-ink-900">
                            {t('groups.members_heading')}
                        </h3>

                        <ul className="mt-1 divide-y divide-warm-100">
                            {members.map((member) => (
                                <li
                                    key={member.id}
                                    className="flex items-center justify-between gap-3 py-3"
                                >
                                    <div className="flex items-center gap-3">
                                        <Avatar name={member.name} size="sm" />
                                        <span className="font-medium text-ink-800">
                                            {member.name}
                                        </span>
                                        {member.id === group.owner_id && (
                                            <Badge color="primary">{t('groups.owner_badge')}</Badge>
                                        )}
                                    </div>

                                    {isOwner && member.id !== group.owner_id && (
                                        <DangerButton onClick={() => removeMember(member.id)}>
                                            {t('groups.remove_member')}
                                        </DangerButton>
                                    )}
                                </li>
                            ))}
                        </ul>

                        {isOwner && (
                            <div className="mt-6 border-t border-warm-100 pt-4">
                                <h4 className="text-sm font-semibold text-ink-700">
                                    {t('groups.add_member')}
                                </h4>

                                {friendsNotInGroup.length === 0 ? (
                                    <p className="mt-2 text-sm text-ink-400">
                                        {t('groups.no_friends_to_add')}
                                    </p>
                                ) : (
                                    <ul className="mt-1 divide-y divide-warm-100">
                                        {friendsNotInGroup.map((friend) => (
                                            <li
                                                key={friend.id}
                                                className="flex items-center justify-between gap-3 py-2.5"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <Avatar name={friend.name} size="sm" />
                                                    <span className="font-medium text-ink-800">
                                                        {friend.name}
                                                    </span>
                                                </div>
                                                <SecondaryButton onClick={() => addMember(friend.id)}>
                                                    {t('groups.add_member')}
                                                </SecondaryButton>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end">
                        {isOwner ? (
                            <DangerButton onClick={deleteGroup}>
                                {t('groups.delete_group')}
                            </DangerButton>
                        ) : (
                            <DangerButton onClick={leaveGroup}>
                                {t('groups.leave_group')}
                            </DangerButton>
                        )}
                    </div>
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
