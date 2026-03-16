# Runbook: Deployment to VPS (Ubuntu + Nginx + PM2)

## 1. Контур

- Репозиторий: `git@github.com:Rudtrip/Dialog-Trainer.git`
- Домен: `rudtrip.ru`, `www.rudtrip.ru`
- Приложение: Node.js (`src/server.js`)
- Процесс-менеджер: PM2 (`dialog-trainer`)
- Внутренний порт backend: `3010`
- Рабочая директория: `/var/www/dialog-trainer/current`
- Секреты: `/var/www/dialog-trainer/shared/.env.local`

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
CANONICAL_HOST=www.rudtrip.ru
CANONICAL_REDIRECT_HOSTS=rudtrip.ru
```

### 2.5 PM2

```bash
cd /var/www/dialog-trainer/current
PORT=3010 pm2 start src/server.js --name dialog-trainer
pm2 save
pm2 startup
```

Проверка:

```bash
curl -i http://127.0.0.1:3010/healthz
pm2 status
```

## 3. Nginx

Файл `/etc/nginx/sites-available/dialog-trainer`:

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

## 4. SSL (Let's Encrypt)

```bash
sudo certbot --nginx -d rudtrip.ru -d www.rudtrip.ru --redirect -m <EMAIL> --agree-tos --no-eff-email
```

Проверка:

```bash
curl -i https://www.rudtrip.ru/healthz
curl -I https://rudtrip.ru
```

Ожидается:

- `https://www.rudtrip.ru/healthz` -> `200`
- `https://rudtrip.ru` -> `301` на `https://www.rudtrip.ru/...`

## 5. Стандартный релиз

```bash
cd /var/www/dialog-trainer/current
git pull --ff-only origin main
npm ci --silent
ln -sfn /var/www/dialog-trainer/shared/.env.local .env.local
pm2 restart dialog-trainer
pm2 save
```

Smoke checks:

```bash
curl -f http://127.0.0.1:3010/healthz
curl -f https://www.rudtrip.ru/healthz
pm2 status
```

## 6. Rollback

```bash
cd /var/www/dialog-trainer/current
git log --oneline -n 20
git checkout <PREVIOUS_SHA>
npm ci --silent
pm2 restart dialog-trainer
```

После rollback:

- `/healthz` отвечает `200`;
- работают `/login`, `/builder`, `/assets`.

## 7. Частые проблемы

### 7.1 `bind() to 0.0.0.0:443 failed`

Порт занят другим процессом.

```bash
ss -ltnp | grep ':443'
lsof -i :443
```

### 7.2 `unknown directive "ln"` в Nginx

В конфиг случайно вставлена shell-команда. Исправить файл и перезапустить Nginx.

### 7.3 `Missing SUPABASE_SERVICE_ROLE_KEY`

Нет переменной `SUPABASE_SERVICE_ROLE_KEY` в production env или приложение не перезапущено после правки env.

### 7.4 Ошибки AI (`insufficient_quota`, `model_not_found`)

- проверить `OPENAI_API_KEY`;
- проверить `OPENAI_MODEL`;
- проверить billing/доступ к модели в OpenAI.

