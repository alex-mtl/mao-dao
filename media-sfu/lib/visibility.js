const roomsRegistry = require('./rooms');
const { invalidateRoom } = require('./authorize');

/**
 * Keeps what each viewer receives in line with the game, continuously.
 * Permission is also checked when a viewer first subscribes to a stream
 * (see signaling.js handleConsume), but a phase change must be able to
 * take a stream away that was legitimately allowed a moment ago — nightfall
 * must cut the daytime video, and spectators must never keep footage of the
 * mafia's meeting — and give it back when the day returns.
 *
 * Laravel answers "who may each of these viewers see" for the whole room in
 * one request (GET /internal/mafia/visibility), polled once a second and
 * nudged right after each phase change. A stream that is no longer allowed
 * is closed on the server and the viewer told (`consumer-revoked`); one
 * that becomes allowed again is offered afresh (`producer-available`).
 *
 * Players and spectators are both viewers here; a spectator id is "s<id>".
 */

async function fetchVisibility(roomCode, viewerIds) {
    const base = (process.env.LARAVEL_BASE_URL || '').replace(/\/$/, '');
    const url = `${base}/internal/mafia/visibility?room=${encodeURIComponent(roomCode)}&viewers=${encodeURIComponent(viewerIds.join(','))}`;

    try {
        const response = await fetch(url, {
            headers: { 'X-Media-Sfu-Secret': process.env.SHARED_SECRET || '' },
            signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) {
            console.error(`visibility request failed: HTTP ${response.status}`);
            return null;
        }

        return await response.json();
    } catch (error) {
        console.error('visibility request errored:', error.message);

        return null;
    }
}

function send(peer, message) {
    try {
        peer.ws.send(JSON.stringify(message));
    } catch {
        // The connection is going away; its own close handler cleans up.
    }
}

/** Applies a visibility map ({viewerId: [visible player ids]}) to a room's peers. */
function applyVisibility(peers, visibility) {
    for (const viewer of peers) {
        const visible = new Set((visibility[String(viewer.playerId)] ?? []).map(String));

        for (const target of peers) {
            if (target === viewer || target.isSpectator) {
                continue;
            }

            const canSee = visible.has(String(target.playerId));

            for (const [kind, producer] of [['video', target.videoProducer], ['audio', target.audioProducer]]) {
                if (!producer) {
                    continue;
                }

                const current = viewer.consumers?.get(producer.id);

                if (current && !canSee) {
                    current.consumer.close();
                    viewer.consumers.delete(producer.id);
                    viewer.revoked.add(producer.id);
                    send(viewer, { type: 'consumer-revoked', playerId: target.playerId, kind, producerId: producer.id });
                } else if (!current && canSee && viewer.revoked?.has(producer.id)) {
                    viewer.revoked.delete(producer.id);
                    send(viewer, {
                        type: 'producer-available',
                        playerId: target.playerId,
                        slot: target.slot,
                        kind,
                        producerId: producer.id,
                    });
                }
            }
        }
    }
}

/**
 * `fresh` drops the cached per-pair answers first — right after a phase
 * change the cache would otherwise keep serving the old phase for a moment.
 */
async function syncRoomVisibility(roomCode, { fresh = false } = {}) {
    if (fresh) {
        invalidateRoom(roomCode);
    }

    const peers = roomsRegistry.peersOf(roomCode);
    if (peers.length < 2) {
        return;
    }

    const visibility = await fetchVisibility(roomCode, peers.map((peer) => String(peer.playerId)));
    if (!visibility) {
        return; // keep whatever is in place rather than guess
    }

    applyVisibility(peers, visibility);
}

const POLL_MS = 1000;
let polling = false;

function startVisibilityPolling() {
    setInterval(async () => {
        if (polling) {
            return;
        }
        polling = true;
        try {
            await Promise.all(roomsRegistry.roomCodes().map((code) => syncRoomVisibility(code)));
        } finally {
            polling = false;
        }
    }, POLL_MS);
}

module.exports = { applyVisibility, syncRoomVisibility, startVisibilityPolling };
