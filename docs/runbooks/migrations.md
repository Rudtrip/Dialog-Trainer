# Runbook: Supabase Migrations

## 1. Цель

Безопасно применять SQL-миграции без потери данных и без простоев критичных пользовательских сценариев.

## 2. Запрещено в production без отдельного согласования

- `npx supabase db reset`
- destructive `DROP TABLE/SCHEMA`
- массовые `DELETE` без backup и плана отката

## 3. Подготовка

Перед применением:

1. Проверить backup/PITR в Supabase.
2. Проверить SQL на обратимость.
3. Подготовить окно работ и rollback-план.
4. Проверить миграцию на staging/local.

## 4. Применение (варианты)

### Вариант A: SQL Editor (рекомендуется для точечных миграций)

1. Открыть SQL Editor в Supabase.
2. Выполнить SQL из нового файла миграции.
3. Зафиксировать запись в changelog релиза.

### Вариант B: Supabase CLI

```bash
export SUPABASE_ACCESS_TOKEN=<PAT>
cd /path/to/Dialog-Trainer
npx supabase link --project-ref <project-ref>
npx supabase db push
```

## 5. Post-check после миграции

- `GET /healthz`
- `POST /api/v1/auth/login`
- `GET /api/v1/builder/dialogs`
- `GET /api/v1/assets`
- `GET /api/v1/tariffs`
- `GET /api/v1/admin/users` (под админом)

Если миграция про тарифы:

- проверить `/admin/rate` и редактирование тарифа;
- проверить модалку смены тарифа в `/admin/users`;
- проверить лимит создания симуляторов для Free тарифа.

## 6. Откат

Если миграция сломала production:

1. Ограничить рискованные операции (временно отключить проблемный flow).
2. Восстановить состояние через PITR/snapshot.
3. Откатить приложение на стабильный commit.
4. Провести повторный smoke-check.

## 7. Практики для новых миграций

- использовать `IF NOT EXISTS`, где возможно;
- для seed-данных использовать `ON CONFLICT`;
- добавлять индексы вместе с новыми полями фильтрации;
- не смешивать крупный schema refactor и много продуктовых фич в одной миграции.

