# journal-archive

Архив системного журнала движка игры (`guessword-engine` на aws-dev) в Cloudflare R2, бакет `stream-logs`.
Журнал — единственная полная история событий всех комнат (победы, самолёты, шарики, торты, ручные запуски `[manual]`, лайки, чат) с 21.10.2026; journald со временем удаляет старое, поэтому выгружаем.

- Объект: `guessword-engine/YYYY/YYYY-MM-DD.log.xz` — весь журнал за сутки UTC (`journalctl -o short-iso`), xz -9, ~2,3 МБ/сутки (29.10.2026: 36,9 МБ текста).
- Скрипт: `journal-to-r2.sh [YYYY-MM-DD ...]`, без аргументов — вчерашний день. Журнал только читает.
- На сервере: `/home/ubuntu/bin/journal-to-r2.sh`, cron пользователя ubuntu `30 0 * * *`, лог `~/journal-to-r2.log`.
- Ключи: `~/.config/r2-stream-logs.env` (токен только на этот бакет, чтение/запись), в git не кладём.
- Скачать день: `curl --aws-sigv4 aws:amz:auto:s3 --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY" "$R2_ENDPOINT/$R2_BUCKET/guessword-engine/2026/2026-10-29.log.xz" -o day.log.xz`.
- Бесплатно до 10 ГБ в R2 (~0,85 ГБ/год).
