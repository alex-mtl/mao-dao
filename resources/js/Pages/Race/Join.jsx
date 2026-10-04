import RaceLayout from '@/Layouts/RaceLayout';
import PrimaryButton from '@/Components/PrimaryButton';
import TextInput from '@/Components/TextInput';
import InputLabel from '@/Components/InputLabel';
import InputError from '@/Components/InputError';
import { Head, useForm } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

function StateMessage({ title, description }) {
    return (
        <div className="animate-in mt-6 text-center" role="status">
            <p className="font-heading text-xl font-bold text-ink-900">{title}</p>
            <p className="mt-2 text-ink-600">{description}</p>
        </div>
    );
}

export default function Join({ state, code, quizTitle, playerCount, maxPlayers }) {
    const { t } = useLaravelReactI18n();
    const { data, setData, post, processing, errors } = useForm({ nickname: '' });

    const submit = (e) => {
        e.preventDefault();
        post(route('race.join', code));
    };

    return (
        <RaceLayout>
            <Head title={t('race.join_title')} />

            <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">
                    {t('race.room_label')}
                </p>
                <p className="mt-1 font-heading text-3xl font-bold tracking-widest text-ink-900">
                    {code}
                </p>
            </div>

            {state === 'joinable' && (
                <>
                    <p className="mt-4 text-center text-ink-600">
                        {t('race.joining_quiz', { title: quizTitle })}
                    </p>
                    <p className="mt-1 text-center text-sm text-ink-400">
                        {t('race.player_count', { count: playerCount, max: maxPlayers })}
                    </p>

                    <form onSubmit={submit} className="mt-6 space-y-4">
                        <div>
                            <InputLabel htmlFor="nickname" value={t('race.nickname_label')} />
                            <TextInput
                                id="nickname"
                                className="mt-1 block w-full text-center text-lg"
                                value={data.nickname}
                                onChange={(e) => setData('nickname', e.target.value)}
                                maxLength={20}
                                autoFocus
                                required
                            />
                            <InputError message={errors.nickname} className="mt-2" />
                        </div>

                        <PrimaryButton
                            className="w-full justify-center py-3 text-base"
                            disabled={processing}
                            loading={processing}
                        >
                            {t('race.join_button')}
                        </PrimaryButton>
                    </form>
                </>
            )}

            {state === 'full' && (
                <StateMessage title={t('race.full_title')} description={t('race.full_description')} />
            )}
            {state === 'started' && (
                <StateMessage title={t('race.started_title')} description={t('race.started_description')} />
            )}
            {state === 'finished' && (
                <StateMessage title={t('race.finished_title')} description={t('race.finished_description')} />
            )}
            {state === 'cancelled' && (
                <StateMessage title={t('race.cancelled_title')} description={t('race.cancelled_description')} />
            )}
            {state === 'not_found' && (
                <StateMessage
                    title={t('race.not_found_title')}
                    description={t('race.not_found_description')}
                />
            )}
        </RaceLayout>
    );
}
