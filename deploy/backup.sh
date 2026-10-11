#!/usr/bin/env bash
# Daily backup of the IMNSTR database (plan B2). Run by host cron; see deploy/README.md.
#   - backs up inside the container, into /srv/imnstr/backups/imnstr-<UTC stamp>.db
#   - deletes backups older than 14 days
#   - copies the directory to $BACKUP_REMOTE (user@host:/path/) over rsync and ssh
# Exits non-zero on any failure, so cron reports it. With BACKUP_REMOTE unset it
# still takes the local backup, says so on stderr, and exits 1.
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/imnstr}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="imnstr-$STAMP.db"

cd "$APP_DIR"
docker compose -f docker-compose.prod.yml exec -T imnstr \
  node --import tsx scripts/backup.ts "/backups/$NAME"

find "$BACKUP_DIR" -maxdepth 1 -name 'imnstr-*.db' -mtime +14 -delete

if [ -z "${BACKUP_REMOTE:-}" ]; then
  echo "BACKUP_REMOTE is not set: $NAME is on this box only, not copied off it" >&2
  exit 1
fi
rsync -a -e ssh --include='imnstr-*.db' --exclude='*' "$BACKUP_DIR/" "$BACKUP_REMOTE"
