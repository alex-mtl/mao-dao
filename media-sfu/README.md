# mafia-media-sfu

A standalone mediasoup SFU signaling server for the Mafia extension's
voice/video (plan Phase 7) — **not a PHP/Laravel process**. It's a
separate Node.js service the quiz app's `Mafia/Play.jsx` page connects
to directly over WebSocket once a player clicks "Enable Camera"; the
Laravel app never runs mediasoup itself (it can't — mediasoup's worker
is a native binary with nothing to do with PHP-FPM).

The signaling protocol (message shapes, transport/producer/consumer
flow, codec list) is deliberately copied from `ttl10`'s own proven
mediasoup setup (`C:\projects\ttl10\ws\controllers\common.js`) rather
than reinvented — see each file's own comments for exactly which pieces
carried over unchanged and which are new here.

## What Laravel does and doesn't do

- **Issues a short-lived signed join token** per player
  (`MafiaController::mediaToken()`, `GET /mafia/{code}/media-token`) — a
  plain HMAC-signed payload (`lib/auth.js`), not a JWT library. This
  sidecar verifies the signature itself and never touches the database;
  a verified token is the *entire* proof of "this connection may act as
  this player in this room."
- **Answers "can this viewer see this target right now"**
  (`GET /internal/mafia/can-view`, called by `lib/authorize.js` before
  every `consume`) — visibility rules (mafia-only during sitdown/night,
  everyone during the day, nobody during the private watch/check phases)
  are real game logic (`MafiaRoom::canPlayerView()`), and this sidecar
  has no idea what a "role" or a "phase" even is. It only ever asks.
- **Does not** run mediasoup, hold any WebRTC state, or know anything
  about ICE/DTLS/RTP — all of that lives entirely in this service.

## Running it

```bash
cp .env.example .env   # fill in SHARED_SECRET (must match Laravel's
                        # MEDIA_SFU_SHARED_SECRET exactly) and LARAVEL_BASE_URL
npm install
npm start
```

Local dev: `docker-compose.yml` (one level up) has a `media-sfu` service
that runs this automatically — `docker compose up -d media-sfu`
alongside `laravel.test`/`mysql`/`reverb`/`race-tick`/`mafia-tick`.

Production: run via PM2 like every other Node process on that box
(`quiz-reverb`, `quiz-race-tick`, `quiz-mafia-tick`) — see `CLAUDE.md`'s
Phase 7 section for the exact command and the nginx WSS-proxy block it
needs (mirroring how Reverb's own port is exposed). **Not yet deployed**
— unlike every earlier phase, this one genuinely needs the account
owner's own multi-device testing (a real camera/mic exchange between two
people) before it's safe to call "done," the same reason production
login/gameplay testing needed the account owner directly.

## Files

- `server.js` — mediasoup worker/router setup (one shared router for
  every room, plain Opus + VP8, no STUN/TURN — mediasoup's own transport
  with an announced public IP), the WebSocket server, and top-level error
  handling around every dispatched message.
- `lib/signaling.js` — the actual protocol: `join`, `create-producer-transport`,
  `connect-producer-transport`, `create-producer`, `create-consumer-transport`,
  `connect-consumer-transport`, `consume`. One producer transport and one
  consumer transport per peer (shared across audio+video, distinguished
  only by `kind`), matching ttl10's model exactly.
- `lib/rooms.js` — process-local, in-memory peer registry (room code ->
  player id -> peer). Rebuilt from scratch on restart, same as every
  other in-memory registry in this project (see `CLAUDE.md`'s notes on
  `ttl10`'s `ws/data.js`) — a peer just reconnects and re-joins.
- `lib/auth.js` — join-token verification.
- `lib/authorize.js` — the per-consume call back to Laravel, with a short
  cache (a viewer's authorized set only changes on a phase transition,
  never faster) so a burst of consume requests around one phase change
  doesn't become a burst of HTTP calls for the same answer. **Fails
  closed** — a Laravel timeout or outage is never treated as "yes."

## Known limitations (be upfront about these)

- **Not yet verified with real, separate humans.** Every signaling step
  (token verification, transport/producer/consumer creation) was tested
  directly against a live server with a scripted WebSocket client — that
  proves the protocol works, not that two real cameras/microphones
  actually exchange usable audio/video end to end. That needs the
  account owner testing with a second real device.
- **No TURN server.** Mediasoup's own UDP/TCP transport (matching
  `ttl10`'s production setup) works for most residential/office
  networks, but a peer behind strict symmetric NAT or corporate/campus
  firewalls that block the configured UDP port range may simply fail to
  connect. Adding TURN is a real possibility if that turns out to matter
  in practice — not built here, since `ttl10` doesn't have it either and
  there's no evidence yet that this deployment needs it.
- **No resume-consumer / reconnect-without-full-rejoin flow.** A dropped
  WebSocket connection currently means the whole media session restarts
  from scratch (click "Enable Camera" again) rather than resuming
  in-place — matching ttl10's own behavior (it has no resume-consumer
  flow either), not a regression from it.
