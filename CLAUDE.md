# Mao Dao game platform — Project Notes for Claude Code

**What this is.** `mao-dao.com` is a **game platform**: one Laravel monolith
(Laravel + Inertia.js + React + Tailwind + MySQL, Docker for local dev, bare
metal in production) that hosts several games under one account system, one
look, one navigation and four interface languages (en / fr / es / ru).
The repository is still called `quiz` for historical reasons — it started as
a quiz app and the quiz is simply the *first game*.

| Game / module | URL prefix | Notes file |
|---|---|---|
| Quizzes (solo quizzes + Race Mode) — first game | `/quiz` | [`docs/games/quiz.md`](docs/games/quiz.md) |
| Mafia (10-seat social deduction, voice/video) — second game | `/mafia` | [`docs/games/mafia.md`](docs/games/mafia.md) |

More games will follow (prototypes such as `../flight-shooter` and
`../election-game` live in their own folders until they are merged in).

**What belongs where.** This file holds everything that applies to *every*
game: registration / login / email confirmation, roles, the social layer
(friends, groups, notifications), look & feel (design system, color schemes,
views), interface languages, the production setup and how to deploy.
Anything specific to one game — its rules, data model, real-time flow,
quirks — goes in that game's file under `docs/games/`. When a game-level
note turns out to apply to all games, move it here.

## Rules every game on the platform follows

- **Four languages, always.** Every user-visible string goes through
  `lang/{en,fr,es,ru}/*.php` (see "Architecture decisions"); a game is not
  done until all four exist.
- **Theme tokens, never raw colors.** Use the design-system classes
  (`primary`, `ink`, `warm`, `surface`, …) so the game works in all six color
  schemes, including the dark and neon ones (see "Color scheme system").
- **One header, one brand.** Pages render inside `AuthenticatedLayout` (or
  `SpectatorLayout` for signed-out viewers); the header shows the section's
  name (`SectionBrand`) — "Quiz Platform" under `/quiz`, "Mafia" under
  `/mafia`.
- **Game boards size from `vw`** (CSS variables on the grid), not fixed pixels.
- **Errors are styled** by the shared `Error` / game-specific pages; never
  leave a bare framework 404.
- **Section routing**: a game lives under its own URL prefix; read "Two
  sections under one host" below before adding one (root URL / Vite asset
  traps).
- **Deploy** as described in "Production deployment" — and give each game
  its own notes file when it is added.

## Social layer (shared by all games)

Friends, groups and the notifications feed are platform features, not part of
any game (`FriendRequest`, `Group`, `NotificationFeedService`, the nav
drawer). Rules for clubs, and whether a social feed with posts/comments
becomes a separate module (and whether it counts as a "game"), are **not
decided yet** — record the decision here when it is made.

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

6 selectable themes (`light-warm` default, `light-cool`, `light-soft`,
`dark-warm`, `dark-cool`, `dark-neon`), persisted per-user (`users.color_scheme`,
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
- **[2026-10-08] Each theme now has its own primary/secondary/accent hues** (cool = ocean blue/amber/teal, soft = rose/lilac/sage, dark-warm = amber/rose/olive, dark-cool = violet/cyan/orchid, neon = magenta/cyan/lime); the old "same hue everywhere" made them look identical. `dark-neon` is written as direct lightness curves (`scaleFromL`) and its fonts (Orbitron headings, Rajdhani text), glows and dark-text-on-bright-buttons live in a scoped block at the end of `resources/css/app.css`. Semantic scales (success/warning/danger/info) keep their hues in the other four themes. The next bullet describes the original approach.
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

## Game-specific notes

Quiz rules (timing, randomization, scoring, Race Mode) → [`docs/games/quiz.md`](docs/games/quiz.md).
Mafia (engine, real-time, voice/video, spectators, fouls) →
[`docs/games/mafia.md`](docs/games/mafia.md). Mentions below of "gotcha #N"
refer to the numbered list near the top of this file.

## Two sections under one host: /quiz and /mafia (routing, root URL, assets)

The same applies to any further section added next to `/quiz`.

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
`public/build/` over. **Gotcha — `public/build` on the server is owned by `www-data`**, so the
`ubuntu` user can't `rm -rf` it (a plain `rm -rf build && tar x` leaves the
old build in place and fails halfway). Stage the new build next to it, then
swap with passwordless sudo: extract to `public/build.new`, `sudo chown -R
www-data:www-data build.new && sudo mv build build.old && sudo mv build.new
build && sudo rm -rf build.old`. **Ship the PHP and the build together, in one
sitting** — new PHP removing a route (e.g. `explorer.index`) with the old JS
bundle still live makes Ziggy's `route()` throw and blanks pages. Also take a
backup first (`tar czf /home/ubuntu/quiz-<date>.tgz` of the files being
replaced); deploys of 2026-10-04 left `/home/ubuntu/quiz-20261004-pre-deploy.tgz`.

**Verify after every deploy**:
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

## Ziggy `route()` after client-side navigation between /quiz and /mafia (2026-10-08)

`@routes` is rendered once, by the section that served the first full page
load, so after landing on `/mafia/...` and navigating (Inertia, no reload) to
`/quiz` pages every plain `route()` resolved against the bare host — e.g. the
profile theme switcher sent `PATCH https://mao-dao.com/profile/color-scheme`
and the Node app at `/` answered "Cannot PATCH". `resources/js/app.jsx` now
wraps `window.route`: names starting with `mafia.` resolve against
`window.location.origin`, everything else against the shared `quizUrl` prop;
calls that pass their own config (`useSectionRoutes`) are untouched.

## Email confirmation for email registrations (added 2026-10-12)

- **Flow.** Registering with an email creates the account and logs the user in
  at once, but `email_verified_at` stays null and `verification_expires_at` is
  set to now + `config('auth.verification.expire')` (1440 min = 24 h, one value
  for both the link lifetime and the grace period). The `Registered` event
  triggers `User::sendEmailVerificationNotification()` →
  `App\Notifications\VerifyEmailNotification` (localized via the user's
  `ui_language`; `lang/*/account.php`). Resending (signed-in
  `verification.send`, or the guest `verification.resend` by email address)
  restarts the 24 h.
- **State is derived, not stored**: `User::emailVerificationState()` →
  `verified | pending | expired | not_applicable`. `expired` = unconfirmed and
  past `verification_expires_at` → the account is **disabled**: `LoginRequest`
  refuses it (errors `email` + `account_expired`, the login page then offers
  "send me a new link") and `EnsureAccountIsActive` (web middleware) logs out
  an already-open session. No cron/queue is needed for this.
- **Never disabled**: accounts with no deadline — all pre-existing users, email
  changes made in the profile (a reminder only, link is re-sent), and
  Telegram sign-ins, whose throw-away `...@users.noreply.quiz-platform.local`
  address counts as `not_applicable` (nothing to confirm).
- **Link**: `verification.verify` is deliberately **not** behind `auth` (opened
  on another device, signed URL + email hash are the proof; it never logs
  anyone in). The dashboard no longer uses the `verified` middleware, so
  pending users can use the site.
- **UI**: shared Inertia prop `emailVerification {state, expiresAt, hoursLeft}`;
  header pill "Pending validation" (all pages) and a banner under the header
  with a resend button (`EmailVerificationNotice.jsx`; not shown on /mafia
  pages, whose layout is sized to the viewport).
- **Transport**: Mailgun via `symfony/mailgun-mailer` (+ `symfony/http-client`),
  pinned `^7.0|^8.0` so the server's PHP 8.3 re-resolve still works. Env on the
  server: `MAIL_MAILER=mailgun`, `MAILGUN_DOMAIN=mg.ttl10.net` (the domain
  already verified for ttl10), `MAILGUN_SECRET=<key>`, optional
  `MAILGUN_ENDPOINT` (EU: `api.eu.mailgun.net`), `MAIL_FROM_ADDRESS=noreply@mg.ttl10.net`,
  `MAIL_FROM_NAME="Mao Dao Game Platform"`. To send as `@mao-dao.com`, add that
  domain in the same Mailgun account and put its DNS records in Route 53 first
  — a From domain that differs from the signing domain lands in spam. Until
  `MAIL_MAILER` is changed, mails only go to the log (as before).
