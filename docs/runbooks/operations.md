# Runbook: Operations

## 1. Ежедневный чек-лист

- `GET /healthz` возвращает `200`.
- `pm2 status` -> процесс `dialog-trainer` в `online`.
- нет критичных ошибок в `pm2 logs dialog-trainer`.
- нет всплеска `5xx` в Nginx.
- проверено свободное место на диске и RAM.
- открываются ключевые страницы:
  - `/login`
  - `/builder`
  - `/assets`
  - `/cabinet`
  - `/admin/users` (для админа)

## 2. Еженедельный чек-лист

- обновить security-патчи ОС;
- проверить срок действия SSL-сертификата;
- проверить автозапуск PM2 после reboot;
- проверить backup/PITR в Supabase;
- проверить AI-генерацию для тарифов `pro` и `enterprise`.

## 3. Мониторинг (минимум)

- uptime `/healthz`;
- HTTP 5xx;
- CPU/RAM/disk;
- ошибки Supabase Auth/API;
- ошибки загрузки ассетов;
- ошибки OpenAI API.

## 4. Команды диагностики

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

## 5. Типовые инциденты

### 5.1 Пользователь редиректится на `/register`

Проверить:

- Supabase `Site URL` и `Additional Redirect URLs`;
- доступность `https://<project-ref>.supabase.co`;
- что домен работает как `https://www.rudtrip.ru` (canonical).

### 5.2 Админ-функции не работают

Ошибка вида:

`Admin API is not configured. Missing SUPABASE_SERVICE_ROLE_KEY`

Действия:

1. проверить `SUPABASE_SERVICE_ROLE_KEY` в `.env.local`;
2. выполнить `pm2 restart dialog-trainer`.

### 5.3 AI не генерирует сценарий

Проверить:

- `OPENAI_API_KEY` задан;
- `OPENAI_MODEL` доступна аккаунту;
- нет ошибки `insufficient_quota`.

### 5.4 Ассеты не открываются / битые ссылки

- проверить корректность `file_url` и `metadata_json.emotionImages`;
- проверить локальные файлы в `public/uploads/library-assets` (если не S3);
- проверить права на директории и наличие места на диске.

## 6. Инцидент-отчет (шаблон)

После инцидента фиксировать:

1. время начала/окончания;
2. impact (какие пользователи и функции затронуты);
3. корневая причина;
4. что исправлено;
5. prevention-задачи.

