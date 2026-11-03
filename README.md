# Process Safety Tracker

An online version of the NEPL Process Safety Tracker workbook. Every sheet became a module, with a live dashboard, timeline, summary sheet, document attachments and email alerts on top.

| Workbook sheet | App module |
|---|---|
| SCE Master Register | **SCE register** (each SCE is one cell in the dashboard's barrier strip) |
| SCE Inspection Tracking | **Inspections**: next due and overdue calculate automatically |
| Barrier Overrides | **Overrides**: duration calculates automatically, flags expired or unassessed |
| Defects & Actions | **Actions**: owner, progress, target date, documents on every item |
| PS KPI Dashboard | **KPIs**: percentages auto-calculate, trend chart, "fill from live data" |

Added: dashboard with status bar and health index, alerts, Gantt-style timeline, printable summary sheet, searchable document library, activity history, Excel import/export (same sheets and formulas as your workbook), dark mode, mobile layout.

## Two ways to run it (same code)

| Mode | Hosts | Data is stored | Email |
|---|---|---|---|
| **Static** | GitHub Pages, Netlify, Vercel, Cloudflare Pages | In each user's browser (IndexedDB) | Send from the browser via free EmailJS, or opens the user's mail app |
| **Server** | Render, Railway, Fly.io, Replit, Glitch | On the server, shared by the whole team | SMTP or Resend, plus an automatic **daily digest** and instant alerts |

The page detects which mode it is in. For a bid, deploy **Server** mode so the whole team shares one record and scheduled emails work. If you want the front-end on a static host and the server elsewhere, put the server URL in `public/config.js` (`apiBase`).

## Deploy (pick one)

**Render**: push this folder to GitHub, then New > Blueprint (uses `render.yaml`). Add env vars below.
**Railway**: New Project > Deploy from GitHub. `railway.json` is picked up. Add a Volume mounted at `/data` and set `DATA_DIR=/data`.
**Fly.io**: `fly launch --copy-config --no-deploy`, `fly volumes create tracker_data --size 1`, `fly secrets set APP_PASSWORD=...`, `fly deploy`.
**Replit**: Create Repl > Import from GitHub (or upload the folder), press Run. Set secrets in the Secrets tab.
**Glitch**: Import from GitHub (or upload). `glitch.json` handles install/start.
**Netlify / Vercel**: drag the folder in or connect the repo (`netlify.toml` / `vercel.json` publish `public/`). Static mode.
**GitHub Pages**: push to `main`, then Settings > Pages > Source = GitHub Actions (`.github/workflows/pages.yml`). Static mode.

Locally: `npm install && npm start`, then open http://localhost:3000.

## Environment variables (server mode, all optional)

See `.env.example`. The important ones:

- `APP_PASSWORD` shared team password. **Set this**: without it anyone with the link can edit.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` for email through any SMTP provider (Gmail app password, Brevo, Zoho, Office 365).
  Or `RESEND_API_KEY` + `MAIL_FROM` for Resend.
- `DATA_DIR` where data and uploads live. **Point it at a persistent disk or volume.** Render's free plan and Glitch have no durable disk, so use a paid disk/volume (or Railway/Fly volumes) for real project data, and export a backup from Settings regularly.
- `PUBLIC_URL` the app's public address, used for the "Open tracker" button in emails.

## Email setup

1. Settings > Email notifications: add recipients, choose what to alert on, pick the daily digest hour and time zone.
2. Server mode: set the SMTP or Resend variables, restart, press **Send test email**.
3. Static mode: create a free EmailJS service and template (variables `to_email`, `subject`, `message`, `html`), paste the three IDs into Settings.
4. Optional Slack/Teams/Zapier/Make webhook receives the same digest as `{ "text": … }`.
5. Action owners get their own overdue items if you add an owner email on the action and switch on "Remind action owners".

## Health index

40% inspections on time + 25% actions on time + 20% overrides controlled (assessed, in date) + 15% test results (a Fail counts fully, a Conditional counts half). Rated Strong 90+, Stable 75+, Watch 60+, Critical below. The formula is also printed on the summary sheet. Change it in `summarize()` in `public/shared.js`.

## Files

```
public/        the whole front-end (no build step)
  index.html styles.css config.js
  shared.js    status logic + email digest (also used by the server)
  core.js      storage layer, charts, dialogs
  views.js     all screens, drawer, import/export
  vendor/      SheetJS (Excel), bundled so it works offline
server.js      Express API, uploads, email, daily digest
```

## Honest limits

- Static mode keeps data in one browser; use Export/Backup, or deploy server mode.
- Sign-in is a single shared password. It is fine for a project team; it is not per-user access control.
- Server data is a JSON file plus an uploads folder, which suits a team of tens, not thousands.
- The demo records are fictional. Use Settings > Clear all data before loading real data.
