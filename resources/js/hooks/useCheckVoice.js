import { useEffect, useRef } from 'react';
import { usePage } from '@inertiajs/react';
import { useLaravelReactI18n } from 'laravel-react-i18n';

// Recorded English words (from the original game), used only when the
// browser has no speech voice for the interface language.
const FALLBACK_SOUNDS = {
    donSheriff: 'sheriff.mp3',
    donNotSheriff: 'not-a-sheriff.mp3',
    sheriffMafia: 'mafia.mp3',
    sheriffCitizen: 'citizen.mp3',
};

const SPEECH_LANG = { en: 'en-US', ru: 'ru-RU', fr: 'fr-FR', es: 'es-ES' };

/**
 * Spoken confirmation of a night check, in the interface language: e.g.
 * "Player number 4 is a citizen." — read aloud with the browser's speech synthesis. Falls back to the
 * short recorded English words when the browser has no voice for the
 * language. Plays once per NEW result in the viewer's own check history
 * (results already there on page load are not replayed). Spectators and
 * everybody else have empty histories, so they hear nothing.
 */
export default function useCheckVoice(donCheckHistory, sheriffCheckHistory) {
    const { quizUrl, locale } = usePage().props;
    const { t } = useLaravelReactI18n();
    const seen = useRef(null);

    useEffect(() => {
        const entries = [
            ...donCheckHistory.map((c) => ({
                key: `d${c.slot}`,
                text: t(c.isSheriff ? 'mafia.tts_check_is_sheriff' : 'mafia.tts_check_not_sheriff', { slot: c.slot }),
                sound: c.isSheriff ? FALLBACK_SOUNDS.donSheriff : FALLBACK_SOUNDS.donNotSheriff,
            })),
            ...sheriffCheckHistory.map((c) => ({
                key: `s${c.slot}`,
                text: t(c.isBlackTeam ? 'mafia.tts_check_black' : 'mafia.tts_check_red', { slot: c.slot }),
                sound: c.isBlackTeam ? FALLBACK_SOUNDS.sheriffMafia : FALLBACK_SOUNDS.sheriffCitizen,
            })),
        ];

        if (seen.current === null) {
            seen.current = new Set(entries.map((e) => e.key));
            return;
        }

        for (const entry of entries) {
            if (seen.current.has(entry.key)) {
                continue;
            }
            seen.current.add(entry.key);

            const lang = SPEECH_LANG[locale] ?? 'en-US';
            const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
            const voices = synth ? synth.getVoices() : [];
            // `getVoices()` can still be empty right after page load; in that
            // case let the browser pick by language rather than giving up.
            const canSpeak = Boolean(synth) && (voices.length === 0 || voices.some((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2))));

            try {
                if (canSpeak) {
                    const utterance = new SpeechSynthesisUtterance(entry.text);
                    utterance.lang = lang;
                    utterance.volume = 1;
                    synth.speak(utterance);
                } else {
                    const audio = new Audio(`${quizUrl}/sfx/mafia/${entry.sound}`);
                    audio.volume = 0.6;
                    audio.play().catch(() => {});
                }
            } catch {
                // No speech/audio support or autoplay blocked: the badge still shows the result.
            }
        }
    }, [donCheckHistory, sheriffCheckHistory]);
}
