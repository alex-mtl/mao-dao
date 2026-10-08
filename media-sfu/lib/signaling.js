const { verifyToken } = require('./auth');
const { canView } = require('./authorize');
const roomsRegistry = require('./rooms');
const { applyToNewProducer } = require('./micpolicy');

/**
 * The full signaling protocol, adapted directly from ttl10's proven
 * ws/controllers/common.js (see the research summary this was built
 * from) rather than reinvented — same message shape (a generic
 * `request-response` envelope correlated by a client-generated
 * `requestId`), same one-producer-transport/one-consumer-transport-per-
 * peer model (shared across both audio and video, distinguished only by
 * `kind`), same bare Opus+VP8 codec list, no STUN/TURN (mediasoup's own
 * UDP/TCP transport with an announced public IP is enough, matching
 * ttl10's own production setup). The one deliberate addition ttl10
 * doesn't have: every `consume` request is authorized against Laravel's
 * game rules first (see authorize.js) — ttl10 has no equivalent because
 * its game and its media server are the same process; here they're
 * deliberately separate, so "can this viewer see this target right now"
 * has to be asked explicitly instead of being implicit in shared memory.
 */
function respond(ws, requestId, status, data = {}, error = null) {
    const message = { type: 'request-response', requestId, status };
    if (error) {
        message.error = error;
    } else {
        message.data = data;
    }
    ws.send(JSON.stringify(message));
}

function broadcastToRoom(roomCode, exceptPlayerId, message) {
    roomsRegistry.otherPeers(roomCode, exceptPlayerId).forEach((peer) => {
        peer.ws.send(JSON.stringify(message));
    });
}

function handleJoin(ws, router, data) {
    const payload = verifyToken(data.token, process.env.SHARED_SECRET || '');
    if (!payload) {
        ws.send(JSON.stringify({ type: 'join-rejected', error: 'Invalid or expired token' }));
        ws.close();
        return;
    }

    const peer = {
        ws,
        roomCode: payload.roomCode,
        playerId: payload.playerId,
        slot: payload.slot,
        producerTransport: null,
        consumerTransport: null,
        videoProducer: null,
        audioProducer: null,
        cameraOn: true,
        // A spectator only listens and watches: it may never produce.
        isSpectator: payload.role === 'spectator',
        // producerId -> { consumer, targetPlayerId, kind } for what this
        // viewer is currently receiving, and producerIds it was refused or
        // had taken away (so they can be offered again when allowed).
        consumers: new Map(),
        revoked: new Set(),
    };
    ws.peer = peer;
    roomsRegistry.addPeer(peer.roomCode, peer.playerId, peer);

    ws.send(JSON.stringify({
        type: 'joined',
        playerId: peer.playerId,
        slot: peer.slot,
        rtpCapabilities: router.rtpCapabilities,
        // So a newly-joined peer immediately knows who else is already
        // producing, instead of waiting for their next producer-available
        // broadcast (which only fires on a *new* produce, not a re-join).
        // Who has switched their camera off, so a newcomer shows an avatar
        // instead of a frozen/black frame for them from the first moment.
        cameraOff: roomsRegistry.otherPeers(peer.roomCode, peer.playerId)
            .filter((other) => other.cameraOn === false)
            .map((other) => other.playerId),
        existingProducers: roomsRegistry.otherPeers(peer.roomCode, peer.playerId).flatMap((other) => [
            other.videoProducer && { playerId: other.playerId, slot: other.slot, kind: 'video', producerId: other.videoProducer.id },
            other.audioProducer && { playerId: other.playerId, slot: other.slot, kind: 'audio', producerId: other.audioProducer.id },
        ].filter(Boolean)),
    }));

    broadcastToRoom(peer.roomCode, peer.playerId, { type: 'peer-joined', playerId: peer.playerId, slot: peer.slot });
}

/**
 * A player switched their camera on or off. The server-side video producer
 * is paused to match (no point forwarding a dead picture), and everyone
 * else is told so their seat can show the avatar instead of a black frame.
 */
async function handleCameraState(ws, data) {
    const peer = ws.peer;
    peer.cameraOn = data.enabled === true;

    if (peer.videoProducer) {
        if (peer.cameraOn && peer.videoProducer.paused) {
            await peer.videoProducer.resume();
        } else if (!peer.cameraOn && !peer.videoProducer.paused) {
            await peer.videoProducer.pause();
        }
    }

    broadcastToRoom(peer.roomCode, peer.playerId, {
        type: 'camera-state',
        playerId: peer.playerId,
        enabled: peer.cameraOn,
    });
}

async function handleCreateProducerTransport(ws, router, data) {
    const peer = ws.peer;
    if (peer.isSpectator) {
        respond(ws, data.requestId, false, {}, 'Spectators cannot send audio or video');
        return;
    }
    const transport = await router.createWebRtcTransport({
        listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.PUBLIC_IP }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
    });
    peer.producerTransport = transport;

    respond(ws, data.requestId, 'producer-transport-created', {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
    });
}

async function handleConnectProducerTransport(ws, data) {
    const peer = ws.peer;
    if (!peer.producerTransport) {
        respond(ws, data.requestId, false, {}, 'No producer transport — reload and try again');
        return;
    }
    await peer.producerTransport.connect({ dtlsParameters: data.dtlsParameters });
    respond(ws, data.requestId, 'transport-connected', { transportId: peer.producerTransport.id });
}

async function handleCreateProducer(ws, data) {
    const peer = ws.peer;
    if (peer.isSpectator) {
        respond(ws, data.requestId, false, {}, 'Spectators cannot send audio or video');
        return;
    }
    if (!peer.producerTransport) {
        respond(ws, data.requestId, false, {}, 'No producer transport — reload and try again');
        return;
    }

    const producer = await peer.producerTransport.produce({ kind: data.kind, rtpParameters: data.rtpParameters });
    if (data.kind === 'video') {
        peer.videoProducer = producer;
    } else {
        peer.audioProducer = producer;
        // Not audible until the game's mic policy says this player may be
        // heard (fails closed if Laravel can't be asked).
        await applyToNewProducer(peer);
    }

    respond(ws, data.requestId, 'producer-created', { producerId: producer.id, kind: data.kind });

    broadcastToRoom(peer.roomCode, peer.playerId, {
        type: 'producer-available',
        playerId: peer.playerId,
        slot: peer.slot,
        kind: data.kind,
        producerId: producer.id,
    });
}

async function handleCreateConsumerTransport(ws, router, data) {
    const peer = ws.peer;
    if (!peer.consumerTransport) {
        peer.consumerTransport = await router.createWebRtcTransport({
            listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.PUBLIC_IP }],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
        });
    }
    const transport = peer.consumerTransport;

    respond(ws, data.requestId, 'consumer-transport-created', {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
    });
}

async function handleConnectConsumerTransport(ws, data) {
    const peer = ws.peer;
    if (!peer.consumerTransport) {
        respond(ws, data.requestId, false, {}, 'No consumer transport — reload and try again');
        return;
    }
    await peer.consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
    respond(ws, data.requestId, 'transport-connected', { transportId: peer.consumerTransport.id });
}

async function handleConsume(ws, router, data) {
    const peer = ws.peer;
    const targetPeer = roomsRegistry.findPeerByProducerId(peer.roomCode, data.producerId);
    if (!targetPeer) {
        respond(ws, data.requestId, false, {}, 'Producer not found (they may have left)');
        return;
    }

    const allowed = await canView(peer.roomCode, peer.playerId, targetPeer.playerId);
    if (!allowed) {
        // Remember it, so the stream can be offered again the moment this
        // viewer is allowed to see that player (see visibility.js).
        peer.revoked.add(data.producerId);
        respond(ws, data.requestId, 'not-authorized', {}, 'Not allowed to view this player right now');
        return;
    }

    const producer = data.kind === 'video' ? targetPeer.videoProducer : targetPeer.audioProducer;
    if (!producer) {
        respond(ws, data.requestId, false, {}, 'That player has no active producer of this kind');
        return;
    }

    if (!router.canConsume({ producerId: producer.id, rtpCapabilities: data.rtpCapabilities })) {
        respond(ws, data.requestId, false, {}, "Router says this client can't consume this producer");
        return;
    }

    if (!peer.consumerTransport) {
        respond(ws, data.requestId, false, {}, 'No consumer transport — reload and try again');
        return;
    }

    const consumer = await peer.consumerTransport.consume({
        producerId: producer.id,
        rtpCapabilities: data.rtpCapabilities,
        paused: false,
    });

    peer.revoked.delete(producer.id);
    peer.consumers.set(producer.id, { consumer, targetPlayerId: targetPeer.playerId, kind: data.kind });
    const forget = () => peer.consumers.delete(producer.id);
    consumer.on('producerclose', forget);
    consumer.on('transportclose', forget);

    respond(ws, data.requestId, 'consumer-created', {
        id: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
    });
}

function handleClose(ws) {
    const peer = ws.peer;
    if (!peer) {
        return;
    }
    peer.videoProducer?.close();
    peer.audioProducer?.close();
    peer.producerTransport?.close();
    peer.consumerTransport?.close();
    roomsRegistry.removePeer(peer.roomCode, peer.playerId);
    broadcastToRoom(peer.roomCode, peer.playerId, { type: 'peer-left', playerId: peer.playerId, slot: peer.slot });
}

async function dispatch(ws, router, data) {
    if (data.type !== 'join' && !ws.peer) {
        console.warn(`Ignoring "${data.type}" from a connection that never joined`);
        return;
    }

    switch (data.type) {
        case 'join':
            return handleJoin(ws, router, data);
        case 'create-producer-transport':
            return handleCreateProducerTransport(ws, router, data);
        case 'connect-producer-transport':
            return handleConnectProducerTransport(ws, data);
        case 'create-producer':
            return handleCreateProducer(ws, data);
        case 'create-consumer-transport':
            return handleCreateConsumerTransport(ws, router, data);
        case 'connect-consumer-transport':
            return handleConnectConsumerTransport(ws, data);
        case 'consume':
            return handleConsume(ws, router, data);
        case 'camera-state':
            return handleCameraState(ws, data);
        default:
            console.warn('Unknown message type:', data.type);
    }
}

module.exports = { dispatch, handleClose, handleCameraState };
