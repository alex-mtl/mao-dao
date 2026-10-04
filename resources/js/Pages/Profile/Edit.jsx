import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import PageHeader from '@/Components/PageHeader';
import { Head } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import DeleteUserForm from './Partials/DeleteUserForm';
import ImageCollection from './Partials/ImageCollection';
import ColorSchemePreferenceForm from './Partials/ColorSchemePreferenceForm';
import LanguagePreferenceForm from './Partials/LanguagePreferenceForm';
import ProfilePhotoForm from './Partials/ProfilePhotoForm';
import TagsForm from './Partials/TagsForm';
import UpdatePasswordForm from './Partials/UpdatePasswordForm';
import UpdateProfileInformationForm from './Partials/UpdateProfileInformationForm';

export default function Edit({
    mustVerifyEmail,
    status,
    tags,
    userTagIds,
    profilePhotoUrl,
    images,
    imageLimit,
    canDeleteAccount,
}) {
    const { t } = useLaravelReactI18n();

    return (
        <AuthenticatedLayout header={<PageHeader title={t('profile.title')} />}>
            <Head title={t('profile.title')} />

            <div className="py-8">
                <div className="mx-auto max-w-7xl space-y-6 sm:px-6 lg:px-8">
                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft sm:p-8">
                        <UpdateProfileInformationForm
                            mustVerifyEmail={mustVerifyEmail}
                            status={status}
                            className="max-w-xl"
                        />
                    </div>

                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft sm:p-8">
                        <ProfilePhotoForm
                            profilePhotoUrl={profilePhotoUrl}
                            className="max-w-xl"
                        />
                    </div>

                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft sm:p-8">
                        <ImageCollection
                            images={images}
                            imageLimit={imageLimit}
                            className="max-w-2xl"
                        />
                    </div>

                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft sm:p-8">
                        <LanguagePreferenceForm className="max-w-xl" />
                    </div>

                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft sm:p-8">
                        <ColorSchemePreferenceForm className="max-w-xl" />
                    </div>

                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft sm:p-8">
                        <TagsForm
                            tags={tags}
                            userTagIds={userTagIds}
                            className="max-w-xl"
                        />
                    </div>

                    <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft sm:p-8">
                        <UpdatePasswordForm className="max-w-xl" />
                    </div>

                    {canDeleteAccount && (
                        <div className="rounded-xl border border-warm-200 bg-surface p-6 shadow-soft sm:p-8">
                            <DeleteUserForm className="max-w-xl" />
                        </div>
                    )}
                </div>
            </div>
        </AuthenticatedLayout>
    );
}
