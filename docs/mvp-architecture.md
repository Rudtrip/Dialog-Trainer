# MVP Architecture: Dialog Trainer

## 0. Цель MVP

Дать команде обучения рабочий цикл:

1. собрать сценарий в визуальном редакторе;
2. опубликовать версию;
3. встроить в LMS/портал;
4. получить попытки и score.

## 1. Подсистемы

### 1.1 Builder Admin

- создание и редактирование сценариев;
- управление нодами и связями;
- preview/publish/export;
- AI-помощник генерации (по тарифу).

### 1.2 Runtime Player

- исполнение опубликованного сценария;
- подсчет PTS;
- отображение финального статуса прохождения;
- отправка завершения попытки.

### 1.3 Publish Service

- формирование immutable snapshot из draft;
- выдача `publicationKey`;
- подготовка embed/html артефактов.

### 1.4 Auth and Session

- Supabase email/password;
- session + refresh token flow;
- восстановление сессии на клиенте без повторного логина.

### 1.5 Asset Service

- библиотека персонажей/фонов;
- эмоции персонажей;
- S3/local storage + metadata.

### 1.6 Admin and Tariffs

- управление пользователями;
- смена пароля/тарифа/impersonation;
- управление тарифными планами (`tariff_plans`).

## 2. Data flow: от редактора до runtime

1. Пользователь создает `simulator` в draft.
2. Builder сохраняет `editor graph` в последнюю версию сценария.
3. При publish выполняется валидация.
4. Создается snapshot публикации (`publications`).
5. Runtime получает snapshot по `publicationKey`.
6. После завершения отправляется результат попытки.

## 3. Сущности (минимальный набор)

- `workspaces`
- `workspace_members`
- `simulators`
- `scenario_versions`
- `scenario_steps`
- `scenario_choices`
- `scenario_endings`
- `scoring_policies`
- `ui_configs`
- `library_assets`
- `publications`
- `attempts`
- `attempt_events`
- `tariff_plans`

## 4. Нефункциональные требования

- стабильная работа до 100-200 нод на сценарий;
- безопасная публикация только валидных графов;
- запрет превышения лимитов тарифа;
- отказоустойчивость к невалидным AI-ответам через нормализацию;
- проверка доступа по workspace membership.

## 5. Ограничения MVP

- без совместного realtime-редактирования;
- без сложного медиа-пайплайна (транскодинг и т.д.);
- без полноценной BI-аналитики в интерфейсе.

## 6. Что важно для production

- корректно настроенные Supabase redirect URLs;
- `SUPABASE_SERVICE_ROLE_KEY` на backend;
- canonical host redirect;
- регулярные backup/PITR и runbook инцидентов.

