# Dialog Trainer

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-3C873A?logo=node.js&logoColor=white)](#)
[![Express](https://img.shields.io/badge/Express-5.x-111827?logo=express&logoColor=white)](#)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ECF8E?logo=supabase&logoColor=white)](#)
[![Status](https://img.shields.io/badge/Status-MVP-informational)](#)

**Dialog Trainer** — визуальный конструктор интерактивных диалоговых тренажеров для LMS и корпоративного обучения.

Проект позволяет без кода собирать обучающие сценарии с ветвлением, персонажами, фонами, системой баллов (PTS), попытками прохождения и предпросмотром runtime в двух режимах:

- `Messenger` (чат-интерфейс)
- `Dialog` (сценический режим с персонажем и фоном)

---

## Содержание

- [Зачем нужен проект](#зачем-нужен-проект)
- [Ключевые возможности](#ключевые-возможности)
- [Как это работает](#как-это-работает)
- [Архитектура](#архитектура)
- [Быстрый старт](#быстрый-старт)
- [Переменные окружения](#переменные-окружения)
- [Supabase миграции](#supabase-миграции)
- [Основные API endpoints](#основные-api-endpoints)
- [Ограничения ассетов](#ограничения-ассетов)
- [Структура проекта](#структура-проекта)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)

---

## Зачем нужен проект

В учебных продуктах часто требуется быстро запускать диалоговые симуляции (продажи, сервис, переговоры, клинические кейсы), но классический цикл разработки долгий и дорогой.

**Dialog Trainer** закрывает эту проблему:

- дает редактор сценариев с визуальным канвасом;
- объединяет редактор, библиотеку ассетов и runtime-preview в одном контуре;
- позволяет быстро проверить сценарий перед публикацией;
- поддерживает критерии прохождения (проходной балл, лимит попыток) и фиксацию результатов.

Итог: методист или эксперт может выпускать интерактивные тренажеры быстрее и с меньшей зависимостью от разработки.

---

## Ключевые возможности

### 1) Builder сценариев (`/builder`, `/builder/dialog/:id`)

- Ноды: `Start`, `Message`, `Response`, `End`.
- Валидации графа:
  - `Start -> Message`;
  - `Message -> Response|End`;
  - `Response -> Message|End`;
  - из `Start` допускается только **один** `Message`;
  - у `Response` допускается только **один исходящий** переход.
- Правая панель ноды открывается по клику на ноду и скрывается по клику в пустое место канваса.
- Управление масштабом и UX для работы с большим графом.

### 2) Настройки узлов

- `Start`:
  - `Title`
  - `Pass score` (проходной балл, опционально)
  - `Max attempts` (количество попыток, опционально)
- `Message`:
  - `Character asset`
  - `Speaker name`
  - `Message text`
  - `Emotion state` (`Neutral`, `Happy`, `Concerned`, `Angry`)
  - `Background asset`
- `Response`:
  - `Response text`
  - `PTS`
  - вспомогательные поля (feedback/hint)

### 3) Библиотека ассетов (`/assets`)

- Вкладки: `Characters` и `Backgrounds`.
- Режимы отображения: `Grid / Table`.
- Предустановленные + пользовательские ассеты.
- Редактирование персонажа: `/assets/characters/:id`.
- Поддержка эмоций персонажа (отдельные изображения по состояниям).
- Для user uploads: удаление и обновление; для preinstalled: read-only ограничения.

### 4) Preview runtime

- Встроенный предпросмотр в editor:
  - телефонный режим для `Messenger`;
  - сценический режим для `Dialog`.
- Кнопка `Preview` генерирует временную ссылку и открывает runtime в новой вкладке.
- Временный preview поддерживает:
  - ветвление по ответам;
  - расчет PTS;
  - pass/fail по `Start.passScore`;
  - учет попыток по `Start.maxAttempts`;
  - кнопка `Сбросить`.

### 5) Публикация и экспорт

- Публикация/депубликация проекта.
- Экспорт embed-артефактов (`iframe`, `script`, `html` URL).
- Дублирование и удаление проекта.

---

## Как это работает

1. Автор создает проект в `/builder`.
2. Выбирает тип сцены: `messenger` или `dialog`.
3. Собирает граф диалога на канвасе.
4. Назначает персонажей/фоны из `/assets`.
5. Проверяет сценарий через `Preview`.
6. Публикует и получает данные для встраивания.

---

## Архитектура

### Frontend

- Статические страницы в `public/*`.
- Vanilla JavaScript + Tailwind (CDN).
- Ключевые экраны:
  - `/register`
  - `/login`
  - `/builder`
  - `/builder/dialog/:id`
  - `/assets`
  - `/assets/characters/:id`
  - `/preview/:token`

### Backend

- `Node.js + Express` (`src/server.js`).
- REST API для auth, builder, assets, publish/export, preview.
- Runtime snapshot для временного preview-токена.

### Data layer

- Supabase Postgres + Auth + RLS.
- Миграции в `supabase/migrations`.

### Хранение медиа

- Основной вариант: AWS S3.
- Fallback (если S3 не настроен): локально в `public/uploads/library-assets`.

---

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
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

### Запуск в dev

```powershell
npm run dev
```

### Production запуск

```powershell
npm start
```

### Полезные URL

- `http://localhost:3000/healthz`
- `http://localhost:3000/register`
- `http://localhost:3000/login`
- `http://localhost:3000/builder`
- `http://localhost:3000/assets`

---

## Переменные окружения

| Переменная | Обязательна | По умолчанию | Назначение |
|---|---|---|---|
| `PORT` | нет | `3000` | Порт Express-сервера |
| `SUPABASE_URL` | да | - | URL Supabase проекта |
| `SUPABASE_PUBLISHABLE_KEY` | да | - | Publishable key для клиентских/серверных запросов |
| `SUPABASE_ACCESS_TOKEN` | нет | - | Для `supabase link` / `supabase db push` |
| `SUPABASE_SERVICE_ROLE_KEY` | нет | - | Для server-side операций (при необходимости обхода RLS) |
| `PLAYER_BASE_URL` | нет | `https://player.dialog-trainer.local` | Базовый URL для export |
| `AWS_REGION` | нет | `us-east-1` | Регион S3 |
| `S3_BUCKET` | нет | - | Бакет S3 |
| `AWS_ACCESS_KEY_ID` | нет | - | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | нет | - | AWS secret key |
| `ASSET_CHARACTER_MAX_BYTES` | нет | `2097152` | Лимит размера character-файла |
| `ASSET_BACKGROUND_MAX_BYTES` | нет | `1048576` | Лимит размера background-файла |
| `ASSET_SIGNED_URL_TTL_SEC` | нет | `3600` | TTL подписанных ссылок на ассеты |
| `LOCAL_ASSET_PREFIX` | нет | `uploads/library-assets` | Путь локального fallback-хранилища |
| `TEMP_PREVIEW_TTL_SEC` | нет | `1800` | TTL временной preview-ссылки (сек) |

---

## Supabase миграции

В проекте используются миграции:

- `001_create_dialog_trainer_core.sql`
- `002_enable_rls_and_policies.sql`
- `003_relax_workspace_insert_policy.sql`
- `004_create_library_assets.sql`

Применение миграций:

```powershell
$env:SUPABASE_ACCESS_TOKEN="<your_personal_access_token>"
npx supabase link --project-ref <project-ref>
npx supabase db push
```

---

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

### Builder dialogs

- `GET /api/v1/builder/dialogs`
- `POST /api/v1/builder/dialogs`
- `GET /api/v1/builder/dialogs/:id/editor`
- `PUT /api/v1/builder/dialogs/:id/editor`
- `POST /api/v1/builder/dialogs/:id/duplicate`
- `POST /api/v1/builder/dialogs/:id/publish`
- `POST /api/v1/builder/dialogs/:id/unpublish`
- `GET /api/v1/builder/dialogs/:id/export`
- `DELETE /api/v1/builder/dialogs/:id`

### Preview/runtime

- `POST /api/v1/builder/dialogs/:id/preview/link` — получить временную preview-ссылку
- `GET /api/v1/preview/:token` — получить runtime snapshot по токену
- `GET /preview/:token` — открыть полноэкранный preview runtime
- `GET /api/v1/builder/dialogs/:id/preview/attempts/summary`
- `POST /api/v1/builder/dialogs/:id/preview/attempts/complete`

---

## Ограничения ассетов

### Characters

- Форматы: `PNG`, `SVG`
- Лимит: `ASSET_CHARACTER_MAX_BYTES`

### Backgrounds

- Форматы: `JPG/JPEG`, `PNG`, `WEBP`
- Лимит: `ASSET_BACKGROUND_MAX_BYTES` (по умолчанию 1 МБ)

Если S3 не сконфигурирован, файлы сохраняются локально в `public/uploads/library-assets`.

---

## Структура проекта

```text
Dialog-Trainer/
  public/
    builder/
      editor/
    assets/
    preview/
    login/
    register/
    uploads/
  src/
    server.js
  supabase/
    migrations/
  schemas/
    scenario.schema.json
  .env.example
  README.md
```

---

## Troubleshooting

### `S3 is not configured. Missing bucket or credentials.`

Это не блокер для MVP. Приложение продолжит работу через локальный fallback-storage.

### `Supabase login failed.`

Проверьте:

- корректность `SUPABASE_URL`;
- актуальность `SUPABASE_PUBLISHABLE_KEY`;
- доступность Supabase-проекта и сетевое подключение.

### Временная preview-ссылка не открывается

Preview-токен ограничен по времени (`TEMP_PREVIEW_TTL_SEC`) и хранится в памяти процесса. После истечения TTL или перезапуска сервера ссылка перестает быть валидной.

---

## Roadmap

- Расширенные фильтры и поиск по ассетам.
- Массовая загрузка медиа.
- Версионирование ассетов.
- Интеграция с внешними LMS runtime-метриками.
- Полноценные авто-тесты UI и API.

---

Если вы используете проект как основу для корпоративного тренажера, начните с настройки Supabase, заполните библиотеку персонажей/фонов и проверьте первый сценарий через `Preview` перед публикацией.
