# Dialog Trainer

Платформа для создания, публикации и встраивания интерактивных диалоговых тренажеров без программирования.

## Зачем нужен проект

Dialog Trainer закрывает типовые проблемы L&D и методических команд:

- долгое согласование сценариев в таблицах и документах;
- слабая визуализация ветвлений и логики ответов;
- сложный технический путь от идеи до LMS/портала;
- отсутствие единых правил оценки (PTS, проходной балл, попытки).

Итог: сценарии запускаются быстрее, их проще редактировать и поддерживать, а результаты обучения становятся измеримыми.

## Кому подходит

- корпоративным университетам и L&D-командам;
- методистам, instructional designers, HR-академиям;
- командам обучения продажам, сервису, soft skills;
- владельцам LMS и внутренних обучающих порталов.

## Ключевые возможности

### 1) Конструктор сценариев (`/builder`)

- граф из нод: `Start`, `Message`, `Response`, `End`;
- настройка нод в правой панели;
- валидации структуры графа перед публикацией;
- preview и publish прямо из редактора;
- режимы сцены: `messenger` и `dialog`.

### 2) AI-генерация сценариев

- доступна на тарифах `Pro Educator52` и `Institution`;
- запуск из редактора (кнопка рядом со `Start` + боковая AI-панель);
- генерация русского контента;
- поддержка настоящего ветвления: ответы ведут в разные ветки, а не в одно общее сообщение.

### 3) Библиотека ассетов (`/assets`)

- типы ассетов: `character`, `background`;
- эмоции персонажа: `neutral`, `happy`, `concerned`, `angry`;
- preinstalled и пользовательские ассеты;
- хранение в S3 (если настроено) или локальный fallback.

### 4) Runtime и публикация

- предпросмотр по временной ссылке: `/preview/:token`;
- публичный рантайм: `/p/:publicationKey`;
- артефакты встройки:
  - iframe;
  - script (`/embed.js`);
  - HTML export (`/export/:publicationKey.html`).

### 5) Админка и тарифы

- пользователи: `/admin/users`;
- тарифы: `/admin/rate`;
- действия администратора:
  - смена пароля;
  - смена тарифа;
  - вход под пользователем (impersonation).

### 6) Кабинет пользователя (`/cabinet`)

- профиль;
- текущий тариф и лимиты;
- сравнение планов и выбор тарифа.

## Стек

- Backend: `Node.js 18+`, `Express 5`;
- Frontend: статические страницы (`public/*`, vanilla JS + Tailwind CDN);
- DB/Auth: `Supabase (Postgres, Auth, RLS)`;
- Media: `S3` или локальное хранилище.

## Структура проекта

```text
Dialog-Trainer/
  public/
  src/
    server.js
  supabase/
    migrations/
  docs/
    runbooks/
  schemas/
  .env.example
  README.md
```

## Быстрый старт (локально)

### Требования

- `Node.js 18+`
- `npm 9+`
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

Основные (фактически используемые backend):

- `PORT`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (обязательно для admin API и части server-side операций)
- `ADMIN_EMAILS`
- `PREINSTALLED_MANAGER_EMAILS`
- `PLAYER_BASE_URL`
- `TEMP_PREVIEW_TTL_SEC`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- `ASSET_CHARACTER_MAX_BYTES`, `ASSET_BACKGROUND_MAX_BYTES`, `ASSET_SIGNED_URL_TTL_SEC`, `LOCAL_ASSET_PREFIX`

Пример и комментарии: [.env.example](/c:/github/Dialog-Trainer/.env.example)

## Настройка Supabase Auth

В `Authentication -> URL Configuration`:

- `Site URL`: `https://www.rudtrip.ru` (prod), `http://localhost:3000` (local)
- `Additional Redirect URLs`:
  - `http://localhost:3000/*`
  - `https://www.rudtrip.ru/*`
  - `https://rudtrip.ru/*`

Если SSO не требуется, отключите OAuth providers и оставьте email/password.

## Миграции

Текущие миграции в `supabase/migrations` включают:

- core-таблицы сценариев;
- библиотеку ассетов и preinstalled-данные;
- тарифные планы (`007_create_tariff_plans.sql`).

Runbook по миграциям: [docs/runbooks/migrations.md](/c:/github/Dialog-Trainer/docs/runbooks/migrations.md)

## Production (VPS)

Основной runbook: [docs/runbooks/deployment-vps.md](/c:/github/Dialog-Trainer/docs/runbooks/deployment-vps.md)

Быстрый релиз на сервере:

```bash
cd /var/www/dialog-trainer/current \
  && git pull --ff-only origin main \
  && npm ci --silent \
  && pm2 restart dialog-trainer
```

## Полезные маршруты

UI:

- `/register`, `/login`
- `/builder`, `/builder/dialog/:id`
- `/assets`, `/assets/characters/:id`
- `/cabinet`
- `/admin/users`, `/admin/rate`

Runtime:

- `/preview/:token`
- `/p/:publicationKey`
- `/export/:publicationKey.html`

## Частые ошибки и причины

### `insufficient_quota` (OpenAI)

Ключ OpenAI не имеет доступной квоты/биллинга.

### `model_not_found`

В `OPENAI_MODEL` указан недоступный для аккаунта model id.

### `Unsupported value: 'temperature' ...`

Для некоторых моделей не поддерживаются кастомные значения temperature. В проекте используется дефолтное значение модели.

### `Admin API is not configured. Missing SUPABASE_SERVICE_ROLE_KEY`

На сервере не задан `SUPABASE_SERVICE_ROLE_KEY` или процесс не перезапущен после изменения `.env.local`.

## Дополнительная документация

- Deployment: [docs/runbooks/deployment-vps.md](/c:/github/Dialog-Trainer/docs/runbooks/deployment-vps.md)
- Operations: [docs/runbooks/operations.md](/c:/github/Dialog-Trainer/docs/runbooks/operations.md)
- Migrations: [docs/runbooks/migrations.md](/c:/github/Dialog-Trainer/docs/runbooks/migrations.md)
- Publish validation: [docs/publish-validation.md](/c:/github/Dialog-Trainer/docs/publish-validation.md)

