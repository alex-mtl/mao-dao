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

**Russian difficulty groups (2026-11-02).** The secret pool of `ru` (5 784 words, `pools` in `meta.json`) is split
by wordfreq zipf into three near-equal groups — simple (zipf > 3.86, 1 922), normal (> 3.44, 1 884), hard (the
rest, 1 978); thresholds and the zipf of every `ru` vocab word are in `built/ru/difficulty.json` (on the server:
`stream-engine/assets/ru/difficulty.json`). In Russian every level plays the `ru` dictionary and the room's level
picks the group (1 simple, 2 normal, 3 hard); `ru-easy` / `ru-hard` are no longer used for Russian. No repeats:
a word picked once stays used (any group) until its group is played through, then only that group starts anew.
The scale: `SemanticIndex.difficulty()` puts a word at the share of the pool more frequent than it (ticks =
where the groups end); the overlay draws it under the timer row, the bot as an emoji line for the viewer who
picked a word and for the host deciding on it. Other languages: no `difficulty.json`, no groups, no scale.

## Access

Who may run a room is answered by the platform service `App\Services\Capabilities`
(`guessword.tiktok`): super admins and accounts with an active streamer pack (`user_products`,
`App\Services\StreamerPack`; CLAUDE.md rule 3).

Every streamer reaches only their own room: `/guessword/room*` takes no room id, and the engine opens a
room only by its secret tokens. Super admins alone also see every room: `/guessword/rooms` (list) and
`/guessword/rooms/{room}` (the same room page and actions for that room; anyone else gets 403).

## Laravel ↔ engine

`App\Games\Guessword\Services\EngineClient` calls the engine's `/internal/*` with header
`X-Internal-Secret` (`GUESSWORD_ENGINE_SECRET` = the engine's `INTERNAL_SECRET`). The engine id of a
room is `gw<id>`. Laravel sends the whole room each time (`PUT /internal/rooms/{id}`); the engine
keeps its own copy in `rooms.json` so rooms come back after a restart.

The other way round the engine calls Laravel only for viewers' bonuses (`/internal/guessword/bonuses`, same
secret, engine env `PLATFORM_URL`; see "Players' bonuses" below). These routes have no session/auth and are
excluded from CSRF in `bootstrap/app.php`.

Browser / Studio addresses go through nginx: `GUESSWORD_ENGINE_PUBLIC_PATH` (default
`/guessword/engine`) → the engine (its `BASE_PATH`). Two links per room:

- **Studio link** `/guessword/engine/r/<overlay_token>/guess/?tt=1&alpha=1` — read-only pages; can be
  regenerated (the old one stops working);
- **control link** `/guessword/engine/r/<control_token>/` — the game's menu, embedded on the room page.

## Players' bonuses (since 2026-11-03)

What a viewer has "on account" in a streamer's room: free hints, cakes, boosts... Any engine gift action a
viewer can launch themselves is a bonus kind (`config('guessword.bonus_kinds')` = `stream-engine/app/bonuses.py`
`KINDS`: hint, cake, boost, multi, balloon, plane, bomber, snowball; a new kind = one line in both).

- **Laravel is the source of truth**: `guessword_bonuses` (room, viewer = TikTok @id lower case, kind, amount,
  the last nickname) and `guessword_bonus_log` (every change: delta, balance after, source host / console / gift /
  spend / setter / migration / rename, the host who did it, the engine's op id). `Services\Bonuses`.
- **The engine keeps a copy** (`DATA_DIR/rooms/<room>/bonuses.json`) to answer the chat at once, and sends every
  change it makes (a gift's extra hints, the setter's hint, spending) as an operation with an id:
  `POST {PLATFORM_URL}/internal/guessword/bonuses {room, ops}` every 2 s while it has some (outbox
  `bonus_outbox.json`, kept across restarts; Laravel applies each op id once and answers the balances). For every
  room, running or not, it pulls everything when the process starts and every 10 min (`GET .../internal/guessword/bonuses?room=gw1`, `RoomManager.bonus_sync`). Header
  `X-Internal-Secret` both ways (engine `INTERNAL_SECRET` = `GUESSWORD_ENGINE_SECRET`); engine env `PLATFORM_URL`
  (e.g. `https://mao-dao.com`) — empty = the copy is all there is (home copy, tests).
- **The host's changes** go to Laravel, which pushes the viewer's balances to the engine
  (`POST /internal/rooms/{id}/bonuses {id, balances}`; when the engine is down it gets them on the next pull).
- **First sync** sends what the engine had (the old `guess/hint_credits.json` included) as `migrate-<room>-<kind>-
  <viewer>` ops, once (`bonus_migrated.json`).
- **Spending**: a hint with "подсказка" / "hint" or a club emote bound to `hint` (as before); every other kind only
  by a club emote the streamer binds to it in the emote settings (`EMOTE_ACTIONS` = the bonus kinds). The emote
  does the gift action for that viewer (`Hub.use_bonus`: the cake show with their avatar, a plane...) and spends
  one; nothing is spent when it can't happen (3 words for the round between rounds, a boost they already have).
- **Room page**: the monitor's tab "🎁 Players' bonuses" (`Partials/PlayerBonuses.jsx`; `GET/POST
  /guessword/room/bonuses`, super admins `/guessword/rooms/{room}/bonuses`): players on the left, the picked one's
  bonuses with −/+, their history; any viewer of the stream or a typed @login can be given
  something. The old "Pending" box of the "Planned" tab is gone; who has the stream boost now is shown in this tab.
- **Console**: `php artisan guessword:hints <tiktok login> [n=1] [--kind=hint|cake|...] [--room=<id | gw<id> |
  streamer's login>]` (alias `guessword:bonus`; `--room` not needed with one room, negative n takes away).

**For the streamer** (how it is used):

1. Give a bonus: the room page → "Game monitor" («Ход игры») → tab "🎁 Players' bonuses" → pick the player (or a
   viewer of the stream / type the @login) → "+" next to the kind ("−" takes one away).
2. Let viewers spend it: settings → tab "Gifts" («Подарки») → "Club emotes" → bind an emote to the kind (e.g. the cake emote → "🎂 Cake").
   The viewer sends that emote alone in the chat; hints also by typing "подсказка".
3. A gift still gives what the gift rules say; extra hints of a combo still land on the account, now in the DB.

The bot still gets the hint balances only ("мои подсказки" / the bot's balance show hints); a stream boost from a
gift (`boost_ids`, till the stream ends) is not a bonus on account — the tab only shows who has it.

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

## Anagram — the second word game of the room (since 2026-11-03)

A mode of the same room and engine, next to Battle / Guess the Word / Animation (Start ▾ on the room page;
engine game `anagram`, page `app/web/anagram/`). Mockup with the animations: `stream-engine/app/web/demo/anagram.html`.

- **Round word**: a noun of 11+ letters from the Guess the Word dictionary of the room's language
  (`assets/<lang>/vocab.txt`, nouns = `valid_nouns.txt` when present; Russian: 9 111 words). A word is not picked again
  until every long word of the language was played (`anagram/used_words.json`, kept across streams), then a new cycle.
- **Answers**: one word of the chat, 3+ letters, `ё` = `е`. Made of the round word's letters (each letter as many times
  as it is there) and in the dictionary (any word of `vocab.txt`, the round word itself too) = a good word. Shown on the
  answer line letter by letter: a missing letter red, a used-up one grey ("лишняя С"), a word of the right letters not in
  the dictionary greyed; rejected answers are shown at most every 0.7 s (the chat is fast).
- **Points**: the first to name a good word gets a point per letter. Another viewer naming it later gives its author
  the same points again (the word's ×2, ×3; after ×3 each repeat adds 0.1, the word flashes; once per viewer); the repeater gets nothing; the author's own word again
  counts nothing ("уже твоё"); the round's word itself counts nothing ("это слово раунда"). Setting "Repeats of a word" (`mult`): off = every repeat adds 0.1 and ×N shows the real number of namers. The table: players by points (ties: who got there first); no nicks: the avatar with the points (a cyan seven-segment display, 00.0) on its corner, then the
  words; as many per line as fit its width, as few lines as possible: a word goes to the first line with room for it (squeezed to 82% if
  need be), a new line only when none has. A repeat: the
  word flashes with the last namer's avatar and nick glowing right before it for 3 s (the author's avatar stays), ×N on it. A row slides only
  when its player changes places with another one; the table is redrawn at most every 250 ms. Timings follow the chat's
  pace like Guess the Word's (heat 0..1 from answers a second): the answer line, the flight, the slide, the namer pill get
  shorter (busy: line 0.12–0.2 s, flight and slide 0.1 s, pill 1 s, redraw every 0.1 s); at most 1 answer waits for the
  line, older scoring ones land in the table at once. The round's word stands right under the camera zone.
- **Round end**: most points win (`winner`; nobody scored = `timeout`), podium by points. Stream champions = rounds
  won (`anagram/players.json`, `AnagramStats`, reset with a new LIVE), shown like Guess the Word's: the "On screen" tab
  (the same `SCREEN` options, on the anagram game), tops of planes / balloons from the likes, the bot's name.
- **Settings** (room page → Anagram): round length (3–30 min, default 10), break between rounds (0–2 min, default 2),
  who plays (all / followers / the team from level N), frame and chroma (shared by all the games of the room: `Hub.SHARED_OPTIONS`;
  Anagram took Guess the Word's once, session flag `shared`), On screen, gifts, toasts, likes. Gifts launch
  only the animations every page has (balloon, plane, butterflies, snowball, cake); hints / boosts / steal are Guess the
  Word's and don't exist here (the overlay's "what the gifts do" lists only the animations).
- The overlay reuses `guess/guess.css` and copies the stream chrome of `guess.js` (frame / chroma / TT, tops, gift
  promo, toasts, ticker, clock) into `anagram/anagram.js`: a change there is to be made in both until it moves to
  `common/`. Strings: `a.*` in `common/i18n.js`, `guessword.mode_anagram*` / `anagram_rules` in `lang/*/guessword.php`.
- Engine log lines `[anagram] round N (ru), ...`; the live log gets `round_start` / `winner` / `round_end` with
  `game: "anagram"`. Tests: `stream-engine/tests/test_anagram.py` (a tiny dictionary of its own, no built assets).

## Quiz — questions of the platform's quizzes (since 2026-11-09)

Engine game `quiz` (`stream-engine/app/games/quiz/`, page `app/web/quiz/`). Mockup: `stream-engine/app/web/demo/quiz.html`.
- **Questions**: the generated quizzes of the platform (services/quiz-factory: `import_key` `<topic>-<level>-<n>`, one
  tag = the topic). Laravel `GET /internal/guessword/quizzes?lang=ru` (`QuizBankController`, header X-Internal-Secret =
  the engine's secret) gives every published one with each question's right answer and its whole `wrong_pool` (up to 14).
  The engine (`quiz/bank.py`) fetches it in a thread at the first use and every 6 h, keeps the last copy in
  `{DATA_DIR}/quiz-bank/<lang>.json`; with no platform and no copy a small built-in sample plays (tests, home copies).
  No quizzes in the room's language → the Russian ones.
- **Round**: TOPIC (roulette on the overlay, ~4.5 s: a topic at random of the ticked ones, or the host's queued one; a
  quiz of it with questions not played this stream, `quiz/used.json`, a topic played through starts over) → for each
  of `qcount` questions (default 5): INTRO "QUESTION 2 / 5" (2 s) → ASK (`qtime`, 10–120 s, default 30) → ANSWER
  (`answer_sec`, default 6) → WINNER → REVEAL (break) like the other games.
- **Answers**: chat text is matched to the variants (right one + its wrong pool) after `norm()` (case, ё, spaces,
  hyphens, punctuation ignored); a match becomes / joins a row of the table, anything else flashes on the chat line
  (`try` kind `miss`, at most every 0.6 s). **Only a viewer's last variant counts.** A row shows who stands for it now,
  the first to name it first (on top of the stack), at most 7 avatars then "+N"; nobody left → its author, faded.
  The rows have no colours until the answer (order: most players first, or as named — setting).
- **Points** (per question, at ANSWER): last variant right → 1; their first variant of the question was a wrong one →
  0.9; the first to name the right answer (of those) → 1.2 (1.1 if they had said a wrong one first — the owner did
  not decide this case, 2026-11-09). Round winner = most points; a tie → each of them gets the round win. Stream
  champions = rounds won (`quiz/players.json`), shown with the planes / balloon tops as in the other games.
- **Topics (31 since 2026-11-10: the 8 categories + 23 finer ones)**: a topic = a set of the factory's question types
  (`THEMES` in `stream-engine/app/games/quiz/bank.py`; `/internal/guessword/quizzes` gives every question its `type` =
  the part of `questions.import_key` before `:`). The platform's quizzes mix the types of a category, so the bank deals
  the questions again into quizzes of one topic + one level (`regroup`); a question of an unknown type plays in the
  topic of its quiz's category. A new topic = `THEMES` + `QUIZ_TOPICS` / `TOPIC_ICON` (`QuizMonitor.jsx`, `quiz.js`) +
  `qz_t_*` / `q.t.*` strings in four languages. Rooms that had all eight old topics on got all 31 (flag `shared` = 3).
- **Room page → Quiz**: settings (time per question, questions per round, the answer on screen, break, level, topics,
  table order, who plays; frame / On screen / gifts / toasts / likes as in the other games — the Quiz took Guess the
  Word's picture and On screen values once, session flag `shared` = 2) and the "game flow" (`QuizMonitor.jsx`): the
  round now with the host's controls (pause, +10 s, show the answer, skip the question — another one of the same quiz,
  end the round), past rounds with their questions, planned topics (`queue_add` / `queue_del` / `queue_move`), bonuses.
- Strings: `q.*` in `common/i18n.js`, `guessword.mode_quiz*` / `qz_*` in `lang/*/guessword.php`. Tests:
  `stream-engine/tests/test_quiz.py`, `tests/Feature/Guessword/QuizBankTest.php`.


## Listen mode — "прослушка" (since 2026-11-11)

For a LIVE the streamer runs **from the phone**: the library only listens (the same TikTok connection as the games)
and records; nothing is drawn or played on the stream. Engine game `listen` (`app/games/listen/`, empty overlay page
`web/listen/`), the sixth mode of the panel (`SettingsPanel.MODES`); its whole view is `ListenMonitor.jsx`
(engine `GET /api/monitor?game=listen`).

- **Counters and tops of the LIVE** (`app/listen_stats.py`, `listen.json` in the room's folder, reset on a new LIVE):
  viewers, messages, likes, gifts + coins, follows, paid subscriptions (`SubNotifyEvent`), joins, shares; top gifters /
  likers / chatters, gifts by kind, a per-minute line. Collected in **every** mode (the hub feeds it), the Listen mode
  only shows it. Subscriptions and shares are also lines of the LIVE log (`sub`).
- **Battles** (`app/battles.py`, extraction from TikTok's events in `app/tiktok/battles.py`, journal
  `battles.jsonl` in the room's folder + a `battle` line in the LIVE log): `LinkMicBattleEvent` gives the start / finish,
  the sides and the result, `LinkMicArmiesEvent` the score of each side and its top gifters during the battle. A
  battle has an id; the battles of one **match channel** (`channel_id`) are the rounds ("подраунды") of one match, the
  n-th battle of a channel = round n (a gap of 30 min starts a new series); extra time is a flag. The host's own side is
  found by the numeric id from the connect (`set_host_uid`); with an unknown host nothing is declared won or lost.
  Comments / likes / gifts / follows / subs during a battle are summed into it. A battle nobody reports on for 10 min is
  closed as "unfinished"; joining midway starts it from the first score update (`mid`).
  **Assumption to check on a real battle:** that rounds really come as separate battle ids in one channel — the raw
  numbers of every battle are in the journal, so the rule can be corrected afterwards.
- **The narrator of the panel** (`Narrator.jsx`, any mode, left column): the browser's own voice on the streamer's
  computer reads every viewer message aloud (`say_chat`) and greets the joiners (`say_greet`, merged: "Welcome Ann,
  Bob and 3 more"). Both are engine global settings (live, no Apply). It listens to the room's websocket feed. The
  overlay's greeting (`greet`, a toast of the games) is a separate switch: the feed's `join` event carries
  `overlay` / `panel` flags and `Greeter.push` skips `overlay === false`. A browser needs one click before it lets a page
  speak, hence the "click once" hint after a reload.
- Tests: `stream-engine/tests/test_battles.py` (stdlib only).

## Environment

| Variable | Meaning |
|---|---|
| `GUESSWORD_ENGINE_URL` | engine for server-to-server calls, default `http://127.0.0.1:8770` |
| `GUESSWORD_ENGINE_SECRET` | shared secret with the engine |
| `GUESSWORD_ENGINE_PUBLIC_PATH` | where nginx publishes the engine, default `/guessword/engine` |
| `GUESSWORD_BOT_URL` | the Telegram bot's Function URL |
| `GUESSWORD_BOT_PLATFORM_SECRET` | = SSM `/tiktok-tg-bot/platform-secret` |

The engine itself needs `TG_BOT_URL`, `RANKER_URLS` and `PLATFORM_URL` (= `https://mao-dao.com` on the server,
in `/etc/guessword-engine.env`) in its environment (see `stream-engine/README.md`).

## Laravel ↔ bot

On a room's first start `App\Games\Guessword\Services\BotClient` registers it in the bot
(`POST /platform/games {id: gw<id>, lang}`, header `X-Platform-Secret`) and stores the returned key
encrypted in `guessword_rooms.tg_key`; Laravel passes it to the engine with the room. The same key opens
the word-ranker Lambdas. Registering the same id again rotates the key.


### The setter's hints (since 2026-11-01)

A viewer whose word is being played can put up to 3 hints on screen through the bot: `/podskazka`
(or `подсказка`) shows three kinds (2026-11-02): ✏️ a word (they type it), 🔤 the first letter (the bot
puts up "к…") and 🔢 the number of letters ("5 букв"); the last two need no typing and each can be used
once. `/podskazka зима` gives a word at once. The bot refuses outside that round, more than one word, the
word itself or a word with the same start (common prefix ≥ min(4, lengths)) and repeats; the engine
then shows a word only if it is in the round's dictionary (`sem.normalize`, the same check as guesses),
else lists it in `setter.rejected` and the bot takes it back and tells the setter ("✅ на экране" for a
word shown). State: `SROUND#<game>` in the bot (written on "played", deleted when the game's poll reports
another `setter` id or `null`; `ver` guards the poll's write against a hint added meanwhile). The engine
sends `setter: {id, hints shown, shown, rejected}` with every poll and polls every 3 s instead of 10
while hints can still come; the bot answers `setter_hints: {id, words, free}` (all so far; `free` = the
bot-made ones, no dictionary check). On screen (chroma / TT mode only): `#setterHints`, top right of the
camera zone under the timer row, the same pill as a boost (avatar + the word), shown in COUNTDOWN / PLAYING.

**Taking a word back (2026-11-02).** After the dictionary check the viewer sees the word's difficulty
with 📨 "отправить ведущему" / ✖️ "отменить" (state `confirm`); only 📨 shows the word to the host.
✖️, a new `/zagadka`, or 30 min without an answer drop it (a word chosen from the saved ones stays saved).

## Viewer identity: one viewer, one id (since 2026-11-02)

Since 2026-11-01 ~16:26 UTC TikTok sends chat messages **without the `@unique_id`** (only the nickname and
the numeric user id); gifts, likes and joins still carry it. Hint credits, boosts, wins, the Telegram link and
the setter check are all keyed by the `@id`, so "подсказка", "мои подсказки" and the 3-words boost stopped
working for anyone whose nickname differs from their `@id`.

`stream-engine/app/identities.py` (one registry for all rooms, `DATA_DIR/identities.json`) maps the numeric id
(never changes) → the current `@id`, plus every id a viewer ever had (old handles, nickname stand-ins) → the
numeric id. Every event goes through it in `Hub._seen()`; `lookup()` finds a viewer by any of their ids
(`add_credits` uses it, so the bot may name an old id; bonuses given on the platform to an old id move to the current one). A viewer seen only in the chat gets
their nickname as a stand-in id; when the real `@id` arrives the registry records a rename and every room merges
its data (`GuessGame.rename_viewer`, balloons, the room's recent viewers) — never two records of one person.
A nickname several viewers use finds nobody and is never merged. On first start the registry is filled from the
rooms' LIVE logs (`backfill`), which also merges the stand-ins created between 2026-11-01 and the deploy.

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
| `setter_hint` | `round`, `word`, `by` (the user who picked the round's word and sent this hint through the bot) |
| `winner` | `round`, `user`, `word`, `seconds`, `guesses`, `streak`, `stolen` ("steal the win" gift) |
| `round_end` | `round`, `word`, `reason` (`exact` / `timeout` / `skip`), `winner` (user or absent), `seconds`, `players`, `guesses`, `podium` (users + `rank`) |
| `plane` | `user`, `likes` + `threshold` (like plane) or `gift` / `manual` + `count` (gift plane), `bomber` |
| `balloon` | `user`, `likes`, `n` (their balloon number), `per`; or `gift` / `manual` + `count` |
| `snowball`, `cake` | `user`, `likes`; or `gift` / `manual` + `count`; a cake also `seed` (its show) |
| `follow` | `user` — every follow event TikTok sends (since 2026-11-07); `guessword:daily-stats` counts distinct viewers |
| `cake_start`, `cake_last`, `cake_split` | `seed`: the show begins (shows wait for each other), its last cracker takes off, the cake flies apart (since 30.10.2026) |
| `gift` | `user`, `gift`, `count`, `coins` (one gift's price), `actions` (bound actions), `to` (a guest, not the host) |

Gifts are logged from `LIVE_LOG_GIFT_COINS` coins per batch (engine env, default 100) and whenever the
gift is bound to an action other than a hint (any gift gives a hint by default). Round numbers restart
with every LIVE. A restart puts no second `round_start` for the restored round; its `round_end` comes.

## The cake show runs on the server (since 2026-10-30)

`stream-engine/app/reactions/cake.py` keeps the show's clock: the cake starts when the previous one ended (at most
3 wait), the fuses are lit 10 s after the start, the first cracker goes 1.8 s later, then one a second and one at
once for every "огонь" / fire / feu / fuego in the chat (asked before the fuses burn: .12 s apart once they do);
3.2 s after the last one the finale (turn 1.2 s, the avatar 1.5 s, slices 1.3 s). The pages get `cake {server:
true}`, `cake_fire`, `cake_final` and only draw (`common/cake.js`; without `server` it still runs its own clock,
as the demo pages do). Before, every page ran the whole show itself and the engine only knew "a cake started".

## Stream archive and the "champion race" digest (since 2026-10-30)

`/guessword/archive` (streamers; super admins: `/guessword/rooms/{room}/archive`, link on the room page) lists
the room's LIVE logs, newest first: start, length, rounds, wins, planes, balloons, cakes, the champion and a
small temperature curve. "Make a digest" builds the 60-second clip **in the streamer's browser** from their
own recording (MP4 from TikTok LIVE Center): the file is never uploaded.

- **Server** (`ArchiveController`, `Services/LiveArchive.php`): gets the logs through the engine's
  `/internal/lives*`, only counts and filters (summary + activity per 5 min, `bins`; the digest's event
  types with users cut to uid / id / name); a parsed log is cached by its size. Avatars:
  `/guessword/avatars/{uid}` → engine `/internal/avatars`.
- **LIVEs before the engine's own logs (21–29.10.2026)** are rebuilt from the journal archive in R2:
  `php artisan guessword:journal-lives <days .log|.log.xz, oldest first> [--dry-run]`
  (`Console/JournalLivesCommand`, `Services/JournalLives`). One LIVE = one TikTok LIVE id of a room, from
  `[tiktok] connected` to "not live" (reconnects continue it); events: rounds, `exact` wins, auto planes,
  balloons, cakes, `[manual]` balloon / plane / cake. Written to `storage/app/guessword/journal-lives/<room>/`
  (new files only); the archive lists them with a note (nicknames only, no avatars) and hides one when the
  engine has a log of the same LIVE id. Imported 30.10.2026 from the days 21–29.10.
- **Straight from TikTok LIVE Center** (browser extension `browser-extension/`, install: its README): LIVE
  Center plays recordings as HLS (`.m3u8`, ~4 s MPEG-TS segments, HEVC, `#EXT-X-PROGRAM-DATE-TIME` on every
  segment, links signed for ~1 year, CDN answers HTTP Range). The recording's id in LIVE Center = the TikTok
  room id of the LIVE log (`live_start.tiktok_room`). The page asks the extension for the recording, the
  playlist and the first 512 KB of each needed segment (`Digest/livecenter.js`; `Digest/ts.js` takes the
  segment's first video frame, a key frame); the clock of the playlist places the log exactly (30.10: the
  recording began 21 s before the log). ~0.5 MB per clip frame, so < 1 GB for any LIVE. Checked locally on
  an HLS cut of the 19.10 recording: 1800 frames in ~14 s, 148 MB read.
- **Browser, one logic for the site and the local pipeline** — `resources/js/Pages/Guessword/Digest/`:
  `model.js` (facts from a LIVE log or tiktok-clips' events.json, nick merging, races, clip time,
  temperature), `draw.js` (one 1080x1920 overlay frame on a canvas), `build.js` (WebCodecs: mediabunny
  reads the MP4 index and only the key frame each clip frame needs via `File.slice`, overlay drawn on top,
  H.264 by `VideoEncoder`, MP4 in memory). Damaged spots of a recording (a decoder error) open a new decoder
  and keep the previous picture. Chrome / Edge only (HEVC recordings need the platform decoder).
- **The local pipeline uses the same files**: `tiktok-clips/tools/digest-race.js` serves `runner.html` +
  these modules (`serve.mjs`) to headless Chrome and gives it the local file. A change here changes both.
- Recording ↔ log: second 0 of the log (`live_start`, the engine's first connection) is taken as second 0
  of the recording; the page warns when the lengths differ by more than max(5 min, 5%).
- **Measured** on the 19.10 recording (7 h 27 min, HEVC 1080x1920, 21.6 GB): 1800 frames built in ~19 s
  (the old ffmpeg + screenshot pipeline: ~11.5 min); Chrome peak ~1.5 GB (all its processes), JS heap
  ~360 MB (incl. the 59 MB result).
- **TikTok cover** (since 2026-10-31, the owner's mockup): `Digest/cover.js` draws one 1080x1440 PNG (3:4, what TikTok keeps of a cover) from the
  same model — date, the three hardest guessed words (the longest won rounds), the podium of the wins race
  (places by win count: equal wins share one pedestal, avatars side by side and the nicks listed under them, "+N" when they do not fit; avatars or initials), rounds / length / balloons / planes, the streamer's
  `@username` from `live_start`. The archive page saves it next to the clip (`digest-<date>-cover.png`, strings
  `digest_cover_*`); `tiktok-clips/tools/digest-race.js` writes `<out>-cover.png`, and
  `tiktok-clips/tools/digest-cover.js <live.jsonl> <out.png> [--avatars <dir>]` makes only the cover.
- **Frame test**: `node tests/digest/frames.test.mjs` (host Node + Chrome; `--update` writes new references
  after an intended change of the look). Synthetic nicks in `tests/digest/events.json`.

## Rounds table (since 2026-11-13)

Every round of every LIVE of a room, one row each: `guessword_rounds` (`App\Games\Guessword\Services\RoundsArchive`,
model `GuesswordRound`). Unique per `(room_id, live_key, round)`.

- **From the logs**: opening the archive refreshes the rounds of every LIVE whose log grew (engine logs and
  journal-rebuilt ones; cached by file size, so a finished LIVE is read once). A round runs from `round_start`
  to its win / `round_end` (journal LIVEs: to the next round's start). Columns: word, lang, tier, round type,
  start time, `offset_s` (from the LIVE's start), `duration_s`, `reason` (exact / timeout / skip), winner
  (uid, @id, nickname), guesses, players, streak.
- **From outside** (`php artisan guessword:rounds-import <file.json> [--room=1] [--sync]`, a JSON array of
  `{live_key, round, ...}`): LIVEs older than any log (`live_key` = `rec:<recording id>`, `source` local = the old
  local game's log of 16–20.10, video = the game's voice in the recording), and what the clips pipeline finds:
  `recording` + `recording_s` (where the round starts in the LIVE Center recording), `clip_url` / `clip_title`,
  `moments` (`[{at, kind, text}]`, `at` = recording second). A refresh from the logs never touches these.
  The rows are made by `tiktok-clips/tools/rounds-export.js` (local / video / live / excerpts).
- **Archive page**: under every LIVE a strip of its rounds (width = length, color = how it ended, 10 min+ rounds
  full height, a dot = clip / moments) and a "Rounds" table (`GET /guessword/archive/rounds/{live_key}`,
  super admins `/guessword/rooms/{room}/archive/rounds/{live_key}`) with a "hard only (10 min+)" filter.
  LIVEs known only from imported rounds are listed below as "Earlier LIVEs (from recordings)".

## Development digest (since 2026-10-31)

A 10-minute video of how the game was made, 06.10–30.10, built in the owner's Chrome straight from LIVE
Center with the same reading as the champion race (`resources/js/Pages/Guessword/DevDigest/`: `schedule.js`
timing, `draw.js` overlay — date, crawling log of changes, development "temperature", "No. 1-3" cards;
`build.js` video). The log crawls at one speed; recordings run as a timelapse (one key frame per segment) and
at 1x **with their sound** on each new animation (`hlsDense` + AAC from the same segments, `ts.js audioFrames`);
the line after an animation waits for it to end, so they stay in sync. The MP4 goes piece by piece to the local
server (`POST /write`) into `tiktok-clips/out/dev-digest/`. Before the first build, scroll the LIVE Center list
down to the oldest recording once (the extension remembers what the page loaded; its own background-tab scroll
did not reach 06.10 in 3 min). Measured 31.10: 90 s of the digest in 280 s, 767 MB read. Data (lines, animation moments, recordings) lives in `tiktok-clips/docs/dev-digest/`;
`node tiktok-clips/tools/dev-digest.js` builds `dev-log.json` and serves the page at
`http://localhost:8791/DevDigest/`. Recordings without a known room id are found by their start time
(extension 0.2.0: `replay` with an empty room id and a start, nearest within 3 min; matches `localhost:*`).

## Telegram Mini App (prototype, 2026-11-03; group rooms 2026-11-04)

The game is played from phones inside Telegram instead of a TikTok chat; bot @md_ugadai_slovo_bot. Code:
`stream-engine/app/tg_app.py` (a room's players, protocol in its docstring), `stream-engine/app/tg_bot.py` (the bot,
one room per group, the gate, unloading), page `stream-engine/app/web/tg/index.html` (the overlay's own
`common/neon.css` + `guess/guess.css`, served under `/tg/`), tests `stream-engine/tests/test_tg_app.py`, `test_tg_bot.py`.

- **A room per Telegram group**: players of a group compete only with each other. The bot added to a group (or
  `/play` there) posts the button `t.me/<bot>?startapp=g<code>`; `<code>` is random (not the chat id), the room is
  `tgg_<code>` (`rooms.json`: `tg_code`, `tg_chat`, `tg_title`, `tg_left` when the bot was removed - data kept).
  Telegram signs the parameter into `initData` (`start_param`), the gate (`TgBot.gate`) picks the room by it; no
  parameter (private chat, menu button) = the common room `TG_APP_ROOM`. A group that becomes a supergroup keeps
  its room (`migrate_to_chat_id`). Needs the **Main Mini App** turned on in BotFather (Bot Settings → Configure
  Mini App → the page URL), else `t.me/<bot>?startapp=` links don't open the app.
- **Group admin panel**: `/settings` in the group → for admins (`getChatMember`) a button with `startapp=a<code>`;
  the gate asks Telegram again when the page opens (anyone can press the button). The panel (same page): round
  length, break, dictionary level, pause / resume, +5 min, skip the round, reset the group's leaderboard. Tab
  "ЛИДЕРЫ" = `stats.leaderboard` of the room (wins since the last reset).
- **Rooms live only while played**: nobody for `TG_APP_IDLE_SEC` -> the game pauses; nobody for
  `TG_APP_UNLOAD_SEC` (300) -> a group room is stopped and dropped from memory (round paused on disk); the first
  player back loads it (a few seconds when the round's table must come from the ranker again). Telegram rooms are
  skipped by the bonus sync with Laravel (they are not the platform's).
- **Bot updates**: webhook `POST /tg/hook` (secret header derived from the token), set by the engine at start
  when `TG_APP_PUBLIC_URL` is set, with the commands (`/play`, `/settings` in groups, `/start` in private).

- **Words never go through Laravel.** The page is a static file served by the engine at `/tg/` (behind nginx:
  `/guessword/engine/tg/`); it opens the websocket `/tg/ws`, sends Telegram's `initData` first, then words.
  The engine checks `initData` with the bot's token (HMAC, max 24 h old), so a player can't pose as someone else.
  A word from a phone = a chat line for `GuessGame` (`hub.comment`), all the game rules apply. Player ids are
  `tg<telegram id>`, never equal to a TikTok @id.
- **Load**: the phones get their own slim message (round + the closest `TG_APP_TOP` words), at most every
  `TG_APP_PUSH_SEC` and only when it changed; the overlay's full message (10/s) is not sent to them. A player's
  result and own words go to that player alone. Words: at most one per `TG_APP_WORD_SEC` per player
  (no brute force of the dictionary); unknown words cost no wait.
- **Env** (`/etc/guessword-engine.env`): `TG_APP_ROOM` (room id; empty = off; the engine creates the room, ru,
  `pause` 10 s, `round_min` 10, everyone plays, and keeps it running), `TG_APP_BOT_TOKEN` (the Mini App bot from
  BotFather), `TG_APP_DEV=1` only locally (`/tg/?dev=Name` plays without Telegram), `TG_APP_WORD_SEC` (1.2),
  `TG_APP_PUSH_SEC` (0.5), `TG_APP_TOP` (40), `TG_APP_IDLE_SEC` (120: nobody has the page open this long -> the game pauses, the host's pause marked `idle`; the first player back lifts it, a pause set on the room page stays), `TG_APP_UNLOAD_SEC` (300), `TG_APP_PUBLIC_URL` (`https://mao-dao.com/guessword/engine`: webhook + private-chat button). The rooms still need the ranker (`RANKER_URLS` + `RANKER_KEY`; for now `RANKER_KEY` is gw1's game key - a key of its own in the bot table is the proper fix). Locally `/tg/?dev=Name&start=g<code>` (or `a<code>`: the panel) plays a group room without Telegram.
- **Not done yet**: bonuses/hints for Telegram players, the link Telegram ↔ TikTok account, sending only diffs of
  the table, nginx `worker_connections` for hundreds of sockets, languages other than Russian.

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

`tests/Feature/Guessword/` (Pest, engine faked with `Http::fake`; bonuses: `GuesswordBonusesTest`); the
engine has its own unittest suite in `stream-engine/tests/` (bonuses: `test_bonuses.py`, runs without the
word assets).

## The streamer app (client accounts)

Streamers who want a program instead of the site get `stream-client/` (Tauri, Windows) and an
access key made by a super admin on `/guessword/clients`. The account has no e-mail or password,
sees only its room without the site chrome, must save an Euler key before the first start, and
OBS loads its overlay through `http://localhost:7777/overlay`. Details: `stream-client/README.md`.
