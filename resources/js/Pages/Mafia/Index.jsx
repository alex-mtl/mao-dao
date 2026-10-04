import { useState } from 'react';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import PageHeader from '@/Components/PageHeader';
import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import TextInput from '@/Components/TextInput';
import InputLabel from '@/Components/InputLabel';
import { Head, Link, router, useForm } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

export default function Index() {
    const { t } = useLaravelReactI18n();
    const { data, setData, post, processing } = useForm({ password: '' });
    const [joinCode, setJoinCode] = useState('');

    const createRoom = (e) => {
        e.preventDefault();
        post(route('mafia.store'));
    };

    const goToCode = (e) => {
        e.preventDefault();
        if (joinCode.trim()) {
            router.get(route('mafia.show', joinCode.trim().toUpperCase()));
        }
    };

    return (
        <AuthenticatedLayout header={<PageHeader title={t('mafia.index_heading')} description={t('mafia.index_description')} />}>
            <Head title={t('mafia.index_title')} />

            <div className="mx-auto max-w-xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
                <form onSubmit={createRoom} className="rounded-2xl border border-warm-200 bg-surface p-6 shadow-elevated">
                    <InputLabel htmlFor="password" value={t('mafia.create_password_label')} />
                    <TextInput
                        id="password"
                        type="password"
                        className="mt-1 block w-full"
                        value={data.password}
                        onChange={(e) => setData('password', e.target.value)}
                        autoComplete="new-password"
                    />
                    <PrimaryButton className="mt-4 w-full justify-center py-3 text-base" disabled={processing} loading={processing}>
                        {t('mafia.create_room_button')}
                    </PrimaryButton>
                </form>

                <form onSubmit={goToCode} className="rounded-2xl border border-warm-200 bg-surface p-6 shadow-elevated">
                    <InputLabel htmlFor="join-code" value={t('mafia.join_by_code_heading')} />
                    <div className="mt-1 flex gap-2">
                        <TextInput
                            id="join-code"
                            className="block w-full text-center uppercase tracking-widest"
                            value={joinCode}
                            onChange={(e) => setJoinCode(e.target.value)}
                            placeholder={t('mafia.join_by_code_placeholder')}
                            maxLength={6}
                        />
                        <SecondaryButton type="submit">{t('mafia.join_by_code_button')}</SecondaryButton>
                    </div>
                </form>

                <div className="text-center">
                    <Link href={route('mafia.history')} className="text-sm font-medium text-primary-600 hover:underline">
                        {t('mafia.view_history_link')}
                    </Link>
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
