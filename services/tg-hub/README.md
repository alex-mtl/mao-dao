# tg-hub — Telegram-бот проектных групп для Дружка

Бот сидит админом в Telegram-группах проектов владельца, сохраняет всё, что там происходит, и даёт Дружку
(ИИ Meta) API: лента событий, история группы, отправка сообщений и реакций, файлы. API — [API.md](API.md)
(его же получает Дружок). Claude по умолчанию группы **не читает**: это работа Дружка, Claude получает от него
задания и отчёты через `services/ai-mailbox`.

## Состав
- `tghub/` — Lambda `tg-hub` (Python 3.12, без зависимостей, 128 МБ, таймаут 30 с) за Function URL (AuthType NONE):
  `POST /tg` — вебхук Telegram (заголовок `X-Telegram-Bot-Api-Secret-Token`), `/v1/*` — API (токены по sha256 из
  `TOKEN_SHA256_DRUZHOK` / `TOKEN_SHA256_CLAUDE`). `OWNER_IDS` — Telegram id владельца (через запятую).
- DynamoDB `tg-hub`: `pk`+`sk`, PROVISIONED 3/3, TTL по `ttl`. Сообщения хранятся бессрочно, лента событий — 90 дней.
  Раскладка — в шапке `tghub/handler.py`.
- SSM SecureString `/tg-hub/token` (токен бота), `/tg-hub/webhook-secret`.
- IAM-роль `tg-hub-role` (`deploy/trust.json`, `deploy/role-policy.json`).
- Всё с тегом `Project=tg-hub`, логи 7 дней (`log-retention-enforcer`), запись в реестре aws-for-claude.

## Бот в Telegram
- Privacy mode выключен в @BotFather (`/setprivacy → Disable`), в группах бот — админ (так он видит реакции).
- `/project <имя>` в группе (только владелец) — привязать группу к проекту; `/project` — показать, `/project -` — отвязать.

## Тесты
```bash
docker run --rm -v "$(pwd -W)":/w -w /w python:3.12-slim python -m unittest -v tests.test_hub
```

## Развёртывание
- Первый раз: токен бота в `.bot-token`, затем `./deploy/setup.sh` (создаёт всё; секреты API в `.secrets/`,
  адрес и токен Claude — в `~/.tg-hub/`). Обе папки вне git.
- Код: `./deploy.sh`. Админ-действия: `aws lambda invoke` с `{"action":"set_webhook","url":".../tg"}`,
  `{"action":"set_commands"}`, `{"action":"info"}`.
- Владелец: его Telegram id виден в событии `bot_added` (`by.id`); положить в `.secrets/owner-ids` и обновить
  переменную `OWNER_IDS` у Lambda.
