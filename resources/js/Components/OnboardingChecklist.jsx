import { Link, router } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/solid';

export default function OnboardingChecklist({ steps }) {
    const { t } = useLaravelReactI18n();

    const items = [
        { key: 'played', label: t('dashboard.onboarding_step_played'), href: route('library.index') },
        { key: 'created', label: t('dashboard.onboarding_step_created'), href: route('quizzes.create') },
        { key: 'friend', label: t('dashboard.onboarding_step_friend'), href: route('friends.index') },
    ];
    const done = items.filter((item) => steps[item.key]).length;

    return (
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-5 shadow-soft md:col-span-2">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="font-heading text-base font-semibold text-ink-900">
                        {t('dashboard.onboarding_title')}
                    </h3>
                    <p className="text-sm text-ink-500">
                        {t('dashboard.onboarding_subtitle', { done, total: items.length })}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => router.post(route('dashboard.onboarding.dismiss'), {}, { preserveScroll: true })}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-ink-500 hover:bg-primary-100 hover:text-ink-800"
                >
                    <XMarkIcon className="h-4 w-4" aria-hidden="true" />
                    {t('dashboard.onboarding_dismiss')}
                </button>
            </div>

            <ol className="mt-3 grid gap-2 sm:grid-cols-3">
                {items.map((item) => {
                    const isDone = steps[item.key];

                    return (
                        <li key={item.key}>
                            <Link
                                href={item.href}
                                data-done={isDone}
                                className={
                                    'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium ' +
                                    (isDone
                                        ? 'border-success-200 bg-success-50 text-success-700 line-through'
                                        : 'border-warm-200 bg-surface text-ink-800 hover:border-primary-300')
                                }
                            >
                                <CheckCircleIcon
                                    className={'h-5 w-5 shrink-0 ' + (isDone ? 'text-success-600' : 'text-warm-300')}
                                    aria-hidden="true"
                                />
                                {item.label}
                            </Link>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
