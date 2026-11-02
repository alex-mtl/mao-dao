import Checkbox from '@/Components/Checkbox';
import InputError from '@/Components/InputError';
import PrimaryButton from '@/Components/PrimaryButton';
import SecondaryButton from '@/Components/SecondaryButton';
import TextInput from '@/Components/TextInput';
import PlatformLayout from '@/Layouts/PlatformLayout';
import { Head, Link, router, useForm } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import { useState } from 'react';

/**
 * Super admins: accounts for the streamer app. Create one (a name, the streamer pack on), then
 * "Generate key" - the key is shown here once and handed to the streamer, who types it into the app.
 */
export default function Clients({ clients, newKey, notice }) {
    const { t } = useLaravelReactI18n();
    const form = useForm({ name: '', pack: true });
    const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—');

    const create = (e) => {
        e.preventDefault();
        form.post(route('guessword.clients.store'), { preserveScroll: true, onSuccess: () => form.reset('name') });
    };
    const post = (name, id, data = {}, confirm = null) => {
        if (confirm && !window.confirm(confirm)) return;
        router.post(route('guessword.clients.' + name, id), data, { preserveScroll: true });
    };

    return (
        <PlatformLayout>
            <Head title={t('guessword.clients_title')} />

            <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <h1 className="font-heading text-2xl font-bold text-ink-900">{t('guessword.clients_title')}</h1>
                    <Link href={route('guessword.rooms')} className="text-sm font-semibold text-primary-700 hover:underline">
                        {t('guessword.all_rooms')}
                    </Link>
                </div>
                <p className="mt-2 text-sm text-ink-500">{t('guessword.clients_help')}</p>
                {notice && <p className="mt-4 rounded-lg bg-primary-50 px-4 py-2 text-sm text-primary-800">{notice}</p>}

                <form onSubmit={create} className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border-2 border-warm-200 bg-surface px-4 py-3 shadow-soft">
                    <TextInput className="min-w-0 flex-1" placeholder={t('guessword.client_name')} value={form.data.name}
                               onChange={(e) => form.setData('name', e.target.value)} />
                    <label className="flex items-center gap-2 text-sm text-ink-700">
                        <Checkbox checked={form.data.pack} onChange={(e) => form.setData('pack', e.target.checked)} />
                        {t('guessword.client_pack')}
                    </label>
                    <PrimaryButton disabled={form.processing || !form.data.name.trim()}>{t('guessword.client_create')}</PrimaryButton>
                    <InputError className="w-full" message={form.errors.name} />
                </form>

                {clients.length === 0 ? (
                    <p className="mt-6 rounded-xl border border-warm-200 bg-surface p-6 text-center text-ink-500">{t('guessword.clients_none')}</p>
                ) : (
                    <ul className="mt-6 space-y-3">
                        {clients.map((c) => (
                            <li key={c.id} className="rounded-xl border-2 border-warm-200 bg-surface px-4 py-3 shadow-soft">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate font-heading text-lg font-bold text-ink-900">
                                            {c.name}
                                            {c.tiktok && <span className="ml-2 text-sm font-semibold text-ink-400">@{c.tiktok}</span>}
                                        </p>
                                        <p className="mt-0.5 text-xs text-ink-500">
                                            {c.keyHint
                                                ? t('guessword.client_key_state', { hint: c.keyHint, time: when(c.keyIssued) })
                                                : t('guessword.client_no_key')}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <label className="flex items-center gap-2 text-sm text-ink-700">
                                            <Checkbox checked={c.pack} onChange={(e) => post('pack', c.id, { on: e.target.checked })} />
                                            {t('guessword.client_pack')}
                                        </label>
                                        <SecondaryButton type="button"
                                                         onClick={() => post('key', c.id, {}, c.keyHint ? t('guessword.client_key_replace_confirm') : null)}>
                                            {t('guessword.client_key_generate')}
                                        </SecondaryButton>
                                        {c.keyHint && (
                                            <SecondaryButton type="button" className="text-danger-700"
                                                             onClick={() => post('revoke', c.id, {}, t('guessword.client_key_revoke_confirm'))}>
                                                {t('guessword.client_key_revoke')}
                                            </SecondaryButton>
                                        )}
                                        {c.roomId && (
                                            <Link href={route('guessword.rooms.show', c.roomId)} className="text-sm font-semibold text-primary-700 hover:underline">
                                                {t('guessword.open_room')}
                                            </Link>
                                        )}
                                    </div>
                                </div>
                                {newKey?.id === c.id && <NewKey value={newKey.key} />}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </PlatformLayout>
    );
}

function NewKey({ value }) {
    const { t } = useLaravelReactI18n();
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            window.prompt(t('guessword.client_key_new'), value);
        }
    };

    return (
        <div className="mt-3 rounded-lg bg-primary-50 px-3 py-2">
            <p className="text-xs font-semibold text-primary-800">{t('guessword.client_key_new')}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 select-all break-all font-mono text-base font-bold text-ink-900">{value}</code>
                <SecondaryButton type="button" onClick={copy}>{t(copied ? 'guessword.copied' : 'guessword.copy')}</SecondaryButton>
            </div>
        </div>
    );
}
