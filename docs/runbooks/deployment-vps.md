# Runbook: Deploy на VPS (Ubuntu + Nginx + PM2)

Документ описывает production-выкладку `Dialog-Trainer` на домен (`rudtrip.ru`) и типовой процесс обновлений.

## 1. Цель и контур

- Приложение: `Dialog-Trainer`
- Репозиторий: `git@github.com:Rudtrip/Dialog-Trainer.git`
- Домены:
  - `rudtrip.ru`
  - `www.rudtrip.ru`
- Reverse proxy: `Nginx`
- Process manager: `PM2`
- Backend порт: `3010` (локально на сервере)

## 2. Требования

- Ubuntu 22.04+
- Root или sudo-доступ
- Открытые порты `80/tcp` и `443/tcp`
- Домен уже направлен на IP сервера
- Установлен SSH-доступ к GitHub (deploy key или личный ключ)

## 3. DNS перед деплоем

Проверьте, что обе записи указывают на один и тот же IP сервера:
- `A @ -> <SERVER_IPV4>`
- `A www -> <SERVER_IPV4>`

Проверка:

```bash
nslookup rudtrip.ru 1.1.1.1
nslookup www.rudtrip.ru 1.1.1.1
```

Важно: если DNS показывает старый IP, выпуск SSL может падать до полной пропагации.

## 4. Установка пакетов

```bash
sudo apt update
sudo apt install -y git curl nginx certbot python3-certbot-nginx

# Node.js 18+ (через NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2
sudo npm i -g pm2
```

Проверка:

```bash
node -v
npm -v
nginx -v
pm2 -v
```

## 5. Структура директорий

```text
/var/www/dialog-trainer/
  current/           # рабочая версия приложения
  shared/
    .env.local       # production env
    logs/
```

Создание:

```bash
sudo mkdir -p /var/www/dialog-trainer/current
sudo mkdir -p /var/www/dialog-trainer/shared/logs
sudo chown -R $USER:$USER /var/www/dialog-trainer
```

## 6. Клонирование и установка приложения

```bash
cd /var/www/dialog-trainer
git clone git@github.com:Rudtrip/Dialog-Trainer.git current
cd current
npm ci
```

## 7. Настройка `.env.local`

Вариант 1 (создать на сервере):

```bash
cp .env.example /var/www/dialog-trainer/shared/.env.local
nano /var/www/dialog-trainer/shared/.env.local
```

Вариант 2 (скопировать с локальной машины):

```powershell
scp "C:\github\Dialog-Trainer\.env.local" root@<SERVER_IP>:/var/www/dialog-trainer/shared/.env.local
```

Минимум для production:

```env
PORT=3010
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
PLAYER_BASE_URL=https://www.rudtrip.ru
```

Связать env с текущей версией:

```bash
ln -sfn /var/www/dialog-trainer/shared/.env.local /var/www/dialog-trainer/current/.env.local
```

## 8. Запуск через PM2

```bash
cd /var/www/dialog-trainer/current
pm2 start src/server.js --name dialog-trainer
pm2 save
pm2 startup
```

Проверка:

```bash
pm2 status
curl -i http://127.0.0.1:3010/healthz
```

## 9. Nginx-конфиг

Создайте `/etc/nginx/sites-available/dialog-trainer`:

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

Активируйте сайт:

```bash
sudo ln -sfn /etc/nginx/sites-available/dialog-trainer /etc/nginx/sites-enabled/dialog-trainer
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

## 10. SSL (Let's Encrypt)

```bash
sudo certbot --nginx -d rudtrip.ru -d www.rudtrip.ru --redirect -m <YOUR_EMAIL> --agree-tos --no-eff-email
```

Проверка:

```bash
curl -I https://rudtrip.ru/healthz
curl -I https://www.rudtrip.ru/healthz
```

## 11. Релиз (обновление прода)

```bash
cd /var/www/dialog-trainer/current
git fetch origin
git checkout main
git pull --ff-only origin main
npm ci
ln -sfn /var/www/dialog-trainer/shared/.env.local .env.local
pm2 restart dialog-trainer
pm2 save
```

Smoke-check:

```bash
curl -f http://127.0.0.1:3010/healthz
curl -f https://www.rudtrip.ru/healthz
```

## 12. Откат

```bash
cd /var/www/dialog-trainer/current
git log --oneline -n 20
git checkout <PREVIOUS_SHA>
npm ci
pm2 restart dialog-trainer
```

Если проблема в БД, используйте recovery в Supabase (PITR/snapshot) до перезапуска сервиса.

## 13. Частые проблемы

### 13.1 Порт 443 занят (`bind() to 0.0.0.0:443 failed`)
Проверка:

```bash
ss -ltnp | grep ':443'
lsof -i :443
```

Если порт занят Docker proxy — остановите/перенастройте контейнер, который слушает `443`.

### 13.2 Nginx не стартует с `unknown directive "ln"`
В конфиг случайно попал текст команды.
Исправьте файл `/etc/nginx/sites-available/dialog-trainer`, затем:

```bash
sudo nginx -t
sudo systemctl restart nginx
```

### 13.3 `tlsv1 unrecognized name`
Обычно это следствие некорректного vhost/certificate mapping.
Проверьте `server_name`, сертификаты и `nginx -t`.

### 13.4 Сертификат не выпускается (Certbot unauthorized)
Проверьте DNS:

```bash
nslookup rudtrip.ru ns1.reg.ru
nslookup www.rudtrip.ru ns1.reg.ru
```

Домены должны указывать на текущий IP сервера.

## 14. Полезные команды эксплуатации

```bash
pm2 status
pm2 logs dialog-trainer --lines 200
sudo systemctl status nginx
sudo tail -n 200 /var/log/nginx/error.log
sudo tail -n 200 /var/log/nginx/access.log
df -h
free -m
```

## 15. Безопасность и эксплуатационные практики

- Не храните `.env.local` в git.
- Ограничьте вход по SSH (желательно ключи + fail2ban).
- Регулярно обновляйте ОС и пакеты.
- Включите мониторинг `/healthz` и алерты по 5xx.
- Делайте бэкап критичных конфигов и используйте backup/PITR в Supabase.
