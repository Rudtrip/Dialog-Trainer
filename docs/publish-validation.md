# Publish Validation Guide

## Что проверяет JSON Schema

Файл: `schemas/scenario.schema.json`

Schema проверяет:
- наличие обязательных блоков (`scenario`, `steps`, `choices`, `endings`, `scoring`, `uiConfig`);
- типы полей и базовые диапазоны/длины;
- формат идентификаторов и HEX-цветов;
- структуру `choice` (должен быть `nextStepId` или `endingId`).

## Что проверяется отдельно (семантическая валидация)

Эти правила не покрываются только JSON Schema и должны выполняться publish-validator сервисом:
- `scenario.startStepId` существует в `steps`;
- все `stepId`, `nextStepId`, `endingId`, `choiceIds` ссылаются на существующие объекты;
- нет недостижимых шагов и выборов;
- из `startStepId` достижима хотя бы одна концовка;
- циклы допускаются только при наличии пути к концовке;
- `passThreshold <= maxScore`;
- media refs указывают на `media_assets.status = 'ready'`;
- суммарный размер export соответствует лимитам MVP.

## Рекомендуемый pipeline перед публикацией

1. Структурная проверка по `scenario.schema.json`.
2. Семантическая проверка ссылочной целостности и графа.
3. Проверка scoring и media readiness.
4. Генерация immutable snapshot и запись `publications`.
