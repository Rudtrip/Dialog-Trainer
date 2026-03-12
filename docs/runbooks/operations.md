# Runbook: Operations

## 1. Ежедневный чек-лист

- `GET /healthz` возвращает `200`.
- `pm2 status` -> `dialog-trainer` в `online`.
- нет аномалий в `pm2 logs dialog-trainer`.
- нет 5xx-всплесков в `nginx access/error logs`.
- достаточно диска и RAM.
- открываются ключевые страницы:
  - `/login`
  - `/builder`
  - `/assets`
  - `/admin/users` (для админов)
  - `/cabinet`

## 2. Еженедельный чек-лист

- обновить системные security-патчи;
- проверить срок SSL сертификата;
- проверить автозапуск PM2 после reboot;
- проверить, что backup/PITR Supabase активны;
- проверить доступность AI-генерации (только Pro/Institution).

## 3. Мониторинг

Минимум:

- uptime `/healthz`;
- HTTP 5xx;
- CPU/RAM/disk;
- ошибки Auth/Supabase;
- ошибки загрузки ассетов;
- ошибки OpenAI (`insufficient_quota`, `model_not_found`).

## 4. Диагностика

```bash
pm2 status
pm2 logs dialog-trainer --lines 200
curl -i http://127.0.0.1:3010/healthz
curl -i https://www.rudtrip.ru/healthz
sudo systemctl status nginx
sudo tail -n 200 /var/log/nginx/error.log
sudo tail -n 200 /var/log/nginx/access.log
df -h
free -m
```

## 5. Частые инциденты

### 5.1 Ошибки авторизации пользователей

Проверить:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`;
- redirect URLs в Supabase Auth;
- доступность `https://<project-ref>.supabase.co`.

### 5.2 Админ-функции не работают

Ошибка вида: `Missing SUPABASE_SERVICE_ROLE_KEY`.

Проверить:

- переменную `SUPABASE_SERVICE_ROLE_KEY` в production env;
- что PM2 процесс перезапущен после изменения env.

### 5.3 AI не генерирует сценарий

Проверить:

- `OPENAI_API_KEY` задан;
- `OPENAI_MODEL` доступна аккаунту;
- в логах нет `insufficient_quota`.

### 5.4 Ошибки по ассетам

Если S3 не настроен, используется локальный fallback (`public/uploads/library-assets`).
Проверить права на директорию и свободное место.

## 6. Релиз и коммуникация

Минимум для отчета по инциденту:

- время начала и окончания;
- impact;
- корневая причина;
- что исправлено;
- какие prevention-задачи заведены.

