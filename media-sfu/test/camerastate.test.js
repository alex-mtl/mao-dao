const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

process.env.SHARED_SECRET = 'secret';

const roomsRegistry = require('../lib/rooms');
const { dispatch, handleCameraState } = require('../lib/signaling');

function fakeProducer() {
    return {
        id: `p-${Math.random().toString(36).slice(2)}`,
        paused: false,
        async pause() { this.paused = true; },
        async resume() { this.paused = false; },
    };
}

function fakeWs() {
    return { sent: [], send(raw) { this.sent.push(JSON.parse(raw)); }, close() {} };
}

function addPeer(roomCode, playerId) {
    const ws = fakeWs();
    const peer = { ws, roomCode, playerId, slot: playerId, videoProducer: fakeProducer(), audioProducer: fakeProducer(), cameraOn: true };
    ws.peer = peer;
    roomsRegistry.addPeer(roomCode, playerId, peer);
    return { ws, peer };
}

function token(roomCode, playerId) {
    const payload = Buffer.from(JSON.stringify({
        roomCode, playerId, userId: playerId, slot: playerId, exp: Math.floor(Date.now() / 1000) + 60,
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', 'secret').update(payload).digest('hex');

    return `${payload}.${signature}`;
}

test('switching the camera off pauses the video producer and tells everyone else, but not audio', async () => {
    const a = addPeer('CAM1', 1);
    const b = addPeer('CAM1', 2);

    await handleCameraState(a.ws, { enabled: false });

    assert.strictEqual(a.peer.cameraOn, false);
    assert.strictEqual(a.peer.videoProducer.paused, true);
    assert.strictEqual(a.peer.audioProducer.paused, false);
    assert.deepStrictEqual(b.ws.sent, [{ type: 'camera-state', playerId: 1, enabled: false }]);
    assert.deepStrictEqual(a.ws.sent, []);
});

test('switching it back on resumes the producer and tells everyone', async () => {
    const a = addPeer('CAM2', 1);
    const b = addPeer('CAM2', 2);
    await handleCameraState(a.ws, { enabled: false });
    b.ws.sent.length = 0;

    await handleCameraState(a.ws, { enabled: true });

    assert.strictEqual(a.peer.videoProducer.paused, false);
    assert.deepStrictEqual(b.ws.sent, [{ type: 'camera-state', playerId: 1, enabled: true }]);
});

test('a peer without a video producer (no camera) can still report its state', async () => {
    const a = addPeer('CAM3', 1);
    a.peer.videoProducer = null;

    await handleCameraState(a.ws, { enabled: false });

    assert.strictEqual(a.peer.cameraOn, false);
});

test('a newcomer is told who already has their camera off', async () => {
    const a = addPeer('CAM4', 1);
    addPeer('CAM4', 2);
    await handleCameraState(a.ws, { enabled: false });

    const newcomer = fakeWs();
    await dispatch(newcomer, { rtpCapabilities: {} }, { type: 'join', token: token('CAM4', 3) });

    const joined = newcomer.sent.find((m) => m.type === 'joined');
    assert.deepStrictEqual(joined.cameraOff, [1]);
});

test('camera-state from a connection that never joined is ignored', async () => {
    const stray = fakeWs();

    await dispatch(stray, {}, { type: 'camera-state', enabled: false });

    assert.deepStrictEqual(stray.sent, []);
});
