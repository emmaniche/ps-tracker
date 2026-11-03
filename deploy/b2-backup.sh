#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ps-tracker → Backblaze B2 nightly backup (host cron job, NEW file, from the
# free-stack kit; see ../DEPLOY-FREE-STACK.md Step 8). 10 GB free at b2.com.
#
# What it does:
#   1. tar.gz snapshot of the data dir (state.json + uploads/) →
#        b2:<bucket>/snapshots/YYYY-MM-DD.tz.tar.gz   with retention pruning
#   2. rclone sync of the live data dir →
#        b2:<bucket>/live/...                          (always current)
#   3. concurrent-lock file so overlapping cron runs are skipped
#
# Setup (one-time on the box):
#   rclone config                 # remote named "b2", type b2, app key + id
#   Edit BUCKET / REMOTE / SRC / RETENTION_DAYS below, then:
#   ./b2-backup.sh                # run once manually
#   crontab -e                    # schedule daily 02:00:
#     0 2 * * * /opt/ps-tracker/deploy/b2-backup.sh >> /var/log/ps-tracker-backup.log 2>&1
#
# Restore (see DEPLOY-FREE-STACK.md):
#   rclone copyto b2:<bucket>/snapshots/<archive>.tar.gz /tmp/r.tar.gz
#   tar -xzf /tmp/r.tar.gz -C /opt/ps-tracker-data/
#   docker restart ps-tracker    # or: pm2 restart ps-tracker
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── configuration ────────────────────────────────────────────────────────────
REMOTE="b2"                       # rclone remote name (from `rclone config`)
BUCKET="ps-tracker-backups"       # private B2 bucket (create in B2 console)
RETENTION_DAYS=30                 # prune snapshot archives older than this
# Where the app's data lives on THIS box:
#   Docker (Option A): mounted host dir  →  /opt/ps-tracker-data
#   PM2 (Option B):    the DATA_DIR itself
SRC="/opt/ps-tracker-data"
LOCKFILE="/run/ps-tracker-backup.lock"
LOG_TAG="ps-tracker-backup"

log() { echo "[$(date '+%F %T')] $LOG_TAG: $*"; }

[[ -d "$SRC" ]] || { log "ERROR: data dir '$SRC' not found — edit SRC"; exit 1; }
[[ -f "$SRC/state.json" ]] || { log "ERROR: $SRC/state.json missing — app not initialised here?"; exit 1; }

# ── single-flight lock (skip if the previous run is still going) ─────────────
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCKFILE"
  flock -n 9 || { log "previous run still active — skipping"; exit 0; }
fi

BUCKETPATH="b2:$BUCKET"

# ── 1) daily snapshot archive, with retention ────────────────────────────────
SNAP_NAME="$(date '+%F').tar.gz"          # filename date = archive day
TMPARCHIVE="$(mktemp --suffix=.tar.gz)"
trap 'rm -f "$TMPARCHIVE"' EXIT
tar -czf "$TMPARCHIVE" -C "$(dirname "$SRC")" "$(basename "$SRC")"
rclone copyto "$TMPARCHIVE" "$BUCKETPATH/snapshots/$SNAP_NAME" --quiet 2>/dev/null \
  || { log "ERROR: rclone upload failed for snapshot"; exit 1; }
log "snapshot uploaded: snapshots/$SNAP_NAME ($(du -h "$TMPARCHIVE" | cut -f1))"

# prune archives older than RETENTION_DAYS (snapshot names start with YYYY-MM-DD)
pruned=0
CUTOFF=$(date -u -d "-$RETENTION_DAYS days" '+%s' 2>/dev/null || echo 0)
while read -r f; do
  case "$f" in
    ????-??-??.tar.gz) ARCH_DATE="${f%.tar.gz}";;
    *) continue;;
  esac
  ARCH="$(date -u -d "$ARCH_DATE" '+%s' 2>/dev/null || echo 0)"
  [[ "$ARCH" -gt 0 && "$ARCH" -lt "$CUTOFF" ]] || continue
  rclone deletefile "$BUCKETPATH/snapshots/$f" --quiet && { pruned=$((pruned+1)); log "pruned old snapshot: $f"; }
done < <(rclone lsf "$BUCKETPATH/snapshots/" --files-only 2>/dev/null || true)
log "retention: pruned $pruned archive(s) (keep $RETENTION_DAYS days)"

# ── 2) live sync (current state always available for fast restore) ───────────
rclone sync "$SRC" "$BUCKETPATH/live" --quiet 2>/dev/null \
  || { log "WARN: live sync incomplete (snapshot above is still valid)"; exit 0; }

log "backup complete: $BUCKETPATH"
