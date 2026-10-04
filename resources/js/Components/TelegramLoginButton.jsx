import { useEffect, useRef } from 'react';

/**
 * Renders Telegram's own "Log in with Telegram" widget button.
 *
 * Telegram's login widget is not a normal OAuth redirect: it's a script
 * that draws its own button and, once the user approves access, redirects
 * the browser straight to `data-auth-url` with the signed payload — our
 * SocialAuthController verifies that payload's hash server-side.
 *
 * Renders nothing until a bot name is configured (VITE_TELEGRAM_BOT_NAME),
 * so the button simply doesn't appear until real Telegram credentials are
 * supplied.
 */
export default function TelegramLoginButton() {
    const containerRef = useRef(null);
    const botName = import.meta.env.VITE_TELEGRAM_BOT_NAME;

    useEffect(() => {
        if (!botName || !containerRef.current) {
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://telegram.org/js/telegram-widget.js?22';
        script.async = true;
        script.setAttribute('data-telegram-login', botName);
        script.setAttribute('data-size', 'large');
        script.setAttribute('data-auth-url', route('social.callback', 'telegram'));
        script.setAttribute('data-request-access', 'write');

        containerRef.current.appendChild(script);

        return () => {
            if (containerRef.current) {
                containerRef.current.innerHTML = '';
            }
        };
    }, [botName]);

    if (!botName) {
        return null;
    }

    return <div ref={containerRef} className="flex justify-center" />;
}
