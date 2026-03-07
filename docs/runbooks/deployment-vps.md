# Runbook: Деплой на VPS (Ubuntu + Nginx + PM2)

## 1. Цель
Инструкция для стабильного выката `Dialog-Trainer` в production на VPS без простоя и с возможностью быстрого отката.

## 2. Предпосылки
- Ubuntu 22.04 LTS
- Node.js 18+
- npm 9+
- Nginx
- PM2 (`npm i -g pm2`)
- Домен, направленный на сервер
- Выпущенный SSL (Let's Encrypt)

## 3. Рекомендованная структура каталогов
```text
/var/www/dialog-trainer/
  current/        # активная версия (git checkout рабочей ветки)
  shared/
    .env.local    # production env (НЕ в git)
    logs/
```

## 4. Первый запуск
```bash
sudo mkdir -p /var/www/dialog-trainer/current
sudo mkdir -p /var/www/dialog-trainer/shared/logs
sudo chown -R $USER:$USER /var/www/dialog-trainer

cd /var/www/dialog-trainer/current
git clone git@github.com:Rudtrip/Dialog-Trainer.git .
npm ci
cp .env.example /var/www/dialog-trainer/shared/.env.local
```

Заполните `/var/www/dialog-trainer/shared/.env.local` реальными значениями:
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- опционально S3-переменные (`S3_BUCKET`, `AWS_*`)

Свяжите env:
```bash
ln -sfn /var/www/dialog-trainer/shared/.env.local /var/www/dialog-trainer/current/.env.local
```

Запуск через PM2:
```bash
cd /var/www/dialog-trainer/current
pm2 start src/server.js --name dialog-trainer
pm2 save
pm2 startup
```

## 5. Nginx конфиг (пример)
```nginx
server {
  listen 80;
  server_name your-domain.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name your-domain.com;

  ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }
}
```

Проверка и перезагрузка:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Стандартный релиз
```bash
cd /var/www/dialog-trainer/current
git fetch origin
git checkout main
git pull --ff-only
npm ci
ln -sfn /var/www/dialog-trainer/shared/.env.local .env.local
pm2 reload dialog-trainer
```

Smoke-проверки:
```bash
curl -f http://127.0.0.1:3000/healthz
curl -f https://your-domain.com/healthz
```

## 7. Применение миграций
Перед выкладкой схемы БД обязательно используйте runbook:
- [`migrations.md`](./migrations.md)

Кратко:
1. Проверить бэкапы/PITR в Supabase.
2. Применить новую миграцию через SQL Editor или `supabase db push`.
3. Проверить ключевые API и UI-сценарии.

## 8. Откат
Вариант отката к предыдущему коммиту:
```bash
cd /var/www/dialog-trainer/current
git log --oneline -n 20
git checkout <previous_commit_sha>
npm ci
pm2 reload dialog-trainer
```

Если проблема в схеме/данных:
- восстановление через Supabase PITR или snapshot
- затем перезапуск приложения

## 9. Логи и мониторинг
- PM2: `pm2 logs dialog-trainer`
- Статус: `pm2 status`
- Nginx: `/var/log/nginx/access.log`, `/var/log/nginx/error.log`

Минимальные алерты:
- `/healthz` недоступен > 2 проверок подряд
- RAM > 90%
- Disk free < 10%
- скачок 5xx
