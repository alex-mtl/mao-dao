# Guess the Word — the streamer app

A thin Windows app (Tauri 2, WebView2) for streamers who want a program instead of a link to the
site. Everything still runs on mao-dao.com; the app only opens the streamer's room and gives
OBS / TikTok LIVE Studio a local address.

## How it works

1. **A super admin** opens `/guessword/clients` (link "App clients" on `/guessword/rooms`), creates
   a client account (a name; the streamer pack on) and presses **Generate key**. The key
   (`MD-XXXX-XXXX-XXXX-XXXX-XXXX`) is shown once — hand it to the streamer together with the
   installer. A client account has no e-mail (a placeholder under `.invalid`) and no password;
   only the key's HMAC is stored (`App\Services\ClientAccounts`).
2. **The app** asks for the key (`ui/index.html`), sends it to
   `POST /guessword/client/api/session` and gets a one-time address
   (`/guessword/client/enter/{code}`, 2 minutes) that signs its window in, plus the overlay link.
   The key is kept in `%APPDATA%\com.guessword.streamer\key.txt`, so the next start signs in by
   itself; menu → **Change key** forgets it.
3. **The window** shows only the room: a client account gets no site chrome (`PlatformLayout`),
   any other page of the site sends it back to the room (`RestrictClientAccounts`), and the app
   itself lets the window go only to `/guessword/...` (other links open in the browser).
4. **Setup gate:** until the TikTok nick and an Euler Stream key are saved the room shows only the
   setup; the platform refuses to start a client's game without an Euler key.
5. **Overlay:** the app listens on `http://localhost:7777/overlay`; every load asks
   `POST /guessword/client/api/overlay` with the key and answers `302` to the room's overlay
   (with a cached link while the network blips). No key yet → a transparent page that retries
   every 5 s. A revoked key → no overlay at all.

Revoking the key or generating a new one ends every session of the account at once.

## Build

Built on GitHub Actions (`.github/workflows/stream-client.yml`, Windows runner) on every push to
`main` that touches `stream-client/`, or by hand (Run workflow). The installer
(`Guess the Word_<version>_x64-setup.exe`, per-user install, no admin rights) is the run's
artifact `guessword-streamer-setup`.

Locally (needs Rust + MSVC build tools): `npx @tauri-apps/cli@2 icon app-icon.png -o src-tauri/icons`,
then `npx @tauri-apps/cli@2 dev`. `GW_BASE_URL=http://localhost:8000` points the app at a local
platform.

## Not done yet

- The installer is not code-signed: Windows SmartScreen says "unknown publisher"
  (More info → Run anyway) until a signing certificate is bought.
- No auto-update of the app itself (the room and the game update on the server anyway).
- The key is stored as a plain file in the user's profile, not in Windows Credential Manager.
