# Dialog Trainer

MVP-конструктор диалоговых тренажеров для LMS.

## Стек

- Backend: `Node.js` + `Express`
- Frontend: статические HTML-страницы + CSS/JS
- База данных: `Supabase` (Postgres + Auth + RLS)
- Хранение ассетов:
  - `S3` (если настроен)
  - локально в `public/uploads/library-assets` (fallback, если S3 не настроен)

## Что реализовано

- Аутентификация:
  - регистрация `/register`
  - вход `/login`
- Builder:
  - список проектов `/builder`
  - редактор канваса `/builder/dialog/:id`
  - публикация, депубликация, дублирование, удаление
  - экспорт
- Assets library:
  - страница `/assets`
  - вкладки `Characters` и `Backgrounds`
  - загрузка пользовательских ассетов
  - удаление пользовательских ассетов
  - экран редактирования персонажа с эмоциями
- Supabase migrations:
  - `supabase/migrations/001_create_dialog_trainer_core.sql`
  - `supabase/migrations/002_enable_rls_and_policies.sql`
  - `supabase/migrations/003_relax_workspace_insert_policy.sql`
  - `supabase/migrations/004_create_library_assets.sql`

## Create New Project (актуально)

В модалке `Create New Project`:

- есть поля:
  - `Project name` (обязательно)
  - `Описание` (опционально, до 1200 символов)
  - `Тип сцены` (`Мессенджер` или `Диалог`)
  - `Upload image` (опционально, только файл)
- загрузка обложки через URL удалена
- значение `Описание` сохраняется в `simulators.description`
- в карточке проекта в списке `/builder` показывается именно это описание

## API (основное)

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

## Контракт создания проекта

`POST /api/v1/builder/dialogs`

Тело запроса:

```json
{
  "name": "Customer Service 101",
  "description": "Тренажер для отработки сложных диалогов с клиентом",
  "sceneType": "messenger"
}
```

Поля:

- `name`: строка, обязательно
- `description`: строка, опционально, до 1200 символов
- `sceneType`: `messenger | dialog`

## Локальный запуск

```powershell
cd C:\github\Dialog-Trainer
npm install
Copy-Item .env.example .env.local
```

Минимальные переменные в `.env.local`:

```env
PORT=3000
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Запуск dev-сервера:

```powershell
npm run dev
```

Полезные URL:

- `http://localhost:3000/register`
- `http://localhost:3000/login`
- `http://localhost:3000/builder`
- `http://localhost:3000/assets`
- `http://localhost:3000/healthz`

## Supabase migrations

```powershell
$env:SUPABASE_ACCESS_TOKEN="<your_personal_access_token>"
npx supabase link --project-ref <project-ref>
npx supabase db push
```

## Примечания по ассетам

- Лимиты по умолчанию:
  - персонаж: `2 MB`
  - фон: `1 MB`
- Если S3 не настроен (`S3_BUCKET`/ключи отсутствуют), загрузки сохраняются локально.
- Локальные файлы отдаются из `public/uploads/library-assets`.
