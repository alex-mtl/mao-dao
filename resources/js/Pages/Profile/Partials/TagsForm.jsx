import PrimaryButton from '@/Components/PrimaryButton';
import { Transition } from '@headlessui/react';
import { useForm } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

export default function TagsForm({ tags, userTagIds, className = '' }) {
    const { t } = useLaravelReactI18n();

    const { data, setData, patch, processing, recentlySuccessful } = useForm({
        tag_ids: userTagIds,
    });

    const toggleTag = (tagId) => {
        setData(
            'tag_ids',
            data.tag_ids.includes(tagId)
                ? data.tag_ids.filter((id) => id !== tagId)
                : [...data.tag_ids, tagId],
        );
    };

    const submit = (e) => {
        e.preventDefault();

        patch(route('profile.tags.update'));
    };

    return (
        <section className={className}>
            <header>
                <h2 className="text-lg font-medium text-ink-900">
                    {t('profile.tags_heading')}
                </h2>

                <p className="mt-1 text-sm text-ink-600">
                    {t('profile.tags_description')}
                </p>
            </header>

            <form onSubmit={submit} className="mt-6 space-y-6">
                <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => {
                        const selected = data.tag_ids.includes(tag.id);

                        return (
                            <button
                                type="button"
                                key={tag.id}
                                onClick={() => toggleTag(tag.id)}
                                className={
                                    'rounded-full border px-3 py-1 text-sm transition ' +
                                    (selected
                                        ? 'border-primary-600 bg-primary-600 text-white'
                                        : 'border-warm-300 text-ink-700 hover:bg-warm-50')
                                }
                            >
                                {tag.name}
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center gap-4">
                    <PrimaryButton disabled={processing}>
                        {t('common.save')}
                    </PrimaryButton>

                    <Transition
                        show={recentlySuccessful}
                        enter="transition ease-in-out"
                        enterFrom="opacity-0"
                        leave="transition ease-in-out"
                        leaveTo="opacity-0"
                    >
                        <p className="text-sm text-ink-600">
                            {t('common.saved')}
                        </p>
                    </Transition>
                </div>
            </form>
        </section>
    );
}
