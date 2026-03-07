# Runbook: Миграции Supabase (безопасно для production)

## 1. Цель
Единый порядок работы с миграциями БД, чтобы исключить потерю данных и неконсистентный runtime.

## 2. Критические запреты
Никогда не выполняйте в production без явного согласования:
- `npx supabase db reset`
- `DROP DATABASE`, `DROP TABLE`
- массовые `DELETE` без backup/rollback-плана

## 3. Подготовка перед миграцией
1. Проверить, что в Supabase включены:
   - автоматические бэкапы
   - PITR (point-in-time recovery), если доступно на тарифе
2. Зафиксировать окно работ и план отката.
3. Проверить, что миграция обратима или как минимум безопасна:
   - additive-first (добавление полей/таблиц)
   - без destructive-операций в одном релизе

## 4. Локальная проверка миграции
```bash
cd /path/to/Dialog-Trainer
npx supabase db push
```

Проверить:
- приложение стартует
- `/healthz` отвечает
- ключевые API работают (`/api/v1/auth/*`, `/api/v1/builder/dialogs`, `/api/v1/assets`)

## 5. Применение в production

### Вариант A: Supabase SQL Editor (предпочтительно для единичных изменений)
1. Открыть SQL Editor в project dashboard.
2. Вставить SQL из новой миграции.
3. Выполнить.
4. Сохранить запись о релизе (дата, миграция, оператор).

### Вариант B: Supabase CLI
```bash
export SUPABASE_ACCESS_TOKEN=<personal_access_token>
cd /path/to/Dialog-Trainer
npx supabase link --project-ref <project_ref>
npx supabase db push
```

## 6. Post-check после миграции
1. Smoke API:
   - `GET /healthz`
   - авторизация и загрузка editor
2. Проверить страницы:
   - `/builder`
   - `/assets`
   - `/preview/:token` (через создание preview link)
3. Проверить операции:
   - создание/сохранение проекта
   - загрузка ассета
   - публикация/депубликация

## 7. Откат
Если миграция сломала production:
1. Остановить новые рискованные операции (временный read-only режим, если нужно).
2. Выполнить откат данных:
   - через Supabase PITR
   - или restore из snapshot
3. Откатить приложение на предыдущий стабильный commit/tag.
4. Проверить `/healthz` и основные пользовательские пути.

## 8. Рекомендации по SQL-стилю миграций
- Использовать `IF NOT EXISTS` где возможно.
- Для seed-данных использовать `ON CONFLICT DO NOTHING` / `ON CONFLICT ... DO UPDATE`.
- Добавлять индексы в той же миграции, если новые поля участвуют в фильтрации.
- Не смешивать крупный refactor схемы и продуктовые фичи в одном релизе.
