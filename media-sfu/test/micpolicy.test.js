const test = require('node:test');
const assert = require('node:assert');

process.env.LARAVEL_BASE_URL = 'http://laravel.test';
process.env.SHARED_SECRET = 'secret';

const roomsRegistry = require('../lib/rooms');
const { mayBeHeard, applyToPeer, refreshRoom, applyToNewProducer } = require('../lib/micpolicy');

function fakeProducer() {
    return {
        paused: false,
        async pause() { this.paused = true; },
        async resume() { this.paused = false; },
    };
}

function fakePeer(roomCode, playerId) {
    const peer = { roomCode, playerId, audioProducer: fakeProducer(), videoProducer: fakeProducer() };
    roomsRegistry.addPeer(roomCode, playerId, peer);
    return peer;
}

function stubFetch(responder) {
    const real = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url: String(url), options });
        return responder(url);
    };
    return { calls, restore: () => { global.fetch = real; } };
}

const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

test('mayBeHeard: all, none and only', () => {
    assert.strictEqual(mayBeHeard({ mode: 'all', playerIds: [] }, 7), true);
    assert.strictEqual(mayBeHeard({ mode: 'none', playerIds: [] }, 7), false);
    assert.strictEqual(mayBeHeard({ mode: 'only', playerIds: [7] }, 7), true);
    assert.strictEqual(mayBeHeard({ mode: 'only', playerIds: [7] }, 8), false);
});

test('a refresh pauses everyone except the speaker and leaves video alone', async () => {
    const a = fakePeer('ROOM1', 1);
    const b = fakePeer('ROOM1', 2);
    const stub = stubFetch(() => json({ mode: 'only', playerIds: [2] }));

    await refreshRoom('ROOM1');
    stub.restore();

    assert.strictEqual(a.audioProducer.paused, true);
    assert.strictEqual(b.audioProducer.paused, false);
    assert.strictEqual(a.videoProducer.paused, false);
    assert.match(stub.calls[0].url, /room=ROOM1/);
    assert.strictEqual(stub.calls[0].options.headers['X-Media-Sfu-Secret'], 'secret');
});

test('the speaker handoff pauses the previous speaker and resumes the next', async () => {
    const a = fakePeer('ROOM2', 1);
    const b = fakePeer('ROOM2', 2);

    let stub = stubFetch(() => json({ mode: 'only', playerIds: [1] }));
    await refreshRoom('ROOM2');
    stub.restore();
    assert.deepStrictEqual([a.audioProducer.paused, b.audioProducer.paused], [false, true]);

    stub = stubFetch(() => json({ mode: 'only', playerIds: [2] }));
    await refreshRoom('ROOM2');
    stub.restore();
    assert.deepStrictEqual([a.audioProducer.paused, b.audioProducer.paused], [true, false]);
});

test('"all" resumes everybody and "none" silences everybody', async () => {
    const a = fakePeer('ROOM3', 1);
    const b = fakePeer('ROOM3', 2);

    let stub = stubFetch(() => json({ mode: 'none', playerIds: [] }));
    await refreshRoom('ROOM3');
    stub.restore();
    assert.deepStrictEqual([a.audioProducer.paused, b.audioProducer.paused], [true, true]);

    stub = stubFetch(() => json({ mode: 'all', playerIds: [] }));
    await refreshRoom('ROOM3');
    stub.restore();
    assert.deepStrictEqual([a.audioProducer.paused, b.audioProducer.paused], [false, false]);
});

test('a failed policy lookup during a refresh keeps the current state', async () => {
    const a = fakePeer('ROOM4', 1);
    await applyToPeer(a, { mode: 'none', playerIds: [] });
    assert.strictEqual(a.audioProducer.paused, true);

    const stub = stubFetch(() => { throw new Error('laravel down'); });
    await refreshRoom('ROOM4');
    stub.restore();

    assert.strictEqual(a.audioProducer.paused, true);
});

test('a new audio producer starts silent when the policy is unknown (fail closed)', async () => {
    const a = fakePeer('ROOM5', 1);
    const stub = stubFetch(() => json({}, false, 500));
    await applyToNewProducer(a);
    stub.restore();

    assert.strictEqual(a.audioProducer.paused, true);
});

test('a new audio producer is audible straight away when the policy allows it', async () => {
    const a = fakePeer('ROOM6', 1);
    await applyToPeer(a, { mode: 'none', playerIds: [] });

    const stub = stubFetch(() => json({ mode: 'all', playerIds: [] }));
    await applyToNewProducer(a);
    stub.restore();

    assert.strictEqual(a.audioProducer.paused, false);
});

test('an unrecognised policy shape is ignored', async () => {
    const a = fakePeer('ROOM7', 1);
    const stub = stubFetch(() => json({ mode: 'weird' }));
    await refreshRoom('ROOM7');
    stub.restore();

    assert.strictEqual(a.audioProducer.paused, false);
});
