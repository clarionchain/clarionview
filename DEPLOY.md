# VPS Deployment Guide

## Requirements
- VPS with 2+ vCPU, 4GB+ RAM, 40GB SSD (Ubuntu 22.04 recommended)
- Docker + Docker Compose v2 installed
- Domain name pointing to the VPS IP
- Port 80 and 443 open in firewall

## 1. First-time setup

```bash
# Clone or copy the project to the VPS
git clone <your-repo> /opt/dc-workbench
cd /opt/dc-workbench

# Copy env file and fill in values
cp .env.example .env
nano .env
```

**Required `.env` values:**
| Variable | Description |
|---|---|
| `WORKBENCH_SESSION_SECRET` | `openssl rand -hex 32` |
| `WORKBENCH_ADMIN_PASSWORD` | Your admin password (min 4 chars) |
| `OPENROUTER_API_KEY` | Your OpenRouter key (for AI features) |
| `FRED_API_KEY` | Free key from fred.stlouisfed.org (for macro data) |

## 2. SSL Certificate

```bash
# Install Certbot
apt install certbot

# Get certificate (stops on port 80 — run BEFORE starting nginx)
certbot certonly --standalone -d yourdomain.com

# Copy certs to nginx/ssl/
mkdir -p nginx/ssl
cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem nginx/ssl/
cp /etc/letsencrypt/live/yourdomain.com/privkey.pem nginx/ssl/
chmod 600 nginx/ssl/*.pem
```

Update `nginx/nginx.conf` — replace `server_name _;` with `server_name yourdomain.com;`

## 3. Build and start

```bash
# Build and start all services
docker compose up -d --build

# Check status
docker compose ps
docker compose logs -f nextjs
docker compose logs -f analytics
```

The app will be available at `https://yourdomain.com`

## 4. Enable SQLite backups (optional but recommended)

Set up an S3-compatible bucket (Cloudflare R2 is free for this use case), then add to `.env`:

```env
LITESTREAM_ACCESS_KEY_ID=your-key
LITESTREAM_SECRET_ACCESS_KEY=your-secret
LITESTREAM_BUCKET=your-bucket
LITESTREAM_ENDPOINT=https://abc123.r2.cloudflarestorage.com  # R2 example
```

Then start with backup profile:
```bash
docker compose --profile backup up -d
```

## 5. Manage users

```bash
# Add user via CLI
docker compose exec nextjs node scripts/workbench-add-user.mjs <username> <password>

# Or use the admin UI at https://yourdomain.com/admin/users
```

## 6. Update

```bash
git pull
docker compose up -d --build
```

Docker Compose will rebuild only changed services and perform a rolling restart.

## 7. Overnight reports

Reports are generated automatically at 2am UTC by the Python analytics service.
To generate on demand: visit the Reports page in the app and click "Generate Now."

To change the time:
```env
REPORT_HOUR_UTC=3   # 3am UTC
```

## Certbot auto-renewal

```bash
# Add to crontab (root)
0 3 * * * certbot renew --quiet && \
  cp /etc/letsencrypt/live/yourdomain.com/fullchain.pem /opt/dc-workbench/nginx/ssl/ && \
  cp /etc/letsencrypt/live/yourdomain.com/privkey.pem /opt/dc-workbench/nginx/ssl/ && \
  docker compose -f /opt/dc-workbench/docker-compose.yml restart nginx
```

## Troubleshooting

| Issue | Fix |
|---|---|
| Yahoo Finance data not loading | Check `docker compose logs analytics` — Python service may still be starting |
| FRED data not loading | Ensure `FRED_API_KEY` is set in `.env` |
| Reports page shows "unavailable" | Analytics service may be down: `docker compose restart analytics` |
| Login loop after redeploy | `WORKBENCH_SESSION_SECRET` changed — users must log in again |
| DB backup not starting | Check Litestream env vars and bucket permissions |
