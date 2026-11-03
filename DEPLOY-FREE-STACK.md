# ps-tracker — $0/month Deployment (The Vibe Hosting + Brevo/Resend + UptimeRobot + B2 backup)

Companion files (all *new*, nothing existing was modified):

```
ps-tracker/
├── DEPLOY-FREE-STACK.md          ← you are here
└── deploy/
    ├── .env.free-stack.template  ← ready-to-use env file for this stack
    └── b2-backup.sh              ← cron job: nightly backup to Backblaze B2 (10 GB free)
```

Why this stack: ps-tracker stores state as `state.json` + uploaded docs on disk and
runs an in-process `setInterval` daily digest. So it needs **persistent disk** and
**no sleep**. The Vibe Hosting's free tier (2-core / 512 MB root Linux box, 24/7)
is the only $0 option from the free-for.dev list that satisfies both. Dockerfile
already sets `DATA_DIR=/data` and `PORT=8080`.

---

## Step 0 — Prerequisites (5 min)

- [ ] Phone number to verify (Vibe Hosting free tier requires it; no credit card)
- [ ] A Brevo **or** Resend account (email — `server.js` supports both natively)
- [ ] (Optional) Backblaze B2 account for off-site backups

## Step 1 — Get your free box

1. Go to https://thevibehosting.com and follow their onboarding (`curl` one-liner /
   dashboard) to provision the free root box. You get SSH access and an HTTPS subdomain.
2. Note the **HTTPS subdomain** — this is `PUBLIC_URL` in Step 4.
3. SSH in: `ssh root@<box-address>`

> If the platform proxies HTTPS to a fixed port, set your app's `PORT` to match in
> the env file (Node reads it via `process.env.PORT`; Docker maps `-p` accordingly
> in Step 5).

## Step 2 — Email keys (choose ONE, both are pre-wired in server.js)

### Option A — Brevo (largest free quota: 9,000/mo, 300/day)
1. Sign up at https://www.brevo.com → **SMTP & API** page.
2. Generate an **SMTP key**.
3. Values for the env file:
   ```
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_USER=<your Brevo account email>
   SMTP_PASS=<the SMTP key>
   MAIL_FROM=Process Safety Tracker <you@yourdomain.com>
   ```
   MAIL_FROM must be an address Brevo associates with your account.

### Option B — Resend (3,000/mo, 100/day, best DX)
1. Sign up at https://resend.com → **API Keys** → create key (`re_...`).
2. Free tier sends from your own email first; verify a domain to use
   `alerts@yourdomain.com`.
3. Values for the env file:
   ```
   RESEND_API_KEY=re_xxxxxxxx
   MAIL_FROM=Process Safety Tracker <you@yourdomain.com>
   ```
> **⚠️ As-deployed correction (Nov 2026):** The Vibe Hosting sandboxes **block
> outbound SMTP** (their fair-use §10). Brevo/SMTP therefore will **not work there** —
> use **Resend** (HTTPS API), which `server.js` already supports: add
> `RESEND_API_KEY` + `MAIL_FROM` to the app env with no other changes.

## Step 3 — Get the app onto the box

```bash
# on the box
apt-get update && apt-get install -y git   # if git missing
git clone <YOUR_REPO_URL> /opt/ps-tracker
# …or copy the folder up with scp:
#   scp -r "ps-tracker" root@<box-address>:/opt/
```

## Step 4 — Configure environment

```bash
mkdir -p /opt/ps-tracker-data          # persistent state lives here, NOT in the container
cp /opt/ps-tracker/deploy/.env.free-stack.template /opt/ps-tracker/.env
nano /opt/ps-tracker/.env              # fill in APP_PASSWORD, email keys, PUBLIC_URL
```

Key values to fill (full list is in the template):

| Var | Value |
|---|---|
| `APP_PASSWORD` | team password (login is disabled without it!) |
| `PUBLIC_URL` | `https://<your-vibe-subdomain>` (link used in digest emails) |
| `DATA_DIR` | `/data` (already in Dockerfile; template keeps it explicit) |
| `TZ` | `Africa/Lagos` (matches fly.toml/render.yaml defaults) |
| `SEED_DEMO` | `false` for a real production instance |
| email block | from Step 2 (Option A or B) |

## Step 5 — Run it

### Option A — Docker (uses the existing Dockerfile as-is)
```bash
apt-get install -y docker.io
cd /opt/ps-tracker
docker build -t ps-tracker .
docker run -d --name ps-tracker \
  --restart unless-stopped \
  -p 8080:8080 \
  --env-file /opt/ps-tracker/.env \
  -v /opt/ps-tracker-data:/data \
  ps-tracker
```

### Option B — PM2 (lighter on a 512 MB box)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
npm i -g pm2
cd /opt/ps-tracker
pm2 start server.js --name ps-tracker --update-env   # reads env via: pm2 start ecosystem? see note
# Simplest: export env then start:
set -a; source /opt/ps-tracker/.env; set +a
DEC envoy: pm2 restart ps-tracker --update-env
pm2 save && pm2 startup     # survives reboots
```
(For PM2, set `DATA_DIR=/opt/ps-tracker-data` inside the env file instead of `/data`.)

## Step 6 — Verify

```bash
curl http://localhost:8080/api/health
# → {"app":"ps-tracker","ok":true,"auth":true,"email":{"smtp":true,"resend":false}}
```
- [ ] `ok`: true
- [ ] `auth`: true (APP_PASSWORD set)
- [ ] one of `smtp` / `resend` is true
- [ ] Open `https://<subdomain>`, log in, run **Settings → Send test email**
- [ ] Check data persists: restart the container / `pm2 restart ps-tracker`, reload the
      app, confirm records are still there (proves the mounted volume works)

## Step 7 — UptimeRobot monitoring (free, 50 monitors)

1. https://uptimerobot.com → Add New Monitor → **HTTP(s)**.
2. URL: `https://<your-subdomain>/api/health` → interval 5 min.
3. Benefit:instant alerts on downtime **and** the pings double as keep-alive traffic.
   Optional second monitor: keyword check on `"ok":true`.

## Step 8 — OPTIONAL: nightly off-site backup to Backblaze B2 (10 GB free)

1. Create a B2 bucket (e.g. `ps-tracker-backups`, private) + an application key.
2. Install rclone and do a one-time setup on the box:
   ```bash
   curl https://rclone.org/install.sh | bash
   rclone config      # remote name: b2, type: b2, enter account id + application key
   ```
3. Edit the top of `deploy/b2-backup.sh` (BUCKET, RETENTION_DAYS, SRC dirs).
4. Test it once, then schedule with cron (daily 02:00):
   ```bash
   chmod +x /opt/ps-tracker/deploy/b2-backup.sh
   /opt/ps-tracker/deploy/b2-backup.sh        # dry-run once manually
   crontab -e
   0 2 * * * /opt/ps-tracker/deploy/b2-backup.sh >> /var/log/ps-tracker-backup.log 2>&1
   ```

### Restore procedure
```bash
# full snapshot restore:
rclone copyto b2:<bucket>/snapshots/<archive>.tar.gz /tmp/restore.tar.gz
tar -xzf /tmp/restore.tar.gz -C /opt/ps-tracker-data/
# live-file restore (data/<subpath>):
rclone copy b2:<bucket>/live/... /opt/ps-tracker-data/...
# then: docker restart ps-tracker  (or pm2 restart ps-tracker)
```

---

## Free-tier limits recap (as listed in free-for-dev, Nov 2026 — verify before relying)

| Piece | Provider | Free allowance |
|---|---|---|
| Hosting | The Vibe Hosting | 2-core / 512 MB, root box, 24/7, phone-verified |
| Email A | Brevo | 9,000 emails/mo (300/day) |
| Email B | Resend | 3,000 emails/mo (100/day) |
| Monitoring | UptimeRobot | 50 monitors, 5-min interval |
| Backup | Backblaze B2 | 10 GB object storage |
| Transport bonus | `ps-tracker` webhooks | Discord/Slack digest delivery is free & already supported via Settings → webhook |

## When to spend (upgrade triggers)

- Brevo hit 300/day → move `MAIL_FROM` recipients to a domain or switch to Resend
- Box feels tight (512 MB) → Fly.io with your existing `fly.toml` + volume (~$2–3/mo)
  is the drop-in paid upgrade; configs already exist in this repo

---

## Appendix — Actual deployment record (Nov 2026)

This deployment used The Vibe Hosting's agent API (per `SKILL.md`), not the
Docker/PM2 options above. Working setup, for reference:

- **Server:** `ps-tracker.thevibehosting.com` (anonymous tier, 256 MB)
- **Publishing:** supervisor watches `/root/run.sh` (must be at `/root`, not
  `/root/app/`) → `source /root/myapp/app.env; exec node server.js` on `0.0.0.0:80`.
  No Docker install needed — box ships with Ubuntu 24.04 + Node 18.
- **Env file:** `/root/myapp/app.env` (chmod 600): `PORT=80`, `DATA_DIR=/root/ps-tracker-data`,
  `TZ=Africa/Lagos`, `SEED_DEMO=false`, `PUBLIC_URL`, `APP_PASSWORD`
- **Upload without rsync on Windows:** `tar -czf` → `scp` → remote untar (PS pipelines corrupt binary)
- **Credentials (local only, never commit):** `deploy/.vibe-deployment.create.json`
  (api_key, SSH private key), `deploy/.thevibehosting_key`, `deploy/.vibe-deployment.local.json`
  (app password). Add these three names to `.gitignore` if this folder ever becomes a repo.
- **Billing reality check:** burn ≈ $0.13/mo (36 MB RAM avg, awake) → comfortably
  inside the $0.90/mo anonymous free credit. Disk persists across sleep/restarts;
  host also does its own daily off-site backups (14 d / 8 wks / 6 mo).
- **Email on this host:** SMTP blocked → Resend only. Until a `RESEND_API_KEY` is added
  to `app.env` (`run.sh` re-sources it after `pkill -f '[r]un.sh'`), digests fail with
  "No email provider configured" but the app itself works fully.
- **Scale-to-zero:** anonymous accounts can't set `never_sleep`; idle 10 min → sleeps,
  wakes in ~1–3 s on HTTP (browser sees a brief "Waking…" page). An external monitor
  pinging `/api/health` keeps it warm and also makes the hourly digest reliable.
- **Left to do:** add RESEND_API_KEY · verify phone (unlocks $2.25/mo credit,
  512 MB free 24/7, never-sleep, custom domains, key recovery) · set up UptimeRobot.
