import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import RoomForms from '@/Components/Mafia/RoomForms';
import { Head } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

export default function Index() {
    const { t } = useLaravelReactI18n();

    return (
        <AuthenticatedLayout>
            <Head title={t('mafia.index_title')} />

            <div className="px-4 py-8 sm:px-6 lg:px-8">
                <RoomForms />
            </div>
        </AuthenticatedLayout>
    );
}
