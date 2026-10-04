# Quiz Platform — Project Notes for Claude Code

Social quiz platform: Laravel (monolith) + Inertia.js + React + Tailwind +
MySQL, fully localized (en/fr/es/ru). Built per the spec in
`../quiz-platform-prompt.txt` (one level up) and the implementation plan
this session followed phase-by-phase (Foundation → Users → Media → Social →
Quiz Foundation/Creation/Discovery/Playing → Social Quiz Features →
Personalization → Finalization). All 11 phases are built and verified.

## "Production" here is effectively a test environment (owner's decision, 2026-10-04)

`mao-dao.com` is called "prod" but is not yet used for its real purpose —
treat it as the **test environment**. Consequences:
- **Run the full test suite in GitHub Actions** (`.github/workflows/tests.yml`,
  triggers on every push to `main` and on PRs; MySQL service container, so no
  live data is ever involved). It is ~30x faster than the local Docker run
  (about 14 s for the test step vs ~417 s locally for the same 292 tests) —
  check the run after every push (public API:
  `https://api.github.com/repos/alex-mtl/mao-dao/actions/runs`). Locally,
  prefer `--filter=<Name>` for the area being changed.
- **Do not run the suite on the server itself**: `RefreshDatabase` wipes every
  table it touches, the server installs with `--no-dev` (no Pest), and a
  dedicated test DB would have to be created on a shared box. After a deploy,
  just smoke-check `/quiz/login` and `/mafia/`.
- **Data on the server must not be harmed** (owner's explicit requirement).
- Still be careful: the box is shared with other **real** production
  projects. Touch only `/var/www/quiz`, this app's own DB/user/FPM pool, and
  its own PM2 processes; never data folders or other sites' files.

## Environment — read this before running anything

**No PHP, Composer, or Node is installed on the host (Windows).** Everything
runs inside Docker. Do not try to run `php`, `composer`, or `npm` directly —
prefix every such command with `docker compose exec laravel.test`.

```bash
docker compose up -d --build          # start the stack (Laravel app + MySQL)
docker compose exec laravel.test php artisan migrate --seed
docker compose exec laravel.test php artisan test
docker compose exec laravel.test npm run build   # after ANY resources/js or lang/ change
```

App runs at **http://localhost:8000** (not port 80 — `APP_PORT=8000` in
`.env` to avoid clashing with anything already on 80).

**`vendor/bin/sail` does not work on native Windows Git Bash** (it only
supports macOS/Linux/WSL2 and will exit immediately with "Unsupported
operating system"). Always use `docker compose exec ...` / `docker compose
up/down` directly instead of the `sail` wrapper. `WWWUSER`/`WWWGROUP` are
hardcoded in `.env` (not dynamically exported per-shell) so `docker compose`
picks them up automatically without needing the sail script.

**Git Bash mangles absolute container paths** (e.g. `/etc/...` gets rewritten
to `C:/Program Files/Git/etc/...`). Prefix any `docker compose exec`/`run`
command that includes an absolute Linux path with:
```bash
export MSYS_NO_PATHCONV=1
```

## Known gotchas already fixed — don't reintroduce these

1. **Windows bind-mount permissions**: Docker Desktop reports all
   bind-mounted files as `root:root` regardless of the container user, so
   the non-root `sail` user can't write to storage/cache. Fixed by setting
   `SUPERVISOR_PHP_USER: root` in `docker-compose.yml`'s `laravel.test`
   environment block. Don't remove this — without it you'll get a cryptic
   `tempnam(): file created in the system's temporary directory` 500 error.

2. **npm peer-dependency conflict**: this project pins bleeding-edge
   package versions where `@vitejs/plugin-react`'s peer range hasn't
   caught up to `vite@8` yet. Always install with
   `npm install --legacy-peer-deps`. Plain `npm install` will fail with an
   ERESOLVE error.

3. **Ziggy's `route().current()` does NOT accept an array.**
   `route().current(['a', 'b', 'c'])` crashes with `t.replace is not a
   function` and takes down the *entire* page (it's called in
   `AuthenticatedLayout`, so every authenticated page breaks). Always
   chain instead: `route().current('a') || route().current('b')`.

4. **Inertia does not remount the app root on client-side navigation.**
   A `<LaravelReactI18nProvider locale={x}>` set once in `app.jsx`'s
   `setup()` goes stale after e.g. logging in as a user with a different
   `ui_language` — the UI stays in the previous language until a hard
   refresh. Fixed via the `<App>` children render-prop pattern
   (`resources/js/app.jsx`'s `LocaleSync` component), which re-syncs the
   locale from page props on every visit via `useEffect`. Don't revert
   `app.jsx` to the simpler `<App {...props} />` form without keeping this.

5. **Breeze's scaffolded `app.jsx` imports `./bootstrap`, which doesn't
   exist** in this Breeze version (Inertia handles CSRF internally now;
   axios bootstrap is a stale leftover). Already removed — don't re-add it
   if you regenerate the file.

6. **`laravel-lang/publisher` alone does nothing.** It needs the actual
   translations package `laravel-lang/lang` installed too, or `lang:add`
   silently produces empty directories with no error. Both are required
   dev dependencies here.

7. **Generated factories from `make:model -mf` have an empty
   `definition()` stub** — e.g. `TagFactory` needed `name`/`slug` filled
   in by hand, or `Tag::factory()->create()` fails with a MySQL "doesn't
   have a default value" error. Check any new factory's `definition()`
   isn't still `return [ // ];`.

8. **A freshly-created Eloquent model doesn't know about DB column
   defaults it didn't explicitly set.** e.g. `User::factory()->create()`
   doesn't set `ui_language`, so `$user->ui_language` is `null` in memory
   even though the DB row actually has `'en'` (the column default). Use
   `$user->fresh()->ui_language` to see the real value.

9. **`.env.example` in a fresh Laravel skeleton defaults to SQLite.**
   This project forbids SQLite — `.env.example`/`.env` are already
   corrected to MySQL (`DB_CONNECTION=mysql`, host `mysql`). Don't let a
   future `composer create-project` or template refresh silently revert
   this.

10. **Browser-automation click-by-`ref` sometimes fails** with "(0,0)
    could not be attributed to a frame" right after a page transition.
    Workaround: take a fresh `screenshot` immediately before the click, or
    click by coordinate, or fall back to `document.querySelector(...).click()`
    via the JS-eval tool.

11. **`get_page_text` / reading `#app` `dataset.page` can be stale for a
    second right after an Inertia client-side navigation.** If content
    looks like it didn't update, check `window.location.href` first before
    assuming a bug — it's often just a timing lag in the read, not the app.

12. **`REVERB_ALLOWED_ORIGINS` must be a bare hostname (`mao-dao.com`), NOT
    a full URL with scheme (`https://mao-dao.com`) — this was set wrong in
    production for an unknown amount of time and silently broke real-time
    push for BOTH Race Mode and Mafia the entire time, with no error
    anywhere.** Root cause: `vendor/laravel/reverb/src/Protocols/Pusher/Server.php`'s
    `verifyOrigin()` does `parse_url($connection->origin(), PHP_URL_HOST)` —
    it strips the scheme from the browser's `Origin` header before
    comparing against `allowed_origins` — so a configured value that still
    has `https://` on it can never match, and Reverb rejects every single
    connection with `{"code":4009,"message":"Origin not allowed"}`,
    confirmed directly via a raw `curl` WebSocket handshake (`101 Switching
    Protocols` succeeds, then the app-level rejection follows immediately
    over the now-open socket). **This produces no visible error in the
    browser or Laravel logs** — Pusher-js just silently fails to hold a
    subscription, and the app degrades to `useMafiaChannel.js`'s 12-second
    heartbeat poll / `useRaceChannel.js`'s equivalent, which still makes
    the app "work" well enough that this went unnoticed through this
    session's own earlier local testing (see gotcha below) and through
    manual production verification, since nothing throws or logs. Reported
    directly by the account owner as "nomination/vote doesn't feel
    instant, next speaker starts ~10s late" — that ~10s is the heartbeat
    interval, not a game-logic bug. Fixed by setting
    `REVERB_ALLOWED_ORIGINS=mao-dao.com` and restarting the `quiz-reverb`
    PM2 process (config alone doesn't take effect until the long-running
    Reverb server process itself restarts) — verified via the same raw
    `curl` handshake returning `pusher:connection_established` instead of
    the error. **If you ever regenerate Reverb credentials/config for a
    new environment, set this to the bare host, not a URL.**

13. **Running this project's own "build for production" command
    (`VITE_ASSET_BASE_PATH`/`VITE_REVERB_*` overrides) inside the SAME
    `laravel.test` container used for local dev overwrites local dev's own
    `public/build/` with the production-configured bundle** — they share
    one Vite output directory. This actually happened mid-session and
    silently broke local WebSocket testing for a long stretch (the local
    browser was pointed at `wss://mao-dao.com:8380`, which a dev-machine
    browser cannot meaningfully connect to, so every "local" real-time
    test was actually running on the 12s heartbeat fallback without any
    error saying why). Confirmed via `window.Pusher.instances[0].config`
    in the browser console and `.connection.state` reading
    `"disconnected"`. **Always run a plain `npm run build` (no env
    overrides) again after building for a production deploy**, before
    resuming any local testing that depends on Reverb.

14. **Vite's chunk hashes are NOT scoped to only the files that actually
    changed** — a fresh `npm run build` gives essentially every hashed
    filename under `public/build/` a new hash, not just the ones whose
    source changed (confirmed by diffing two manifests where only one
    `.jsx` file differed: literally every entry's hash was different).
    Never hand-pick "just the changed chunk" for a frontend deploy —
    ship the **entire** `public/build/` directory (it's ~1.4MB, cheap to
    tar/scp in full) plus `manifest.json`, so the manifest and its
    referenced files always agree. This per-file-deploy risk is specific
    to compiled JS assets; plain PHP source files remain safe to deploy
    individually (that's a separate, real risk — see the rotation-drift
    gotcha in the Mafia section below).

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

## Visual design system ("Playful Premium" redesign)

The frontend was fully restyled from stock Breeze/Tailwind onto a custom
design system — same backend/business logic throughout, purely visual +
one UX change (see below). If you touch styling, use these, don't
reintroduce raw `gray-*`/`indigo-*` classes:

- **Tokens** (`tailwind.config.js` `theme.extend.colors`): `primary`
  (blue-violet brand color), `secondary` (coral, sparing use),
  `accent` (mint), `success`/`warning`/`danger`/`info` (semantic), `warm`
  (backgrounds/surfaces/borders — warm neutral, never cold gray), `ink`
  (all text colors — charcoal/navy, never pure black or warm-tinted).
  Fonts: `font-heading` (Manrope, for `h1`-`h6` and headings) / default
  `font-sans` (Inter, body/UI) — both loaded via the existing Bunny Fonts
  `<link>` in `app.blade.php`.
- **Icons**: `@heroicons/react` (24px `outline` for nav/UI chrome, 20px
  `solid` for small inline icons like `InputError`). This is the only
  icon library — don't add a second one.
- **Shared components** (`resources/js/Components/`): `QuizCard` (used by
  Explorer/Library/Mine/Dashboard — don't hand-roll quiz list rows again),
  `Pagination` (wraps Laravel's `links` paginator shape), `PageHeader`,
  `Badge`, `EmptyState`, `Avatar` (shows `user.profile_photo_url`, a
  `$appends`-computed accessor on the `User` model — presentation only,
  reads from the existing Spatie media library, no new column), `Spinner`
  (used by the button components' `loading` prop).
- **Navigation**: the old permanent top nav bar is gone. `AuthenticatedLayout`
  is now a compact ~56px sticky header (hamburger + logo + avatar dropdown)
  plus `NavigationDrawer.jsx` (Headless UI `Dialog`, slides from the left,
  grouped Main/Social/Account sections, ESC + backdrop-click to close).
  `ResponsiveNavLink.jsx` was repurposed into the drawer's nav-item
  component (icon + label + active state); the old `NavLink.jsx`
  (underline-style top-bar link) was deleted since nothing renders a
  permanent top bar anymore.
- **Quiz Player is now a one-question-per-screen stepper** (`Play.jsx`) —
  a progress bar, Next/Back, answers held in local state and only POSTed
  as the same full array to the same `POST /quizzes/{quiz}/attempts`
  endpoint on the final "Finish" step. This is a frontend-only interaction
  change; `QuizAttemptController` (shuffle, timer, scoring) is untouched.
- **Gotcha — button `type` defaults**: `PrimaryButton`/`DangerButton` must
  NOT default their `type` prop to `'button'`. Several call sites (e.g.
  Login's submit button) rely on the native HTML behavior where an
  untyped `<button>` inside a `<form>` defaults to `type="submit"`. Adding
  an explicit `type = 'button'` default silently breaks those forms (this
  actually happened during the redesign — caught by testing the login
  flow, not by the build or Pest suite, since it's a pure frontend
  behavior change). `SecondaryButton` is the one exception that SHOULD
  default to `'button'` — it's never used as a submit button.
- **Color schemes (5, incl. 2 dark) were added later** — see the dedicated
  "Color scheme system" section below. All 9 semantic color scales are now
  CSS-variable-backed rather than static Tailwind hex, so this superseded
  the original redesign's decision not to add dark mode.

## Color scheme system

5 selectable themes (`light-warm` default, `light-cool`, `light-soft`,
`dark-warm`, `dark-cool`), persisted per-user (`users.color_scheme`,
mirrors `ui_language` end-to-end: `config/color_schemes.php`,
`HandleInertiaRequests` shares `color_scheme`/`color_scheme_options`,
`ProfileController::updateColorScheme()` + `PATCH /profile/color-scheme`).

- **All 9 semantic Tailwind color scales are CSS-variable-backed**, not
  static hex (`tailwind.config.js`'s `cssVarScale()` emits
  `rgb(var(--color-x-500) / <alpha-value>)`). The actual per-theme values
  live in `resources/css/themes.css`, which is **generated, not
  hand-edited** — its source of truth and transform logic is
  `resources/css/generate-themes.mjs`. Regenerate after changing brand hex
  values or a theme's transform with:
  `docker compose exec laravel.test node resources/css/generate-themes.mjs`
  (then `npm run build`).
- **Brand/semantic scales keep the same hue in every theme** ("systematic
  variants", not new brand identities) — only neutrals (`warm`/`ink`) and
  a `surface` token (replaces literal `bg-white` on cards — a `data-theme`
  scoped nested element, e.g. a swatch preview, needs its own explicit
  rule to override an ancestor's different theme, which is why `:root`
  duplicates `light-warm` rather than being the only place it's defined)
  vary hue/lightness per theme.
- **Dark themes are NOT a uniform lightness flip.** Brand/neutral
  *background* scales (`warm`, and primary/secondary/accent/semantic) use
  `reversePosition()` (shade 50 gets shade 950's old lightness, etc.) —
  this keeps "higher shade number = lighter" true in every theme without
  per-usage special-casing, and intentionally keeps buttons visually
  similar across themes since shade 500 self-maps. The `ink` (text) scale
  specifically uses `invertLightness()` (`newL = 100 - L`, not a position
  swap, plus a `+14` lift) instead — `reversePosition` would leave
  `ink-500` (muted secondary text) anchored at its original ~41%
  lightness, unreadable (~1.8:1 contrast) against a dark ~20-27% surface;
  this was caught during manual verification, not by the test suite,
  since it's a pure-CSS contrast issue. If you add a new neutral-ish scale
  used for text, it needs `invertLightness`, not `reversePosition`.
- `<html data-theme="...">` is set server-side in `app.blade.php` (reads
  `auth()->user()->color_scheme`, mirroring the existing `lang` attribute
  pattern) to avoid a flash of the wrong theme before hydration.
  `resources/js/Components/ColorSchemeSync.jsx` re-applies it from Inertia
  props on every client-side navigation (same staleness issue `LocaleSync`
  in `app.jsx` solves for locale — Inertia doesn't remount the app root).
- The picker (`Profile/Partials/ColorSchemePreferenceForm.jsx`) renders
  swatch buttons with their own `data-theme="<key>"` attribute so their
  preview dots/backgrounds use plain `bg-primary-500`/`bg-surface` classes
  scoped to that theme via CSS custom property inheritance — no
  hardcoded per-theme hex duplicated in JS. Clicking one applies the
  theme instantly client-side, then persists it via a background
  `patch()`.

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

## Mafia (social-deduction party game — new platform section, in progress)

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

### Phase 6 — production routing: two real bugs found deploying this

Making `/mafia` a genuine sibling of `/quiz` (same Laravel app, two nginx
path prefixes, per plan §2.1) surfaced two non-obvious bugs that took
real debugging to find — both are load-bearing fixes, don't revert them
without understanding why they're there:

1. **`/mafia`'s nginx block must NOT strip the prefix the way `/quiz`'s
   does.** `/quiz`'s own app routes are defined *without* "quiz" in them
   (`Route::get('/dashboard', ...)`, not `Route::get('/quiz/dashboard',
   ...)`) — they work because nginx/Symfony's base-path detection strips
   "/quiz" before Laravel's router ever sees the path. Mafia's routes are
   defined *with* a literal "mafia/" prefix
   (`Route::get('/mafia/history', ...)`), so stripping "/mafia" the same
   way left the router seeing just "/history" (matching nothing → 404)
   or "" (matching `/` → wrongly rendered the Welcome page for
   `/mafia/`). The fix, in the mafia nginx block's PHP location only: set
   `fastcgi_param SCRIPT_NAME /$mafiapath;` (**not** `/mafia/$mafiapath`,
   unlike the matching `/quiz` line) — Symfony's
   `Request::prepareBaseUrl()` derives the stripped base from
   `dirname(SCRIPT_NAME)`, and `dirname('/index.php')` is `/`, which is
   never treated as a real prefix to strip, so the full `/mafia/...` path
   reaches the router intact. This is a **deliberate difference** from
   the `/quiz` block, not a copy-paste inconsistency — the two sections
   need opposite base-path behavior precisely because one's routes are
   prefixed and the other's aren't.
2. **The shared, un-prefixed Breeze `login` route only resolves under
   `/quiz`'s stripping scheme** — after fix #1, an unauthenticated
   `/mafia/*` request has nothing named "mafia/login" to redirect to
   (Laravel's default unauthenticated-redirect logic would otherwise
   produce a URL nothing matches, causing a **redirect loop**: `/mafia/*`
   → `route('login')` under the mafia root → back to `/mafia/login` →
   matches nothing except the `mafia/{code}` wildcard, which is itself
   `auth`-gated → redirects again → forever). Rather than duplicate the
   entire auth route set under a second prefix for one shared account
   system, `AppServiceProvider::boot()` now calls
   `Authenticate::redirectUsing(fn () => rtrim(config('app.url'),
   '/').'/login')` — every unauthenticated redirect, from either
   section, goes to the one real login page under `/quiz`. Laravel's
   ordinary "intended URL" session mechanism still bounces the user back
   to whatever `/mafia/...` page they actually wanted once they log in —
   this needed no custom code, it's stock Laravel behavior once the
   redirect target itself resolves to a real route.
3. **`SESSION_PATH` was hardcoded to `/quiz`** in production `.env` —
   harmless while only one section existed, but it would have scoped the
   session/XSRF cookies to `/quiz` only, meaning they'd never be sent
   back on `/mafia/*` requests at all. Widened to `SESSION_PATH=/` (the
   whole domain) — both sections share one session/account system
   anyway, so there's no reason to scope the cookie tighter, and a
   domain-wide path is simpler than trying to make it dynamic per prefix.
4. **[CORRECTED, see below] Original (buggy) design**: `config('app.mafia_url')`
   (`.env`'s `APP_MAFIA_URL`, set to `https://mao-dao.com/mafia`) was what
   `AppServiceProvider::rootUrlFor()` forced the root to for any request
   whose path starts with "mafia". This shipped, went unnoticed through
   every automated test (forceRootUrl only runs in the `production`
   environment, so local/CI never exercised it), and surfaced as a real
   **404 on room creation** the first time an actual human clicked
   "Create Room" in production — Ziggy's client-side `route('mafia.store')`
   concatenated the forced root (`.../mafia`) with the route's own URI
   (`mafia/rooms`, since — unlike `/quiz`'s bare routes — Mafia's routes
   carry a literal `mafia/` prefix), producing `.../mafia/mafia/rooms`,
   which matches no route. Confirmed directly: `POST /mafia/rooms` → 419
   (CSRF, i.e. route found) vs `POST /mafia/mafia/rooms` → 404.
   **Fix**: `rootUrlFor()` now returns a bare `'https://'.$request->getHost()`
   for mafia paths instead of a config value with a path suffix — since
   Mafia's routes already embed their own prefix, the forced root must
   contribute no path at all, or any second concatenated prefix doubles
   up. `config('app.mafia_url')`/`APP_MAFIA_URL` were removed entirely
   (dead once nothing needed them) — `APP_URL` itself remains untouched
   (`https://mao-dao.com/quiz`) since it's referenced directly in the OAuth
   callback URL env vars (`GOOGLE_REDIRECT_URI="${APP_URL}/..."` etc.),
   which are registered with Google/Facebook and would break if changed.
   **Lesson**: `forceRootUrl`-style logic that only runs in `production`
   is exactly the kind of thing Pest tests can't catch — this needs a
   real click-through in production after any future change to it, not
   just green tests.
6. **Follow-up bug from fix #4, same root cause**: fixing the room-creation
   404 by forcing a bare root on `/mafia/*` requests broke the *other*
   direction — `AuthenticatedLayout`/`NavigationDrawer` render the same
   shared header on every page in **both** sections and link into both
   (`dashboard`, `profile.edit`, `logout`, `friends.index`, `groups.index`,
   `explorer.index`, `library.index`, `quizzes.mine`, `quizzes.create`,
   plus `mafia.index`). `rootUrlFor()` forces exactly one root for the
   *whole request* — there is no single root that's simultaneously
   correct for a bare quiz route and a `mafia/`-prefixed route generated
   on the same page. Result: every shared-nav link rendered on a
   `/mafia/*` page 404'd once fix #4 shipped (reported directly: "a lot
   of 404" right after landing on a room's lobby page).
   **Fix**: `resources/js/hooks/useSectionRoutes.js` — a small hook
   exposing `quizRoute(name, params)` and `mafiaRoute(name, params)`,
   each calling Ziggy's global `route()` with an explicit 4th-arg config
   override (`{ ...window.Ziggy, url: <the correct root> }`) instead of
   relying on whatever root the *current* page happened to force.
   `quizRoute` always resolves against a new `quizUrl` prop shared from
   `HandleInertiaRequests::share()` (`config('app.url')`, stable
   regardless of request); `mafiaRoute` always resolves against
   `window.location.origin` (correct for mafia's self-prefixed routes on
   whatever domain is currently serving the page — no server round trip
   needed). `AuthenticatedLayout.jsx` and `NavigationDrawer.jsx` are the
   only two files with cross-section links, so only those two needed
   updating — every other `route()` call in the app stays untouched
   since it only ever points within its own section.
   **Lesson, generalized**: a single per-request forced root (`rootUrlFor`)
   is only safe for `route()` calls confined to their own section. Any
   *shared* component that links across `/quiz` and `/mafia` must resolve
   those specific links explicitly rather than trusting the ambient root
   — check for this pattern before adding any other shared,
   both-sections-visible component.
7. **The real, bigger bug underlying both of the above**: `@vite()`'s
   entry `<script>`/`<link>` tags — the ones that load the page's *own*
   JS/CSS bundle — are generated via `Illuminate\Foundation\Vite::asset()`,
   whose default path resolver is just the `asset()` helper
   (`Vite.php::assetPath()`: `$this->assetPathResolver ?? asset(...)`).
   `asset()` respects `forceRootUrl` exactly like `route()`/`url()` do.
   So on **every real, authenticated `/mafia/*` page** (not the
   redirect-to-login case fix #4/#6 were verified against — that
   redirects to a `/quiz/login` request, which forces the *correct* root)
   — Lobby, Play, Index, Join, History — the page's own entry bundle was
   requested from the bare/mafia root instead of `/quiz/build/...`,
   404ing immediately and cascading into dozens of failed dynamic
   chunk-imports for everything the entry script pulls in (reported
   directly: a screenshot showing ~20 simultaneous 404s for
   `https://mao-dao.com/build/assets/*.js` plus a blocked stylesheet MIME
   error, referrer `play:1`). This is almost certainly what both of the
   "a lot of 404s" reports in this session actually were — fix #6 (shared
   nav links) was a real bug too, but nowhere near this scale, since a
   plain `<Link href>` doesn't fire a request until clicked, while a
   dead entry script blanks the whole page.
   **Fix**: `AppServiceProvider::boot()` now calls
   `Vite::createAssetPathsUsing(fn ($path) =>
   rtrim(config('app.url'), '/').'/'.ltrim($path, '/'))` — Vite's own
   asset URLs always resolve against the quiz root, completely
   independent of `rootUrlFor()`'s per-request forced root. This is
   correct because the compiled bundle physically exists *only* under
   `/var/www/quiz/public/build`, reachable *only* via the `/quiz/build/`
   nginx alias, regardless of which section's page is loading it (see
   point 5 above) — there is no scenario where a mafia-rooted asset URL
   would ever be right.
   **Verified properly this time**: manually forced the root to bare
   (`URL::forceRootUrl('https://mao-dao.com')`, the exact state a real
   `/mafia/*` request produces) in `tinker` on production and confirmed
   `Vite::asset(...)` still returned the `/quiz/build/...` URL while
   `route('mafia.store')` still correctly returned the bare-rooted
   `/mafia/rooms` — i.e. the two mechanisms are now genuinely
   independent, not just "happened to pass because the test case didn't
   exercise the broken state" (a mistake made once already in this
   session — the first post-fix browser check only ever hit the
   redirect-to-login path, which never exercises the bare-root branch at
   all).
   **Lesson**: when verifying a per-request-root bug, check whether the
   *specific request path tested* actually exercises the branch you
   changed — a redirect target on a differently-rooted page proves
   nothing about the page that redirected to it.
5. **No separate asset path or nginx `/build/` block was needed** —
   `/quiz/build/...` is an nginx `alias` to the physical
   `/var/www/quiz/public/build/` directory regardless of which prefix
   served the page, so pages rendered under `/mafia` loading their JS/CSS
   from the existing `/quiz/build/...` URLs (baked in at Vite build time,
   unchanged) resolve correctly without any special-casing. The plan's
   §2.1 originally assumed a new shared `/build/` path would be required;
   it wasn't.

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

### Phase 7 — voice/video: built, tested, deliberately not deployed

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

## Architecture decisions worth knowing

- **i18n**: `lang/{en,fr,es,ru}/*.php` is the single source of truth for
  both backend (`__()`, validation messages) and frontend
  (`laravel-react-i18n`, via a Vite plugin that bundles the same PHP lang
  files as JSON). `HandleInertiaRequests` sets `App::setLocale()` from
  `auth()->user()->ui_language` every request and shares `locale` +
  `locale_options` props.
- **Media**: Spatie Laravel Media Library, two collections on `User`:
  `profile` (single file) and `images` (max 100, enforced in
  `ImageController`, not just client-side).
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

## Roles & permissions

Three roles exist (`roles` table, seeded by `RoleSeeder`): `super_admin`,
`community_admin`, `user`. Every user has a nullable `role_id` FK
(`User::role()`); new users get `user` automatically via a `static::creating`
model hook in `User.php` (NOT via `#[Fillable]` — `role_id` is deliberately
excluded from mass assignment so it can never be set through a form). That
hook doesn't fire for seeders using `WithoutModelEvents` (`DatabaseSeeder`
does), so `UserFactory::definition()` also sets a default `role_id` directly
— if you add another place that creates users outside the factory/hook,
assign `role_id` explicitly there too.

Helper methods: `$user->isSuperAdmin()`, `$user->isCommunityAdmin()`,
`$user->hasRole(string $slug)`. Role is shared to the frontend via
`HandleInertiaRequests` (`auth.user.role.slug`), but authorization
decisions are computed server-side and passed as booleans (e.g.
`canDeleteAccount` from `ProfileController::edit()`) — don't duplicate role
logic in JS beyond reading that boolean.

**Delete Account is Super-Admin-only** (both hidden in the UI and enforced
in `ProfileController::destroy()` via `abort_unless($user->isSuperAdmin(),
403)`). The `DeleteUserForm` component and the destroy route/controller
logic are untouched/fully functional — only visibility + authorization are
gated. Don't hide a sensitive action in the frontend without a matching
backend check; a hidden button is not a permission boundary.

On production, roles were backfilled for pre-existing users after the
migration (all defaulted to `user`; `kim.alexander.ca@gmail.com` was
promoted to `super_admin` at the account owner's explicit request — this
was NOT scripted/assumed, since granting elevated access to a real account
is not something to do silently). The seeder separately makes the
`test@example.com` dev/demo account `super_admin` for local Docker
environments only — that choice doesn't affect production.

## Testing

`docker compose exec laravel.test php artisan test` — 91 Pest tests in
`tests/Feature/`, one file per feature area (Auth, Localization, Profile,
Friends, Groups, Images, Quiz CRUD, Quiz Player, Likes, Copy,
Recommendations, Dashboard). All passing as of last run, including a full
tear-down/rebuild-from-scratch Docker verification.

## Seeded accounts (after `--seed`, password is `password`)

`test@example.com` (plain), `alice@example.com` (en), `bruno@example.com`
(fr), `carla@example.com` (es), `dmitri@example.com` (ru), `eve@example.com`
(en) — these have quizzes, friendships, a group, likes, and attempts
already populated (see `database/seeders/QuizPlatformSeeder.php`).

## Not yet live

Facebook/Telegram login code paths are complete
(`SocialAuthController`, `SocialLoginButtons.jsx`) but untested against
real providers — `.env` has placeholder credential fields for those two.
The Telegram button doesn't render until `TELEGRAM_BOT_NAME` is set.
Google is configured (see "Production deployment" below) and redirects
into Google's consent screen correctly; it only completes end-to-end once
the redirect URI is added in Google Cloud Console (a manual step only the
account owner can do).

## Production deployment (mao-dao.com/quiz)

Live at `https://mao-dao.com/quiz/`, deployed to `/var/www/quiz` on the
`aws-dev` server (`ssh aws-dev`) — a shared box with several other live,
unrelated sites. Never run anything destructive there without checking
what else is running first; this project only ever touches its own
`/var/www/quiz` folder, its own MySQL DB/user, its own PHP-FPM pool, and a
`/quiz` location block appended to `mao-dao.com`'s existing nginx config.

### Server specifics (bare metal, no Docker on this host)

- PHP 8.3.23 / nginx / MySQL 8.0. App code: `/var/www/quiz`.
- DB: `quiz` database, `quiz_user` MySQL user — isolated, no access to any
  other database on the box.
- Dedicated PHP-FPM pool at `/etc/php/8.3/fpm/pool.d/quiz.conf` (its own
  socket, `php8.3-fpm-quiz.sock`) — created instead of touching the shared
  `www.conf` pool other sites use, so this app's higher upload limits (6M/
  8M, for the 5MB image feature) don't affect anyone else. Reload with
  `sudo systemctl reload php8.3-fpm` after editing it.
- nginx config lives in the existing `/etc/nginx/sites-available/mao-dao.com`
  (mao-dao's own Node app is proxied at `/`; `/quiz` is a separate location
  block added above it — see below). Always back up before editing,
  `sudo nginx -t` before every reload, `sudo systemctl reload nginx` after.

### Deploying a source/code change

Composer dependencies must be resolved for **PHP 8.3** (the server), not
the 8.4/8.5 used in local Docker dev — the committed `composer.lock`
resolves to Symfony 8.1, which needs PHP 8.4.1+. On the server:
`rm composer.lock && composer install --no-dev --optimize-autoloader`
(re-resolves against 8.3 rather than installing a second PHP version on
the box). After any PHP change: `php artisan config:cache` (route/view
cache too if those changed — but see the route:cache warning below).

### Deploying a frontend/asset change

Assets are built **locally** (the server's Node 20.11 is too old for Vite
8/rolldown — `node:util`'s `styleText` needs Node 20.19+) and the compiled
`public/build/` directory is copied over. The build MUST set the `/quiz`
base path, or lazy-loaded page chunks (any React-split component, e.g.
`Dashboard.jsx`) try to load from the domain root and 404 — Laravel's own
`asset()`/Ziggy URLs are unaffected (that's a separate mechanism, fixed by
`forceRootUrl` below), but Vite's own runtime chunk-loader defaults to
root regardless:

**Also always pass the production `VITE_REVERB_*` values** — `echo.js`
bakes `VITE_REVERB_APP_KEY`/`HOST`/`PORT`/`SCHEME` into the compiled
bundle at build time (Vite env vars aren't runtime-configurable). Without
overriding them, the build silently uses local `.env`'s dev values
(`localhost:8080`, dev app key) instead of production's
(`mao-dao.com:8380`, `https`, production app key from `.env`'s
`REVERB_APP_KEY`) — this genuinely happened (three rebuilds in a row
during the Phase 7 fix-up session shipped `wss://localhost:8080/...` to
production, silently breaking Reverb for **both** Mafia and Race Mode)
and there's no build error or failed test to catch it — it only surfaces
as a browser console WebSocket error on the live site. Get the current
production values with `ssh aws-dev "grep REVERB_ /var/www/quiz/.env"`
first (they rotate if Reverb credentials are ever regenerated), then:

```bash
MSYS_NO_PATHCONV=1 docker compose exec \
  -e VITE_ASSET_BASE_PATH=/quiz/build/ \
  -e VITE_REVERB_APP_KEY=<production REVERB_APP_KEY> \
  -e VITE_REVERB_HOST=mao-dao.com \
  -e VITE_REVERB_PORT=8380 \
  -e VITE_REVERB_SCHEME=https \
  laravel.test npm run build
```

`MSYS_NO_PATHCONV=1` is required — Git Bash mangles the `/quiz/build/`
value passed via `-e` otherwise (same class of bug as gotcha #3 above, but
on an env var this time, not a bind-mount path). Both `VITE_ASSET_BASE_PATH`
and the `VITE_REVERB_*` overrides only take effect when explicitly passed
this way, so plain local `npm run build` / Docker dev is unaffected. Then
on the server: `rm -rf /var/www/quiz/public/build`, tar-pipe the new
`public/build/` over. **Verify after every deploy**:
`ssh aws-dev "grep -c mao-dao.com /var/www/quiz/public/build/assets/echo-*.js"`
should be ≥1 and `grep -c localhost` should be 0.

### Subfolder-hosting gotchas specific to this deployment

- `AppServiceProvider::boot()` calls `URL::forceRootUrl(config('app.url'))`
  + `URL::forceScheme('https')` when `APP_ENV=production` — without this,
  `route()`/`url()`/Ziggy generate root-relative URLs missing the `/quiz`
  prefix. Don't remove without an equivalent fix.
- **`php artisan route:cache` breaks the root `/` route** specifically
  under this subfolder nginx setup — reproducible with both a closure
  route AND a controller-based route (`WelcomeController`), so it's not
  about closures specifically. Route caching is intentionally left **off**
  in production (`config:cache`/`view:cache` are fine and used). If you
  ever re-enable it, retest `https://mao-dao.com/quiz/` — a 405 "Method Not
  Allowed / Allow: HEAD" response means it broke again; run
  `php artisan route:clear` to fix.
- The nginx `/quiz` location block uses a **regex location with named
  captures** (`location ~ ^/quiz/(?<quizpath>.+\.php)(?<quizpathinfo>/.*)?$`)
  to build `SCRIPT_FILENAME`/`SCRIPT_NAME` directly — NOT the more common
  `alias` + nested `\.php$` location pattern. The latter double-counts the
  `/quiz` prefix in `$fastcgi_script_name` (because `alias` doesn't rewrite
  `$uri`), producing "Primary script unknown" errors. Don't refactor back
  to that pattern.
- Two hardcoded `<Link href="/">` logo links (`GuestLayout.jsx`,
  `AuthenticatedLayout.jsx`) were changed to `route('welcome')` /
  `route('dashboard')` — a raw `href="/"` in an Inertia `<Link>` bypasses
  Laravel's URL generator entirely and would send users to the ROOT
  mao-dao.com app instead of back into `/quiz`. Any new hardcoded
  root-style href needs the same treatment.

### Google OAuth — shared credential with mao-dao

`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in the server's `.env` are
intentionally the **same** credentials mao-dao's Node app already uses
(see mao-dao's own `.env`) — one Google Cloud OAuth client with both
mao-dao's "Authorized JavaScript origin" (it uses Google Identity Services
/ ID-token POST flow via `POST /auth/google`, not a redirect flow) and
quiz's "Authorized redirect URI"
(`https://mao-dao.com/quiz/auth/google/callback`, Socialite's server-side
redirect flow) registered on it. This is **not** single sign-on — the two
apps still have fully separate sessions/user tables; sharing the
credential is purely an admin convenience (one Google Cloud dashboard
instead of two, consistent consent-screen branding).

### Debugging a live 500/404 on production

Temporarily: `sed -i 's/APP_DEBUG=false/APP_DEBUG=true/' .env && php
artisan config:clear`, reproduce, then **always** revert:
`sed -i 's/APP_DEBUG=true/APP_DEBUG=false/' .env && php artisan
config:cache`. Never leave `APP_DEBUG=true` on this box.
