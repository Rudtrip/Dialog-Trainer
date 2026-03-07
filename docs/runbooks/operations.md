# Runbook: Эксплуатация и поддержка

## 1. Ежедневный чек-лист
- Проверить доступность `GET /healthz`
- Проверить ошибки в `pm2 logs dialog-trainer`
- Проверить `nginx error.log`
- Проверить свободное место на диске
- Проверить, что `preview` и `assets` открываются

## 2. Еженедельный чек-лист
- Обновить ОС-патчи (с окном работ)
- Проверить срок действия SSL
- Проверить, что автозапуск PM2 не сломан после reboot
- Выгрузить список открытых инцидентов и закрыть с RCA

## 3. Что мониторить обязательно
- Uptime `/healthz`
- 5xx на Nginx
- CPU/RAM/Disk
- всплески ошибок авторизации (Supabase)
- ошибки загрузки ассетов (S3/local)

## 4. Бэкапы
- Supabase: убедиться, что backup/PITR активны
- Конфиги сервера: бэкап `/var/www/dialog-trainer/shared/.env.local` в защищенное хранилище
- Если используется local asset storage:
  - бэкап директории `public/uploads/library-assets`

## 5. Быстрые команды диагностики
```bash
pm2 status
pm2 logs dialog-trainer --lines 200
curl -i http://127.0.0.1:3000/healthz
df -h
free -m
sudo systemctl status nginx
```

## 6. Типовые инциденты

### 6.1 `Supabase login failed`
Проверить:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- сетевой доступ сервера к `<project>.supabase.co`

### 6.2 `S3 is not configured. Missing bucket or credentials`
Это ожидаемый fallback-сценарий. Система сохраняет файлы в локальный storage.
Проверить:
- доступность записи в `public/uploads/library-assets`
- свободное место на диске

### 6.3 preview link не работает
Причина: token истек (`TEMP_PREVIEW_TTL_SEC`) или сервер перезапускался.
Решение: сгенерировать новую preview-ссылку из builder.

## 7. Коммуникация по инциденту
Минимум в отчете:
- что случилось
- когда началось/закончилось
- impact на пользователей
- root cause
- какие меры приняты
- какие prevention-задачи заведены
