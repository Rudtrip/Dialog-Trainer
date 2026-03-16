# Runbook: Supabase Migrations

## 1. Цель

Безопасно применять SQL-миграции без потери данных и с минимальным риском для production.

## 2. Что нельзя делать в production без отдельного согласования

- `supabase db reset`;
- destructive `DROP TABLE/SCHEMA`;
- массовые `DELETE/UPDATE` без backup и rollback-плана.

## 3. Подготовка перед миграцией

1. Проверить backup/PITR в Supabase.
2. Прогнать миграцию на staging/local.
3. Подготовить rollback-план.
4. Зафиксировать окно работ и ответственного.

## 4. Применение миграций

### Вариант A: Supabase SQL Editor

Подходит для точечных правок.

1. Открыть SQL Editor.
2. Вставить SQL из нужной миграции.
3. Выполнить и сохранить лог релиза.

### Вариант B: Supabase CLI

```bash
export SUPABASE_ACCESS_TOKEN=<PAT>
cd /path/to/Dialog-Trainer
npx supabase link --project-ref <project-ref>
npx supabase db push
```

## 5. Post-check после миграции

Обязательные проверки:

- `GET /healthz`
- `GET /api/v1/tariffs`
- `GET /api/v1/assets`
- `GET /api/v1/builder/dialogs`
- `GET /api/v1/admin/users` (под админом)
- `GET /api/v1/admin/tariffs` (под админом)

Если миграция затрагивает тарифы:

- проверить `/admin/rate` (редактирование и сохранение);
- проверить модалку смены тарифа в `/admin/users`;
- проверить ограничение по созданию симуляторов для тарифа `free`.

## 6. Ключевые миграции проекта

- `004_create_library_assets.sql` — ассеты персонажей/фонов.
- `007_create_tariff_plans.sql` — тарифные планы.

## 7. Частые проблемы

### `duplicate key value violates unique constraint "tariff_plans_pkey"`

Обычно возникает при некорректном `upsert` без `on conflict (plan_key)`.

Решение:

- использовать `ON CONFLICT (plan_key) DO UPDATE`;
- для API вставки использовать `on_conflict=plan_key`.

### Таблица тарифов не найдена

Ошибка API:

`Tariff storage is not configured. Apply migration 007_create_tariff_plans.sql first.`

Решение:

- применить миграцию `007_create_tariff_plans.sql`;
- перезапустить backend.

## 8. Rollback

1. Ограничить рискованные операции на фронте.
2. Восстановить данные из PITR/snapshot.
3. Откатить приложение на предыдущий commit.
4. Выполнить smoke-check.

