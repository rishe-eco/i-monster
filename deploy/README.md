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

3. **Start the app** (the three lines under *Deploying by hand*) and check it answers on loopback: `curl -s http://127.0.0.1:4100/healthz` prints `ok`.

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

**A push to `main` deploys.** The workflow `.github/workflows/deploy.yml` runs on every push to `main`:

1. The `check` job runs `npm ci --ignore-scripts`, `npm run check`, `npm run build` and `npm test` on Node 24 (no Playwright: the Edge e2e stays local, at the milestones).
2. If that is green, the `deploy` job opens one SSH connection to the box as `imnstr-deploy`. That key can only run `/usr/local/sbin/imnstr-deploy`, as root through `sudo`, with no arguments (*Server setup for CI*, below). The job runs only for `main`, and only while the repository variable `DEPLOY_ENABLED` is `true`; any other value switches automatic deploys off, and `check` still runs.
3. The script fast-forwards `/srv/imnstr`, builds the image on the box, runs `up -d --wait`, checks the container's health and `nginx -t`, then runs `deploy/checks.sh` as `nobody`. A green run ends with `DEPLOYED <sha>`, and the job says whether that is the pushed commit or a newer one.

Only `verify` pushes `main`, so only reviewed code deploys. Watch the run on the repository's Actions page; it is public, and so is its log, which holds no secret and no line of `.env`.

**The script never changes Nginx, the compose file or itself.** If `deploy/nginx/imnstr.conf` differs from the live copy, `docker-compose.prod.yml` changed, or `deploy/imnstr-deploy.sh` differs from the installed copy, it stops before changing anything and exits 2 (*What each exit code means*). It never reloads Nginx and never prunes images. A one-off server step (a setup token, a cron line, a new `.env` line) is still yours, by hand, before the push that needs it: the app boots on defaults without a new `.env` line.

### Deploying by hand

The same deploy, under the same lock, from your own shell:

```
sudo /usr/local/sbin/imnstr-deploy
```

It prints what it does and ends with `DEPLOYED <sha>`. It is also the fallback when CI is off or red, and the way to re-run after a manual step. Before the script is installed (the first time, or when it stopped on a stop file), the three plain lines are:

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

### What each exit code means

| Exit | Meaning | What to do |
|---|---|---|
| **0** | Deployed, and every check passed. The last line is `DEPLOYED <sha>`. | Nothing. |
| **2** | **Stopped, and nothing was changed.** The running container is as it was. The line says why, and the line after it says what to do by hand. | The list below, then re-run: *Re-run all jobs* on the failed run, or **Run workflow** on the Actions page, or `sudo /usr/local/sbin/imnstr-deploy`. |
| **1** | **Failed after something may have changed.** The line names the step: `build`, `up`, `health`, `nginx` or `checks`. The site is left on the new image: there is no automatic rollback, because migrations run at boot and old code against a migrated database is the riskier move. | Read the step's output, fix forward on `main`, or roll back by hand (below). A failed `build` leaves the old container serving. |

What to do for each exit 2:

- **Another deploy holds the lock.** Wait for it, then re-run.
- **The checkout has uncommitted changes.** `cd /srv/imnstr && sudo git status` shows them. Commit, stash or discard them by hand, then re-run.
- **`origin/main` is not a fast-forward** (history was rewritten, as on 2026-10-14). The script never resets the checkout. Look at `sudo git log` against `origin/main` in `/srv/imnstr`, decide there, then re-run.
- **`imnstr.conf` differs from the live conf.** Bring the commit in, copy the file, check and reload (the three lines above), then re-run:
  ```
  cd /srv/imnstr && sudo git pull
  ```
- **`docker-compose.prod.yml` changed.** Deploy by hand (*Deploying by hand*: pull, build, `up -d`), then re-run.
- **The installed script differs from the commit's.** Bring the commit in, reinstall the script, then re-run:
  ```
  cd /srv/imnstr && sudo git pull
  sudo install -o root -g root -m 0755 /srv/imnstr/deploy/imnstr-deploy.sh /usr/local/sbin/imnstr-deploy
  ```

A re-run when the checkout is already current does not move it. It still builds (cached, so seconds), runs `up -d` (which changes nothing when the image is unchanged) and runs every check, so a run is only green when what is running passed.

### Rolling back by hand

A bad deploy stays up until you act. Roll back only when the bad commit added no migration (`cd /srv/imnstr && sudo git diff --stat <good>..HEAD -- migrations` prints nothing): a migrated database under old code is worse than the bug. If it did add one, fix forward, or restore a backup (*Restoring a backup into a scratch container*, below, and its last paragraph).

1. In GitHub, **Settings, Secrets and variables, Actions, Variables**: set `DEPLOY_ENABLED` to `false`, so a push can't redeploy the bad commit while you work.
2. On the box, put the last good commit (`sudo git log --oneline -10` shows them) back in the checkout and rebuild:
   ```
   cd /srv/imnstr
   sudo git checkout --detach <good sha>
   sudo docker compose -f docker-compose.prod.yml build
   sudo docker compose -f docker-compose.prod.yml up -d --wait --wait-timeout 120
   bash /srv/imnstr/deploy/checks.sh 1
   ```
   (`1` while `PRELAUNCH=1` is in `.env`; `0` after launch.)
3. On your own machine, revert the bad commit on `main` and have `verify` push it. Then, on the box, return the checkout to the branch, and set `DEPLOY_ENABLED` back to `true`:
   ```
   cd /srv/imnstr
   sudo git checkout main
   ```
   The next push deploys the revert on top of what `main` holds.

### Checks after every deploy

`deploy/checks.sh` is the one list. The deploy script runs it as `nobody` from the new checkout, so a stage that adds a deploy check edits that file in its own diff, and nobody reinstalls the root script. By hand, from any machine:

```
bash deploy/checks.sh 1
```

The argument is `1` while `PRELAUNCH=1` is in the server's `.env` (the checks expect `X-Robots-Tag: noindex`), `0` after launch (they expect it absent). Optional second and third arguments are the site's origin (default `https://imnstr.com`) and root-app's URL (default `https://m-root.com/`). It stops at the first failure and prints `FAILED <check name>: <why>`. It never reads `.env`.

It covers: the security headers, no `Set-Cookie`, and noindex on `/`, `/fa/` and a 404; `www` to the apex and `http` to `https`, both 301; the admin API (B4a: 401 `UNAUTHENTICATED`, 403 `ORIGIN_REFUSED`, 401 for the entries list and for an unknown path under `/admin/api` (B5), 200 sign-in options with `"rpId":"imnstr.com"` and `"userVerification":"required"`, which proves the server runs with `ORIGIN` set, and 404 for the test routes, which exist only with `E2E_CLOCK=1`); the admin shell on `/admin` and `/admin/setup/x` (200, the CSP, `no-store`); the bundle's script and stylesheet that the shell names (200, `immutable`); and root-app's own URL answering 200. It sends one POST, the sign-in options, which leaves a 5-minute challenge in the server's memory and nothing else.

The two checks that need root stay in the script: the container's `healthy` (`sudo docker inspect --format '{{.State.Health.Status}}' imnstr-imnstr-1`) and `sudo nginx -t`. If the image was built without the bundle the container does not start, which `docker compose ps` shows at once.

Paste the output into the stage record.

## Server setup for CI

Once, by the founder, as a sudo user, with the commit that carries these files already deployed by hand (*Deploying by hand*), so that `/srv/imnstr/deploy/imnstr-deploy.sh` exists. One command per line, `sudo` on each. **`imnstr-deploy` is a separate account from your own sudo user (`deploy` on this box). Never give CI's key to `deploy`.**

1. **The key pair, on your own machine, never on the box and never in the repository.** No passphrase, because CI cannot type one:
   ```
   ssh-keygen -t ed25519 -N '' -C imnstr-ci -f ./imnstr-ci-key
   ```
   `imnstr-ci-key.pub` is the public half, one line. `imnstr-ci-key` is the private half. Both are deleted at step 8.

2. **The user:** no password, `/bin/sh` as its shell (`sshd` runs the forced command through the user's shell, so `nologin` would block it), and no group but its own:
   ```
   sudo adduser --disabled-password --gecos '' --shell /bin/sh imnstr-deploy
   ```
   If a login later says the account is locked, `sudo usermod -p '*' imnstr-deploy` makes the password unusable without locking the account.

3. **The key's line,** with the forced command. Paste the public key where `<public key>` is, keeping the single quotes. The directory and the file belong to root, so the user cannot rewrite its own line:
   ```
   sudo install -d -m 0755 -o root -g root /home/imnstr-deploy/.ssh
   printf '%s\n' 'restrict,command="sudo -n /usr/local/sbin/imnstr-deploy" <public key>' | sudo tee /home/imnstr-deploy/.ssh/authorized_keys
   sudo chmod 0644 /home/imnstr-deploy/.ssh/authorized_keys
   ```
   The line must read `restrict,command="sudo -n /usr/local/sbin/imnstr-deploy" ssh-ed25519 AAAA… imnstr-ci`. `restrict` gives no pty, no forwarding and no agent. Any command the client sends runs the script and nothing else.

4. **The sudoers line.** A broken file in `/etc/sudoers.d/` breaks `sudo` for everyone on the box, so write it to a temporary file, check it with `visudo -cf`, and only then install it. The name has no dot, because `sudo` skips names with one. The empty `""` forbids arguments:
   ```
   F=$(mktemp /tmp/imnstr-deploy.XXXXXX)
   printf 'imnstr-deploy ALL=(root) NOPASSWD: /usr/local/sbin/imnstr-deploy ""\n' > "$F"
   sudo visudo -cf "$F"
   ```
   Only if the last command printed `parsed OK`:
   ```
   sudo install -m 0440 -o root -g root "$F" /etc/sudoers.d/imnstr-deploy
   rm "$F"
   sudo -n true
   ```
   The last line proves your own `sudo` still works.

5. **The script,** from the checkout:
   ```
   sudo install -o root -g root -m 0755 /srv/imnstr/deploy/imnstr-deploy.sh /usr/local/sbin/imnstr-deploy
   ```

6. **Prove the account.** `id` shows no `docker` group; `sudo -l` lists the one command with `""`; the third is refused; and `nobody` can run the checks:
   ```
   id imnstr-deploy
   sudo -l -U imnstr-deploy
   sudo -u imnstr-deploy docker ps
   sudo runuser -u nobody -- bash /srv/imnstr/deploy/checks.sh 1
   ```

7. **On GitHub (web),** in `rishe-eco/i-monster`. Settings, **Environments**, `production` (deployment branches: `main` only; no reviewers and no wait timer, since either would make every deploy wait for a click). Add four **environment secrets**:
   - `DEPLOY_HOST`: the box's hostname or address;
   - `DEPLOY_PORT`: `22`;
   - `DEPLOY_KEY`: the whole private key file, including its `-----BEGIN` and `-----END` lines;
   - `DEPLOY_KNOWN_HOSTS`: one line, the box's own host key. Make it on the box, with the same name or address as `DEPLOY_HOST` in place of `<host>`:
     ```
     echo "<host> $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
     ```

   Then, under Settings, **Secrets and variables, Actions, Variables**, the repository variable `DEPLOY_ENABLED` = `true`, under *Repository variables*. **Set it last.** Anything but `true` switches automatic deploys off. **Not as an environment variable of `production`:** GitHub decides whether to run a job before it loads the job's environment, so the `deploy` job's `if` can't see one there, and every run shows `deploy` as skipped (found at CD1's verify).

8. **Delete the private half** once it is pasted into `DEPLOY_KEY`, on your own machine:
   ```
   rm imnstr-ci-key imnstr-ci-key.pub
   ```
   (`Remove-Item` in PowerShell.) GitHub keeps the secret; nobody can read it back.

9. **Re-run the workflow** (Actions, **Run workflow**). The checkout is current, so it builds from cache, ups, and runs the checks: green, with `DEPLOYED <sha>` equal to the pushed commit.

If a run cannot connect: the provider's own firewall may limit SSH by address (hosted runners come from a wide, changing range), or the key line is wrong; `sudo journalctl -u ssh --since '10 minutes ago'` on the box says which. If `AllowUsers` or `AllowGroups` is ever added to `sshd_config`, add `imnstr-deploy` to it, then `sudo sshd -t && sudo systemctl reload ssh`.

## The CLIs

Run them inside the container, which has the database mounted:

```
dc exec -T imnstr node --import tsx scripts/seed-entry.ts --lang en --body-file /tmp/entry.txt
dc exec -T imnstr node --import tsx scripts/backup.ts /backups/imnstr-manual.db
```

**The reader record** (spec §3.1) is shown here and nowhere else. `--to` is optional and defaults to this month; both months are inclusive:

```
dc exec -T imnstr node --import tsx scripts/report.ts --from 2026-11 --to 2027-01
```

**`reset-content`** clears the entries, episodes and reader record that the demonstrations left, and keeps the passkeys and settings. **Take a backup first** (the `backup.ts` line above). Without `--yes` it only prints what it would delete, as row counts:

```
dc exec -T imnstr node --import tsx scripts/reset-content.ts
dc exec -T imnstr node --import tsx scripts/reset-content.ts --yes
```

**The setup token** is how the first passkey is made, and how both are recovered if both are lost (spec §4.3). It needs server access, so it is made here and nowhere else:

```
sudo docker compose -f docker-compose.prod.yml exec imnstr npm run setup-token
```

It prints a link, `https://imnstr.com/admin/setup/<token>`, and when it expires (the line after the link; ignore the two `>` lines npm prints first). Open the link in the browser of the device that will hold the passkey. The link works once and dies after 30 minutes unused. It is printed and written nowhere else: the database keeps only its hash, so a lost link means running the command again. The origin in the link comes from `ORIGIN`, which defaults to `https://imnstr.com` when `NODE_ENV=production`, so the server's `.env` needs no new line. The page behind the link is the admin's setup screen: it asks for a name for the passkey and registers this device; it works on a phone at 360 px.

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
