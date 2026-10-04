const crypto = require('crypto');

/**
 * Verifies the short-lived join token Laravel issues to each player
 * (MafiaController::mediaToken()) — a plain HMAC-signed payload, not a
 * JWT library, since the two sides only ever need to agree on one
 * narrow format. Token shape: "<base64url(payload json)>.<hex hmac>".
 * Payload: { roomCode, playerId, userId, slot, exp } (exp = unix seconds).
 *
 * This sidecar never touches the database — a verified token IS the
 * complete proof of "this connection may act as this player in this
 * room" for every signaling purpose (which room's mediasoup room to
 * join). Anything that depends on *game state* (who's currently allowed
 * to view whom) is a separate, per-request question answered by
 * authorize.js, not by this token.
 */
function verifyToken(token, secret) {
    if (typeof token !== 'string' || !token.includes('.')) {
        return null;
    }

    const [payloadB64, signature] = token.split('.');
    const expectedSignature = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');

    // Constant-time comparison — signatures are equal-length hex digests,
    // but guard the length check anyway since timingSafeEqual throws on
    // mismatched buffer lengths rather than returning false.
    if (
        signature.length !== expectedSignature.length ||
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
        return null;
    }

    let payload;
    try {
        payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    } catch {
        return null;
    }

    if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) {
        return null;
    }

    if (!payload.roomCode || !payload.playerId || !payload.slot) {
        return null;
    }

    return payload;
}

module.exports = { verifyToken };
