# Deploying IMNSTR.com

IMNSTR is a co-tenant on root-app's VPS (Ubuntu 22.04, Docker, Compose, Nginx 1.18, certbot). It shares the box and nothing else with root-app: its own compose project (`imnstr`), its own Nginx file, its own limit zone (`imnstr_auth`), its own directory (`/srv/imnstr`). The only port it uses is `127.0.0.1:4100`.

**Rules for the box.** Run `nginx -t` before every reload. Reload (`systemctl reload nginx`); never restart. A zone name or a `default_server` that clashes with another site fails `nginx -t` for all of them.

**Every command here is written for a normal user with sudo,** one command per line, so each line can be pasted on its own. `sudo` covers the command, not a shell redirect after it: `sudo printf … > /etc/file` fails, because your own shell opens the file before `sudo` runs. So files that root owns are written through `sudo tee`.

## First-time setup

1. **Clone and directories.**
   ```
   sudo git clone https://github.com/rishe-eco/i-monster /srv/imnstr
   sudo mkdir -p /srv/imnstr/data /srv/imnstr/backups
   sudo chown 1000:1000 /srv/imnstr/data /srv/imnstr/backups
   ```
   The container runs as `node` (uid 1000). It cannot write to a directory root owns.

2. **The `.env`**, at `/srv/imnstr/.env` (never committed; `.env.example` lists every variable):
   ```
   printf 'DB_PATH=/data/imnstr.db\nPRELAUNCH=1\nNODE_ENV=production\n' | sudo tee /srv/imnstr/.env
   ```
   `PRELAUNCH=1` keeps the site out of search engines until launch. Do not set `E2E_CLOCK`: the server refuses to boot with it in production.

3. **Start the app** (see *Routine deploys*) and check it answers on loopback: `curl -s http://127.0.0.1:4100/healthz` prints `ok`.

4. **Nginx, first the bootstrap file.** The final config points at a certificate that does not exist yet, and `nginx -t` refuses that. So start with the port-80-only file:
   ```
   sudo cp /srv/imnstr/deploy/nginx/imnstr.bootstrap.conf /etc/nginx/sites-available/imnstr
   sudo ln -s /etc/nginx/sites-available/imnstr /etc/nginx/sites-enabled/imnstr
   sudo nginx -t && sudo systemctl reload nginx
   ```
   The live file is a **copy**, not a link into the repo, for two reasons. certbot's nginx plugin edits the live file for a moment at every renewal, and that must not happen inside the git checkout. And a `git pull` must not change what the box's next reload loads (root-app's, or certbot's) before anyone has run `nginx -t` on it.

5. **The certificate**, without certbot editing any file in the repo:
   ```
   sudo certbot certonly --nginx -d imnstr.com -d www.imnstr.com --deploy-hook 'nginx -t && systemctl reload nginx'
   ```
   DNS for both names must already point at the box. `certonly` writes the certificate and leaves the config as it was: the live file is still the bootstrap file afterwards, so the next step overwrites nothing of certbot's. certbot keeps the deploy hook and runs it after each renewal, so Nginx loads the new certificate.

6. **Swap in the final config.**
   ```
   sudo cp /srv/imnstr/deploy/nginx/imnstr.conf /etc/nginx/sites-available/imnstr
   sudo nginx -t && sudo systemctl reload nginx
   ```
   If `nginx -t` fails here, put the bootstrap file back before anything else reloads. The certbot timer renews the certificate; `imnstr.conf` reads it from `/etc/letsencrypt/live/imnstr.com/`. Check with `sudo certbot renew --dry-run --cert-name imnstr.com`.

7. **Backups** (below): set up the cron line and the off-box target.

## Routine deploys

```
cd /srv/imnstr && sudo git pull
sudo docker compose -f docker-compose.prod.yml build
sudo docker compose -f docker-compose.prod.yml up -d
```

Migrations run at boot. If `deploy/nginx/imnstr.conf` changed, copy it over the live file, then check and reload. Keep the old file first, and if `nginx -t` fails, put it back before anything else reloads:
```
sudo cp /etc/nginx/sites-available/imnstr /tmp/imnstr.conf.prev
sudo cp /srv/imnstr/deploy/nginx/imnstr.conf /etc/nginx/sites-available/imnstr
sudo nginx -t && sudo systemctl reload nginx || sudo cp /tmp/imnstr.conf.prev /etc/nginx/sites-available/imnstr
```

Shorthand used below: `dc` is `sudo docker compose -f docker-compose.prod.yml`, run from `/srv/imnstr`.

### Checks after every deploy

```
sudo docker inspect --format '{{.State.Health.Status}}' imnstr-imnstr-1
sudo nginx -t
curl -sI https://imnstr.com/
curl -sI https://imnstr.com/fa/
curl -sI https://imnstr.com/no-such-page
curl -sI https://www.imnstr.com/ | head -3
```

Look for: `healthy`; the security headers on each response (the app sets them, Nginx adds none) and no `Set-Cookie`; `X-Robots-Tag: noindex` while `PRELAUNCH=1`; a 404 for the third; a 301 to the apex for the last. Then confirm root-app's own URL still answers. Paste the results into the stage record.

From B4a the admin API is live. It has no screens until B4b, so these are checked with `curl` alone:

```
curl -si https://imnstr.com/admin/api/session
curl -si -X POST -H 'Origin: https://evil.example' https://imnstr.com/admin/api/auth/signin/options
curl -si -X POST -H 'Origin: https://imnstr.com' https://imnstr.com/admin/api/auth/signin/options
curl -si https://imnstr.com/__test/auth
```

Look for: 401 with `{"code":"UNAUTHENTICATED"}`; 403 with `{"code":"ORIGIN_REFUSED"}`; 200 with `"rpId":"imnstr.com"` and `"userVerification":"required"`, which proves the server runs with `ORIGIN=https://imnstr.com` (a 403 here means it doesn't, and no passkey could sign in); 404 (the `/__test` routes exist only with `E2E_CLOCK=1`, which the server refuses in production). None of the four sets a cookie.

## The CLIs

Run them inside the container, which has the database mounted:

```
dc exec -T imnstr node --import tsx scripts/seed-entry.ts --lang en --body-file /tmp/entry.txt
dc exec -T imnstr node --import tsx scripts/backup.ts /backups/imnstr-manual.db
```

**The setup token** is how the first passkey is made, and how both are recovered if both are lost (spec §4.3). It needs server access, so it is made here and nowhere else:

```
sudo docker compose -f docker-compose.prod.yml exec imnstr npm run setup-token
```

It prints a link, `https://imnstr.com/admin/setup/<token>`, and when it expires (the line after the link; ignore the two `>` lines npm prints first). Open the link in the browser of the device that will hold the passkey. The link works once and dies after 30 minutes unused. It is printed and written nowhere else: the database keeps only its hash, so a lost link means running the command again. The origin in the link comes from `ORIGIN`, which defaults to `https://imnstr.com` when `NODE_ENV=production`, so the server's `.env` needs no new line. Until B4b the page behind the link does not exist, so no token is issued in production before then.

## Backups

`deploy/backup.sh` backs up with SQLite's online backup API (inside the container, so the app keeps running), checks the copy with `PRAGMA integrity_check`, keeps 14 days in `/srv/imnstr/backups`, and copies the directory off the box with `rsync -e ssh` to `$BACKUP_REMOTE`. If `$BACKUP_REMOTE` is unset it still makes the local backup, says so on stderr and exits 1, so cron reports it. Each backup is one self-contained file.

The off-box target is another host (P0-4). Give the root user an ssh key that the target accepts, then write `/etc/cron.d/imnstr-backup`:

```
printf 'BACKUP_REMOTE=backup@other-host:/backups/imnstr/\n17 3 * * * root /srv/imnstr/deploy/backup.sh\n' | sudo tee /etc/cron.d/imnstr-backup
```

Until the off-box target exists, the cron line can go in without the `BACKUP_REMOTE` line: the daily local copy is still made, and the run exits 1 so the missing copy off the box stays visible.

```
printf '17 3 * * * root /srv/imnstr/deploy/backup.sh\n' | sudo tee /etc/cron.d/imnstr-backup
```

Try it by hand once before trusting cron: `sudo BACKUP_REMOTE=... /srv/imnstr/deploy/backup.sh`, then look at `/srv/imnstr/backups` and the target.

### Restoring a backup into a scratch container

Prove a backup reads back, without touching the live data. This uses the live image but a throwaway data directory and another port:

```
B=$(ls -t /srv/imnstr/backups/imnstr-*.db | head -1)
sudo mkdir -p /tmp/imnstr-restore
sudo cp "$B" /tmp/imnstr-restore/imnstr.db
sudo chown -R 1000:1000 /tmp/imnstr-restore
sudo docker run --rm -d --name imnstr-scratch -p 127.0.0.1:4199:4100 -e DB_PATH=/data/imnstr.db -e PRELAUNCH=1 -v /tmp/imnstr-restore:/data imnstr:latest
curl -s http://127.0.0.1:4199/healthz
curl -s http://127.0.0.1:4199/log | head
sudo docker exec imnstr-scratch node --import tsx scripts/backup.ts /data/check.db
sudo docker stop imnstr-scratch
sudo rm -rf /tmp/imnstr-restore
```

`/healthz` prints `ok`, `/log` shows the entries, and the last `backup.ts` copies and integrity-checks the restored file.

To restore for real: `dc stop`, move the live `imnstr.db` (and any `-wal`/`-shm` beside it) aside, copy the backup in as `/srv/imnstr/data/imnstr.db`, `sudo chown 1000:1000` it, `dc up -d`.

## Not covered here

root-app's own `deploy/README.md` has one line under "Somewhere else on the box", pointing at this file. That is the only edit to root-app, made on its `main` at B2's verify.
