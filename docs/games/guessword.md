# Guess the Word for TikTok LIVE — third game

Status: **pilot** (2026-10-20). Not in the platform's main menu yet; the section answers at `/guessword`.
Plan and decisions: `../../../Stream Games — Requirements and Implementation Plan.md`, section 0.

## What it is

A streamer runs the game during their TikTok LIVE: viewers type words in the TikTok chat, the game ranks
them by meaning and shows who is closest on an overlay that TikTok LIVE Studio captures. A web-only mode
(play on the site without TikTok) is planned later, not now.

## Pieces

| Piece | Where | Role |
|---|---|---|
| Section and rooms (Laravel) | `app/Games/Guessword/`, `routes/games/guessword.php`, `config/guessword.php`, `resources/js/Pages/Guessword/`, `lang/*/guessword.php`, table `guessword_rooms` | who owns which room, TikTok username, language, Euler key (encrypted), Studio link, start / stop |
| Game engine (Python sidecar) | `stream-engine/` | one process, many rooms: TikTok connection, rounds, overlays, the game's own menu |
| Telegram bot (AWS Lambda) | `services/telegram-bot/` | viewers link Telegram ↔ TikTok, offer words; the host approves |
| Word ranking (AWS Lambdas) | `services/word-ranker/` | the round's ranking table per language (no embeddings on the server) |

## Dictionaries and how places are counted

Everything the dictionaries are made from is kept in **`stream-engine/word-data/`** — raw sets by library
and version (`sources/`: wordfreq, OpenCorpora via pymorphy3, WordNet / Open Multilingual Wordnet, spaCy
fr/es models, profanity list), the embedding models (`models/`: MiniLM for en, rubert-tiny2 for ru, LaBSE for
fr, a Spanish BETO model for es) and the finished dictionaries now in production (`built/<dict>/`). Sources,
versions, licenses, sha256 and where each part is stored (GitHub / S3): `stream-engine/word-data/README.md`.

A build uses **only** these local sets: the `assets` stage of `stream-engine/Dockerfile` reads them
(`HF_HUB_OFFLINE=1`, libraries pinned) and `services/word-ranker/build.sh` packs `word-data/built` as is.
Data or models are downloaded again only when a developer explicitly decides to refresh a set.

Places: every vocabulary word has an L2-normalized vector; the round's ranking sorts all words by cosine
similarity to the secret word (the secret itself is always #1) — `SemanticIndex.ranking()` in
`stream-engine/app/games/guess/semantic.py`, the same math in `ranking()` of `services/word-ranker/handler.py`,
which is what production uses (the game server holds no vectors).

## Access

Who may run a room is answered by the platform service `App\Services\Capabilities`
(`guessword.tiktok`): super admins and the e-mails in `GUESSWORD_STREAMERS` (pilot allowlist; the
planned "streamer pack" replaces it there, not in the game).

Every streamer reaches only their own room: `/guessword/room*` takes no room id, and the engine opens a
room only by its secret tokens. Super admins alone also see every room: `/guessword/rooms` (list) and
`/guessword/rooms/{room}` (the same room page and actions for that room; anyone else gets 403).

## Laravel ↔ engine

`App\Games\Guessword\Services\EngineClient` calls the engine's `/internal/*` with header
`X-Internal-Secret` (`GUESSWORD_ENGINE_SECRET` = the engine's `INTERNAL_SECRET`). The engine id of a
room is `gw<id>`. Laravel sends the whole room each time (`PUT /internal/rooms/{id}`); the engine
keeps its own copy in `rooms.json` so rooms come back after a restart.

Browser / Studio addresses go through nginx: `GUESSWORD_ENGINE_PUBLIC_PATH` (default
`/guessword/engine`) → the engine (its `BASE_PATH`). Two links per room:

- **Studio link** `/guessword/engine/r/<overlay_token>/guess/?tt=1&alpha=1` — read-only pages; can be
  regenerated (the old one stops working);
- **control link** `/guessword/engine/r/<control_token>/` — the game's menu, embedded on the room page.

## "On screen" tab (live overlay elements)

The room page's settings panel has an **On screen** tab (after Frame) and a short strip of the same
switches over the game monitor. They control what the overlay shows besides the game, in TT / chroma
mode: the three tops (stream champions on the right, planes and balloons on the left, on the bottom
edge of the camera zone), the Telegram bot's name, and "what the gifts do". Each is always / never /
periodically (every N min for N s, on the wall clock); tops can also take turns in a carousel; the gifts
have a view (one by one, tiles, ticker, column) and a place (host zone, or bottom right of the chat
zone - only when the chat zone is on). "Hide everything" and "all tops" keep the modes.

Unlike the other tabs these settings are sent at once (no Apply): `useEngineSettings().setNow()`. In the
engine they are guess options (`GuessGame.SCREEN`, saved with the room) and go to the overlay as
`state.screen`; `guess.js` (`renderSides`) re-checks them twice a second. The old toast switch
"what the gifts do" (`toasts.promo`) is gone: a room that had it off got `gifts = never`.

## Environment

| Variable | Meaning |
|---|---|
| `GUESSWORD_ENGINE_URL` | engine for server-to-server calls, default `http://127.0.0.1:8770` |
| `GUESSWORD_ENGINE_SECRET` | shared secret with the engine |
| `GUESSWORD_ENGINE_PUBLIC_PATH` | where nginx publishes the engine, default `/guessword/engine` |
| `GUESSWORD_STREAMERS` | pilot allowlist: e-mails, comma separated |
| `GUESSWORD_BOT_URL` | the Telegram bot's Function URL |
| `GUESSWORD_BOT_PLATFORM_SECRET` | = SSM `/tiktok-tg-bot/platform-secret` |

The engine itself needs `TG_BOT_URL` and `RANKER_URLS` in its environment (see `stream-engine/README.md`).

## Laravel ↔ bot

On a room's first start `App\Games\Guessword\Services\BotClient` registers it in the bot
(`POST /platform/games {id: gw<id>, lang}`, header `X-Platform-Secret`) and stores the returned key
encrypted in `guessword_rooms.tg_key`; Laravel passes it to the engine with the room. The same key opens
the word-ranker Lambdas. Registering the same id again rotates the key.

## Live logs and avatars (for clips and digests)

The engine keeps what happened on every TikTok LIVE, so clips and digests can be cut later without
recognising the game's voice in the recording (`stream-engine/app/live_log.py`).

**Where** (on `aws-dev`, `DATA_DIR` = `/var/lib/guessword-engine`, owned by the service; read only):

- `rooms/<room>/lives/<YYYY-MM-DD_HHMMSS>_<tiktok room id>.jsonl` — one file per LIVE (server local time
  of its start). A new file opens when TikTok connects to a new LIVE; a reconnect or an engine restart
  during the same LIVE goes on writing the same file. Nothing is written before the first TikTok
  connection (simulated rooms have no log).
- `avatars/<uid>.<jpg|webp|png>` — viewers' avatars (TikTok `avatar_thumb`, a small square), shared by all
  rooms. Named by the numeric TikTok user id, or by the `@unique_id` (lower case) when the event had no
  numeric id. Fetched in one background thread (10 s timeout, errors only in the engine log) when a
  viewer first shows up in a LIVE, unless the saved picture is younger than 7 days. TikTok's links are
  signed and expire after a few days, which is why the picture itself is kept.

**Getting them**: over ssh (`sudo cat` / `sudo tar` of the paths above), or the engine's internal API with
header `X-Internal-Secret` (= `GUESSWORD_ENGINE_SECRET` in Laravel's `.env`), on the server at
`http://127.0.0.1:8770`:

| Request | Answer |
|---|---|
| `GET /internal/lives[?room=gw1]` | `{lives: [{room, file, size, mtime}]}` |
| `GET /internal/lives/{room}/{file}` | the JSONL file |
| `GET /internal/avatars/{uid or unique_id}` | the picture, 404 if none |

**Format**: one JSON object per line, `t` (ISO time with offset, ms), `s` (seconds since the LIVE started,
0.1 s), `type`, then the fields below (absent = none). A *user* is `{"uid": numeric TikTok id or "",
"id": "@unique_id without @", "name": nickname at that moment}`; `uid` is stable, `id` and `name` can change. `name` is the raw string TikTok sent (UTF-8, not cut, not normalised: Unicode "font" letters, emoji stay as they are; the screen shows it cut to 40).

| type | fields |
|---|---|
| `live_start` | `epoch` (unix time of the start), `tiktok_room`, `username` (the streamer) |
| `viewer` | `user`, `first` (true: first event of this viewer in the LIVE; otherwise the nickname changed) |
| `round_start` | `round`, `word`, `lang`, `tier`, `round_type`, `duration` (s), `setter` (user who picked the word) |
| `winner` | `round`, `user`, `word`, `seconds`, `guesses`, `streak`, `stolen` ("steal the win" gift) |
| `round_end` | `round`, `word`, `reason` (`exact` / `timeout` / `skip`), `winner` (user or absent), `seconds`, `players`, `guesses`, `podium` (users + `rank`) |
| `plane` | `user`, `likes` + `threshold` (like plane) or `gift` / `manual` + `count` (gift plane), `bomber` |
| `balloon` | `user`, `likes`, `n` (their balloon number), `per`; or `gift` / `manual` + `count` |
| `snowball`, `cake` | `user`, `likes`; or `gift` / `manual` + `count` |
| `gift` | `user`, `gift`, `count`, `coins` (one gift's price), `actions` (bound actions), `to` (a guest, not the host) |

Gifts are logged from `LIVE_LOG_GIFT_COINS` coins per batch (engine env, default 100) and whenever the
gift is bound to an action other than a hint (any gift gives a hint by default). Round numbers restart
with every LIVE. A restart puts no second `round_start` for the restored round; its `round_end` comes.

## Load and scaling (measured 2026-10-28)

Two live streams: ~190 guesses/min, ~140 chat messages/min, ~50 like events/min, <1 gift/min per room;
the engine used ~8% of one core and 282 MB. Viewers do not open the overlay, so more viewers mean more
events, not more web clients.

**Already in place: delivery to overlays is batched.** Games only append events (`emit`); the hub's
`broadcaster` loop (`stream-engine/app/hub.py`) sends the state plus all new events at most every 0.1 s,
one message per tick to all clients of the room. A burst of likes or guesses never means a message per
event. Keep it that way: never push to websockets straight from an event handler.

What limits a room is the processing of each event in the single Python thread (TikTok client, guess
lookup, game logic). Order of work when audiences grow, each step only when a measurement asks for it:

1. **Measure peaks, not averages**: CPU per second (p95/p99) and the delay from a TikTok event to the
   overlay message (p95/max) on a big stream, plus TikTok socket reconnects.
2. **Collapse bursts inside a tick**: e.g. many like events of one tick → one balloons update, so the
   per-tick message stays small whatever the chat does.
3. **TikTok ingestion in its own process** (parsing, filtering to candidate guesses), the game logic gets
   ready guesses → two cores for one stream.
4. **Rooms in several engine processes** (sharding by room; rooms do not share state by design) and,
   for a very large stream, its own instance. One room still lives in one process, so steps 2–3 matter
   for a single huge stream, not just more servers.

## Tests

`tests/Feature/Guessword/` (Pest, engine faked with `Http::fake`); the engine has its own unittest
suite in `stream-engine/tests/`.
