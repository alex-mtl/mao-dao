import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import SpectatorLayout from '@/Layouts/SpectatorLayout';
import PrimaryButton from '@/Components/PrimaryButton';
import TextInput from '@/Components/TextInput';
import InputLabel from '@/Components/InputLabel';
import InputError from '@/Components/InputError';
import { Head, Link, useForm, usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

function StateMessage({ title, description }) {
    return (
        <div className="animate-in mt-6 text-center" role="status">
            <p className="font-heading text-xl font-bold text-ink-900">{title}</p>
            <p className="mt-2 text-ink-600">{description}</p>
        </div>
    );
}

export default function Join({ state, code, playerCount, maxPlayers, requiresPassword, watchUrl = null }) {
    const { t } = useLaravelReactI18n();
    // A guest can land here too (a cancelled or unknown room): they have no
    // account menu to show.
    const Layout = usePage().props.auth.user ? AuthenticatedLayout : SpectatorLayout;
    const { data, setData, post, processing, errors } = useForm({ password: '' });

    const submit = (e) => {
        e.preventDefault();
        post(route('mafia.join', code));
    };

    return (
        <Layout>
            <Head title={t('mafia.join_title')} />

            <div className="mx-auto max-w-md px-4 py-10 sm:px-6 lg:px-8">
                <div className="rounded-2xl border border-warm-200 bg-surface p-6 shadow-elevated sm:p-8">
                    <div className="text-center">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">
                            {t('mafia.room_label')}
                        </p>
                        <p className="mt-1 font-heading text-3xl font-bold tracking-widest text-ink-900">
                            {code}
                        </p>
                    </div>

                    {state === 'joinable' && (
                        <>
                            <p className="mt-1 text-center text-sm text-ink-400">
                                {t('mafia.player_count', { count: playerCount, max: maxPlayers })}
                            </p>

                            <form onSubmit={submit} className="mt-6 space-y-4">
                                {requiresPassword && (
                                    <div>
                                        <InputLabel htmlFor="password" value={t('mafia.password_label')} />
                                        <TextInput
                                            id="password"
                                            type="password"
                                            className="mt-1 block w-full"
                                            value={data.password}
                                            onChange={(e) => setData('password', e.target.value)}
                                            autoFocus
                                            required
                                        />
                                        <InputError message={errors.password} className="mt-2" />
                                    </div>
                                )}

                                <PrimaryButton
                                    className="w-full justify-center py-3 text-base"
                                    disabled={processing}
                                    loading={processing}
                                >
                                    {t('mafia.join_button')}
                                </PrimaryButton>
                                <InputError message={errors.room} className="mt-2" />
                            </form>

                            {watchUrl && (
                                <p className="mt-4 text-center text-sm">
                                    <Link href={watchUrl} className="font-medium text-primary-700 hover:underline">
                                        {t('mafia.watch_instead')}
                                    </Link>
                                </p>
                            )}
                        </>
                    )}

                    {state === 'full' && (
                        <StateMessage title={t('mafia.full_title')} description={t('mafia.full_description')} />
                    )}
                    {state === 'started' && (
                        <StateMessage title={t('mafia.started_title')} description={t('mafia.started_description')} />
                    )}
                    {state === 'finished' && (
                        <StateMessage title={t('mafia.finished_title')} description={t('mafia.finished_description')} />
                    )}
                    {state === 'cancelled' && (
                        <StateMessage title={t('mafia.cancelled_title')} description={t('mafia.cancelled_description')} />
                    )}
                    {state === 'not_found' && (
                        <StateMessage
                            title={t('mafia.not_found_title')}
                            description={t('mafia.not_found_description')}
                        />
                    )}
                </div>
            </div>
        </Layout>
    );
}
