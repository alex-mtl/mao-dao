const test = require('node:test');
const assert = require('node:assert');

process.env.LARAVEL_BASE_URL = 'http://laravel.test';
process.env.SHARED_SECRET = 'secret';

const roomsRegistry = require('../lib/rooms');
const { applyVisibility, syncRoomVisibility } = require('../lib/visibility');

function producer(id) {
    return { id, paused: false };
}

function peer(roomCode, playerId, { spectator = false, video = true, audio = true } = {}) {
    const sent = [];
    const p = {
        roomCode,
        playerId,
        slot: typeof playerId === 'number' ? playerId : null,
        isSpectator: spectator,
        ws: { send: (raw) => sent.push(JSON.parse(raw)) },
        sent,
        consumers: new Map(),
        revoked: new Set(),
        videoProducer: !spectator && video ? producer(`v-${playerId}`) : null,
        audioProducer: !spectator && audio ? producer(`a-${playerId}`) : null,
    };
    roomsRegistry.addPeer(roomCode, playerId, p);

    return p;
}

// What the viewer currently receives from a target.
function consume(viewer, target, kind = 'video') {
    const closed = { value: false };
    const producerId = kind === 'video' ? target.videoProducer.id : target.audioProducer.id;
    viewer.consumers.set(producerId, {
        consumer: { close: () => { closed.value = true; } },
        targetPlayerId: target.playerId,
        kind,
        closed,
    });

    return closed;
}

test('a stream that is no longer allowed is closed and the viewer told, others are left alone', () => {
    const a = peer('VIS1', 1);
    const b = peer('VIS1', 2);
    const c = peer('VIS1', 3);
    const closedB = consume(a, b);
    const closedC = consume(a, c);

    // Night falls: a may now see c only.
    applyVisibility([a, b, c], { 1: [3], 2: [], 3: [] });

    assert.strictEqual(closedB.value, true);
    assert.strictEqual(closedC.value, false);
    assert.deepStrictEqual(a.sent, [{ type: 'consumer-revoked', playerId: 2, kind: 'video', producerId: 'v-2' }]);
    assert.ok(a.revoked.has('v-2'));
    assert.ok(!a.consumers.has('v-2'));
});

test('both audio and video of a hidden player are taken away', () => {
    const a = peer('VIS2', 1);
    const b = peer('VIS2', 2);
    consume(a, b, 'video');
    consume(a, b, 'audio');

    applyVisibility([a, b], { 1: [], 2: [] });

    assert.deepStrictEqual(a.sent.map((m) => m.kind).sort(), ['audio', 'video']);
});

test('when the day returns, the streams that were taken away are offered again', () => {
    const a = peer('VIS3', 1);
    const b = peer('VIS3', 2);
    consume(a, b);
    applyVisibility([a, b], { 1: [], 2: [] });
    a.sent.length = 0;

    applyVisibility([a, b], { 1: [2], 2: [1] });

    assert.deepStrictEqual(a.sent, [
        { type: 'producer-available', playerId: 2, slot: 2, kind: 'video', producerId: 'v-2' },
    ]);
    assert.ok(!a.revoked.has('v-2'));
});

test('a stream refused at subscribe time (revoked set) is offered once it becomes allowed', () => {
    const a = peer('VIS4', 1);
    const b = peer('VIS4', 2);
    a.revoked.add('v-2');

    applyVisibility([a, b], { 1: [2], 2: [] });

    assert.strictEqual(a.sent.length, 1);
    assert.strictEqual(a.sent[0].type, 'producer-available');
});

test('nothing is re-offered that was never refused or revoked, and nothing is repeated', () => {
    const a = peer('VIS5', 1);
    const b = peer('VIS5', 2);

    applyVisibility([a, b], { 1: [2], 2: [1] });
    assert.deepStrictEqual(a.sent, []);

    a.revoked.add('v-2');
    applyVisibility([a, b], { 1: [2], 2: [1] });
    applyVisibility([a, b], { 1: [2], 2: [1] });
    assert.strictEqual(a.sent.length, 1);
});

test('a spectator is a viewer like any other (string id), and is never a target', () => {
    const player = peer('VIS6', 1);
    const spectator = peer('VIS6', 's7', { spectator: true });
    const closed = consume(spectator, player);

    applyVisibility([player, spectator], { 1: [], s7: [] });

    assert.strictEqual(closed.value, true);
    assert.strictEqual(spectator.sent[0].type, 'consumer-revoked');
    assert.deepStrictEqual(player.sent, []);
});

test('a viewer missing from the answer sees nobody (fail closed)', () => {
    const a = peer('VIS7', 1);
    const b = peer('VIS7', 2);
    const closed = consume(a, b);

    applyVisibility([a, b], { 2: [1] });

    assert.strictEqual(closed.value, true);
});

test('syncRoomVisibility asks Laravel once for the whole room, with every viewer id', async () => {
    const a = peer('VIS8', 1);
    const b = peer('VIS8', 2);
    peer('VIS8', 's3', { spectator: true });
    const closed = consume(a, b);

    const real = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        return { ok: true, status: 200, json: async () => ({ 1: [], 2: [1], s3: [] }) };
    };
    await syncRoomVisibility('VIS8', { fresh: true });
    global.fetch = real;

    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /room=VIS8/);
    assert.match(decodeURIComponent(calls[0].url), /viewers=1,2,s3/);
    assert.strictEqual(calls[0].options.headers['X-Media-Sfu-Secret'], 'secret');
    assert.strictEqual(closed.value, true);
});

test('a failed lookup leaves everything as it is', async () => {
    const a = peer('VIS9', 1);
    const b = peer('VIS9', 2);
    const closed = consume(a, b);

    const real = global.fetch;
    global.fetch = async () => { throw new Error('laravel down'); };
    await syncRoomVisibility('VIS9');
    global.fetch = real;

    assert.strictEqual(closed.value, false);
    assert.deepStrictEqual(a.sent, []);
});
