# stream-engine — Guess the Word for TikTok LIVE (platform sidecar)

Python (FastAPI) process that runs the TikTok LIVE games for **every room** of the platform: one room =
one streamer's game with its own settings, data folder (`DATA_DIR/rooms/<id>/`), TikTok connection
(optional own Euler key), Telegram link and ranker client. Dictionaries (word lists, ~17 MB) are shared
by all rooms; round tables come from the `services/word-ranker` Lambdas. Started from `election-game`
(tag `stable-local-docker-2026-10-20`, its old README is `README.election-game.md`).

Plan: `../../Stream Games — Requirements and Implementation Plan.md`, section 0.

## Addresses

- `/internal/*` — the platform's API, header `X-Internal-Secret` (see the docstring of `app/server.py`):
  create/update a room (`PUT /internal/rooms/{id}`), start/stop, settings, status.
- `/r/{control_token}/` — the room's menu, settings, debug and game pages.
- `/r/{overlay_token}/guess/?tt=1&alpha=1` — the TikTok LIVE Studio page (game pages, state, websocket only).
- Pages use relative addresses; the engine adds `<base href="BASE_PATH/r/{token}/">`.

## Settings (environment)

| Variable | Meaning |
|---|---|
| `HOST`, `PORT` | listen address, default `127.0.0.1:8770` (nginx is in front) |
| `DATA_DIR` | data: `rooms.json` (room registry, holds Euler keys, mode 600), `rooms/<id>/`, `logs/` |
| `ASSETS_DIR` | word lists: `<lang>/{vocab.txt, meta.json, secret_nouns.txt}` (no embeddings needed) |
| `BASE_PATH` | where nginx publishes the engine, e.g. `/guessword/engine` |
| `INTERNAL_SECRET` | the platform's secret for `/internal/*` (empty = internal API off) |
| `RANKER_URLS` | `en=https://…,ru=https://…` — the word-ranker Lambdas |
| `TG_BOT_URL` | the Telegram bot's Function URL (each room gives its own key, `tg_key`) |
| `DEBUG_CONTROLS` | `1` = debug buttons in the control pages |
| `DEV_ROOMS` | local testing: N simulated rooms, tokens `dev1`/`view1`, `dev2`/`view2`… |

## Dictionaries (`word-data/`)

Raw sets, models and the finished dictionaries live in `word-data/` (description, versions, licenses, sha256:
`word-data/README.md`). The Dockerfile's `assets` stage reads only that folder — nothing is downloaded but
the pinned Python libraries; refreshing a set from the internet is a developer's explicit decision.
`word-data/built/<dict>/` = the dictionaries in production (with embeddings) — use it as `ASSETS_DIR` for
the tests.

## Run and test locally

```bash
DEV_ROOMS=2 HOST=0.0.0.0 ASSETS_DIR=… RANKER_URLS=… TG_GAME_KEY=… python -m app
python -m unittest tests.test_games tests.test_rooms     # needs the full assets (with embeddings)
```

Measured 2026-10-20 (Python 3.10, limits 0.5 CPU / 512 MB, two simulated rooms): ~180 MB, ~1 % CPU.
