import PrimaryButton from '@/Components/PrimaryButton';
import DangerButton from '@/Components/DangerButton';
import InputError from '@/Components/InputError';
import { useForm, router } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useRef } from 'react';

export default function ImageCollection({ images, imageLimit, className = '' }) {
    const { t } = useLaravelReactI18n();
    const fileInput = useRef(null);

    const { setData, post, processing, errors, reset } = useForm({
        image: null,
    });

    const chooseFile = () => fileInput.current?.click();

    const onFileSelected = (e) => {
        const file = e.target.files[0];

        if (!file) {
            return;
        }

        setData('image', file);

        post(route('images.store'), {
            forceFormData: true,
            preserveScroll: true,
            onSuccess: () => reset(),
        });
    };

    const deleteImage = (id) => {
        router.delete(route('images.destroy', id), { preserveScroll: true });
    };

    const atLimit = images.length >= imageLimit;

    return (
        <section className={className}>
            <header>
                <h2 className="text-lg font-medium text-ink-900">
                    {t('profile.image_collection_heading')}
                </h2>

                <p className="mt-1 text-sm text-ink-600">
                    {t('profile.image_collection_description', {
                        limit: imageLimit,
                    })}
                </p>

                <p className="mt-1 text-sm text-ink-500">
                    {t('profile.image_count', {
                        count: images.length,
                        limit: imageLimit,
                    })}
                </p>
            </header>

            <div className="mt-4">
                <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={onFileSelected}
                />

                <PrimaryButton
                    type="button"
                    disabled={processing || atLimit}
                    onClick={chooseFile}
                >
                    {t('profile.upload_image')}
                </PrimaryButton>

                <InputError message={errors.image} className="mt-2" />
            </div>

            {images.length === 0 ? (
                <p className="mt-4 text-sm text-ink-500">
                    {t('profile.no_images')}
                </p>
            ) : (
                <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
                    {images.map((image) => (
                        <div key={image.id} className="relative">
                            <img
                                src={image.url}
                                alt={image.name}
                                className="aspect-square w-full rounded-lg object-cover"
                            />

                            <DangerButton
                                type="button"
                                className="mt-2 w-full !px-2 !py-1 !text-[10px]"
                                onClick={() => deleteImage(image.id)}
                            >
                                {t('profile.delete_image')}
                            </DangerButton>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
