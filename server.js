/* Process Safety Tracker – tiny Node server (Express).
   Stores data as JSON + uploaded files — Netlify Blobs on Netlify,
   local disk elsewhere (DATA_DIR). Sends email, runs the daily digest.
   Environment variables (all optional):
     PORT, DATA_DIR, APP_PASSWORD, PUBLIC_URL, CORS_ORIGIN, SEED_DEMO=false
     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, MAIL_FROM   (any SMTP provider)
     RESEND_API_KEY, MAIL_FROM                                            (or Resend)            */
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PS = require('./public/shared.js');

const PORT = process.env.PORT || 3000;
const ON_NETLIFY = !!(process.env.NETLIFY === 'true' || process.env.NETLIFY_BLOBS_CONTEXT || process.env.SITE_ID);
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const UP = path.join(DATA, 'uploads');
try { if (!ON_NETLIFY) fs.mkdirSync(UP, { recursive: true }); } catch {} /* read-only FS on hosted functions */
const FILE = 'state.json';

/* ---------- state — Postgres (DATABASE_URL) or local disk ---------- */
const { Client } = require('pg');
const hasDb = () => !!process.env.DATABASE_URL;
async function withDb(fn) {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
async function ensureTables(c) {
  await c.query("CREATE TABLE IF NOT EXISTS ps_state (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())");
  await c.query("CREATE TABLE IF NOT EXISTS ps_uploads (id TEXT PRIMARY KEY, name TEXT, mime TEXT, bytes BYTEA NOT NULL, created TIMESTAMPTZ DEFAULT now())");
}
const COLS = ['sce', 'insp', 'ovr', 'act', 'kpi', 'log'];
let state = null; let lastStorageError = null;
async function load() {
  if (hasDb()) {
    try {
      await withDb(async c => {
        await ensureTables(c);
        const r = await c.query("SELECT data FROM ps_state WHERE id = 'state'");
        state = r.rows.length ? JSON.parse(r.rows[0].data) : null;
      });
    } catch (e) { state = null; lastStorageError = String(e.message || e).slice(0, 160); }
  } else {
    try { state = JSON.parse(fs.readFileSync(path.join(DATA, FILE), 'utf8')); } catch (e) { state = null; }
  }
  if (!state) {
    const demo = process.env.SEED_DEMO !== 'false';
    state = { rev: 1, lastDigest: '', db: demo ? PS.seed(PS.todayISO(PS.DEFAULT_SETTINGS.timezone)) : { sce: [], insp: [], ovr: [], act: [], kpi: [], log: [] }, settings: Object.assign({}, PS.DEFAULT_SETTINGS, { demo }) };
    try { await save(); } catch (e) { lastStorageError = String(e.message || e).slice(0, 160); }
  }
  COLS.forEach(c => { state.db[c] = state.db[c] || []; });
}
async function save() {
  state.rev++;
  if (hasDb()) {
    try {
      await withDb(async c => {
        await ensureTables(c);
        await c.query("INSERT INTO ps_state (id, data) VALUES ('state', $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()", [JSON.stringify(state)]);
      });
      lastStorageError = null;
      return;
    } catch (e) { lastStorageError = String(e.message || e).slice(0, 160); }
  }
  const tmp = path.join(DATA, FILE + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, path.join(DATA, FILE));
}

/* ---------- email ---------- */
const hasSMTP = () => !!process.env.SMTP_HOST, hasResend = () => !!process.env.RESEND_API_KEY;
async function sendMail(to, subject, text, html) {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  if (!from) throw new Error('Set MAIL_FROM (the address emails are sent from).');
  const list = Array.isArray(to) ? to : [to];
  if (hasResend()) {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: list, subject, text, html }) });
    if (!r.ok) throw new Error('Resend rejected the message: ' + (await r.text()).slice(0, 200));
    return;
  }
  if (!hasSMTP()) throw new Error('No email provider configured. Set SMTP_HOST/SMTP_USER/SMTP_PASS or RESEND_API_KEY on the server.');
  const port = +process.env.SMTP_PORT || 587;
  const tx = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465, auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
  await tx.sendMail({ from, to: list.join(','), subject, text, html });
}
async function postWebhook(text) {
  const u = state.settings.webhook; if (!u) return false;
  const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!r.ok) throw new Error('Webhook returned ' + r.status);
  return true;
}
const publicUrl = req => process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || (process.env.RAILWAY_PUBLIC_DOMAIN && 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN) || (req && (req.protocol + '://' + req.get('host'))) || '';

async function sendDigest(link) {
  const S = state.settings, t = PS.todayISO(S.timezone), sent = [];
  const d = PS.buildDigest(state.db, S, t, { link });
  if (S.recipients.length) { await sendMail(S.recipients, d.subject, d.text, d.html); sent.push(...S.recipients); }
  if (S.notifyOwners) {
    const owners = [...new Set(state.db.act.filter(a => a.ownerEmail && a.status !== 'Closed').map(a => a.ownerEmail.toLowerCase()))];
    for (const o of owners) { if (S.recipients.map(x => x.toLowerCase()).includes(o)) continue; const od = PS.buildDigest(state.db, S, t, { link, ownerEmail: o }); if (od.count) { await sendMail(o, od.subject, od.text, od.html); sent.push(o); } }
  }
  const hook = await postWebhook(d.subject + '\n\n' + d.text);
  if (!sent.length && !hook) throw new Error('Add at least one recipient (or a webhook) in Settings first.');
  return { sent, webhook: hook, subject: d.subject };
}
async function instantAlert(subject, line) {
  const S = state.settings; if (!S.instantAlerts || !S.recipients.length || !(hasSMTP() || hasResend())) return;
  try { await sendMail(S.recipients, `[${S.project}] ${subject}`, line, `<p style="font-family:Arial,sans-serif">${PS.esc(line)}</p>`); } catch (e) { console.error('instant alert failed:', e.message); }
}
const hourIn = tz => { try { return +new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()) % 24; } catch (e) { return new Date().getHours(); } };

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => { res.set({ 'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'X-Content-Type-Options': 'nosniff' }); if (req.method === 'OPTIONS') return res.sendStatus(204); next(); });
app.use(express.json({ limit: '12mb' }));

const PW = process.env.APP_PASSWORD || '';
const TOKEN = PW ? crypto.createHash('sha256').update(PW + '|ps-tracker').digest('hex') : '';
const attempts = new Map();
const guard = (req, res, next) => {
  if (!PW) return next();
  const t = (req.get('Authorization') || '').replace(/^Bearer /, '') || req.query.token || '';
  if (t.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(TOKEN))) return next();
  res.status(401).json({ error: 'Sign in required' });
};

app.get('/api/health', (req, res) => res.json({ app: 'ps-tracker', ok: true, auth: !!PW, email: { smtp: hasSMTP(), resend: hasResend() }, storage: { onNetlify: ON_NETLIFY, error: lastStorageError, hasDbEnv: !!process.env.DATABASE_URL, envKeys: Object.keys(process.env).filter(k => /^(DATABASE_URL|APP_SECRET|ADMIN_KEY|CRON_SECRET|APP_URL|SITE_ID|NETLIFY|SEED_DEMO|PUBLIC_URL)/.test(k)).join(",") } }));
app.post('/api/login', (req, res) => {
  const ip = req.ip, now = Date.now(), a = (attempts.get(ip) || []).filter(x => now - x < 60000);
  if (a.length >= 10) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
  a.push(now); attempts.set(ip, a);
  if (!PW || req.body.password === PW) return res.json({ token: TOKEN });
  res.status(401).json({ error: 'Wrong password' });
});

app.use('/api', (req, res, next) => (req.path === '/health' || req.path === '/login') ? next() : guard(req, res, next));
app.get('/api/state', (req, res) => res.json({ db: state.db, settings: state.settings, rev: state.rev }));
app.put('/api/settings', async (req, res) => { await stateReady; state.settings = Object.assign({}, PS.DEFAULT_SETTINGS, req.body); await save(); res.json({ rev: state.rev }); });
app.post('/api/import', async (req, res) => {
  const { db, settings } = req.body || {}; if (!db) return res.status(400).json({ error: 'Missing data' });
  state.db = {}; COLS.forEach(c => state.db[c] = Array.isArray(db[c]) ? db[c] : []);
  if (settings) state.settings = Object.assign({}, PS.DEFAULT_SETTINGS, settings);
  await save(); res.json({ rev: state.rev });
});

/* documents — Postgres (DATABASE_URL) or local disk */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
app.post('/api/docs', async (req, res) => {
  try {
    await stateReady;
    await upload.single('file')(req, res, async err => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is over 25 MB.' : err.message });
      if (!req.file) return res.status(400).json({ error: 'No file received' });
      const id = crypto.randomBytes(10).toString('hex');
      const ext = path.extname(req.file.originalname).replace(/[^.w]/g, '').slice(0, 8);
      if (hasDb()) {
        await withDb(async c => {
          await ensureTables(c);
          await c.query('INSERT INTO ps_uploads (id, name, mime, bytes) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, mime = EXCLUDED.mime, bytes = EXCLUDED.bytes', [id, req.file.originalname, req.file.mimetype, req.file.buffer]);
        });
      } else {
        fs.writeFileSync(path.join(UP, id + ext), req.file.buffer);
      }
      res.json({ id, name: req.file.originalname, size: req.file.size, type: req.file.mimetype });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
const findDocRow = async id => {
  if (!/^[a-f0-9]+$/.test(id)) return null;
  if (hasDb()) {
    try { return await withDb(async c => (await c.query('SELECT id, name, mime, bytes FROM ps_uploads WHERE id = $1', [id])).rows[0] || null); }
    catch (e) { lastStorageError = String(e.message || e).slice(0, 160); return null; }
  }
  const f = fs.readdirSync(UP).find(f => f.split('.')[0] === id);
  return f ? { id, diskPath: path.join(UP, f) } : null;
};
app.get('/api/docs/:id/:name', async (req, res) => {
  const row = await findDocRow(req.params.id);
  if (!row) return res.status(404).send('File not found');
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(req.params.name)}`);
  if (hasDb()) return res.send(row.bytes);
  res.sendFile(row.diskPath);
});
app.delete('/api/docs/:id', async (req, res) => {
  const row = await findDocRow(req.params.id);
  if (row && hasDb()) { try { await withDb(async c => { await c.query('DELETE FROM ps_uploads WHERE id = ', [req.params.id]); }); } catch {} }
  if (row && !hasDb()) fs.unlinkSync(row.diskPath);
  res.sendStatus(204);
});

/* email */
app.post('/api/email/test', async (req, res) => {
  try { await stateReady; const S = state.settings; if (!S.recipients.length) throw new Error('Add at least one recipient first.');
    await sendMail(S.recipients, `[Test] ${S.project}`, 'This is a test message from your Process Safety Tracker. Notifications are working.', '<p style="font-family:Arial,sans-serif">This is a test message from your Process Safety Tracker. <b>Notifications are working.</b></p>');
    res.json({ message: 'Test email sent to ' + S.recipients.join(', ') }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/email/digest', async (req, res) => {
  try { await stateReady; const r = await sendDigest((req.body && req.body.link) || publicUrl(req)); res.json({ message: `Digest sent to ${r.sent.length} recipient${r.sent.length === 1 ? '' : 's'}${r.webhook ? ' and webhook' : ''}` }); } catch (e) { res.status(400).json({ error: e.message }); }
});

/* records */
app.put('/api/:col/:id', async (req, res) => {
  try {
    await stateReady;
    const { col, id } = req.params; if (!COLS.includes(col)) return res.sendStatus(404);
    const rec = Object.assign({}, req.body, { id }), arr = state.db[col], i = arr.findIndex(r => r.id === id), prev = i >= 0 ? arr[i] : null;
    if (i >= 0) arr[i] = rec; else arr.push(rec);
    if (col === 'log' && arr.length > 500) arr.splice(0, arr.length - 500);
    await save(); res.json({ rev: state.rev });
    if (col === 'act' && !prev && rec.risk === 'H' && rec.status !== 'Closed') instantAlert('New high-risk action: ' + rec.tag, `A high-risk action was added for ${rec.tag}: ${rec.desc}. Owner: ${rec.owner || 'unassigned'}. Target: ${PS.fmtDate(rec.target)}.`);
    if (col === 'insp' && rec.result === 'Fail' && (!prev || prev.result !== 'Fail')) instantAlert('Test failed: ' + rec.tag, `${rec.tag} (${rec.type}) failed its last test. Raise a defect and confirm compensating measures.`);
    if (col === 'ovr' && !prev && rec.risk !== 'Yes' && rec.status !== 'Closed') instantAlert('Override without risk assessment: ' + rec.tag, `An override on ${rec.tag} was recorded without a risk assessment.`);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/:col/:id', async (req, res) => {
  try {
    await stateReady;
    const { col, id } = req.params; if (!COLS.includes(col)) return res.sendStatus(404);
    state.db[col] = state.db[col].filter(r => r.id !== id); await save(); res.json({ rev: state.rev });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '5m' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* startup: persistent servers listen + run the digest timer; on Netlify the
   serverless-http wrapper (netlify/functions/server.js) exposes the app and
   the daily digest runs from a scheduled function instead */
const stateReady = load(); stateReady.catch(e => console.error('state init failed:', e.message));
if (!ON_NETLIFY) {
  stateReady.then(() => {
    setInterval(async () => {
      const S = state.settings; if (!S.digestEnabled || !(S.recipients.length || S.webhook) || !(hasSMTP() || hasResend() || S.webhook)) return;
      const t = PS.todayISO(S.timezone); if (state.lastDigest === t || hourIn(S.timezone) !== +S.digestHour) return;
      state.lastDigest = t; await save();
      try { const r = await sendDigest(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ''); console.log('Daily digest sent to', r.sent.join(', ')); } catch (e) { console.error('Daily digest failed:', e.message); }
    }, 5 * 60 * 1000);
    app.listen(PORT, '0.0.0.0', () => console.log(`Process Safety Tracker running on port ${PORT}${PW ? ' (password protected)' : ' (no password set: set APP_PASSWORD)'}`));
  });
}

module.exports = { app, stateReady, TOKEN };
