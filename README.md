# Dialog Trainer

Dialog Trainer — это визуальный конструктор интерактивных диалоговых тренажеров для обучения (LMS, корпоративный e-learning, внутренние академии).

Проект покрывает полный цикл: создание сценария -> настройка ассетов -> предпросмотр runtime -> публикация -> встраивание через iframe/script.

## Что уже реализовано

### 1. Конструктор сценариев (`/builder`, `/builder/dialog/:id`)
- Узлы: `Start`, `Message`, `Response`, `End`.
- Ограничения графа:
  - из `Start` можно вести только в `Message`;
  - из `Start` допускается только один исходящий `Message`;
  - `Message -> Response|End`;
  - `Response -> Message|End`;
  - у `Response` только один исходящий переход.
- Панель настроек узла открывается по клику на ноду и скрывается по клику в пустое место канваса.
- PTS в `Response` с цветовой дифференциацией в UI.

### 2. Библиотека ассетов (`/assets`)
- Типы ассетов: `character`, `background`.
- Режимы отображения: `Grid` и `Table`.
- Поддержка preinstalled и user-upload ассетов.
- Редактор персонажа: `/assets/characters/:id`.
- Обратная совместимость со старыми ссылками:
  - `/assets/персонажей/:id`
  - URL-encoded вариант этого пути.
- Эмоции персонажа: `neutral`, `happy`, `concerned`, `angry` (отдельные изображения).

### 3. Runtime Preview
- Встроенный preview в редакторе:
  - режим `messenger` (телефонный UI);
  - режим `dialog` (сцена с персонажем и фоном).
- Кнопка `Preview` генерирует временную ссылку (`/preview/:token`).
- Временный preview учитывает:
  - ветвление по ответам;
  - итоговый PTS;
  - проходной балл (`Start.passScore`);
  - лимит попыток (`Start.maxAttempts`);
  - сохранение попытки preview в БД.

### 4. Публикация и встраивание
- Публикация/депубликация сценария.
- Runtime опубликованного сценария: `/p/:publicationKey`.
- Экспорт артефактов:
  - iframe snippet,
  - script snippet,
  - html URL (`/export/:publicationKey.html`).
- Авто-вставка через `/embed.js` + `data-publication`.

## Стек

- Backend: `Node.js 18+`, `Express 5`.
- DB/Auth: `Supabase (Postgres + Auth + RLS)`.
- Frontend: статические страницы в `public/*` (Vanilla JS + Tailwind CDN).
- Хранение медиа:
  - S3 (если настроен);
  - локальный fallback (`public/uploads/library-assets`) при отсутствии S3.

## Структура проекта

```text
Dialog-Trainer/
  public/
    register/
    login/
    builder/
      editor/
    assets/
    preview/
    preinstalled/
    uploads/
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
- Node.js `18+`
- npm `9+`
- Supabase проект

### Установка

```powershell
cd C:\github\Dialog-Trainer
npm install
Copy-Item .env.example .env.local
```

### Минимальная конфигурация `.env.local`

```env
PORT=3000
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

### Запуск

```powershell
npm run dev
```

или production-режим локально:

```powershell
npm start
```

### Проверка
- `http://localhost:3000/healthz`
- `http://localhost:3000/register`
- `http://localhost:3000/login`
- `http://localhost:3000/builder`
- `http://localhost:3000/assets`

## Переменные окружения

| Переменная | Обязательная | Default | Назначение |
|---|---|---|---|
| `PORT` | нет | `3000` | Порт backend-сервера |
| `SUPABASE_URL` | да | - | URL Supabase проекта |
| `SUPABASE_PUBLISHABLE_KEY` | да | - | Publishable key для REST/Auth |
| `SUPABASE_SERVICE_ROLE_KEY` | нет | - | Нужен для server-side fallback-операций runtime |
| `SUPABASE_ACCESS_TOKEN` | нет | - | Для Supabase CLI (`link`, `db push`) |
| `PLAYER_BASE_URL` | нет | `https://player.dialog-trainer.local` | Базовый URL для export-артефактов |
| `AWS_REGION` | нет | `us-east-1` | Регион S3 |
| `S3_BUCKET` | нет | - | Бакет для ассетов |
| `AWS_ACCESS_KEY_ID` | нет | - | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | нет | - | AWS secret key |
| `ASSET_CHARACTER_MAX_BYTES` | нет | `2097152` | Лимит размера character-файла |
| `ASSET_BACKGROUND_MAX_BYTES` | нет | `1048576` | Лимит размера background-файла |
| `ASSET_SIGNED_URL_TTL_SEC` | нет | `3600` | TTL подписанных URL |
| `LOCAL_ASSET_PREFIX` | нет | `uploads/library-assets` | Путь локального fallback-хранилища |
| `TEMP_PREVIEW_TTL_SEC` | нет | `1800` | TTL временной preview-ссылки (сек.) |

## Настройка Supabase Auth

Минимально проверьте в Supabase Dashboard:

1. `Authentication -> URL Configuration`
- `Site URL`:
  - локально: `http://localhost:3000`
  - прод: `https://www.rudtrip.ru`
- `Redirect URLs`:
  - `http://localhost:3000/*`
  - `https://www.rudtrip.ru/*`
  - `https://rudtrip.ru/*`

2. `Authentication -> Providers`
- Для текущего UX используется email/password.
- Если SSO не требуется, отключите OAuth-провайдеры.

## Миграции Supabase

Текущий набор:
- `001_create_dialog_trainer_core.sql`
- `002_enable_rls_and_policies.sql`
- `003_relax_workspace_insert_policy.sql`
- `004_create_library_assets.sql`
- `005_promote_character_preinstalled_and_cleanup.sql`
- `006_fix_preinstalled_character_media_paths.sql`

Применение:

```powershell
$env:SUPABASE_ACCESS_TOKEN="<your_pat>"
npx supabase link --project-ref <project-ref>
npx supabase db push
```

## Основные UI-маршруты

- `/` -> редирект на `/register`
- `/register`
- `/login`
- `/builder`
- `/builder/dialog/:id`
- `/assets`
- `/assets/characters/:id`
- `/assets/персонажей/:id` (legacy)
- `/preview/:token` (временный preview)
- `/p/:publicationKey` (опубликованный runtime)
- `/export/:publicationKey.html`

## Основные API endpoints

### Auth
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`

### Assets
- `GET /api/v1/assets`
- `POST /api/v1/assets`
- `GET /api/v1/assets/:id`
- `PATCH /api/v1/assets/:id`
- `POST /api/v1/assets/:id/emotions/:state`
- `DELETE /api/v1/assets/:id`

### Builder
- `GET /api/v1/builder/dialogs`
- `POST /api/v1/builder/dialogs`
- `GET /api/v1/builder/dialogs/:id/editor`
- `PUT /api/v1/builder/dialogs/:id/editor`
- `POST /api/v1/builder/dialogs/:id/duplicate`
- `POST /api/v1/builder/dialogs/:id/publish`
- `POST /api/v1/builder/dialogs/:id/unpublish`
- `GET /api/v1/builder/dialogs/:id/export`
- `DELETE /api/v1/builder/dialogs/:id`

### Runtime / Preview
- `GET /api/v1/publications/:publicationKey/runtime`
- `POST /api/v1/builder/dialogs/:id/preview/link`
- `GET /api/v1/preview/:token`
- `GET /api/v1/builder/dialogs/:id/preview/attempts/summary`
- `POST /api/v1/builder/dialogs/:id/preview/attempts/complete`

## Встраивание (iframe / script)

### Iframe

```html
<iframe
  src="https://www.rudtrip.ru/p/<publicationKey>"
  width="100%"
  height="720"
  frameborder="0"
  allowfullscreen
></iframe>
```

### Script

```html
<script
  src="https://www.rudtrip.ru/embed.js"
  data-publication="<publicationKey>"
  data-width="100%"
  data-height="720"
></script>
```

## Production deploy

Полный runbook: [docs/runbooks/deployment-vps.md](docs/runbooks/deployment-vps.md)

Для рабочего прод-контура (`rudtrip.ru`) сервер поднят через Nginx + PM2, backend слушает локальный порт `3010`.

## Troubleshooting

### `S3 is not configured. Missing bucket or credentials.`
Это ожидаемый fallback-режим. Ассеты сохраняются локально в `public/uploads/library-assets`.

### `Supabase login failed`
Проверьте `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` и URL/Redirect configuration в Supabase Auth.

### Временный preview не открывается
Preview-токен хранится в памяти процесса и истекает по `TEMP_PREVIEW_TTL_SEC`.
После перезапуска сервера старые preview-ссылки становятся невалидны.

### В iframe получаете `{ "error": "Not found." }`
Проверьте, что используете путь вида `/p/<publicationKey>`, а не локальный домен/неверный endpoint.

---

Если проект используется в корпоративном обучении, рекомендуется зафиксировать процесс релизов (checklist + rollback) и мониторинг `/healthz`, PM2 и Nginx логов.
