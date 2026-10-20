# tiktok-tg-bot

Telegram-бот, который связывает Telegram зрителя с его TikTok-аккаунтом и потом шлёт ему сообщения от LIVE-игры
(игра: `C:\projects\claude\election-game`, клиент — `app/telegram_link.py`).

## Цикл привязки
1. Зритель пишет в чат стрима «настроить связь» → игра показывает @бота и **слово стрима** (МАРИНАД).
2. В Telegram зритель присылает слово стрима и свой ник TikTok (можно одним сообщением: `маринад @nick`).
3. Бот проверяет, что стрим с этим словом в эфире, и выдаёт ключ `ключ-тг-XXXXXXXX` (15 минут).
4. Зритель пишет ключ в чат стрима → игра отправляет боту ключ + TikTok id автора.
5. Если автор совпадает с указанным ником — бот связывает аккаунты, пишет «✅ Готово», игра показывает
   «📲 {имя} подключил Telegram».

Слово стрима выдаёт бот (уникально среди стримов в эфире), поэтому один бот обслуживает много игр
у разных стримеров. Каждая игра — запись GAME с ключом (в `.env` игры: `TG_BOT_URL`, `TG_GAME_KEY`).

## API (Function URL)
| Путь | Кто | Что |
|---|---|---|
| `POST /tg` | Telegram webhook | заголовок `X-Telegram-Bot-Api-Secret-Token` |
| `POST /game/stream/start` | игра | → `{word, bot}`; повторный вызов в том же стриме — то же слово |
| `POST /game/stream/stop` | игра | освобождает слово (иначе само истекает через 12 ч) |
| `POST /game/key` | игра | `{key, tiktok_id, tiktok_name}` → `{ok, linked, first}` |
| `POST /game/push` | игра | `{tiktok_id, text}` — сообщение привязанному зрителю |
| `POST /platform/games` | платформа mao-dao | `{id, lang}` → `{id, game_key}`; заголовок `X-Platform-Secret` = SSM `/tiktok-tg-bot/platform-secret`; повтор выдаёт новый ключ |

Игра шлёт `Authorization: Bearer <game key>`. Админ-действия — только прямой `aws lambda invoke`:
`{"action":"add_game","id":"mao","lang":"ru"}` (ключ показывается один раз), `{"action":"set_webhook","url":"…/tg"}`.

## AWS (бесплатный уровень, аккаунт из aws-for-claude, us-east-1)
- Адрес: https://d3hnpgbwbdwmqk5nbndwjnn4zq0fbewk.lambda-url.us-east-1.on.aws/ , бот @maotiktok_26_bot. Деплой кода: `./deploy.sh`; AWS CLI: `./aws.sh <args>`.
- Lambda `tiktok-tg-bot` (Python 3.12, без зависимостей, 128 МБ) + Function URL (AuthType NONE, проверка внутри).
- DynamoDB таблица `tiktok-tg-bot`: ключ `pk` (S), **PROVISIONED 1/1** (в always-free 25/25), TTL по атрибуту `ttl`.
- SSM Parameter Store (Standard, бесплатно): `/tiktok-tg-bot/token`, `/tiktok-tg-bot/webhook-secret` (SecureString).
- IAM-роль `tiktok-tg-bot-role`: логи + get/put/delete на эту таблицу + ssm:GetParameter на `/tiktok-tg-bot/*`.
- Логи CloudWatch — 7 дней (`log-retention-enforcer`). Всё с тегом `Project=tiktok-tg-bot` и в реестре aws-for-claude.

## Тесты
```bash
docker run --rm -v "$(pwd -W)":/w -w /w python:3.12-slim python -m unittest -v tests.test_bot
```
