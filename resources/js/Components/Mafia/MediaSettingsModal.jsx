import { useEffect, useState } from 'react';
import Modal from '@/Components/Modal';
import SecondaryButton from '@/Components/SecondaryButton';
import PrimaryButton from '@/Components/PrimaryButton';
import { useLaravelReactI18n } from 'laravel-react-i18n';

/**
 * The local player's video/audio input-device picker — matches ttl10's
 * own `showSettings()` popup (`media-source.pug`): a single global picker
 * for the local player only, not something rendered per-seat. Populating
 * the `<select>` lists needs `enumerateDevices()`, which only returns
 * usable device labels/ids once a permission has already been granted —
 * this is always true here, since the settings icon that opens this modal
 * only ever renders on an already-connected local seat.
 *
 * Mounted/unmounted by the caller (not a toggled `show` prop) for the
 * same reason as SignalModal — Headless UI 2.2.10's Dialog gets stuck
 * open otherwise.
 */
export default function MediaSettingsModal({ onApply, onClose, applying = false }) {
    const { t } = useLaravelReactI18n();
    const [videoDevices, setVideoDevices] = useState([]);
    const [audioDevices, setAudioDevices] = useState([]);
    const [videoDeviceId, setVideoDeviceId] = useState('');
    const [audioDeviceId, setAudioDeviceId] = useState('');

    useEffect(() => {
        navigator.mediaDevices.enumerateDevices().then((devices) => {
            setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));
            setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
        });
    }, []);

    const apply = () => {
        onApply({ videoDeviceId: videoDeviceId || undefined, audioDeviceId: audioDeviceId || undefined });
    };

    return (
        <Modal show onClose={onClose} maxWidth="sm">
            <div className="p-6">
                <h2 className="font-heading text-lg font-bold text-ink-900">{t('mafia.media_settings_heading')}</h2>

                <div className="mt-4">
                    <label className="text-sm font-medium text-ink-700" htmlFor="mafia-video-source">
                        {t('mafia.media_settings_video_source')}
                    </label>
                    <select
                        id="mafia-video-source"
                        value={videoDeviceId}
                        onChange={(e) => setVideoDeviceId(e.target.value)}
                        className="mt-1 block w-full rounded-lg border-warm-300 text-sm text-ink-800 focus:border-primary-500 focus:ring-primary-500"
                    >
                        <option value="">{t('mafia.media_settings_default_device')}</option>
                        {videoDevices.map((d, i) => (
                            <option key={d.deviceId} value={d.deviceId}>
                                {d.label || `${t('mafia.media_settings_video_source')} ${i + 1}`}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="mt-4">
                    <label className="text-sm font-medium text-ink-700" htmlFor="mafia-audio-source">
                        {t('mafia.media_settings_audio_source')}
                    </label>
                    <select
                        id="mafia-audio-source"
                        value={audioDeviceId}
                        onChange={(e) => setAudioDeviceId(e.target.value)}
                        className="mt-1 block w-full rounded-lg border-warm-300 text-sm text-ink-800 focus:border-primary-500 focus:ring-primary-500"
                    >
                        <option value="">{t('mafia.media_settings_default_device')}</option>
                        {audioDevices.map((d, i) => (
                            <option key={d.deviceId} value={d.deviceId}>
                                {d.label || `${t('mafia.media_settings_audio_source')} ${i + 1}`}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="mt-6 flex gap-2">
                    <SecondaryButton type="button" onClick={onClose} className="flex-1 justify-center">
                        {t('mafia.media_settings_close_button')}
                    </SecondaryButton>
                    <PrimaryButton type="button" onClick={apply} disabled={applying} loading={applying} className="flex-1 justify-center">
                        {t('mafia.media_settings_apply_button')}
                    </PrimaryButton>
                </div>
            </div>
        </Modal>
    );
}
