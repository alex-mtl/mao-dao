import InputLabel from '@/Components/InputLabel';
import PrimaryButton from '@/Components/PrimaryButton';
import { Transition } from '@headlessui/react';
import { useForm, usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

export default function LanguagePreferenceForm({ className = '' }) {
    const { t } = useLaravelReactI18n();
    const user = usePage().props.auth.user;
    const localeOptions = usePage().props.locale_options;

    const { data, setData, patch, processing, recentlySuccessful } = useForm({
        ui_language: user.ui_language,
    });

    const submit = (e) => {
        e.preventDefault();

        patch(route('profile.language.update'));
    };

    return (
        <section className={className}>
            <header>
                <h2 className="text-lg font-medium text-ink-900">
                    {t('profile.language_heading')}
                </h2>

                <p className="mt-1 text-sm text-ink-600">
                    {t('profile.language_description')}
                </p>
            </header>

            <form onSubmit={submit} className="mt-6 space-y-6">
                <div>
                    <InputLabel
                        htmlFor="ui_language"
                        value={t('profile.ui_language_label')}
                    />

                    <select
                        id="ui_language"
                        className="mt-1 block w-full rounded-lg border-warm-300 shadow-sm focus:border-primary-500 focus:ring-primary-500"
                        value={data.ui_language}
                        onChange={(e) => {
                            setData('ui_language', e.target.value);
                        }}
                    >
                        {localeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
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
