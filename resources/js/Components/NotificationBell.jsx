import { Link, usePage } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import { BellIcon } from '@heroicons/react/24/outline';
import { useLaravelReactI18n } from 'laravel-react-i18n';
import useSectionRoutes from '@/hooks/useSectionRoutes';

export default function NotificationBell() {
    const { t } = useLaravelReactI18n();
    const { quizRoute } = useSectionRoutes();
    const sharedUnread = usePage().props.notifications_unread ?? 0;

    const [open, setOpen] = useState(false);
    const [items, setItems] = useState(null);
    // Server count re-syncs on every Inertia visit; opening the list zeroes
    // it locally (the server marks everything read in the same request).
    const [cleared, setCleared] = useState(false);
    const rootRef = useRef(null);

    useEffect(() => {
        setCleared(false);
    }, [sharedUnread]);

    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (e) => {
            if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        const onKeyDown = (e) => e.key === 'Escape' && setOpen(false);
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const unread = cleared ? 0 : sharedUnread;

    const toggle = async () => {
        if (open) {
            setOpen(false);
            return;
        }
        setOpen(true);
        setItems(null);
        try {
            const response = await fetch(quizRoute('notifications.index'), {
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin',
            });
            const data = await response.json();
            setItems(data.items);
            setCleared(true);
        } catch (e) {
            setItems([]);
        }
    };

    const label =
        unread > 0 ? t('notifications.bell_label_unread', { count: unread }) : t('notifications.bell_label');

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                onClick={toggle}
                aria-label={label}
                aria-haspopup="true"
                aria-expanded={open}
                className="relative flex h-10 w-10 items-center justify-center rounded-lg text-ink-500 transition hover:bg-warm-100 hover:text-ink-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
                <BellIcon className="h-6 w-6" aria-hidden="true" />
                {unread > 0 && (
                    <span
                        data-testid="notification-count"
                        className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-bold leading-none text-white"
                    >
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-warm-200 bg-surface shadow-elevated"
                >
                    <div className="border-b border-warm-100 px-4 py-2.5 font-heading text-sm font-semibold text-ink-900">
                        {t('notifications.title')}
                    </div>

                    {items === null ? (
                        <p className="px-4 py-5 text-sm text-ink-400">{t('notifications.loading')}</p>
                    ) : items.length === 0 ? (
                        <p className="px-4 py-5 text-sm text-ink-400">{t('notifications.empty')}</p>
                    ) : (
                        <ul className="max-h-96 divide-y divide-warm-100 overflow-y-auto">
                            {items.map((item) => (
                                <li key={item.key}>
                                    <Link
                                        href={
                                            item.type === 'friend_request'
                                                ? quizRoute('friends.index')
                                                : quizRoute('groups.show', item.group_id)
                                        }
                                        onClick={() => setOpen(false)}
                                        className={
                                            'flex items-start gap-2 px-4 py-3 text-sm hover:bg-warm-50 ' +
                                            (item.unread ? 'bg-primary-50' : '')
                                        }
                                    >
                                        <span className="flex-1 text-ink-800">
                                            {item.type === 'friend_request'
                                                ? t('notifications.friend_request', { name: item.name })
                                                : t('notifications.group_added', {
                                                      name: item.name,
                                                      group: item.group_name,
                                                  })}
                                        </span>
                                        {item.unread && (
                                            <span className="shrink-0 rounded-full bg-primary-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                                {t('notifications.new_badge')}
                                            </span>
                                        )}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
