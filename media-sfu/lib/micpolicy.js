const roomsRegistry = require('./rooms');

/**
 * Server-side microphone gating, the same idea as ttl10: the sidecar pauses
 * a player's audio producer unless the game currently lets them be heard,
 * and every listener just receives silence from a paused producer. The rule
 * itself (who may speak in which phase) lives in Laravel
 * (MafiaRoom::micPolicy()); this only asks and applies it. A modified
 * client can't bypass it — pausing is done on the server's own Producer.
 *
 * policy = { mode: 'all' | 'none' | 'only', playerIds: number[] }
 */

function mayBeHeard(policy, playerId) {
    if (policy.mode === 'all') {
        return true;
    }
    if (policy.mode === 'only') {
        return (policy.playerIds || []).includes(playerId);
    }
    return false;
}

async function applyToPeer(peer, policy) {
    const producer = peer.audioProducer;
    if (!producer) {
        return;
    }

    const allowed = mayBeHeard(policy, peer.playerId);

    if (allowed && producer.paused) {
        await producer.resume();
    } else if (!allowed && !producer.paused) {
        await producer.pause();
    }
}

async function applyToPeers(peers, policy) {
    await Promise.all(peers.map((peer) => applyToPeer(peer, policy)));
}

/**
 * Returns the policy, or null if Laravel couldn't be reached/understood —
 * callers decide whether to keep the current state or fail closed.
 */
async function fetchPolicy(roomCode) {
    const base = (process.env.LARAVEL_BASE_URL || '').replace(/\/$/, '');
    const url = `${base}/internal/mafia/mic-policy?room=${encodeURIComponent(roomCode)}`;

    try {
        const response = await fetch(url, {
            headers: { 'X-Media-Sfu-Secret': process.env.SHARED_SECRET || '' },
            signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) {
            console.error(`mic-policy request failed: HTTP ${response.status}`);
            return null;
        }
        const body = await response.json();
        if (!['all', 'none', 'only'].includes(body.mode)) {
            return null;
        }
        return body;
    } catch (error) {
        console.error('mic-policy request errored:', error.message);
        return null;
    }
}

/** Re-reads the room's policy and applies it to everyone in it. */
async function refreshRoom(roomCode) {
    const policy = await fetchPolicy(roomCode);
    if (!policy) {
        return; // keep whatever is applied now rather than guess
    }
    await applyToPeers(roomsRegistry.peersOf(roomCode), policy);
}

/**
 * A brand-new audio producer must not be audible until the policy says so:
 * unknown policy fails closed (paused), so there is no window where a
 * player is briefly heard out of turn right after joining.
 */
async function applyToNewProducer(peer) {
    const policy = (await fetchPolicy(peer.roomCode)) ?? { mode: 'none', playerIds: [] };
    await applyToPeer(peer, policy);
}

const POLL_MS = 1000;
let polling = false;

/** Safety net next to Laravel's push nudges: reconcile every room each second. */
function startPolling() {
    setInterval(async () => {
        if (polling) {
            return;
        }
        polling = true;
        try {
            await Promise.all(roomsRegistry.roomCodes().map((code) => refreshRoom(code)));
        } finally {
            polling = false;
        }
    }, POLL_MS);
}

module.exports = { mayBeHeard, applyToPeer, applyToPeers, refreshRoom, applyToNewProducer, startPolling };
