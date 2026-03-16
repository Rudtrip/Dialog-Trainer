# Dialog Trainer

Платформа для создания, публикации и встраивания интерактивных диалоговых тренажеров без программирования.

## Зачем нужен проект

Dialog Trainer сокращает путь от идеи до рабочего учебного сценария:

- визуальный конструктор ветвящихся диалогов;
- единая логика оценки (PTS, порог прохождения, попытки);
- публикация в клик и готовые коды встраивания в LMS/портал;
- библиотека персонажей и фонов;
- админка пользователей и тарифов.

## Для кого

- L&D и корпоративные университеты;
- методисты и instructional designers;
- команды обучения продажам/сервису/soft skills;
- владельцы LMS и внутренних учебных порталов.

## Что реализовано

### 1. Конструктор сценариев `/builder`

- граф нод: `Start`, `Message`, `Response`, `End`;
- правый инспектор параметров ноды;
- валидация графа перед публикацией;
- предпросмотр прямо из редактора;
- режимы сцены: `Мессенджер` и `Диалог`.

### 2. AI-генерация сценариев

- доступна для тарифов `Pro Educator` и `Institution`;
- запуск из редактора через кнопку с иконкой `✨`;
- генерация ветвящегося графа (не линейного);
- результат сразу сохраняется в текущий draft.

### 3. Библиотека ассетов `/assets`

- типы: `character`, `background`;
- эмоции персонажа: `neutral`, `happy`, `concerned`, `angry`;
- preinstalled и пользовательские ассеты;
- хранение в S3 или локально (`/public/uploads/library-assets`).

### 4. Публикация и встраивание

- публикация immutable-снапшота;
- runtime: `/p/:publicationKey`;
- временный preview: `/preview/:token`;
- экспорт и embed:
  - iframe,
  - script (`/embed.js`),
  - HTML (`/export/:publicationKey.html`).

### 5. Админ-панель

- `/admin/users`: список пользователей, смена пароля, смена тарифа, вход под пользователем;
- `/admin/rate`: редактирование тарифных планов;
- изменения тарифов подтягиваются в `/cabinet`.

### 6. Кабинет пользователя `/cabinet`

- профиль (имя, email);
- текущий тариф;
- сравнение тарифов и выбор плана;
- лимиты симуляторов по тарифу.

## Тарифная логика

- при регистрации пользователь получает `free`;
- для `free` действует лимит по количеству симуляторов (`simulator_limit`);
- если лимит достигнут, создание нового тренажера блокируется с понятной ошибкой;
- лимиты и параметры берутся из таблицы `public.tariff_plans` (не хардкод).

## Технологии

- Backend: Node.js 18+, Express 5;
- Frontend: статические страницы (`public/*`, vanilla JS + Tailwind CDN);
- Auth/DB: Supabase (Auth + Postgres + RLS);
- Media: S3 (опционально) или локальное хранилище.

## Структура проекта

```text
Dialog-Trainer/
  public/                # фронтенд страницы
  src/server.js          # API + статический сервер
  supabase/migrations/   # SQL-миграции
  docs/                  # документация и runbooks
  schemas/               # JSON-схемы
  .env.example
```

## Быстрый старт (локально)

### Требования

- Node.js 18+
- npm 9+
- проект в Supabase

### Установка

```powershell
cd C:\github\Dialog-Trainer
npm install
Copy-Item .env.example .env.local
```

### Минимальный `.env.local`

```env
PORT=3000
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

### Запуск

```powershell
npm run dev
```

Проверка:

- `http://localhost:3000/healthz`
- `http://localhost:3000/register`
- `http://localhost:3000/builder`
- `http://localhost:3000/assets`

## Переменные окружения

Смотри полный пример: [`.env.example`](.env.example)

Ключевые переменные:

- `PORT`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (обязательно для `/admin/*` и server-side операций)
- `ADMIN_EMAILS` (кто считается админом)
- `PREINSTALLED_MANAGER_EMAILS` (кто может управлять preinstalled ассетами)
- `PLAYER_BASE_URL`
- `TEMP_PREVIEW_TTL_SEC`
- `CANONICAL_HOST`, `CANONICAL_REDIRECT_HOSTS`
- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- `ASSET_CHARACTER_MAX_BYTES`, `ASSET_BACKGROUND_MAX_BYTES`, `ASSET_SIGNED_URL_TTL_SEC`, `LOCAL_ASSET_PREFIX`

## Настройка Supabase Auth

В Supabase: `Authentication -> URL Configuration`

- `Site URL`:
  - локально: `http://localhost:3000`
  - прод: `https://www.rudtrip.ru`
- `Additional Redirect URLs` минимум:
  - `http://localhost:3000/*`
  - `https://www.rudtrip.ru/*`
  - `https://rudtrip.ru/*`

Если SSO не используется, отключите OAuth providers и оставьте email/password.

## Миграции

Миграции лежат в `supabase/migrations`.

Ключевые:

- `004_create_library_assets.sql` — библиотека ассетов;
- `007_create_tariff_plans.sql` — тарифные планы.

Подробно: [`docs/runbooks/migrations.md`](docs/runbooks/migrations.md)

## API (основные маршруты)

### Auth

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/auth/me`
- `PATCH /api/v1/auth/me`

### Tariffs/Admin

- `GET /api/v1/tariffs`
- `GET /api/v1/admin/users`
- `GET /api/v1/admin/tariffs`
- `PUT /api/v1/admin/tariffs/:key`
- `POST /api/v1/admin/users/:id/password`
- `POST /api/v1/admin/users/:id/tariff`
- `POST /api/v1/admin/users/:id/impersonate`

### Assets

- `GET /api/v1/assets`
- `POST /api/v1/assets`
- `PATCH /api/v1/assets/:id`
- `POST /api/v1/assets/:id/emotions/:state`
- `DELETE /api/v1/assets/:id`

### Builder

- `GET /api/v1/builder/dialogs`
- `POST /api/v1/builder/dialogs`
- `GET /api/v1/builder/dialogs/:id/editor`
- `PUT /api/v1/builder/dialogs/:id/editor`
- `POST /api/v1/builder/dialogs/:id/ai/generate`
- `POST /api/v1/builder/dialogs/:id/publish`
- `POST /api/v1/builder/dialogs/:id/unpublish`
- `GET /api/v1/builder/dialogs/:id/export`
- `POST /api/v1/builder/dialogs/:id/preview/link`

## Продакшн деплой (VPS)

Подробный runbook: [`docs/runbooks/deployment-vps.md`](docs/runbooks/deployment-vps.md)

Быстрое обновление на сервере:

```bash
cd /var/www/dialog-trainer/current \
  && git pull --ff-only origin main \
  && npm ci --silent \
  && pm2 restart dialog-trainer \
  && pm2 save
```

## Операционка

- ежедневные проверки и инциденты: [`docs/runbooks/operations.md`](docs/runbooks/operations.md)
- валидация публикации: [`docs/publish-validation.md`](docs/publish-validation.md)

## Частые проблемы

### `Missing SUPABASE_SERVICE_ROLE_KEY`

На сервере не задан `SUPABASE_SERVICE_ROLE_KEY` или не перезапущен PM2.

### `insufficient_quota` (OpenAI)

Недостаточно квоты/биллинга по API-ключу OpenAI.

### `model_not_found`

В `OPENAI_MODEL` указан model id, недоступный вашему аккаунту OpenAI.

### Пользователь всегда уходит на `/register`

Проверьте:

- корректность `Site URL` и `Additional Redirect URLs` в Supabase;
- что домен открывается как `https://www.rudtrip.ru`;
- что localStorage session не блокируется браузером/расширениями.
