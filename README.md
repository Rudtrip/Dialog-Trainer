# Dialog Trainer

Dialog Trainer - это платформа для создания интерактивных диалоговых тренажеров без программирования.  
Проект объединяет визуальный конструктор сценариев, библиотеку ассетов, предпросмотр в runtime-режиме, публикацию и встраивание в LMS/сайты.

## Почему этот проект был реализован

Большинство команд обучения и L&D сталкиваются с одной и той же проблемой:

- сценарии коммуникации сложно быстро прототипировать и согласовывать;
- ветвления диалогов живут в таблицах и теряют наглядность;
- публикация в LMS и встраивание в корпоративные порталы требуют ручной технической работы;
- обратная связь по качеству ответов и итоговому баллу часто не стандартизирована.

Dialog Trainer закрывает эти пробелы: помогает запускать диалоговые симуляции быстрее, управляемее и с прозрачной логикой оценивания.

## Кому может помочь

- L&D-командам и корпоративным университетам
- Методистам и instructional designers
- HR/академиям продаж и клиентского сервиса
- Командам, создающим soft skills и role-play обучение
- Владельцам LMS и внутренним платформам обучения

## Что дает бизнесу и команде обучения

- Сокращает время сборки учебного сценария от идеи до публикации
- Делает логику ветвлений прозрачной для экспертов и согласующих
- Стандартизирует оценивание через PTS, проходной балл и лимит попыток
- Упрощает дистрибуцию: публикация, iframe/script-встраивание, runtime по ссылке
- Снижает зависимость от разработчиков на этапе создания контента

## Ключевые возможности

### 1) Визуальный конструктор сценариев

- Узлы: `Start`, `Message`, `Response`, `End`
- Редактирование через canvas и правую панель настроек
- Валидации графа (в т.ч. только один первый `Message` из `Start`)
- Подсчет и отображение PTS по ответам

### 2) Библиотека ассетов

- Типы: `character`, `background`
- Редактор персонажа с эмоциями: `neutral`, `happy`, `concerned`, `angry`
- Preinstalled + пользовательские ассеты
- Локальное хранилище по умолчанию, S3 при наличии конфигурации

### 3) Runtime preview

- Режим `messenger` (телефонный формат)
- Режим `dialog` (сценический формат с фоном и персонажем)
- Временные preview-ссылки `/preview/:token`
- Учет PTS, проходного балла и количества попыток

### 4) Публикация и распространение

- Публикация/депубликация сценария
- Публичный runtime `/p/:publicationKey`
- Артефакты встраивания:
  - iframe-код
  - script-код (`/embed.js`)
  - html export URL (`/export/:publicationKey.html`)

### 5) Админ-панель

- Страница: `/admin/users`
- Список пользователей платформы
- Действия:
  - смена пароля пользователя
  - смена тарифа
  - вход под пользователем (impersonate)

## Как выглядит рабочий цикл

1. Создать проект и выбрать тип сцены
2. Собрать логику диалога в визуальном редакторе
3. Подобрать персонажей/фоны и эмоции
4. Настроить PTS, проходной балл и попытки
5. Проверить сценарий через preview
6. Опубликовать и встроить в LMS/портал

## Технологический стек

- Backend: `Node.js 18+`, `Express 5`
- DB/Auth: `Supabase (Postgres + Auth + RLS)`
- Frontend: статические страницы (`public/*`, Vanilla JS + Tailwind CDN)
- Медиа:
  - `S3` (если настроен)
  - локальный fallback `public/uploads/library-assets`

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
    admin/
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

## Быстрый старт

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

Режим разработки:

```powershell
npm run dev
```

Production-режим локально:

```powershell
npm start
```

Проверка:

- `http://localhost:3000/healthz`
- `http://localhost:3000/register`
- `http://localhost:3000/login`
- `http://localhost:3000/builder`
- `http://localhost:3000/assets`

## Переменные окружения

| Переменная | Обязательная | Default | Назначение |
|---|---|---|---|
| `PORT` | нет | `3000` | Порт backend |
| `SUPABASE_URL` | да | - | URL Supabase проекта |
| `SUPABASE_PUBLISHABLE_KEY` | да | - | Publishable key для REST/Auth |
| `SUPABASE_SERVICE_ROLE_KEY` | нет* | - | Нужен для admin API и server-side операций bypass RLS |
| `SUPABASE_ACCESS_TOKEN` | нет | - | Для Supabase CLI (`link`, `db push`) |
| `ADMIN_EMAILS` | нет | `admin@example.com` | Список админов через запятую |
| `PREINSTALLED_MANAGER_EMAILS` | нет | `salekh@reezonly.ru` | Кто может создавать/удалять preinstalled ассеты |
| `PLAYER_BASE_URL` | нет | `https://player.dialog-trainer.local` | Базовый URL export-артефактов |
| `AWS_REGION` | нет | `us-east-1` | Регион S3 |
| `S3_BUCKET` | нет | - | Бакет S3 |
| `AWS_ACCESS_KEY_ID` | нет | - | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | нет | - | AWS secret key |
| `ASSET_CHARACTER_MAX_BYTES` | нет | `2097152` | Лимит размера файла character |
| `ASSET_BACKGROUND_MAX_BYTES` | нет | `1048576` | Лимит размера файла background |
| `ASSET_SIGNED_URL_TTL_SEC` | нет | `3600` | TTL подписанных URL |
| `LOCAL_ASSET_PREFIX` | нет | `uploads/library-assets` | Путь локального fallback хранилища |
| `TEMP_PREVIEW_TTL_SEC` | нет | `1800` | TTL preview-ссылки (сек.) |

\* Для базового входа/конструктора не обязателен, но обязателен для админских функций и части server-side операций.

## Настройка Supabase Auth

В Supabase Dashboard:

1. `Authentication -> URL Configuration`
   - `Site URL`:
     - локально: `http://localhost:3000`
     - прод: `https://www.rudtrip.ru`
   - `Additional Redirect URLs`:
     - `http://localhost:3000/*`
     - `https://www.rudtrip.ru/*`
     - `https://rudtrip.ru/*`

2. `Authentication -> Providers`
   - Базовый сценарий: email/password
   - OAuth-провайдеры включайте только при необходимости

## Миграции Supabase

Актуальные миграции:

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

## Основные маршруты

### UI

- `/register`
- `/login`
- `/builder`
- `/builder/dialog/:id`
- `/assets`
- `/assets/characters/:id`
- `/assets/персонажей/:id` (legacy)
- `/admin/users`
- `/preview/:token`
- `/p/:publicationKey`
- `/export/:publicationKey.html`

### API

Auth:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`

Assets:

- `GET /api/v1/assets`
- `POST /api/v1/assets`
- `GET /api/v1/assets/:id`
- `PATCH /api/v1/assets/:id`
- `POST /api/v1/assets/:id/emotions/:state`
- `DELETE /api/v1/assets/:id`

Builder:

- `GET /api/v1/builder/dialogs`
- `POST /api/v1/builder/dialogs`
- `GET /api/v1/builder/dialogs/:id/editor`
- `PUT /api/v1/builder/dialogs/:id/editor`
- `POST /api/v1/builder/dialogs/:id/duplicate`
- `POST /api/v1/builder/dialogs/:id/publish`
- `POST /api/v1/builder/dialogs/:id/unpublish`
- `GET /api/v1/builder/dialogs/:id/export`
- `DELETE /api/v1/builder/dialogs/:id`

Preview/Runtime:

- `GET /api/v1/publications/:publicationKey/runtime`
- `POST /api/v1/builder/dialogs/:id/preview/link`
- `GET /api/v1/preview/:token`
- `GET /api/v1/builder/dialogs/:id/preview/attempts/summary`
- `POST /api/v1/builder/dialogs/:id/preview/attempts/complete`

Admin:

- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users/:id/password`
- `POST /api/v1/admin/users/:id/tariff`
- `POST /api/v1/admin/users/:id/impersonate`

## Встраивание сценария

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

## Продакшен и деплой

Подробный runbook: [docs/runbooks/deployment-vps.md](docs/runbooks/deployment-vps.md)

Текущий production-контур:

- домен: `rudtrip.ru`
- reverse proxy: `Nginx`
- process manager: `PM2`
- backend: локальный порт `3010`

## Troubleshooting

### `S3 is not configured. Missing bucket or credentials.`

Это нормальный fallback-режим: загрузки идут в `public/uploads/library-assets`.

### `Supabase login failed`

Проверьте:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- URL/Redirect конфигурацию в Supabase Auth

### Preview-ссылка не открывается

Preview-токен хранится в памяти процесса и истекает по `TEMP_PREVIEW_TTL_SEC`.  
После рестарта backend старые preview-токены недействительны.

### В iframe отображается `{ "error": "Not found." }`

Проверьте, что используется правильный путь: `/p/<publicationKey>`.

## Лицензия

В текущем состоянии используется лицензия из `package.json` (`ISC`).

---

Если вы используете Dialog Trainer в корпоративном контуре, рекомендуем зафиксировать:

- релизный чеклист,
- регламент rollback,
- мониторинг `healthz`, PM2 и Nginx логов.
