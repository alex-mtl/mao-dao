import { useEffect, useRef } from 'react';
import { usePage } from '@inertiajs/react';

const SOUNDS = {
    donSheriff: 'sheriff.mp3',
    donNotSheriff: 'not-a-sheriff.mp3',
    sheriffMafia: 'mafia.mp3',
    sheriffCitizen: 'citizen.mp3',
};

/**
 * Spoken confirmation of a night check, as in the original game: the don
 * hears "sheriff" / "not a sheriff", the sheriff hears "mafia" / "citizen".
 * Plays once per NEW result that shows up in the viewer's own check history
 * (results already there when the page loads are not replayed). Spectators
 * and everyone else have empty histories, so they hear nothing.
 */
export default function useCheckVoice(donCheckHistory, sheriffCheckHistory) {
    const { quizUrl } = usePage().props;
    const seen = useRef(null);

    useEffect(() => {
        const entries = [
            ...donCheckHistory.map((c) => ({ key: `d${c.slot}`, sound: c.isSheriff ? SOUNDS.donSheriff : SOUNDS.donNotSheriff })),
            ...sheriffCheckHistory.map((c) => ({ key: `s${c.slot}`, sound: c.isBlackTeam ? SOUNDS.sheriffMafia : SOUNDS.sheriffCitizen })),
        ];

        if (seen.current === null) {
            seen.current = new Set(entries.map((e) => e.key));
            return;
        }

        for (const entry of entries) {
            if (!seen.current.has(entry.key)) {
                seen.current.add(entry.key);
                try {
                    const audio = new Audio(`${quizUrl}/sfx/mafia/${entry.sound}`);
                    audio.volume = 0.6;
                    audio.play().catch(() => {});
                } catch {
                    // No audio support / blocked autoplay: the badge still shows the result.
                }
            }
        }
    }, [donCheckHistory, sheriffCheckHistory]);
}
