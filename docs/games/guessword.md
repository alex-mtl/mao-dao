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

## Tests

`tests/Feature/Guessword/` (Pest, engine faked with `Http::fake`); the engine has its own unittest
suite in `stream-engine/tests/`.
