import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import InputError from '@/Components/InputError';
import { useForm, router } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useRef } from 'react';

export default function ProfilePhotoForm({ profilePhotoUrl, className = '' }) {
    const { t } = useLaravelReactI18n();
    const fileInput = useRef(null);

    const { setData, post, processing, errors, reset } = useForm({
        photo: null,
    });

    const chooseFile = () => fileInput.current?.click();

    const onFileSelected = (e) => {
        const file = e.target.files[0];

        if (!file) {
            return;
        }

        setData('photo', file);

        post(route('profile.photo.store'), {
            forceFormData: true,
            preserveScroll: true,
            onSuccess: () => reset(),
        });
    };

    const removePhoto = () => {
        router.delete(route('profile.photo.destroy'), { preserveScroll: true });
    };

    return (
        <section className={className}>
            <header>
                <h2 className="text-lg font-medium text-ink-900">
                    {t('profile.photo_heading')}
                </h2>

                <p className="mt-1 text-sm text-ink-600">
                    {t('profile.photo_description')}
                </p>
            </header>

            <div className="mt-6 flex items-center gap-4">
                {profilePhotoUrl ? (
                    <img
                        src={profilePhotoUrl}
                        alt=""
                        className="h-16 w-16 rounded-full object-cover"
                    />
                ) : (
                    <div className="h-16 w-16 rounded-full bg-warm-200" />
                )}

                <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={onFileSelected}
                />

                <PrimaryButton type="button" disabled={processing} onClick={chooseFile}>
                    {t('profile.choose_photo')}
                </PrimaryButton>

                {profilePhotoUrl && (
                    <SecondaryButton type="button" onClick={removePhoto}>
                        {t('profile.remove_photo')}
                    </SecondaryButton>
                )}
            </div>

            <InputError message={errors.photo} className="mt-2" />
        </section>
    );
}
