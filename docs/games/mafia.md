# Game: Mafia (second game of the platform)

Built per `../Mafia Extension — MVP Requirements and Implementation Plan.md`
(one level up), phased like Race Mode was: 1) data model, 2) room/lobby,
3) day/night core loop, 4) disconnection/discipline, 5) polish, 6)
production routing, 7) voice/video — **all 7 phases are built** (257
Pest tests passing locally; Phases 1–6 are live at
`https://mao-dao.com/mafia/`). Discipline/warnings (the other half of
the plan's original Phase 4) was **not** built — see the dedicated note
further down. **Phase 7 (voice/video) is code-complete and locally
verified to the extent this environment allows, but deliberately NOT
deployed to production** — see its own section below for exactly why and
what's still needed. Nobody has played a real multi-person game on
production yet at all (video or otherwise), since that needs a second
real account to test with, not just single-player verification.


Platform-wide rules (languages, themes, auth, deployment, the /quiz-vs-/mafia
routing and root-URL traps) live in the main [`CLAUDE.md`](../../CLAUDE.md);
"gotcha #N" references below point to its numbered list.

## Details by area

**Deployed**: migrations run, `mafia-tick` PM2 process
(`quiz-mafia-tick`) added alongside `quiz-reverb`/`quiz-race-tick`
(reuses the same Reverb instance/port 8380 — no new WebSocket
infrastructure), nginx reloaded, config cached. Not yet done: nobody has
played an actual multi-account game through production — that needs the
account owner to test with a second real login, the same reason Race
Mode's production Reverb rollout was verified by the user directly
rather than by Claude logging in.
- **Phase 5 delivered**: the hidden-communication signal panel
  (`MafiaController::signal()`, `MafiaSignalReceived`,
  `resources/js/Components/Mafia/SignalPanel.jsx`) — the first real use
  of the private per-player channel scaffolded back in Phase 2, since a
  covert signal is a one-off, ephemeral notification that genuinely needs
  prompt, targeted delivery, unlike everything else in this app which
  uses the "public ping, then authenticated fetch" pattern. `useMafiaChannel`
  now takes an optional third `mafiaPlayerId` argument to subscribe to
  that private channel and returns a third `dismissSignal` value; only
  `Mafia/Play.jsx` passes it (Lobby has no signals to receive). A game-history
  page (`GET /mafia/history` — note its route registration order,
  *before* the `{code}` wildcard route, or "history" gets swallowed as a
  room code) mirrors `QuizAttemptController::history()`'s shape. `Badge.jsx`
  now spreads extra props (e.g. `aria-label`) — a small, purely-additive
  shared-component change made to support the countdown timer's
  accessible label.

- **No host-clicked "Start" button — matches ttl10 exactly.** The game
  auto-starts the instant every currently-seated player is ready
  (`MafiaController::ready()`), not on a separate host action. The
  original plan draft had copied Race Mode's explicit-start pattern into
  its route list; that was a mistake caught during Phase 2 implementation
  and corrected (see the plan doc's §6 correction note) — `ttl10`'s own
  `mafia.js` has no manual-start path at all, only ready-triggered
  auto-start (`gamePlayerStatus`/`gameStart`).
- **Gotcha — Reverb must be running even for manual/browser dev testing,
  not just for `mafia:tick`.** Unlike Pest tests (`BROADCAST_CONNECTION=null`
  in `phpunit.xml`, so event dispatch is a safe no-op), the real dev
  `.env` has `BROADCAST_CONNECTION=reverb`. Every Mafia action that
  dispatches a `ShouldBroadcastNow` event (join/ready/leave) **hangs the
  entire HTTP request** if the `reverb` docker-compose service isn't
  running — it's not a fast connection-refused, it's a long stall trying
  to publish to an unreachable server. This cost real debugging time
  during Phase 2's manual verification (a "stuck" ready-toggle button
  turned out to be exactly this, not an application bug). Always
  `docker compose up -d reverb` (in addition to `laravel.test`/`mysql`)
  before manually testing anything in Mafia or Race Mode through a
  browser.

- **Source of truth for gameplay rules**: `C:\projects\ttl10`, a separate
  Node.js app that already runs this game in production — its
  `ws/controllers/host.js`/`mafia.js` are canonical. This Laravel build is
  a from-scratch reimplementation of the same rules, not a port of the
  code or a proxy to that app. Keep using its terminology verbatim
  (`sitdown`, `don_watch`, `shooting`, "lock motion", "shout-out", etc.)
  rather than inventing synonyms.
- **Data model**: `mafia_rooms` / `mafia_players` / `mafia_actions` — see
  `App\Models\MafiaRoom`/`MafiaPlayer`/`MafiaAction`. Unlike Race Mode,
  night/day activity is an **append-only action log**
  (`mafia_actions`, `MafiaAction::UPDATED_AT = null`) rather than one
  mutable JSON blob — phase-resolution logic queries it directly instead
  of hand-parsing JSON, and it's what makes the vote-tally/shoot-unanimity
  services below trivially unit-testable.
- **Fixed 10-seat table, always** (`config('mafia.seats')`,
  `config('mafia.role_deck')`: 6 citizen / 1 sheriff / 2 mafia / 1 don).
  **A seat nobody joined still gets dealt a role and stays in the game as
  a "dummy"** (`MafiaPlayer::isDummy()`, true when `user_id` is null) —
  it's always "alive" and still counts toward its team in the win check,
  it just never speaks or acts. This is why `mafia_players.user_id` is
  nullable even though real players are otherwise accounts-only (no guest
  play, unlike Race Mode) — don't "fix" that nullability without
  re-reading plan §7/§10 first.
- **Pure, directly-testable rule engines** (`app/Services/Mafia/`), each
  with no Eloquent/HTTP dependency so they're unit-tested with plain
  arrays/collections:
  - `MafiaShootResolver` — the mafia's nightly kill only resolves if
    *every* living black-team member submitted the *same* target; one
    missing vote or disagreement means no kill.
  - `MafiaVoteTallyService` — tallies one round of day-phase voting; a
    living voter who never explicitly voted defaults to the **last**
    candidate in nomination order. Deciding what to do with a tie
    (defense-speech re-vote vs. the "Eliminate ALL" lock motion) is
    day-phase state-machine logic that belongs to a later phase, not this
    class — it only turns votes into counts.
  - `MafiaDisciplineService` — the warning ladder (3rd warning shortens
    the next speech to 10s, 4th disqualifies outright).
  - `MafiaRoom::checkWinner()` lives on the model (matching how
    `RaceRoom::leaderboard()` does), not a separate service — it's a
    single query + two comparisons, not worth extracting.
- **`MafiaTickService` is now just the thin "find due rooms" loop
  wrapper** — all real phase logic lives in `App\Services\Mafia\MafiaGameEngine`
  (Phase 3), which it calls for every room whose `phase_deadline_at` has
  passed. There is **no manual-host mode built** (a deliberate MVP
  simplification, decided in Phase 2 — `autohost` is fixed `true`,
  nothing in the UI lets a human drive phases by hand), so `MafiaGameEngine`
  is the *only* thing that ever transitions a room; controller actions
  (nominate/vote/shoot/checks/pass) only ever record a `MafiaAction` row,
  never a transition. `pass()` is the one action that visibly speeds
  things up, and it does so by setting `phase_deadline_at` to now — the
  very next tick (≤500ms later) then resolves the stage exactly as if the
  timer had run out for real, so there's still only one code path for
  "this stage is over."
- **Day's internal sub-steps use a second field, `mafia_rooms.stage`**
  (nullable string), alongside the existing `status` — mirroring how
  ttl10 itself splits a top-level `phase` from a finer-grained `stage`.
  `status` covers every top-level phase from the plan; `stage` only
  matters while `status === 'day'`, cycling through `speaking` →
  `voting` → (`defense_speech` → `voting` again, on a shrinking tie) →
  `lock_vote` (on a persistent tie) → `last_speech` → back to `speaking`
  or on to `night`; a day that opens on a night kill starts with
  `morning_speech` first (the victim's narrative last word, no status
  change). `mafia_rooms.state` (JSON) is the day's scratch pad —
  speaking order, the voting queue, tie history, pending eliminations —
  for whatever the current stage needs to track that isn't itself a
  logged action; see the migration's comment and `MafiaGameEngine`'s
  class docblock for the full shape and the "latest action per actor per
  round wins" convention applied uniformly to votes/lock-votes/shots.
- **Real-time architecture landed on "public ping, then authenticated
  fetch" instead of the scaffolded private channel.** `MafiaPhaseChanged`
  (broadcast on every transition) carries only status/stage/day/deadline
  — never a role, a check result, or who voted for what — and
  `useMafiaChannel.js` treats it purely as a signal to re-fetch
  `/mafia/{code}/state`, which *is* authenticated and *does* return
  hidden information scoped to the requesting player
  (`MafiaController::roomSnapshot()`). This achieves the same privacy
  guarantee as the private per-player Echo channel scaffolded in Phase 2
  without needing Laravel's private-channel broadcasting-auth wired up
  client-side — that scaffold is still there and still valid, just
  unused for now. Don't add broadcast payloads containing hidden
  information without re-reading this reasoning first.
- **`MafiaActionRecorded` extends the same "public ping" pattern to every
  in-stage action, not just phase transitions.** Originally only
  `MafiaPhaseChanged` broadcast anything, so a nomination, a vote, a
  lock-vote, a shoot, a check, or a disconnect-vote recorded silently —
  other players only found out once the next actual phase transition
  happened to broadcast, or the 12s heartbeat poll landed. Reported
  directly as "not real-time" (see gotcha #12 above for the *other*,
  bigger reason it looked that way). `MafiaController::recordAction()`
  (the one shared choke point every action type above already calls)
  now dispatches `MafiaActionRecorded` itself — carries no payload, same
  privacy reasoning as `MafiaPhaseChanged`, `useMafiaChannel.js` just
  resyncs on receipt. `signal` still has its own separate, private,
  targeted broadcast (`MafiaSignalReceived`) since that one genuinely is
  sensitive point-to-point data, unlike this.
- **Gotcha — a page whose `initialState` is rebuilt inline on every
  render will infinite-loop `useMafiaChannel`.** The hook re-applies
  fresh Inertia props into its local state on every render of the
  `initialState` prop (needed so a plain action redirect — e.g. casting a
  vote — actually shows up without waiting for an unrelated WebSocket
  push; this was a real bug caught during Phase 3 manual testing, the
  same staleness class as the locale/color-scheme sync gotchas above).
  If a page passes `useMafiaChannel(code, { ...spread of individual props
  } )` inline, that object is a **new reference every render**, so the
  sync effect fires every render, which re-renders the page, which
  rebuilds the object again — forever. The fix (already applied): the
  controller nests the whole mutable snapshot under one Inertia prop key
  (`'snapshot' => [...]`, not spread at the top level) so
  `Mafia/Lobby.jsx`/`Mafia/Play.jsx` receive one Inertia-managed,
  reference-stable object to pass straight through. Don't go back to
  spreading top-level props for a page that uses this hook.
- **Checks have no "target must be alive" filter — this was a real bug,
  fixed during Phase 3.** The check phase runs immediately after
  shooting, so the target may already be dead from *that same night's*
  kill; the corrected rule (plan §7) requires the check to still work and
  return the true result regardless. `MafiaController::recordCheck()`
  looks the target up with a plain `find()`, not `where('status',
  'alive')` — don't reintroduce that filter.
- **`MafiaGameEngine::beginSpeakingOrder()` DOES match ttl10's rotating
  start-offset** (`host.js`'s `nextSpeaker`, gated on `slot >=
  room.game.day`) — day 1 starts at slot 1, day 2 starts at slot 2 (so
  slot 1 ends up speaking last that day), day 3 at slot 3, and so on,
  wrapping back through 1 via `(current_day - 1) % config('mafia.seats')
  + 1` once the day count passes the table size. This was fixed and
  tested (`MafiaGameEngineTest.php`'s "day 2 discussion starts at slot 2
  ... matching ttl10's rotating start-offset") but the fix **shipped to
  this repo without ever being deployed** — every other narrowly-scoped
  deploy this session touched other files and never happened to include
  `MafiaGameEngine.php`, so production ran the old always-slot-1 version
  for an unknown stretch until this was caught (reported directly: "the
  game always restarts discussion from slot 1"). **Lesson: a
  single-file-diff check (`md5sum` on both sides) is worth running
  periodically on this codebase given deploys are manual/partial, not a
  full rsync** — this is exactly the kind of drift that's invisible until
  someone hits the specific code path. One deliberate divergence from
  ttl10 that *is* intentional, not a bug: ttl10 itself has no real modulo
  wrap — once `day` exceeds the seat count, its own rotation quirk
  collapses back to slot 1 every day rather than continuing a true
  rotation; this port uses real modulo arithmetic instead, a cleaner
  design for the (rare, only reachable in a very long game) case.
  Remaining known simplification vs. ttl10: a vote/lock-vote/shoot/check
  accepts whichever candidate a player picks at any point during the
  round rather than only the one currently "up" in ttl10's live
  per-candidate window (the final tally still applies the last-candidate
  default to anyone who never explicitly acted).
- **All timers live in `config/mafia.php`'s `timers_ms`, in milliseconds**
  — not seconds like `config/race.php` — because the shooting window is a
  genuine sub-second value (3.5s) that doesn't fit an integer-seconds
  column, and mixing units across the same config file was worse than
  just picking one unit everywhere.
- **Phase 4 delivered disconnection handling only** — discipline/warnings
  (the other half of the plan's original Phase 4 framing) was
  deliberately left out: `MafiaDisciplineService`'s warning-threshold
  *logic* has existed since Phase 1, but nothing can *issue* a warning,
  since that was tied to ttl10's shout-out mechanic, which isn't built
  (there's also no manual-host mode to issue one by hand — a Phase 2 MVP
  decision). Don't be surprised a warning never appears anywhere; revisit
  once/if shout-out gets built.
- **Disconnection** (`App\Services\Mafia\MafiaGameEngine::flagDisconnectedPlayers()`/
  `resolveDisconnectVotes()`, both called every tick, independent of
  `phase_deadline_at`): a player whose `last_seen_at` goes stale
  (`config('mafia.player_disconnect_timeout_seconds')`, 20s) is flagged
  `connection_status: disconnected`; every other **real** (non-dummy)
  alive player then gets Eliminate/Continue buttons
  (`MafiaController::disconnectVote()`,
  `resources/js/Pages/Mafia/Play.jsx`'s disconnected-players section) —
  unanimous Eliminate removes them (win-checked immediately), unanimous
  Continue just restarts the window, a split vote waits. There's no
  separate "reconnect" action: `ResolveMafiaPlayer` flips a disconnected
  player straight back to `connected` the moment any of their own
  requests reaches the server at all, since that alone proves
  connectivity. **Dummy seats are deliberately excluded from the
  "everyone must agree" pool** — unlike the shooting-unanimity rule
  (where a dummy on the mafia team blocking a kill forever is accepted as
  a faithful emergent consequence of ttl10's own rules), this is a
  judgment call made *for* this build: a disconnect safety net that a
  dummy's non-existent opinion could permanently jam would be useless in
  exactly the short-handed games where it matters most.
- **Manual dev/browser verification needs `mafia:tick` actually running**,
  not just `reverb` — nothing advances a room's phase (or resolves a
  disconnect vote) without it. `docker-compose.yml` has a `mafia-tick`
  service (mirroring `race-tick`) — bring it up with
  `docker compose up -d mafia-tick` alongside `reverb`/`laravel.test`/
  `mysql`; it isn't started by a plain `docker compose up -d laravel.test
  mysql`.
- **After a fresh `npm run build`, remember the stale-manifest gotcha
  (#3 above) applies to Mafia's new pages too** — a brand-new page
  component isn't renderable via `Inertia::render()` in tests until the
  build has run at least once after it's added (surfaced as "Not a valid
  Inertia response" in Pest, not a clearer error). Changing an
  *already-built* page's content, or adding new child components it
  imports, does not require a rebuild for Pest (which never executes the
  JS bundle) — only for actually seeing the change in a browser.

### Phase 7 — voice/video: built, tested, and (since ~2026-09-09) DEPLOYED

> **Status correction (verified 2026-10-07 by looking at the server):** the
> sections below were written before deployment and say "deliberately not
> deployed" — that is no longer true. On `aws-dev`: PM2 process
> `quiz-media-sfu` (online ~28 days) listens on `:8381` (`ss` shows it bound to
> all interfaces, not just loopback — worth tightening to 127.0.0.1 if port
> 8381 isn't blocked by the firewall) with its own mediasoup worker on UDP
> 45000-45100; nginx's existing `8380 ssl`
> server block proxies `/media-sfu/` to it, and the app is configured with
> `MEDIA_SFU_WS_URL=wss://mao-dao.com:8380/media-sfu/` plus a set shared
> secret. Still **not verified end-to-end**: a real two-device audio/video
> exchange, and that UDP 45000-45100 is reachable from outside (firewall).
> Other mediasoup workers on that box (`ws`, `mao-dao-ws`, `ms`) are separate
> copies of ttl10 — they authenticate via ttl10's own express-session files
> and rooms stored as JSON, so they cannot serve this Laravel app; this
> sidecar speaks the same protocol but validates Laravel-signed tokens.

> **Lessons from getting live video working (2026-10-07):**
> - `PUBLIC_IP` in `media-sfu/.env` must be the server's real public IP
>   (`curl checkip.amazonaws.com`; here `44.249.201.8`, same as the domain's
>   A record). A wrong value still lets signaling connect (it goes via the
>   domain) but no media ever flows; the symptom is "everyone sees only
>   themselves". The sidecar's can-view calls returning 200 in nginx's access
>   log prove authorization works, so look at the announced IP / UDP next.
> - nginx's `proxy_read_timeout 60s` on `/media-sfu/` closes a quiet
>   WebSocket after a minute, and the sidecar then tears the peer down.
>   `media-sfu/server.js` now pings every client every 25s (heartbeat) to keep
>   it open — keep that if the server is ever rewritten.
> - Restarting `quiz-media-sfu` drops every live call, and the page does not
>   reconnect on its own (a manual reload is needed). Don't restart it while
>   someone is testing without warning them.

> **Microphone gating (added 2026-10-07).** Like ttl10, the *server* pauses
> every player's audio producer except whoever may be heard — listeners get
> silence from a paused producer, so a hacked client can't talk out of turn.
> The rule lives in Laravel (`MafiaRoom::micPolicy()`: lobby/game over =
> everyone; day with someone holding the floor = only them; everything else,
> incl. sitdown, voting and all night phases = nobody). The sidecar
> (`media-sfu/lib/micpolicy.js`) asks `GET /internal/mafia/mic-policy`, applies it
> every 1s and on demand, and a brand-new audio producer starts paused until
> the policy allows it (fails closed). Laravel nudges the sidecar right after
> each transition (`MediaSfuNotifier` → `POST /internal/refresh-mics` on the
> sidecar's own port, `MEDIA_SFU_INTERNAL_URL`, default
> `http://127.0.0.1:8381` outside tests) so speaker handoffs are instant; the
> poll is only the safety net. Sidecar unit tests: `cd media-sfu && npm test`
> (or `node --test` there). Gotcha: the sidecar's Docker image can't run its
> mediasoup worker locally (Windows-built `node_modules` bind-mounted), so
> only the pure policy logic is tested locally.

> **Shout-out / fouls (added 2026-10-08, ported from ttl10).** A living player
> can press a button on their own seat (own-seat hover panel, `record_voice_over`
> icon) during the day to grab `timers_ms.shout_out` (5s) of mic out of turn:
> `MafiaController::shoutOut()` records a `shout_out` action (its window end is
> stored in the action's `value.ends_at`), bumps `mafia_players.warnings`, and
> `MafiaRoom::micPolicy()` lets the shouter be heard next to the current speaker
> while the window is open (`MafiaRoom::activeShouts()`); the sidecar's 1s poll
> closes the mic when it passes. The seat glows red (`shoutEndsAt` in the
> snapshot) and every seat shows a red 1/2/3 counter (`bolt` = disqualified),
> visible to everyone, as in ttl10. The 3rd warning cuts that player's NEXT
> speaking turn to `warned_speech` (10s) exactly once
> (`mafia_players.warned_speech_used`, ttl10's `player.skip`; the turn's real
> length is in `state.speech_total_ms` for the countdown ring); the 4th warning
> sets status `disqualified`, which counts as an elimination for the win check
> (`MafiaGameEngine::concludeIfWon()`) and is skipped in the speaking order.
> Deliberate difference: ttl10 issues the warning ~0.5s after the 5s window
> ends, we issue it when the shout starts. No warning sound yet (ttl10 plays
> `warn.mp3`). Deploying this needs `php artisan migrate` (new column) and a
> `pm2 restart quiz-mafia-tick` (the engine changed).

> **Spectators (added 2026-10-08).** Anyone — including **guests without an
> account** — can watch a room. `GET /mafia/{code}` is public: a signed-in user
> who can still join sees the join page, everyone else is redirected to
> `/mafia/{code}/watch` (+ `/watch/state`, `/watch/media-token`, all behind the
> `mafia.spectator` middleware, `ResolveMafiaSpectator`). Identity is a
> `mafia_spectators` row: `user_id` for signed-in users, otherwise a random
> `mafia_spectator_token` kept in the session. Limit
> `config('mafia.spectator_limit')` = 20 active (heartbeat within
> `spectator_active_seconds` = 45); the 21st gets 429. The spectator snapshot
> (`MafiaController::spectatorSnapshot()`) is `roomSnapshot()` with every
> private bit overridden (no `you`/role, no teammates, no check/signal history,
> all `can*` flags false) — **roles stay hidden until game over**. Media: a
> spectator joins the sidecar with id `s<id>`, can only consume, and sees only
> what `MafiaRoom::canSpectatorView()` allows (lobby/game over: everyone; day:
> living players; night/shooting/checks/sitdown: nobody). Since visibility now
> changes mid-call, the sidecar (`media-sfu/lib/visibility.js`) polls
> `GET /internal/mafia/visibility` once a second and on every nudge, revoking
> (`consumer-revoked`) or re-offering (`producer-available`) streams — this also
> closed an older leak where a player kept consuming streams across the night
> boundary. Lobby: "Free my seat" (`POST /mafia/{code}/release-seat`, lobby only,
> a lone player can't; the host flag moves to the longest-seated player) turns a
> seated player into a spectator; a signed-in spectator taps a free seat
> (`join` with `slot`) to sit. Spectator avatars strip: `SpectatorsStrip.jsx`
> (lobby + game; included in `MafiaLobbyUpdated` and `roomSnapshot`). Deploy
> needs `php artisan migrate --force` (new table), `pm2 restart quiz-mafia-tick`
> and `pm2 restart quiz-media-sfu` (new sidecar files: `lib/visibility.js`,
> changed `auth/authorize/signaling.js`, `server.js`).


The plan's §3.1 #1 decision point (ship without video first, add it once
the core game is validated) resolved to "build it" once the user said to
continue through every phase. What exists now:

- **`media-sfu/`** — a standalone Node.js mediasoup SFU sidecar, **not a
  PHP process** (mediasoup's native worker has nothing to do with
  PHP-FPM). Its signaling protocol (message shapes, one producer
  transport + one consumer transport per peer shared across audio/video,
  bare Opus+VP8 codecs, no STUN/TURN) is copied directly from `ttl10`'s
  own proven `ws/controllers/common.js`, not reinvented — see
  `media-sfu/README.md` and each file's own comments for exactly which
  pieces carried over unchanged. This sidecar never touches the
  database and has no idea what a "role" or "phase" is.
- **The hand-off is two small, explicit contracts, not shared memory**
  (the two processes are genuinely separate): (1)
  `MafiaController::mediaToken()` (`GET /mafia/{code}/media-token`)
  issues a short-lived HMAC-signed join token the sidecar verifies
  itself (`media-sfu/lib/auth.js`) — cross-language compatibility
  between PHP's `hash_hmac('sha256', ...)` and Node's
  `crypto.createHmac('sha256', ...)` was explicitly tested (not just
  assumed) by generating a token in PHP and verifying it in Node
  directly. (2) Every `consume` request the sidecar gets asks Laravel
  first, via `GET /internal/mafia/can-view` (shared-secret header, no
  `auth` guard — the sidecar has no user session) — the actual
  visibility rule lives in **one place**, `MafiaRoom::canPlayerView()`,
  so the sidecar enforcing it and `roomSnapshot()` describing it can
  never drift apart. Visibility: the mafia team sees each other during
  `sitdown`/`night`/`shooting` (mirroring ttl10's own reveal), everyone
  alive sees everyone alive during `day`, nobody sees anyone during the
  private watch/check phases. This is real server-side enforcement, not
  client-side hiding — a modified client still can't get a stream it
  isn't authorized for, because the sidecar never sends one.
- **Client side**: `resources/js/hooks/useMafiaMedia.js` (deliberately
  opt-in — nothing runs until the player clicks "Enable Camera" in
  `Mafia/Play.jsx`, so there's no surprise permission prompt on page
  load), `resources/js/Components/Mafia/VideoTile.jsx` (falls back to
  the ordinary avatar tile when no stream exists — no client-side
  visibility logic to bypass, matching the point above), and
  `GameSeatGrid.jsx` now accepts optional `localStream`/`remoteStreams`
  props. `mediasoup-client` is pinned at `3.6.49` in `package.json` —
  the exact version `ttl10`'s own client uses — not a caret range,
  since client/server mediasoup protocol compatibility isn't guaranteed
  across versions.
- **What was actually verified, and how**: mediasoup's native module
  installs and runs cleanly on this Windows dev machine (no native
  compilation issues) — confirmed by actually starting the sidecar and
  watching it log a successful worker/router boot. The **full signaling
  handshake** (join → correct `rtpCapabilities` returned → producer
  transport created → consumer transport created) was verified against
  a real running sidecar using a small scripted WebSocket test client
  (not committed — noted as throwaway, deleted after use). The
  **PHP-to-Node token interop** was verified directly (see above). The
  **UI integration** was verified in the browser: clicking "Enable
  Camera" correctly requests `getUserMedia`, and — since this sandboxed
  browser environment has no real camera and blocks the permission
  request — correctly catches that failure, shows the
  `media_error_media_permission_denied` message, and leaves the rest of
  the page (timer, actions, everything else) working normally. **What
  was NOT and could not be verified here**: an actual two-person
  audio/video exchange with real cameras/microphones. That gap is
  exactly why this wasn't deployed — see below.
- **Deliberately not deployed to production yet — but NOT because a new
  port needs opening.** That was my first assumption and it was wrong;
  corrected after the account owner pushed back on it. `ttl10`'s own
  mediasoup worker already runs on this exact production box, confirmed
  live via `sudo ss -lunp` (bound to a UDP port in the 40000s at the time
  of checking) — its `ws.js` defaults `RTC_MIN_PORT`/`RTC_MAX_PORT` to
  **40000-49999** and nothing in its production `.env` overrides that.
  Since `ttl10`'s video calls work for real users, and its Mafia
  mediasoup path doesn't route through the TURN server also running on
  this box (that's coturn, on 3478/5349, serving something else),
  direct UDP connectivity across a meaningful chunk of that range must
  already be permitted in the security group. `RTC_MIN_PORT`/
  `RTC_MAX_PORT` here default to **45000-45100** specifically to sit
  *inside* that already-open window, clear of the ~40000s `ttl10` itself
  allocates from — chosen so this sidecar doesn't need any new firewall
  rule at all. **This is a reasoned inference from strong circumstantial
  evidence, not a confirmed fact** (no AWS API access from this box to
  read the security group directly) — verify it empirically (the same
  way Reverb's port 8380 was confirmed reachable) before assuming either
  way, rather than opening a new range pre-emptively. The one thing that
  *does* still block deploying this: unlike HTTP routing (verifiable
  with `curl`), a real audio/video exchange genuinely needs the account
  owner testing with a second real device — there's no way to verify
  that from here. If/when deploying: the signaling WebSocket gets its
  own WSS proxy port mirroring Reverb's exactly (`listen 8381 ssl;
  proxy_pass http://127.0.0.1:8381;` — same pattern as the existing 8380
  block for Reverb), the sidecar runs as its own PM2 process
  (`pm2 start "npm start" --name quiz-media-sfu` from
  `/var/www/quiz/media-sfu`), and `MEDIA_SFU_SHARED_SECRET` must be set
  identically in both `/var/www/quiz/.env` and `media-sfu/.env` on the
  server.
- **Known limitations, stated up front rather than discovered later**:
  no TURN server (fine for most networks, matching `ttl10`'s own setup,
  but a peer behind strict/symmetric NAT may simply fail to connect); no
  resume-consumer/reconnect-in-place flow (a dropped connection means
  clicking "Enable Camera" again, matching `ttl10`'s own behavior, not a
  regression from it); discipline/warnings still isn't built, so there's
  no server-issued warning for camera/mic misbehavior either.

