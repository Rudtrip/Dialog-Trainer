# MVP архитектура сервиса Dialog Trainer

## 0. Цель MVP
Собрать внешний сервис-конструктор диалоговых тренажеров для LMS, который позволяет:
- создать и настроить сценарий в админке;
- опубликовать неизменяемую версию;
- получить `self-contained HTML` и embed-код (`iframe`/`script`);
- запускать тренажер в LMS и собирать базовую аналитику попыток.

## 1. Архитектура подсистем

### 1.1 Конструктор (Builder Admin)
Назначение:
- авторизация методиста/преподавателя;
- CRUD сценария (шаги, выборы, концовки, scoring, UI);
- предпросмотр и валидация;
- публикация.

Выходные артефакты:
- `Draft` версии сценариев;
- команда публикации в подсистему публикации.

### 1.2 Runtime-плеер
Назначение:
- исполнение опубликованного сценария как конечного автомата;
- расчет баллов и отображение концовки;
- отправка событий попытки (step_view, choice_select, complete).

Режимы:
- hosted player (`https://player.../p/{publicationId}`);
- self-contained HTML (без API для core-логики прохождения).

### 1.3 Публикация
Назначение:
- собрать immutable snapshot из черновика;
- присвоить `publicationId` и `version`;
- зафиксировать связку сценарий + UI + scoring + media refs.

Ключевой принцип:
- опубликованная версия не редактируется; изменения только через новую публикацию.

### 1.4 Auth
Назначение:
- регистрация/логин по email+password;
- выдача сессии и проверка прав workspace;
- разграничение ролей (Owner/Editor/Viewer).

Реализация MVP:
- Supabase Auth + RLS-политики в таблицах домена.

### 1.5 Медиа
Назначение:
- хранение изображений/аудио/видео для шагов и UI;
- upload через pre-signed URL;
- выдача публичных/подписанных ссылок для player/export.

Реализация MVP:
- Amazon S3 (bucket + object key conventions + metadata).

### 1.6 Экспорт
Назначение:
- генерация:
  - self-contained HTML;
  - iframe embed;
  - script embed.
- хранение метаданных экспорта и контроль версии.

## 2. Поток данных: от сценария до LMS
1. Пользователь регистрируется/логинится через Supabase Auth.
2. Создает `simulator` и `scenario_version` в статусе `draft`.
3. В конструкторе редактирует `steps/choices/endings/scoring/uiConfig`.
4. Медиа загружается в S3 через pre-signed URL, в БД пишется `media_asset` с `s3_key`.
5. Нажимает Publish.
6. Сервис валидации проверяет целостность сценария и медиа-ссылки.
7. Подсистема публикации создает immutable snapshot `published` + `publication`.
8. Экспорт генерирует:
   - URL hosted player;
   - iframe snippet;
   - script snippet;
   - self-contained HTML artifact.
9. Методист вставляет embed-код в LMS.
10. Студент запускает тренажер в LMS, runtime исполняет snapshot публикации.
11. Runtime отправляет attempt events в backend.
12. Данные попытки и score сохраняются в Supabase и доступны в аналитике.

## 3. Доменная модель (сущности и ключевые поля)

| Сущность | Ключевые поля | Где хранится |
|---|---|---|
| `users` | `id`, `email`, `full_name`, `created_at` | Supabase Auth + profile table |
| `workspaces` | `id`, `name`, `owner_user_id`, `created_at` | Supabase Postgres |
| `workspace_members` | `workspace_id`, `user_id`, `role`, `invited_at` | Supabase Postgres |
| `simulators` | `id`, `workspace_id`, `name`, `status`, `created_by` | Supabase Postgres |
| `scenario_versions` | `id`, `simulator_id`, `version_number`, `state(draft/published)`, `schema_version` | Supabase Postgres |
| `scenario_steps` | `id`, `scenario_version_id`, `step_key`, `type`, `content`, `order_index` | Supabase Postgres (JSONB для `content`) |
| `scenario_choices` | `id`, `scenario_version_id`, `choice_key`, `from_step_key`, `next_step_key`, `condition`, `score_delta` | Supabase Postgres |
| `scenario_endings` | `id`, `scenario_version_id`, `ending_key`, `title`, `rule`, `priority` | Supabase Postgres |
| `scoring_policies` | `id`, `scenario_version_id`, `mode`, `pass_threshold`, `rules_json` | Supabase Postgres |
| `ui_configs` | `id`, `scenario_version_id`, `theme_json`, `branding_json`, `player_json` | Supabase Postgres |
| `media_assets` | `id`, `workspace_id`, `s3_key`, `mime_type`, `size_bytes`, `checksum`, `status` | Supabase Postgres + S3 |
| `publications` | `id`, `simulator_id`, `scenario_version_id`, `publication_key`, `published_at` | Supabase Postgres |
| `export_artifacts` | `id`, `publication_id`, `type(html/iframe/script)`, `url_or_snippet`, `created_at` | Supabase Postgres (+ object store если HTML файл) |
| `attempts` | `id`, `publication_id`, `learner_ref`, `started_at`, `completed_at`, `final_score`, `ending_key` | Supabase Postgres |
| `attempt_events` | `id`, `attempt_id`, `event_type`, `event_time`, `payload_json` | Supabase Postgres |

## 4. Высокоуровневая JSON-модель сценария

```json
{
  "scenario": {
    "id": "scn_001",
    "title": "Sales Objection Handling",
    "version": 3,
    "locale": "ru-RU",
    "startStepId": "step_intro",
    "metadata": {
      "authorId": "usr_123",
      "estimatedDurationSec": 420,
      "tags": ["sales", "b2b"]
    }
  },
  "steps": [
    {
      "id": "step_intro",
      "type": "message",
      "speaker": "client",
      "text": "Здравствуйте, у нас есть сомнения по срокам.",
      "mediaRef": null,
      "choiceIds": ["choice_1", "choice_2"]
    }
  ],
  "choices": [
    {
      "id": "choice_1",
      "stepId": "step_intro",
      "label": "Уточнить детали риска",
      "nextStepId": "step_clarify",
      "conditions": [],
      "scoreDelta": 10,
      "feedback": "Хороший ход: сначала диагностика."
    }
  ],
  "endings": [
    {
      "id": "ending_pass",
      "title": "Сделка сохранена",
      "description": "Вы выявили ключевые возражения и сняли риски.",
      "scoreRange": { "min": 70, "max": 100 },
      "priority": 10
    }
  ],
  "scoring": {
    "mode": "sum",
    "maxScore": 100,
    "passThreshold": 70,
    "rules": [
      {
        "id": "rule_bonus_diagnostics",
        "when": { "choiceId": "choice_1" },
        "add": 10,
        "cap": 100
      }
    ]
  },
  "uiConfig": {
    "theme": "light",
    "colors": {
      "primary": "#5250f7",
      "background": "#f5f5f8",
      "text": "#0f172a"
    },
    "layout": {
      "mode": "chat",
      "showAvatar": true,
      "showProgress": true
    },
    "branding": {
      "logoUrl": "https://cdn.example.com/logo.png",
      "courseTitle": "Тренажер переговоров"
    }
  }
}
```

## 5. Правила валидации перед публикацией

### 5.1 Структурная целостность
- `scenario.id`, `version`, `startStepId` обязательны.
- `steps[].id`, `choices[].id`, `endings[].id` уникальны в пределах версии.
- Все ссылки (`nextStepId`, `choiceIds`, `stepId`) должны существовать.

### 5.2 Граф сценария
- `startStepId` должен быть достижим и существовать.
- Из стартового шага достижима минимум 1 концовка.
- Недостижимые шаги/выборы запрещены (ошибка) или предупреждение по политике.
- Циклы допустимы только если есть путь к концовке.

### 5.3 Контент и UX
- Обязательные поля текста не пустые.
- Ограничения длины: `title <= 120`, `choice.label <= 160`.
- Контраст цветов UI (WCAG AA) не ниже порога.

### 5.4 Scoring
- `passThreshold <= maxScore`.
- Все score-правила ссылаются на существующие step/choice.
- Итоговый score детерминирован для одинаковой траектории.

### 5.5 Медиа и безопасность
- Каждый `mediaRef` указывает на существующий актив со статусом `ready`.
- MIME whitelist (например, image/png, image/jpeg, audio/mpeg, video/mp4).
- Запрещены inline-скрипты в контенте шага (санитизация HTML/Markdown).

### 5.6 Экспортная пригодность
- JSON-снапшот валиден по `schema_version`.
- Размер self-contained HTML не превышает лимит MVP (например, 10 MB).
- Все external refs либо доступны, либо встроены в export по политике.

## 6. Риски MVP

### 6.1 Технические риски

| Риск | Влияние | Снижение риска |
|---|---|---|
| Ошибки RLS в Supabase | Утечка/недоступность данных workspace | Политики по принципу least privilege + тесты на доступ |
| Рост размера self-contained HTML | Долгая загрузка в LMS | Лимиты размера, сжатие, media lazy loading |
| Истечение pre-signed URL S3 | Падение загрузки/проигрывания медиа | Короткоживущие URL для upload + refresh для playback |
| Расхождение draft/published | Непредсказуемое поведение runtime | Immutable snapshot и version locking |
| Ограничения LMS/CSP на embed | Плеер не открывается в iframe | Документированный CSP checklist + fallback script embed |
| Пиковая запись attempt_events | Деградация БД | Батчинг событий, индексы, retention policy |

### 6.2 UX-риски

| Риск | Симптом | Снижение риска |
|---|---|---|
| Сложный branching editor | Пользователь путается в графе | Карта веток + фильтры + auto-layout |
| Непрозрачный scoring | Неясно, почему такой итог | Preview score по траектории + explain panel |
| Разрыв между preview и runtime | После publish результат другой | Preview на snapshot-модели публикации |
| Фрустрация при валидации | Много непонятных ошибок | Ошибки с привязкой к конкретному step/choice |
| Тяжелый onboarding | Высокий drop-off регистрации | Простая форма + шаблон "первый тренажер" |

## 7. Acceptance Criteria Этапа 1

1. Есть утвержденный архитектурный документ MVP с подсистемами, доменной моделью и data flow.
2. Определен и зафиксирован JSON-контракт сценария (`scenario/steps/choices/endings/scoring/uiConfig`).
3. Описаны publish-валидации с четким разделением на blocking errors и warnings.
4. Определены таблицы Supabase для core-домена и попыток.
5. Определен процесс хранения медиа в S3 (upload/download, metadata, ограничения).
6. Определены экспортные форматы: hosted URL, iframe snippet, script snippet, self-contained HTML.
7. Подготовлен список технических и UX-рисков с митигациями.
8. Экран `/register` реализован как рабочий UI-прототип с клиентской валидацией.

## 8. БД Supabase (MVP baseline)

### 8.1 Минимальные таблицы
- `workspaces`, `workspace_members`
- `simulators`, `scenario_versions`
- `scenario_steps`, `scenario_choices`, `scenario_endings`
- `scoring_policies`, `ui_configs`
- `media_assets`
- `publications`, `export_artifacts`
- `attempts`, `attempt_events`

### 8.2 Индексы
- `scenario_versions(simulator_id, version_number)` unique.
- `publications(simulator_id, published_at desc)`.
- `attempts(publication_id, started_at desc)`.
- `attempt_events(attempt_id, event_time)`.
- `media_assets(workspace_id, status)`.

### 8.3 RLS-принципы
- Доступ к данным только через membership workspace.
- `Viewer` не может изменять сценарии/публикации.
- `Editor` может редактировать draft и публиковать.
- `Owner` управляет участниками и всеми объектами workspace.

## 9. Медиа в S3 (MVP baseline)

### 9.1 Bucket strategy
- Bucket: `dialog-trainer-media-{env}`.
- Key pattern: `{workspaceId}/{simulatorId}/{assetId}/{filename}`.
- Версионирование bucket включено.

### 9.2 Upload flow
1. Клиент запрашивает upload intent.
2. Backend проверяет права и MIME/size policy.
3. Backend выдает pre-signed PUT URL.
4. Клиент загружает объект в S3.
5. Backend подтверждает объект (size/checksum) и ставит `media_assets.status=ready`.

### 9.3 Delivery
- Для приватных активов runtime получает signed GET URL.
- Для публичных статичных ассетов допустим CloudFront/CDN URL.
- Все ссылки в публикации резолвятся при запуске runtime/export.

### 9.4 Ограничения MVP
- Max asset size (пример): image 5 MB, audio 20 MB, video 100 MB.
- MIME whitelist и антивирусный/безопасностный скан в асинхронном пайплайне.
- Удаление ассета запрещено, если он используется в опубликованной версии.
