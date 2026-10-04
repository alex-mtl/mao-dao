# Quiz Platform

A social quiz platform built with Laravel, Inertia.js, React, Tailwind CSS,
and MySQL — users can create quizzes, play quizzes shared by others, and
get a personalized quiz feed based on their interests and history. Fully
localized in English, French, Spanish, and Russian.

## Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (with
  Docker Compose). No local PHP, Composer, or Node installation is needed —
  everything runs inside the containers.

## First-time setup

1. Copy the environment file and fill in an app key:

   ```bash
   cp .env.example .env
   ```

2. Build and start the containers (Laravel app + MySQL):

   ```bash
   docker compose up -d --build
   ```

3. Install PHP dependencies and generate the app key (skip if `vendor/`
   already exists, e.g. from a checked-out repo):

   ```bash
   docker compose exec laravel.test composer install
   docker compose exec laravel.test php artisan key:generate
   ```

4. Run migrations and seed demo data (users, quizzes in all four
   languages, friendships, groups, likes, attempts, and a copy-lineage
   example):

   ```bash
   docker compose exec laravel.test php artisan migrate --seed
   docker compose exec laravel.test php artisan storage:link
   ```

5. Install JS dependencies and build the frontend:

   ```bash
   docker compose exec laravel.test npm install
   docker compose exec laravel.test npm run build
   ```

6. Visit **http://localhost:8000**.

## Everyday commands

| Task                          | Command                                                          |
|--------------------------------|-------------------------------------------------------------------|
| Start the stack                | `docker compose up -d`                                            |
| Stop the stack                 | `docker compose down`                                              |
| Rebuild frontend after a change | `docker compose exec laravel.test npm run build`                  |
| Watch frontend for dev          | `docker compose exec laravel.test npm run dev` (then open `--host`) |
| Run the test suite              | `docker compose exec laravel.test php artisan test`                |
| Fresh database + reseed         | `docker compose exec laravel.test php artisan migrate:fresh --seed` |
| Tinker (REPL)                   | `docker compose exec laravel.test php artisan tinker`              |

## Social login (optional)

Google, Facebook, and Telegram login are fully wired but inert until you
supply real credentials in `.env`:

- **Google / Facebook**: create OAuth apps with each provider and set
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and
  `FACEBOOK_CLIENT_ID`/`FACEBOOK_CLIENT_SECRET`.
- **Telegram**: create a bot via [@BotFather](https://t.me/BotFather), set
  its domain to your app's URL, then fill in `TELEGRAM_BOT_NAME` and
  `TELEGRAM_BOT_TOKEN`. The "Log in with Telegram" button only appears once
  `TELEGRAM_BOT_NAME` is set.

Until configured, the Google/Facebook buttons will error if clicked and the
Telegram button simply won't render — the rest of the app is unaffected.

## Seeded accounts

After `--seed`, these accounts exist with the password `password`:

- `test@example.com` — plain account, no extra data.
- `alice@example.com` (English), `bruno@example.com` (French),
  `carla@example.com` (Spanish), `dmitri@example.com` (Russian),
  `eve@example.com` (English) — populated with quizzes, friendships, a
  group, likes, and quiz attempts across all four languages.

## Architecture notes

- **Stack**: Laravel (monolith, no separate REST API) + Inertia.js + React
  + Tailwind, MySQL via Eloquent.
- **i18n**: `lang/{en,fr,es,ru}` files back both server-side validation
  messages and the frontend via `laravel-react-i18n`; `HandleInertiaRequests`
  sets the locale per-request from `users.ui_language`.
- **Media**: Spatie Laravel Media Library for profile photos and the
  100-image collection.
- **Recommendations**: `App\Services\QuizRecommendationService` — a single
  explicit weighted-scoring query, no external search/ML dependency.
