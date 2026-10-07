import { useCallback, useEffect, useRef, useState } from 'react';
import * as mediasoupClient from 'mediasoup-client';

// getUserMedia failure names -> the specific, actionable message to show.
const MEDIA_ERROR_BY_NAME = {
    NotAllowedError: 'media_permission_denied',
    SecurityError: 'media_permission_denied',
    NotFoundError: 'media_device_not_found',
    NotReadableError: 'media_device_busy',
};

/**
 * Camera + mic if possible; if that combination can't be opened (no
 * camera, camera already in use by another tab/app, no microphone) fall
 * back to mic-only, then camera-only, so a missing or busy device doesn't
 * lock the player out of the call entirely. A permission denial is never
 * retried — that would just prompt the player a second time.
 */
async function acquireLocalStream() {
    const attempts = [
        { video: { width: { ideal: 192 } }, audio: true },
        { video: false, audio: true },
        { video: { width: { ideal: 192 } }, audio: false },
    ];
    let lastError;

    for (const constraints of attempts) {
        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
            lastError = err;
            if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
                throw err;
            }
        }
    }

    throw lastError;
}

/**
 * Voice/video (plan Phase 7) — connects to the standalone media-sfu
 * sidecar (never this Laravel app itself; see media-sfu/README.md),
 * following the exact signaling flow proven in ttl10's own mediasoup
 * client (one send transport and one recv transport per peer, shared
 * across both audio and video, correlated request/response envelopes).
 * Deliberately opt-in — nothing here runs until `connect()` is called
 * from a real user gesture (a button), so no camera/mic permission
 * prompt appears uninvited on page load.
 *
 * Visibility is enforced server-side, not here: a `consume` request the
 * sidecar's can-view check rejects (e.g. a citizen trying to see the
 * mafia during a night phase) simply never produces a stream — there is
 * no client-side "hide this video" logic to bypass, because the browser
 * never received the media in the first place.
 */
export default function useMafiaMedia(code) {
    const [enabled, setEnabled] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [remoteStreams, setRemoteStreams] = useState({});
    const [localStream, setLocalStream] = useState(null);
    const [error, setError] = useState(null);

    const [micEnabled, setMicEnabled] = useState(true);
    const [camEnabled, setCamEnabled] = useState(true);

    const wsRef = useRef(null);
    const deviceRef = useRef(null);
    const producerTransportRef = useRef(null);
    const consumerTransportRef = useRef(null);
    const audioProducerRef = useRef(null);
    const videoProducerRef = useRef(null);
    const pendingRequestsRef = useRef({});
    const consumedProducerIdsRef = useRef(new Set());
    const localStreamRef = useRef(null);

    const sendRequest = useCallback((data, timeoutMs = 8000) => {
        return new Promise((resolve, reject) => {
            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const timeout = setTimeout(() => {
                delete pendingRequestsRef.current[requestId];
                reject(new Error(`media-sfu request timed out: ${data.type}`));
            }, timeoutMs);

            pendingRequestsRef.current[requestId] = {
                resolve: (response) => {
                    clearTimeout(timeout);
                    resolve(response);
                },
                reject: (err) => {
                    clearTimeout(timeout);
                    reject(err);
                },
            };
            wsRef.current.send(JSON.stringify({ ...data, requestId }));
        });
    }, []);

    const consumeProducer = useCallback(async ({ playerId, kind, producerId }) => {
        if (consumedProducerIdsRef.current.has(producerId)) {
            return;
        }

        try {
            if (!consumerTransportRef.current) {
                const res = await sendRequest({ type: 'create-consumer-transport' });
                if (res.status !== 'consumer-transport-created') {
                    return;
                }
                const transport = deviceRef.current.createRecvTransport({
                    id: res.data.id,
                    iceParameters: res.data.iceParameters,
                    iceCandidates: res.data.iceCandidates,
                    dtlsParameters: res.data.dtlsParameters,
                });
                transport.on('connect', ({ dtlsParameters }, callback, errback) => {
                    sendRequest({ type: 'connect-consumer-transport', dtlsParameters }).then(callback).catch(errback);
                });
                consumerTransportRef.current = transport;
            }

            const res = await sendRequest({
                type: 'consume',
                producerId,
                kind,
                rtpCapabilities: deviceRef.current.rtpCapabilities,
            });

            // A non-"consumer-created" status (e.g. "not-authorized" while
            // this player isn't currently allowed to see that seat) is an
            // expected, silent no-op — not an error to surface.
            if (res.status !== 'consumer-created') {
                return;
            }

            consumedProducerIdsRef.current.add(producerId);
            const consumer = await consumerTransportRef.current.consume({
                id: res.data.id,
                producerId: res.data.producerId,
                kind: res.data.kind,
                rtpParameters: res.data.rtpParameters,
            });

            setRemoteStreams((prev) => {
                const stream = prev[playerId] instanceof MediaStream ? prev[playerId] : new MediaStream();
                stream.addTrack(consumer.track);
                return { ...prev, [playerId]: stream };
            });
        } catch {
            // A single failed consume (peer left mid-request, transport
            // hiccup) shouldn't take down the whole call — just skip that
            // one stream.
        }
    }, [sendRequest]);

    const connect = useCallback(async () => {
        setConnecting(true);
        setError(null);

        try {
            const { token, wsUrl } = await fetch(route('mafia.media-token', code), {
                headers: { Accept: 'application/json' },
            }).then((r) => {
                if (!r.ok) {
                    throw new Error('media_token_failed');
                }
                return r.json();
            });

            const stream = await acquireLocalStream();
            setLocalStream(stream);
            localStreamRef.current = stream;

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => ws.send(JSON.stringify({ type: 'join', token }));

            ws.onerror = () => setError('media_connection_failed');

            ws.onclose = () => setEnabled(false);

            const handleMessage = async (event) => {
                const data = JSON.parse(event.data);

                if (data.type === 'request-response') {
                    const pending = pendingRequestsRef.current[data.requestId];
                    if (pending) {
                        delete pendingRequestsRef.current[data.requestId];
                        data.status ? pending.resolve(data) : pending.reject(new Error(data.error || 'media-sfu request failed'));
                    }
                    return;
                }

                if (data.type === 'join-rejected') {
                    setError('media_join_rejected');
                    ws.close();
                    return;
                }

                if (data.type === 'joined') {
                    deviceRef.current = new mediasoupClient.Device();
                    await deviceRef.current.load({ routerRtpCapabilities: data.rtpCapabilities });

                    const transportRes = await sendRequest({ type: 'create-producer-transport' });
                    const transport = deviceRef.current.createSendTransport({
                        id: transportRes.data.id,
                        iceParameters: transportRes.data.iceParameters,
                        iceCandidates: transportRes.data.iceCandidates,
                        dtlsParameters: transportRes.data.dtlsParameters,
                    });
                    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
                        sendRequest({ type: 'connect-producer-transport', dtlsParameters }).then(callback).catch(errback);
                    });
                    transport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
                        sendRequest({ type: 'create-producer', kind, rtpParameters })
                            .then((res) => callback({ id: res.data.producerId }))
                            .catch(errback);
                    });
                    producerTransportRef.current = transport;

                    for (const track of stream.getTracks()) {
                        const producer = await transport.produce({ track });
                        if (track.kind === 'audio') {
                            audioProducerRef.current = producer;
                        } else {
                            videoProducerRef.current = producer;
                        }
                    }

                    setMicEnabled(true);
                    setCamEnabled(true);
                    setEnabled(true);
                    (data.existingProducers || []).forEach((p) => consumeProducer(p));
                    return;
                }

                if (data.type === 'producer-available') {
                    consumeProducer(data);
                    return;
                }

                if (data.type === 'peer-left') {
                    setRemoteStreams((prev) => {
                        const next = { ...prev };
                        delete next[data.playerId];
                        return next;
                    });
                }
            };
            // Errors thrown while setting up transports/producers happen in
            // an async handler no try/catch above can see — surface them
            // instead of leaving the player with a silently dead call.
            ws.onmessage = (event) => {
                handleMessage(event).catch((err) => {
                    console.error("Mafia media signaling failed:", err);
                    setError("media_setup_failed");
                    ws.close();
                });
            };
        } catch (err) {
            // Logged so a "could not start your camera" report can be
            // diagnosed from the browser console (the UI message below is
            // deliberately short).
            console.error('Mafia media setup failed:', err);
            setError(MEDIA_ERROR_BY_NAME[err?.name] ?? 'media_setup_failed');
        } finally {
            setConnecting(false);
        }
    }, [code, sendRequest, consumeProducer]);

    const disconnect = useCallback(() => {
        localStream?.getTracks().forEach((track) => track.stop());
        producerTransportRef.current?.close();
        consumerTransportRef.current?.close();
        wsRef.current?.close();
        producerTransportRef.current = null;
        consumerTransportRef.current = null;
        audioProducerRef.current = null;
        videoProducerRef.current = null;
        wsRef.current = null;
        consumedProducerIdsRef.current = new Set();
        setLocalStream(null);
        setRemoteStreams({});
        setEnabled(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localStream]);

    // Local-only mic/cam mute — ttl10's own "self mic/cam" controls are
    // gated to the lobby and post-game screens specifically (during actual
    // gameplay, mic/cam state is driven by the game phase itself, e.g. a
    // player's mic only being live during a phase they're actually
    // authorized to speak in — a separate mechanic this app doesn't
    // implement yet, see the plan doc). `producer.pause()`/`.resume()` is
    // mediasoup-client's real API for this and is confirmed purely local
    // (it just disables the underlying RTCRtpSender's track — no signaling
    // round trip to the media-sfu sidecar is needed for it to take effect
    // for every remote listener).
    const toggleMic = useCallback(() => {
        const producer = audioProducerRef.current;
        if (!producer) {
            return;
        }
        if (producer.paused) {
            producer.resume();
            setMicEnabled(true);
        } else {
            producer.pause();
            setMicEnabled(false);
        }
    }, []);

    const toggleCam = useCallback(() => {
        const producer = videoProducerRef.current;
        if (!producer) {
            return;
        }
        if (producer.paused) {
            producer.resume();
            setCamEnabled(true);
        } else {
            producer.pause();
            setCamEnabled(false);
        }
    }, []);

    // Device (input source) switching — mirrors ttl10's own
    // `saveMediaSettings()`: grab a fresh stream from the newly-chosen
    // device(s), then hand each existing producer its new track via
    // `replaceTrack` rather than tearing down and re-joining the whole
    // call. `localStream` is rebuilt (not mutated in place) so VideoTile's
    // own `srcObject` effect picks up the swapped tracks.
    const switchDevices = useCallback(async ({ videoDeviceId, audioDeviceId } = {}) => {
        const newStream = await navigator.mediaDevices.getUserMedia({
            video: videoDeviceId ? { deviceId: { exact: videoDeviceId }, width: { ideal: 192 } } : { width: { ideal: 192 } },
            audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
        });

        const newVideoTrack = newStream.getVideoTracks()[0] ?? null;
        const newAudioTrack = newStream.getAudioTracks()[0] ?? null;

        if (videoProducerRef.current && newVideoTrack) {
            await videoProducerRef.current.replaceTrack({ track: newVideoTrack });
        }
        if (audioProducerRef.current && newAudioTrack) {
            await audioProducerRef.current.replaceTrack({ track: newAudioTrack });
        }

        localStream?.getTracks().forEach((track) => track.stop());
        localStreamRef.current = newStream;
        setLocalStream(newStream);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localStream]);

    // Tear down on unmount (leaving the page) regardless of whether the
    // player explicitly disconnected first.
    useEffect(() => () => {
        wsRef.current?.close();
        producerTransportRef.current?.close();
        consumerTransportRef.current?.close();
        // Release the camera/mic itself too — otherwise the browser's
        // "camera in use" indicator stays lit after leaving the page.
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
    }, []);

    return {
        enabled,
        connecting,
        connect,
        disconnect,
        localStream,
        remoteStreams,
        error,
        micEnabled,
        camEnabled,
        toggleMic,
        toggleCam,
        switchDevices,
    };
}
