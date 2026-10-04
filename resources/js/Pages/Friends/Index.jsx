import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import PageHeader from '@/Components/PageHeader';
import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import DangerButton from '@/Components/DangerButton';
import TextInput from '@/Components/TextInput';
import Avatar from '@/Components/Avatar';
import { Head, router } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useState } from 'react';
import {
    MagnifyingGlassIcon,
    InboxArrowDownIcon,
    PaperAirplaneIcon,
    UserGroupIcon,
} from '@heroicons/react/24/outline';

function PersonRow({ name, photo, children }) {
    return (
        <li className="flex items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
                <Avatar name={name} src={photo} size="sm" />
                <span className="truncate font-medium text-ink-800">{name}</span>
            </div>
            <div className="flex shrink-0 gap-2">{children}</div>
        </li>
    );
}

function Section({ icon: Icon, title, isEmpty, emptyMessage, children }) {
    return (
        <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft">
            <h3 className="flex items-center gap-2 font-heading text-base font-semibold text-ink-900">
                <Icon className="h-5 w-5 text-primary-500" aria-hidden="true" />
                {title}
            </h3>

            {isEmpty ? (
                <p className="mt-2 text-sm text-ink-400">{emptyMessage}</p>
            ) : (
                <ul className="mt-1 divide-y divide-warm-100">{children}</ul>
            )}
        </div>
    );
}

export default function Index({ friends, incoming, outgoing, search, searchResults }) {
    const { t } = useLaravelReactI18n();
    const [query, setQuery] = useState(search ?? '');

    const submitSearch = (e) => {
        e.preventDefault();

        router.get(route('friends.index'), { search: query }, { preserveState: true });
    };

    const sendRequest = (recipientId) => {
        router.post(route('friends.store'), { recipient_id: recipientId }, { preserveScroll: true });
    };

    const acceptRequest = (id) => {
        router.patch(route('friends.accept', id), {}, { preserveScroll: true });
    };

    const removeRequest = (id) => {
        router.delete(route('friends.destroy', id), { preserveScroll: true });
    };

    return (
        <AuthenticatedLayout header={<PageHeader title={t('friends.title')} />}>
            <Head title={t('friends.title')} />

            <div className="py-8">
                <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-6 lg:px-8">
                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft">
                        <form onSubmit={submitSearch} className="flex gap-2">
                            <div className="relative flex-1">
                                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                                <TextInput
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder={t('friends.search_placeholder')}
                                    className="w-full pl-9"
                                />
                            </div>
                            <PrimaryButton type="submit">{t('friends.search_button')}</PrimaryButton>
                        </form>

                        {search !== '' && (
                            <div className="mt-4 border-t border-warm-100 pt-4">
                                <h3 className="text-sm font-semibold text-ink-700">
                                    {t('friends.search_results')}
                                </h3>

                                {searchResults.length === 0 ? (
                                    <p className="mt-2 text-sm text-ink-400">
                                        {t('friends.no_results')}
                                    </p>
                                ) : (
                                    <ul className="mt-1 divide-y divide-warm-100">
                                        {searchResults.map((result) => (
                                            <PersonRow key={result.id} name={result.name}>
                                                <SecondaryButton onClick={() => sendRequest(result.id)}>
                                                    {t('friends.add_friend')}
                                                </SecondaryButton>
                                            </PersonRow>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </div>

                    <Section
                        icon={InboxArrowDownIcon}
                        title={t('friends.incoming_requests')}
                        isEmpty={incoming.length === 0}
                        emptyMessage={t('friends.no_incoming')}
                    >
                        {incoming.map((request) => (
                            <PersonRow key={request.id} name={request.sender.name}>
                                <PrimaryButton onClick={() => acceptRequest(request.id)}>
                                    {t('friends.accept')}
                                </PrimaryButton>
                                <DangerButton onClick={() => removeRequest(request.id)}>
                                    {t('friends.decline')}
                                </DangerButton>
                            </PersonRow>
                        ))}
                    </Section>

                    <Section
                        icon={PaperAirplaneIcon}
                        title={t('friends.outgoing_requests')}
                        isEmpty={outgoing.length === 0}
                        emptyMessage={t('friends.no_outgoing')}
                    >
                        {outgoing.map((request) => (
                            <PersonRow key={request.id} name={request.recipient.name}>
                                <SecondaryButton onClick={() => removeRequest(request.id)}>
                                    {t('friends.cancel')}
                                </SecondaryButton>
                            </PersonRow>
                        ))}
                    </Section>

                    <Section
                        icon={UserGroupIcon}
                        title={t('friends.your_friends')}
                        isEmpty={friends.length === 0}
                        emptyMessage={t('friends.no_friends')}
                    >
                        {friends.map((friend) => (
                            <PersonRow key={friend.id} name={friend.name}>
                                <SecondaryButton onClick={() => removeRequest(friend.friend_request_id)}>
                                    {t('friends.remove')}
                                </SecondaryButton>
                            </PersonRow>
                        ))}
                    </Section>
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
