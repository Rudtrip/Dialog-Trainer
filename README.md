# Dialog Trainer

MVP-конструктор диалоговых тренажеров для LMS (этап 1).

## Текущий стек

- Backend: `Node.js` + `Express`
- Frontend: статические HTML-страницы + `Tailwind CSS` (CDN)
- База данных: `Supabase` (Postgres + Auth + RLS)

## Что реализовано в этапе 1

- Архитектурные документы:
  - `docs/phase-1-architecture.md`
  - `docs/mvp-architecture.md`
  - `docs/publish-validation.md`
  - `docs/scenario-editor-constructor-tz.md`
- Миграции Supabase:
  - `supabase/migrations/001_create_dialog_trainer_core.sql`
  - `supabase/migrations/002_enable_rls_and_policies.sql`
  - `supabase/migrations/003_relax_workspace_insert_policy.sql` (только для MVP/dev)
- Схема сценария:
  - `schemas/scenario.schema.json`
- UI-страницы:
  - `public/register/index.html`
  - `public/login/index.html`
  - `public/builder/index.html`
  - `public/builder/editor/index.html`
- Сервер:
  - `src/server.js`

## API (реализовано)

- Аутентификация:
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
  - `GET /api/v1/auth/me`
- Конструктор (`builder`):
  - `GET /api/v1/builder/dialogs`
  - `POST /api/v1/builder/dialogs`
  - `GET /api/v1/builder/dialogs/:id/editor`
  - `PUT /api/v1/builder/dialogs/:id/editor`
  - `POST /api/v1/builder/dialogs/:id/duplicate`
  - `POST /api/v1/builder/dialogs/:id/publish`
  - `POST /api/v1/builder/dialogs/:id/unpublish`
  - `GET /api/v1/builder/dialogs/:id/export`
  - `DELETE /api/v1/builder/dialogs/:id`

## Локальный запуск

```powershell
cd C:\github\Dialog-Trainer
npm install
Copy-Item .env.example .env.local
```

Заполните в `.env.local` минимум:

```env
SUPABASE_URL=https://lxxohuudmdcvmjrxhdev.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_key
```

Запуск dev-сервера:

```powershell
npm run dev
```

Полезные URL:

- `http://localhost:3000/register`
- `http://localhost:3000/login`
- `http://localhost:3000/builder`
- `http://localhost:3000/healthz`

## Настройка Supabase (MVP)

1. Создайте персональный токен Supabase (Personal Access Token) в Dashboard.
2. Экспортируйте токен в текущую сессию:

```powershell
$env:SUPABASE_ACCESS_TOKEN="<your_personal_access_token>"
```

3. Линк проекта и применение миграций:

```powershell
npx supabase link --project-ref lxxohuudmdcvmjrxhdev
npx supabase db push
```

Примечание: для локальной разработки используйте `.env.local`.

## Контракты API

### Регистрация

`POST /api/v1/auth/register`

Тело запроса:

```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "password": "StrongPass123!",
  "acceptTerms": true
}
```

Успешный ответ: `201`

```json
{
  "user": {},
  "session": null,
  "emailConfirmationRequired": true
}
```

### Вход

`POST /api/v1/auth/login`

Тело запроса:

```json
{
  "email": "jane@example.com",
  "password": "StrongPass123!"
}
```

Успешный ответ: `200`

```json
{
  "user": {},
  "session": {},
  "accessToken": "jwt",
  "refreshToken": "jwt",
  "expiresIn": 3600,
  "tokenType": "bearer"
}
```

## Авторизация для Builder API

Для всех эндпоинтов `/api/v1/builder/*` обязателен заголовок:

- `Authorization: Bearer <access_token>`

В MVP токен сохраняется в `localStorage` после входа на `/login` и используется страницами `/builder`.
