# Mao Dao: LIVE Center recordings (browser extension)

Lets the stream archive on mao-dao.com (`/guessword/archive`) build the "champion race" digest straight from
your TikTok LIVE Center recordings, without downloading them (a 7-hour recording is ~20 GB; the digest reads
under 1 GB of it). Chrome or Edge on a computer.

## Install (until it is in the Chrome Web Store)

1. Download this folder (`browser-extension/` of this repository) to your computer.
2. Open `chrome://extensions` (Edge: `edge://extensions`), switch on **Developer mode**.
3. **Load unpacked** → choose the folder.
4. Open https://livecenter.tiktok.com/replay once, signed in to TikTok, so the extension sees your recordings.
5. On mao-dao.com: Stream archive → Make a digest → **Build from LIVE Center**.

## Установка (по-русски)

1. Скачайте эту папку (`browser-extension/`) на компьютер.
2. Откройте `chrome://extensions` (в Edge — `edge://extensions`), включите **Режим разработчика**.
3. **Загрузить распакованное** → выберите папку.
4. Откройте https://livecenter.tiktok.com/replay (с входом в TikTok), чтобы расширение увидело записи.
5. На mao-dao.com: Архив эфиров → Создать дайджест → **Собрать из LIVE Center**.

## What it does

- `livecenter-hook.js` / `livecenter.js` (on livecenter.tiktok.com): copy the recordings list the page loads
  itself (id = TikTok LIVE room id, start / finish, the HLS playlist link) into the extension's storage, and
  scroll the list when an older recording is looked for. They send nothing anywhere else.
- `background.js`: answers the mao-dao page — the recording of a LIVE (opens LIVE Center in a background tab
  if it has not seen it yet), the playlist, and byte ranges of segments. It reads only TikTok CDN addresses.
- `maodao.js` (on mao-dao.com): the bridge between the page and the background (`window.postMessage`).
  Page side: `resources/js/Pages/Guessword/Digest/livecenter.js`.

Decoding needs HEVC support in the browser (hardware video decoding: `chrome://gpu`, "Video Decode").
