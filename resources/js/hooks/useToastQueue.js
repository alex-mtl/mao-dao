import { useCallback, useEffect, useRef, useState } from 'react';

/** A tiny auto-expiring queue for GameToasts. `push({ kind, text, team?, ttl })`. */
export default function useToastQueue() {
    const [toasts, setToasts] = useState([]);
    const nextId = useRef(1);
    const timers = useRef(new Map());

    const dismiss = useCallback((id) => {
        setToasts((list) => list.filter((toast) => toast.id !== id));
        const timer = timers.current.get(id);
        if (timer) {
            clearTimeout(timer);
            timers.current.delete(id);
        }
    }, []);

    const push = useCallback(
        ({ ttl = 7000, ...toast }) => {
            const id = `t${nextId.current++}`;
            setToasts((list) => [...list.slice(-3), { ...toast, id, onDismiss: () => dismiss(id) }]);
            if (ttl > 0) {
                timers.current.set(id, setTimeout(() => dismiss(id), ttl));
            }
            return id;
        },
        [dismiss],
    );

    useEffect(() => () => timers.current.forEach((timer) => clearTimeout(timer)), []);

    return { toasts, push, dismiss };
}
