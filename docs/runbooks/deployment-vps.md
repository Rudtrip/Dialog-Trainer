# Runbook: Production Deploy on VPS (Ubuntu + Nginx + PM2)

## 1. Контур

- Репозиторий: `git@github.com:Rudtrip/Dialog-Trainer.git`
- Домен: `rudtrip.ru`, `www.rudtrip.ru`
- Reverse proxy: `Nginx`
- Процесс приложения: `PM2` (`dialog-trainer`)
- Backend порт: `3010`
- Рабочая папка: `/var/www/dialog-trainer/current`
- Общие секреты: `/var/www/dialog-trainer/shared/.env.local`

## 2. One-time setup

### 2.1 Пакеты

```bash
sudo apt update
sudo apt install -y git curl nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

### 2.2 Директории

```bash
sudo mkdir -p /var/www/dialog-trainer/current
sudo mkdir -p /var/www/dialog-trainer/shared
sudo chown -R $USER:$USER /var/www/dialog-trainer
```

### 2.3 Клонирование

```bash
cd /var/www/dialog-trainer
git clone git@github.com:Rudtrip/Dialog-Trainer.git current
cd current
npm ci
```

### 2.4 Production env

```bash
cp .env.example /var/www/dialog-trainer/shared/.env.local
nano /var/www/dialog-trainer/shared/.env.local
ln -sfn /var/www/dialog-trainer/shared/.env.local /var/www/dialog-trainer/current/.env.local
```

Минимум:

```env
PORT=3010
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
PLAYER_BASE_URL=https://www.rudtrip.ru
```

### 2.5 PM2

```bash
cd /var/www/dialog-trainer/current
pm2 start src/server.js --name dialog-trainer
pm2 save
pm2 startup
```

Проверка:

```bash
curl -i http://127.0.0.1:3010/healthz
pm2 status
```

### 2.6 Nginx

`/etc/nginx/sites-available/dialog-trainer`:

```nginx
server {
    listen 80;
    server_name rudtrip.ru www.rudtrip.ru;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name rudtrip.ru www.rudtrip.ru;

    ssl_certificate /etc/letsencrypt/live/rudtrip.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rudtrip.ru/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

Активация:

```bash
sudo ln -sfn /etc/nginx/sites-available/dialog-trainer /etc/nginx/sites-enabled/dialog-trainer
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

### 2.7 SSL

```bash
sudo certbot --nginx -d rudtrip.ru -d www.rudtrip.ru --redirect -m <YOUR_EMAIL> --agree-tos --no-eff-email
```

## 3. Стандартный релиз (prod update)

```bash
cd /var/www/dialog-trainer/current
git pull --ff-only origin main
npm ci --silent
ln -sfn /var/www/dialog-trainer/shared/.env.local .env.local
pm2 restart dialog-trainer
pm2 save
```

Smoke-check:

```bash
curl -f http://127.0.0.1:3010/healthz
curl -f https://www.rudtrip.ru/healthz
pm2 status
```

## 4. Откат

```bash
cd /var/www/dialog-trainer/current
git log --oneline -n 20
git checkout <PREVIOUS_SHA>
npm ci --silent
pm2 restart dialog-trainer
```

После отката обязательно проверить `/healthz`, login и загрузку `/builder`.

## 5. Частые проблемы

### 5.1 `bind() to 0.0.0.0:443 failed`

Порт 443 занят другим сервисом:

```bash
ss -ltnp | grep ':443'
lsof -i :443
```

### 5.2 Nginx: `unknown directive "ln"`

В конфиг случайно попала shell-команда. Исправьте файл и перезапустите Nginx.

### 5.3 `Admin API is not configured. Missing SUPABASE_SERVICE_ROLE_KEY`

- проверьте значение в `/var/www/dialog-trainer/shared/.env.local`;
- выполните `pm2 restart dialog-trainer`.

### 5.4 AI generation errors (`insufficient_quota`, `model_not_found`)

- проверьте `OPENAI_API_KEY` и биллинг;
- проверьте `OPENAI_MODEL` и доступность модели в аккаунте.

## 6. Полезные команды

```bash
pm2 logs dialog-trainer --lines 200
sudo systemctl status nginx
sudo tail -n 200 /var/log/nginx/error.log
sudo tail -n 200 /var/log/nginx/access.log
df -h
free -m
```

