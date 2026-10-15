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

- **Public by default.** A visitor without an account can open every
  section, browse (quiz library, open Mafia rooms), **play** published quizzes
  and **watch** public games. An account is required only to *create* things
  (quizzes, rooms), for personal pages (profile, history, recommendations,
  friends, groups, notifications) and to take a seat in a game. Never put a
  login wall in front of a read-only page; use `PlatformLayout` (members get
  the full chrome, guests the slim bar with Log in / Register) and let the
  controller treat `$request->user()` as nullable. Guest quiz attempts are
  tied to a session token (`quiz_attempts.guest_token`), not to an account.
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
  just smoke-check `/login`, `/quiz` and `/mafia/`.
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

6 selectable themes (`light-warm`, `light-cool`, `light-soft`, `dark-warm`,
`dark-cool`, `dark-neon`). **The platform default — what every guest sees — is
`dark-neon`** (`config/color_schemes.php`'s `default`); a new account starts with
the scheme its visitor was already seeing, and existing members keep their saved
choice (the DB column default is still `light-warm`), persisted per-user (`users.color_scheme`,
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

## Routing: one host, one router (since 2026-10-15)

`mao-dao.com` is served by this Laravel app **at the domain root**; nginx
sends every request that is not a static file to `public/index.php`. There is
no path-prefix stripping, no per-section "root URL" and no Ziggy tricks any
more — the history of those workarounds is in git (look for the "Phase 6
production routing" notes in the old CLAUDE.md) and none of it applies.

| Address | What |
|---|---|
| `/` | platform home: a block per game (`config/games.php`, `Pages/Home.jsx`) |
| `/login`, `/register`, `/forgot-password`, `/verify-email/...`, `/auth/{provider}/...` | accounts (Breeze + social login) |
| `/profile`, `/friends`, `/groups`, `/notifications`, `/images` | platform-level pages |
| `/quiz` (members: dashboard, guests: → library), `/quiz/library`, `/quiz/quizzes/{id}` (+`/play`), `/quiz/quiz-attempts/{id}`, `/quiz/race/{code}` | the quiz game — **public** (browse, play, results via session token) |
| `/quiz/my-quizzes`, `/quiz/quizzes/create`/`edit`, likes, copy, history | quiz features that need an account |
| `/mafia` (public list of open rooms), `/mafia/{code}` + `/watch` (public), `/mafia/{code}/play`/`lobby` and room actions | the Mafia game; creating/joining as a player needs an account, watching does not |
| `/internal/mafia/*` | server-to-server calls from the media sidecar (shared secret, no session) |

Rules for a new game: its routes live under its own prefix (`/<game>/...`),
route **names** stay globally unique and are used with Ziggy's plain `route()`
(`useSectionRoutes().quizRoute/mafiaRoute` are now just aliases of it), the
header section label comes from `Components/SectionBrand.jsx`, and the game gets
a row in `config/games.php` plus `lang/*/platform.php` strings.

**Legacy addresses.** Everything used to live under `/quiz/...`
(`/quiz/login`, `/quiz/profile` ...). These redirect (301) to the root
equivalents. Three things deliberately still answer at the old path because
outside parties hold them: signed confirmation links
(`/quiz/verify-email/{id}/{hash}` — a signature covers the path, so it cannot
be redirected), the OAuth callback registered at Google
(`/quiz/auth/{provider}/callback`, so `GOOGLE_REDIRECT_URI` etc. are set to the
literal old URL on the server until the console is updated) and the sidecar's
`LARAVEL_BASE_URL=.../quiz` (`/quiz/internal/mafia/*`). Remove them when the
outside configuration has moved.

**Static files** are served by nginx from `public/` at `/build/...`,
`/images/...`, `/sfx/...`, `/storage/...` (media). Reference them with
root-relative paths (`/images/mafia/...`), never with a section prefix.

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

## Production deployment (mao-dao.com)

Live at `https://mao-dao.com/`, deployed to `/var/www/quiz` on the
`aws-dev` server (`ssh aws-dev`) — a shared box with several other live,
unrelated sites. Never run anything destructive there without checking
what else is running first; this project only touches its own
`/var/www/quiz` folder, its own MySQL DB/user, its own PHP-FPM pool, its own
PM2 processes (`quiz-*`) and the `mao-dao.com` nginx server blocks.
The Node app that used to answer on this domain (PM2 `mao-dao-vc`, files in
`/var/www/mao-dao`) was stopped on 2026-10-15 and is intentionally not deleted.

### Server specifics (bare metal, no Docker on this host)

- PHP 8.3.23 / nginx / MySQL 8.0. App code: `/var/www/quiz`.
- DB: `quiz` database, `quiz_user` MySQL user — isolated, no access to any
  other database on the box.
- Dedicated PHP-FPM pool at `/etc/php/8.3/fpm/pool.d/quiz.conf` (its own
  socket, `php8.3-fpm-quiz.sock`) — created instead of touching the shared
  `www.conf` pool other sites use, so this app's higher upload limits (6M/
  8M, for the 5MB image feature) don't affect anyone else. Reload with
  `sudo systemctl reload php8.3-fpm` after editing it.
- nginx config: `/etc/nginx/sites-available/mao-dao.com`. Its 443 block serves
  `root /var/www/quiz/public` with `try_files $uri /index.php?$query_string` and
  PHP-FPM socket `php8.3-fpm-quiz.sock`; the port-80 redirect block and the
  8380 block (Reverb at `/`, media sidecar at `/media-sfu/`) are unchanged.
  Always back up before editing (`.bak.<timestamp>` next to it), `sudo nginx -t`
  before every reload, `sudo systemctl reload nginx` after. `www.mao-dao.com`
  needs a DNS record and a certificate that includes it (certbot) before it can
  be added to `server_name`.

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
`public/build/` directory is copied over. Assets are served from `/build/`
(Vite's default base) — no base-path override is needed any more.

**Always pass the production `VITE_REVERB_*` values** — `echo.js` bakes
`VITE_REVERB_APP_KEY`/`HOST`/`PORT`/`SCHEME` into the bundle at build time
(Vite env vars aren't runtime-configurable). Without them the build silently
uses local `.env`'s dev values (`localhost:8080`) and real-time breaks on
production with no build error. Get the current public values with
`ssh aws-dev "grep -E '^REVERB_(APP_KEY|HOST|PORT|SCHEME)=' /var/www/quiz/.env"`, then:

```bash
MSYS_NO_PATHCONV=1 docker compose exec \
  -e VITE_REVERB_APP_KEY=<production REVERB_APP_KEY> \
  -e VITE_REVERB_HOST=mao-dao.com \
  -e VITE_REVERB_PORT=8380 \
  -e VITE_REVERB_SCHEME=https \
  laravel.test npm run build
```

Then run a plain `npm run build` again before resuming local work (same
output dir). On the server the build directory is owned by `www-data`: extract
to `public/build.new`, then `sudo chown -R www-data:www-data build.new && sudo
mv build build.old && sudo mv build.new build && sudo rm -rf build.old`.
**Ship the PHP and the build together, in one
sitting** — new PHP removing a route (e.g. `explorer.index`) with the old JS
bundle still live makes Ziggy's `route()` throw and blanks pages. Also take a
backup first (`tar czf /home/ubuntu/quiz-<date>.tgz` of the files being
replaced); deploys of 2026-10-04 left `/home/ubuntu/quiz-20261004-pre-deploy.tgz`.

**Verify after every deploy**:
`ssh aws-dev "grep -c mao-dao.com /var/www/quiz/public/build/assets/echo-*.js"`
should be ≥1 and `grep -c localhost` should be 0.

### URL generation behind nginx

- `AppServiceProvider::boot()` only forces `https` in production
  (`URL::forceScheme('https')`); the root comes from the request host, so
  `mao-dao.com` and, later, `www.mao-dao.com` both work. `APP_URL` is
  `https://mao-dao.com` (used by emails, queued jobs, CLI).
- Hardcoded root-style hrefs are fine now, but still prefer `route()`.
- `php artisan route:cache` has not been re-tested after the move to the
  domain root; leave route caching off (`config:cache`/`view:cache` are used).

### Google OAuth — shared credential with mao-dao

`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in the server's `.env` are
intentionally the **same** credentials mao-dao's Node app already uses
(see mao-dao's own `.env`) — one Google Cloud OAuth client with both
mao-dao's "Authorized JavaScript origin" (it uses Google Identity Services
/ ID-token POST flow via `POST /auth/google`, not a redirect flow) and
quiz's "Authorized redirect URI" registered on it. The URI registered today is
the **old** `https://mao-dao.com/quiz/auth/google/callback` (Socialite's
server-side flow); the app still answers there and `GOOGLE_REDIRECT_URI` is set
to that literal URL. Add `https://mao-dao.com/auth/google/callback` in the
Google console, then switch the env value. This is **not** single sign-on — the two
apps still have fully separate sessions/user tables; sharing the
credential is purely an admin convenience (one Google Cloud dashboard
instead of two, consistent consent-screen branding).

### Debugging a live 500/404 on production

Temporarily: `sed -i 's/APP_DEBUG=false/APP_DEBUG=true/' .env && php
artisan config:clear`, reproduce, then **always** revert:
`sed -i 's/APP_DEBUG=true/APP_DEBUG=false/' .env && php artisan
config:cache`. Never leave `APP_DEBUG=true` on this box.

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
