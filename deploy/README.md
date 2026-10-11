# Deploying IMNSTR.com

IMNSTR is a co-tenant on root-app's VPS (Ubuntu 22.04, Docker, Compose, Nginx 1.18, certbot). It shares the box and nothing else with root-app: its own compose project (`imnstr`), its own Nginx file, its own limit zone (`imnstr_auth`), its own directory (`/srv/imnstr`). The only port it uses is `127.0.0.1:4100`.

**Rules for the box.** Run `nginx -t` before every reload. Reload (`systemctl reload nginx`); never restart. A zone name or a `default_server` that clashes with another site fails `nginx -t` for all of them.

## First-time setup

Done once, as root or with sudo.

1. **Clone and directories.**
   ```
   git clone https://github.com/rishe-eco/imnstr /srv/imnstr
   mkdir -p /srv/imnstr/data /srv/imnstr/backups
   chown 1000:1000 /srv/imnstr/data /srv/imnstr/backups
   ```
   The container runs as `node` (uid 1000). It cannot write to a directory root owns.

2. **The `.env`**, at `/srv/imnstr/.env` (never committed; `.env.example` lists every variable):
   ```
   DB_PATH=/data/imnstr.db
   PRELAUNCH=1
   NODE_ENV=production
   ```
   `PRELAUNCH=1` keeps the site out of search engines until launch. Do not set `E2E_CLOCK`: the server refuses to boot with it in production.

3. **Start the app** (see *Routine deploys*) and check it answers on loopback: `curl -s http://127.0.0.1:4100/healthz` prints `ok`.

4. **Nginx, first the bootstrap file.** The final config points at a certificate that does not exist yet, and `nginx -t` refuses that. So start with the port-80-only file:
   ```
   cp /srv/imnstr/deploy/nginx/imnstr.bootstrap.conf /etc/nginx/sites-available/imnstr
   ln -s /etc/nginx/sites-available/imnstr /etc/nginx/sites-enabled/imnstr
   nginx -t && systemctl reload nginx
   ```
   The live file is a **copy**, not a link into the repo, for two reasons. certbot's nginx plugin edits the live file for a moment at every renewal, and that must not happen inside the git checkout. And a `git pull` must not change what the box's next reload loads (root-app's, or certbot's) before anyone has run `nginx -t` on it.

5. **The certificate**, without certbot editing any file in the repo:
   ```
   certbot certonly --nginx -d imnstr.com -d www.imnstr.com      --deploy-hook 'nginx -t && systemctl reload nginx'
   ```
   DNS for both names must already point at the box. `certonly` writes the certificate and touches no config. certbot keeps the deploy hook and runs it after each renewal, so Nginx loads the new certificate.

6. **Swap in the final config.**
   ```
   cp /srv/imnstr/deploy/nginx/imnstr.conf /etc/nginx/sites-available/imnstr
   nginx -t && systemctl reload nginx
   ```
   The certbot timer renews the certificate; `imnstr.conf` reads it from `/etc/letsencrypt/live/imnstr.com/`. Check with `certbot renew --dry-run`.

7. **Backups** (below): set up the cron line and the off-box target.

## Routine deploys

```
cd /srv/imnstr && git pull && docker compose -f docker-compose.prod.yml build && docker compose -f docker-compose.prod.yml up -d
```

Migrations run at boot. If `deploy/nginx/imnstr.conf` changed, copy it over the live file, then check and reload. If `nginx -t` fails, put the old file back before anything else reloads:
```
cp /etc/nginx/sites-available/imnstr /tmp/imnstr.conf.prev
cp /srv/imnstr/deploy/nginx/imnstr.conf /etc/nginx/sites-available/imnstr
nginx -t && systemctl reload nginx || cp /tmp/imnstr.conf.prev /etc/nginx/sites-available/imnstr
```

Shorthand used below: `dc` is `docker compose -f docker-compose.prod.yml`.

### Checks after every deploy

```
docker inspect --format '{{.State.Health.Status}}' imnstr-imnstr-1     # healthy
nginx -t                                                                # before any reload
curl -I https://imnstr.com/
curl -I https://imnstr.com/fa/
curl -I https://imnstr.com/no-such-page                                 # 404
curl -I https://www.imnstr.com/                                         # 301 to the apex
```

Look for: the security headers on each response (the app sets them, Nginx adds none), `X-Robots-Tag: noindex` while `PRELAUNCH=1`. Then confirm root-app's own URL still answers. Paste the results into the stage record.

## The CLIs

Run them inside the container, which has the database mounted:

```
dc exec -T imnstr node --import tsx scripts/seed-entry.ts --lang en --body-file /tmp/entry.txt
dc exec -T imnstr node --import tsx scripts/backup.ts /backups/imnstr-manual.db
```

## Backups

`deploy/backup.sh` backs up with SQLite's online backup API (inside the container, so the app keeps running), checks the copy with `PRAGMA integrity_check`, keeps 14 days in `/srv/imnstr/backups`, and copies the directory off the box with `rsync -e ssh` to `$BACKUP_REMOTE`. If `$BACKUP_REMOTE` is unset it still makes the local backup, says so on stderr and exits 1, so cron reports it.

The off-box target is another host (P0-4). Give the root user an ssh key that the target accepts, then in `/etc/cron.d/imnstr-backup`:

```
BACKUP_REMOTE=backup@other-host:/backups/imnstr/
17 3 * * * root /srv/imnstr/deploy/backup.sh
```

Until the off-box target exists, the cron line can go in without the `BACKUP_REMOTE` line: the daily local copy is still made, and the run exits 1 so the missing copy off the box stays visible.

Try it by hand once before trusting cron: `BACKUP_REMOTE=... /srv/imnstr/deploy/backup.sh`, then look at `/srv/imnstr/backups` and the target.

### Restoring a backup into a scratch container

Prove a backup reads back, without touching the live data. This uses the live image but a throwaway data directory and another port:

```
mkdir -p /tmp/imnstr-restore && cp /srv/imnstr/backups/imnstr-<stamp>.db /tmp/imnstr-restore/imnstr.db
chown -R 1000:1000 /tmp/imnstr-restore
docker run --rm -d --name imnstr-scratch -p 127.0.0.1:4199:4100 \
  -e DB_PATH=/data/imnstr.db -e PRELAUNCH=1 \
  -v /tmp/imnstr-restore:/data imnstr:latest
curl -s http://127.0.0.1:4199/healthz            # ok
curl -s http://127.0.0.1:4199/log | head         # the entries are there
docker exec imnstr-scratch node --import tsx scripts/backup.ts /data/check.db   # copies and integrity-checks it
docker stop imnstr-scratch && rm -rf /tmp/imnstr-restore
```

To restore for real: `dc stop`, move the live `imnstr.db` (and any `-wal`/`-shm` beside it) aside, copy the backup in as `/srv/imnstr/data/imnstr.db`, `chown 1000:1000` it, `dc up -d`.

## Not covered here

root-app's own `deploy/README.md` gets one line under "Somewhere else on the box", pointing at this file. That edit is made on root-app's `main`, by the orchestrator, not by a lane.
