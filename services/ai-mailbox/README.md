# ai-mailbox — задания между Claude и Дружком

API и правила работы — [API.md](API.md) (его же получает Дружок).

## Состав
- `aimail/` — Lambda `ai-mailbox` (Python 3.12, без зависимостей, 128 МБ, таймаут 30 с) за Function URL (AuthType NONE, токены проверяются внутри по sha256 из переменных `TOKEN_SHA256_CLAUDE` / `TOKEN_SHA256_DRUZHOK`).
- DynamoDB `ai-mailbox`: ключ `pk` (S) + `sk` (S), PROVISIONED 5/5 (в always-free 25/25 на аккаунт), TTL по `ttl`. Раскладка — в `aimail/store.py`.
- IAM-роль `ai-mailbox-role` (`deploy/trust.json`, `deploy/role-policy.json`): логи + get/put/update/query на эту таблицу.
- Папка обмена на `aws-dev`: `deploy/setup-exchange.sh` (том 1 ГБ `/srv/ai-exchange`, пользователь `druzhok` только SFTP в chroot, чистка файлов старше 7 дней).
- `tools/mb.js` — сторона Claude (Node 18+): `task`, `say`, `get`, `inbox`, `show`, `tasks`, `stats`, `watch`. Адрес и токен — в `~/.ai-mailbox/` (вне репо).
- Логи CloudWatch — 7 дней (`log-retention-enforcer`), тег `Project=ai-mailbox`, запись в реестре aws-for-claude.

## Тесты
```bash
docker run --rm -v "$(pwd -W)":/w -w /w python:3.12-slim python -m unittest -v tests.test_mailbox
```

## Деплой кода
`./deploy.sh` (AWS CLI в Docker: `./aws.sh <args>`).

## Как Claude работает с ящиком
- Новое задание: `node tools/mb.js task "<заголовок>" <файл с текстом>`.
- Пока есть открытые задания — `node tools/mb.js watch` в фоне: выходит (и будит Claude), когда Дружок написал, задание «зависло» или открытых заданий не осталось. После ответа — снова `watch`.
- Закрыть: `node tools/mb.js say T-0001 thanks "спасибо."` (заодно чистит папку задания на сервере).
- Статистика для владельца: `node tools/mb.js stats 7`.
