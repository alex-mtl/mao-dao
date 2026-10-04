// roomCode -> Map(playerId -> peer). Process-local and rebuilt from
// scratch on restart, exactly like ttl10's equivalent in-memory
// registries (see CLAUDE.md's notes on ws/data.js) — a peer just
// reconnects and re-joins after a restart, there's no state here worth
// persisting.
const rooms = new Map();

function room(roomCode) {
    if (!rooms.has(roomCode)) {
        rooms.set(roomCode, new Map());
    }
    return rooms.get(roomCode);
}

function addPeer(roomCode, playerId, peer) {
    room(roomCode).set(playerId, peer);
}

function removePeer(roomCode, playerId) {
    const r = rooms.get(roomCode);
    if (!r) {
        return;
    }
    r.delete(playerId);
    if (r.size === 0) {
        rooms.delete(roomCode);
    }
}

function getPeer(roomCode, playerId) {
    return rooms.get(roomCode)?.get(playerId) ?? null;
}

function otherPeers(roomCode, exceptPlayerId) {
    const r = rooms.get(roomCode);
    if (!r) {
        return [];
    }
    return [...r.values()].filter((peer) => peer.playerId !== exceptPlayerId);
}

/**
 * Finds whichever peer in the room currently owns a producer with this
 * id — rooms are at most 10 peers, so a plain scan is simpler and
 * plenty fast enough than maintaining a second producerId->peer index.
 */
function findPeerByProducerId(roomCode, producerId) {
    const r = rooms.get(roomCode);
    if (!r) {
        return null;
    }
    for (const peer of r.values()) {
        if (peer.videoProducer?.id === producerId || peer.audioProducer?.id === producerId) {
            return peer;
        }
    }
    return null;
}

module.exports = { addPeer, removePeer, getPeer, otherPeers, findPeerByProducerId };
