import { Transition } from '@headlessui/react';
import { useForm, usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

export default function ColorSchemePreferenceForm({ className = '' }) {
    const { t } = useLaravelReactI18n();
    const user = usePage().props.auth.user;
    const colorSchemeOptions = usePage().props.color_scheme_options;

    const { data, setData, patch, processing, recentlySuccessful } = useForm({
        color_scheme: user.color_scheme,
    });

    const select = (value) => {
        // Instant preview: apply the swatch immediately, then persist it in
        // the background. ColorSchemeSync (resources/js/Components) will
        // re-confirm the same value once the server round-trip returns.
        document.documentElement.dataset.theme = value;
        setData('color_scheme', value);

        patch(route('profile.color-scheme.update'), {
            preserveScroll: true,
            onError: () => {
                document.documentElement.dataset.theme = user.color_scheme;
            },
        });
    };

    return (
        <section className={className}>
            <header>
                <h2 className="text-lg font-medium text-ink-900">
                    {t('profile.color_scheme_heading')}
                </h2>

                <p className="mt-1 text-sm text-ink-600">
                    {t('profile.color_scheme_description')}
                </p>
            </header>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {colorSchemeOptions.map((option) => {
                    const selected = data.color_scheme === option.value;

                    return (
                        <button
                            key={option.value}
                            type="button"
                            data-theme={option.value}
                            disabled={processing}
                            onClick={() => select(option.value)}
                            className={`relative flex flex-col items-start gap-2.5 rounded-xl border-2 bg-surface p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                selected
                                    ? 'border-primary-600'
                                    : 'border-warm-200 hover:border-warm-400'
                            }`}
                        >
                            {selected && (
                                <CheckCircleIcon className="absolute right-2 top-2 h-5 w-5 text-primary-600" />
                            )}

                            <span className="flex gap-1.5">
                                <span className="h-6 w-6 rounded-full bg-primary-500" />
                                <span className="h-6 w-6 rounded-full bg-secondary-500" />
                                <span className="h-6 w-6 rounded-full bg-accent-500" />
                            </span>

                            <span className="h-8 w-full rounded-md border border-warm-300 bg-warm-100" />

                            <span className="text-sm font-medium text-ink-900">
                                {t(`profile.color_scheme_${option.value.replace(/-/g, '_')}`)}
                            </span>
                        </button>
                    );
                })}
            </div>

            <Transition
                show={recentlySuccessful}
                enter="transition ease-in-out"
                enterFrom="opacity-0"
                leave="transition ease-in-out"
                leaveTo="opacity-0"
            >
                <p className="mt-3 text-sm text-ink-600">{t('common.saved')}</p>
            </Transition>
        </section>
    );
}
