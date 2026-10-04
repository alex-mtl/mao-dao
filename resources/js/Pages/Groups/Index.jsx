import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import PageHeader from '@/Components/PageHeader';
import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import TextInput from '@/Components/TextInput';
import InputError from '@/Components/InputError';
import EmptyState from '@/Components/EmptyState';
import Badge from '@/Components/Badge';
import { Head, Link, useForm } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { UserGroupIcon, PlusIcon } from '@heroicons/react/24/outline';

export default function Index({ groups }) {
    const { t } = useLaravelReactI18n();

    const { data, setData, post, processing, errors, reset } = useForm({
        name: '',
    });

    const submit = (e) => {
        e.preventDefault();

        post(route('groups.store'), {
            onSuccess: () => reset(),
        });
    };

    return (
        <AuthenticatedLayout header={<PageHeader title={t('groups.title')} />}>
            <Head title={t('groups.title')} />

            <div className="py-8">
                <div className="mx-auto max-w-3xl space-y-4 px-4 sm:px-6 lg:px-8">
                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft">
                        <h3 className="font-heading text-base font-semibold text-ink-900">
                            {t('groups.create_group')}
                        </h3>

                        <form onSubmit={submit} className="mt-3 flex gap-2">
                            <div className="flex-1">
                                <TextInput
                                    value={data.name}
                                    onChange={(e) => setData('name', e.target.value)}
                                    placeholder={t('groups.group_name_placeholder')}
                                    className="w-full"
                                />
                                <InputError message={errors.name} className="mt-2" />
                            </div>
                            <PrimaryButton type="submit" loading={processing}>
                                <PlusIcon className="h-4 w-4" aria-hidden="true" />
                                {t('groups.create_button')}
                            </PrimaryButton>
                        </form>
                    </div>

                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft">
                        {groups.length === 0 ? (
                            <EmptyState icon={UserGroupIcon} title={t('groups.no_groups')} />
                        ) : (
                            <ul className="divide-y divide-warm-100">
                                {groups.map((group) => (
                                    <li
                                        key={group.id}
                                        className="flex items-center justify-between py-3"
                                    >
                                        <div>
                                            <div className="font-medium text-ink-900">
                                                {group.name}
                                            </div>
                                            <Badge className="mt-1">
                                                {t('groups.members_count', {
                                                    count: group.members_count,
                                                })}
                                            </Badge>
                                        </div>
                                        <Link href={route('groups.show', group.id)}>
                                            <SecondaryButton>{t('groups.view')}</SecondaryButton>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
