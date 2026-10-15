# Game: Quizzes (first game of the platform)

Solo quizzes (create, share, play, score) and Race Mode (real-time multiplayer quiz).
Platform-wide rules — languages, auth, themes, deployment — live in the main
[`CLAUDE.md`](../../CLAUDE.md); numbered "gotcha #N" references below point there.

Original spec: `../quiz-platform-prompt.txt` (one level up from the repo) and the
phase-by-phase plan (Foundation → Users → Media → Social → Quiz Foundation /
Creation / Discovery / Playing → Social Quiz Features → Personalization →
Finalization), all 11 phases built.

## Quiz timing & randomization

- **Author's time estimate**: `quizzes.estimated_minutes` (nullable int),
  set via two plain number inputs (hours/minutes) in the Editor and
  combined client-side before submit. Display formatting (`"5 min"`,
  `"1h 05m"`, `"10h"`, `"10h 30m"` — hours never zero-padded, minutes
  zero-padded only when hours are also shown) lives in
  `resources/js/utils/duration.js` (`formatMinutes`/`formatSeconds`).
  Reuse that helper anywhere a duration is displayed — don't hand-roll the
  formatting again.
- **Real time spent per attempt**: server-authoritative, matching the
  existing "never trust the client" scoring philosophy. `play()` stamps
  `session()->put("quiz_attempt_started.{quiz_id}", now())`; `store()`
  pulls it back and diffs against `now()`. A client can't shorten/lengthen
  its own reported time because it never reports one.
- **`Carbon::diffInSeconds()` changed its default in Carbon 3** (used by
  Laravel 13): it now returns a *signed, fractional* value instead of
  Carbon 2's absolute integer. `now()->diffInSeconds($past)` can come back
  **negative** and with decimals — inserting that into an
  `unsignedInteger` column throws `SQLSTATE[22003]: Out of range`. Always
  pass `absolute: true` explicitly and cast to `(int) round(...)` when
  storing a diff. This one cost real debugging time (looked like a slow
  test hang before the actual `QueryException` surfaced) — don't drop the
  `absolute: true` in a refactor.
- **Question/answer order is shuffled server-side** in
  `QuizAttemptController::play()` (`->shuffle()->values()`) on every visit.
  This is purely presentational and safe because grading is entirely
  ID-based (`answers.*.question_id` / `answers.*.answer_id`), never
  positional — reshuffling between page loads can't desync scoring.
- **Public aggregate stats** (`attempts_count`, `average_percentage`,
  `average_time_spent_minutes`) on `Quizzes/Show` are computed live via a
  single aggregate query in `QuizLibraryController::show()`
  (`quiz->attempts()->selectRaw(...)`), not cached/denormalized columns —
  simplest option at this app's scale, matches how recommendations are
  computed too. `average_time_spent_minutes` can round down to `0` and
  gets hidden (not shown as "0 min") since `formatMinutes()` treats `<= 0`
  as "no data" — this is deliberate, not a bug, but worth knowing if stats
  seem to "disappear" for a quiz with only very fast attempts.


## Quiz player

- **Quiz Player is now a one-question-per-screen stepper** (`Play.jsx`) —
  a progress bar, Next/Back, answers held in local state and only POSTed
  as the same full array to the same `POST /quizzes/{quiz}/attempts`
  endpoint on the final "Finish" step. This is a frontend-only interaction
  change; `QuizAttemptController` (shuffle, timer, scoring) is untouched.

## Server-side rules

- **Quiz copy**: deep-clone in a `DB::transaction()`, tags re-pivoted (not
  cloned), `allow_copying` always resets to `true` on the copy regardless
  of the source, `copied_from_quiz_id` preserves lineage. See
  `QuizController::copy()`.
- **Recommendations**: `app/Services/QuizRecommendationService.php` — one
  explicit weighted Eloquent query (tag-overlap ×2, liked-quiz-tags ×1,
  passed-quiz-tags ×1, UI-language-match ×1), no external search/ML.
  Excludes the viewer's own quizzes and anything they've already attempted.
- **Quiz scoring**: always computed server-side in
  `QuizAttemptController::store()` from the submitted `answer_id`s looked
  up against each question's *own* answers — never trust a client-supplied
  correctness flag.

## Race Mode (real-time multiplayer quiz)

Built per `../Multiplayer Quiz Race Mode — Clean Claude Code Prompt.md`
(one level up), phased: 1) data model, 2) room/join, 3) real-time
gameplay, 4) results/lifecycle, 5) polish — **all 5 phases complete and
verified** (149 Pest tests passing, existing solo Quiz Mode untouched and
still fully passing; production deployment of Reverb is the one piece
deliberately left for later, see below). A host opens a published quiz,
clicks "Start a Race", gets a shareable room code/link; anonymous or
authenticated players join with a per-race nickname (independent of their
account name); everyone answers server-timed, synchronized questions
together with a live leaderboard, host can "Play Again" into a fresh room
afterward.

- **Data model**: `race_rooms` / `race_players` / `race_answers` — see
  `App\Models\RaceRoom`/`RacePlayer`/`RaceAnswer`. `RaceRoom.question_order`
  snapshots the quiz's question IDs at start time (a later quiz edit can't
  corrupt an in-progress race). Scoring is `App\Services\RaceScoringService`
  (1000 base + up to 500 linear speed bonus, 0 if incorrect) — pure,
  directly unit-tested, never trusts a client-supplied time or score.
- **Guest identity, not a new auth system**: joining stores a random
  `session_token` on the `RacePlayer` row AND in the visitor's ordinary
  Laravel session (`race_player_token.{room_id}`) — works identically for
  guests and authenticated users, never appears in a URL. Resolved on
  every request by `App\Http\Middleware\ResolveRacePlayer` (aliased
  `race.player`), which attaches `raceRoom`/`racePlayer` to the request.
- **Real-time transport: Laravel Reverb**, chosen over polling despite
  the ops cost of new persistent processes on the shared production box —
  see the audit/decision recorded in this session's plan history if you
  need the reasoning again. Broadcasts are on a **public** channel
  `race.{roomCode}` (no per-guest broadcasting-auth endpoint needed —
  race state isn't sensitive; every write is still authorized
  server-side regardless). Events live in `app/Events/Race/*`, all
  `ShouldBroadcastNow` (not `ShouldBroadcast` — this app's queue has no
  worker running anything dispatched to it would never fire).
- **`race:tick` is the authoritative timing engine**, not Reverb itself
  (Reverb only pushes; it has no scheduling capability, and this app has
  no cron/scheduler wired up either). `App\Services\RaceTickService::tick()`
  — a plain, directly-testable class — is called in a loop by
  `php artisan race:tick` every 500ms, advancing any room whose stored
  deadline (`current_question_deadline_at` / `results_reveal_until` /
  `started_at`) has passed. Every "time's up" decision happens here, from
  a server timestamp — never on a client's local timer.
- **Gotcha — server-to-client Reverb host differs from server-to-server**:
  the browser reaches Reverb at `localhost:8080` (the host-exposed
  docker-compose port), but the `laravel.test`/`race-tick` containers
  broadcasting an event run in *separate containers* from `reverb`, where
  `localhost` means themselves, not the Reverb container — publishing
  would hang/fail with a cURL connection error otherwise. Fixed via a
  second set of env vars read only for server-side publishing
  (`REVERB_SERVER_HOST=reverb`/`REVERB_SERVER_PORT`/`REVERB_SERVER_SCHEME`,
  falling back to the client-facing ones if unset — see
  `config/broadcasting.php`'s `reverb.options`). If you ever collapse
  Reverb back into the same container as the app, this fallback still
  works unchanged.
- **Gotcha — the `reverb` and `race-tick` docker-compose services need
  `SUPERVISOR_PHP_USER: root`** too, exactly like `laravel.test` already
  has (gotcha #1 above) — omitting it means `start-container` execs the
  process as the non-root `sail` user via `gosu`, which can't write to
  the Windows-bind-mounted `storage/logs/laravel.log`, so failures
  (like the host mismatch above) get silently swallowed instead of
  logged, which cost real debugging time.
- **Gotcha — a page that stays subscribed to the Reverb channel across a
  `router.visit()` must guard against re-firing that visit.** `Lobby.jsx`
  listens for the same `race.{code}` events Play.jsx will need later;
  without a ref-guarded "navigate once" check, every subsequent status
  change (question -> question_results -> ...) re-triggers
  `router.visit(route('race.play', ...))`, which remounts `Play.jsx` from
  scratch each time and silently wipes its local `hasAnswered` state —
  this actually happened during manual testing (results screen showed
  "no answer submitted" despite a correctly-recorded, correctly-scored
  answer) and only reproduces under real WebSocket timing, not in Pest.
- **Dev infra**: `docker-compose.yml` has `reverb` (`reverb:start`,
  host port 8080) and `race-tick` (`race:tick`) services, both reusing
  the already-built `sail-8.5/app` image — bring them up with
  `docker compose up -d reverb race-tick` (not started by plain
  `docker compose up -d laravel.test mysql`). `resources/js/echo.js` is
  the Echo/Pusher client config (reads the `VITE_REVERB_*` env mirrors);
  `resources/js/hooks/useRaceChannel.js` is the shared subscribe-and-fold
  -into-state hook used by both `Lobby.jsx` and `Play.jsx`, with a
  visibility-change-triggered resync (via `GET /race/{code}/state`) as a
  low-risk complement to the socket for the common reconnect case (a
  phone screen locking/backgrounding), not a second real-time mechanism.
- **Production deployment of Reverb is not done yet** (planned: PM2-managed
  `reverb:start`/`race:tick` processes, matching how this box's other
  Node services are already run, plus one new nginx `location` block
  proxying a WebSocket upgrade to Reverb over loopback only — do this as
  its own explicit, confirmed step, not bundled into an unrelated deploy).

