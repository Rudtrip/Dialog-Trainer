# Dialog Trainer: Phase 1 Architecture (Current)

Статус: реализовано в production и активно поддерживается.

## 1. Компоненты

### Backend (`src/server.js`)

- API (auth, builder, assets, admin, tariffs, runtime, preview);
- раздача статических страниц (`public/*`);
- canonical redirect (`rudtrip.ru` -> `www.rudtrip.ru`);
- local/S3 storage для ассетов;
- интеграция OpenAI для AI-генерации сценариев.

### Frontend (`public/*`)

- `builder` — визуальный редактор сценария;
- `assets` — библиотека персонажей/фонов;
- `admin` — пользователи и тарифы;
- `cabinet` — кабинет пользователя;
- `preview` и `player` — runtime режимы.

### Supabase

- Auth (email/password, refresh);
- Postgres таблицы домена;
- RLS и workspace-доступ.

## 2. Ключевые потоки

### 2.1 Создание и публикация

1. пользователь создает draft;
2. редактирует граф;
3. валидирует;
4. публикует immutable snapshot;
5. получает runtime/embed/export.

### 2.2 Предпросмотр

1. backend генерирует временный preview token;
2. фронт открывает `/preview/:token`;
3. runtime берет snapshot из `GET /api/v1/preview/:token`.

### 2.3 AI-генерация

1. пользователь описывает сценарий;
2. backend проверяет тариф (`pro`, `enterprise`);
3. backend запрашивает OpenAI;
4. ответ нормализуется в editor graph;
5. граф сохраняется в draft.

## 3. Доступ и роли

- `owner/editor` — редактирование и публикация;
- `viewer` — read-only;
- админ определяется по `ADMIN_EMAILS`.

Дополнительно:

- `PREINSTALLED_MANAGER_EMAILS` может управлять preinstalled ассетами.

## 4. Тарифная модель

- дефолтный тариф при регистрации: `free`;
- лимит симуляторов проверяется сервером;
- тарифы редактируются в `/admin/rate` и применяются глобально;
- `/cabinet` и admin-модалки читают тарифы из БД (`tariff_plans`).

## 5. Сессия и авторизация

- login/register сохраняют session в localStorage;
- перед API вызовами выполняется refresh, если access token истек;
- при наличии сессии `/login` и `/register` редиректят в `/builder`.

## 6. Основные риски

- неверные redirect URL в Supabase -> циклы авторизации;
- отсутствие `SUPABASE_SERVICE_ROLE_KEY` -> нерабочая админка;
- неверный `OPENAI_MODEL`/billing -> падение AI-генерации;
- неактуальный snapshot публикации -> ошибка embed/runtime.

