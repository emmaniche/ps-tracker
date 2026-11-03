/* Process Safety Tracker – tiny Node server (Express).
   Stores data in a Postgres database (Neon free tier is fine) or, without DATABASE_URL, in local JSON files.
   Sends email, runs the daily digest.
   Environment variables:
     PORT, DATA_DIR (file mode only), DATABASE_URL (durable mode), APP_PASSWORD, PUBLIC_URL, CORS_ORIGIN, SEED_DEMO=false
     SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, MAIL_FROM   (any SMTP provider)
     RESEND_API_KEY, MAIL_FROM                                           (or Resend)            */
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PS = require('./public/shared.js');

const PORT = process.env.PORT || 3000;
const DBURL = process.env.DATABASE_URL || '';
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');

/* ---------- durable storage: Postgres when DATABASE_URL is set, local files otherwise ---------- */
let pool = null;
if (DBURL) pool = new (require('pg').Pool)({ connectionString: DBURL, ssl: { rejectUnauthorized: false } });

let state;
const COLS = ['sce', 'insp', 'ovr', 'act', 'kpi', 'log'];

/* file mode */
const FILE = path.join(DATA, 'state.json');
const UP = path.join(DATA, 'uploads');

function freshState() {
  const demo = process.env.SEED_DEMO !== 'false';
  return { rev: 1, lastDigest: '', db: demo ? PS.seed(PS.todayISO(PS.DEFAULT_SETTINGS.timezone)) : { sce: [], insp: [], ovr: [], act: [], kpi: [], log: [] }, settings: Object.assign({}, PS.DEFAULT_SETTINGS, { demo }) };
}
function normalize() { COLS.forEach(c => { state.db[c] = state.db[c] || []; }); }

/* write chain: serializes async DB saves so a burst of requests can't race or lose the last write */
let chain = Promise.resolve();
function pgSave() {
  state.rev++;
  const snap = JSON.stringify(state);
  chain = chain.then(() => pool.query(`INSERT INTO app_state (k, v) VALUES ('state', $1::jsonb) ON CONFLICT (k) DO UPDATE SET v = $1::jsonb`, [snap]))
    .catch(e => console.error('state save failed:', e.message));
  return chain;
}

async function load() {
  if (pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS app_state (k text PRIMARY KEY, v jsonb NOT NULL)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS docs_store (id text PRIMARY KEY, name text, size int, mime text, data bytea NOT NULL, created timestamptz DEFAULT now())`);
    const { rows } = await pool.query(`SELECT v FROM app_state WHERE k = 'state'`);
    state = rows.length ? rows[0].v : freshState();
    if (!rows.length) await pgSave();
  } else {
    fs.mkdirSync(UP, { recursive: true });
    try { state = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { state = null; }
    if (!state) { state = freshState(); saveF(); }
  }
  normalize();
}
function saveF() { state.rev++; const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(state)); fs.renameSync(tmp, FILE); }
const save = () => pool ? pgSave() : saveF();

/* document store: Neon Object Storage (S3) when AWS_* is set, else Postgres bytea, else local files */
const reqId = () => crypto.randomBytes(10).toString('hex');
const BUCKET = process.env.S3_BUCKET || 'docs';
const hasS3 = () => !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_ENDPOINT_URL_S3);

function fsDocStore() {
  const findDoc = id => /^[a-f0-9]+$/.test(id) ? fs.readdirSync(UP).find(f => f.split('.')[0] === id) : null;
  return {
    multer: multer({ storage: multer.diskStorage({ destination: UP, filename: (req, file, cb) => cb(null, crypto.randomBytes(10).toString('hex') + path.extname(file.originalname).replace(/[^.\w]/g, '').slice(0, 8)) }), limits: { fileSize: 25 * 1024 * 1024 } }),
    async putDoc(file) { return { id: file.filename.split('.')[0], name: file.originalname, size: file.size, type: file.mimetype }; },
    async getDoc(id) { const f = findDoc(id); return f ? { mime: 'application/octet-stream', data: fs.readFileSync(path.join(UP, f)) } : null; },
    async delDoc(id) { const f = findDoc(id); if (f) fs.unlinkSync(path.join(UP, f)); },
    async prune(_keep) { /* import keeps referenced files under their own ids; nothing to prune here */ },
  };
}
function pgDocStore() {
  return {
    multer: multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }),
    async putDoc(file) {
      const id = reqId();
      await pool.query(`INSERT INTO docs_store (id, name, size, mime, data) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, size=EXCLUDED.size, mime=EXCLUDED.mime, data=EXCLUDED.data`, [id, file.originalname, file.size, file.mimetype, file.buffer]);
      return { id, name: file.originalname, size: file.size, type: file.mimetype };
    },
    async getDoc(id) {
      if (!/^[a-f0-9]+$/.test(id)) return null;
      const { rows } = await pool.query(`SELECT mime, data FROM docs_store WHERE id = $1`, [id]);
      return rows.length ? { mime: rows[0].mime || 'application/octet-stream', data: rows[0].data } : null;
    },
    async delDoc(id) { await pool.query(`DELETE FROM docs_store WHERE id = $1`, [id]); },
    async prune(keep) { await pool.query(`DELETE FROM docs_store WHERE NOT (id = ANY($1))`, [[...keep]]); },
  };
}
function s3DocStore() {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY },
  });
  return {
    multer: multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }),
    async putDoc(file) {
      const id = reqId();
      await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: id, Body: file.buffer, ContentType: file.mimetype || 'application/octet-stream' }));
      return { id, name: file.originalname, size: file.size, type: file.mimetype };
    },
    async getDoc(id) {
      if (!/^[a-f0-9]+$/.test(id)) return null;
      try {
        const r = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: id }));
        return { mime: r.ContentType || 'application/octet-stream', data: Buffer.from(await r.Body.transformToByteArray()) };
      } catch (e) {
        if (e.name === 'NoSuchKey' || e.$metadata && e.$metadata.httpStatusCode === 404) return null;
        throw e;
      }
    },
    async delDoc(id) {
      if (!/^[a-f0-9]+$/.test(id)) return;
      await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: id })).catch(() => {});
    },
    async prune(keep) {
      const keepSet = new Set(keep); let token;
      do {
        const r = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }));
        for (const o of r.Contents || []) if (!keepSet.has(o.Key)) await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: o.Key }));
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
    },
  };
}
const store = hasS3() ? s3DocStore() : pool ? pgDocStore() : fsDocStore();

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
setInterval(async () => {
  const S = state.settings; if (!S.digestEnabled || !(S.recipients.length || S.webhook) || !(hasSMTP() || hasResend() || S.webhook)) return;
  const t = PS.todayISO(S.timezone); if (state.lastDigest === t || hourIn(S.timezone) < +S.digestHour) return;
  state.lastDigest = t; save();
  try { const r = await sendDigest(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ''); console.log('Daily digest sent to', r.sent.join(', ')); } catch (e) { console.error('Daily digest failed:', e.message); }
}, 5 * 60 * 1000);

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

app.get('/api/health', (req, res) => res.json({ app: 'ps-tracker', ok: true, auth: !!PW, durable: !!pool, storage: { state: pool ? 'postgres' : 'files', docs: hasS3() ? 'object-storage' : pool ? 'postgres' : 'files' }, email: { smtp: hasSMTP(), resend: hasResend() } }));
app.post('/api/login', (req, res) => {
  const ip = req.ip, now = Date.now(), a = (attempts.get(ip) || []).filter(x => now - x < 60000);
  if (a.length >= 10) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
  a.push(now); attempts.set(ip, a);
  if (!PW || req.body.password === PW) return res.json({ token: TOKEN });
  res.status(401).json({ error: 'Wrong password' });
});

app.use('/api', (req, res, next) => (req.path === '/health' || req.path === '/login') ? next() : guard(req, res, next));
app.get('/api/state', (req, res) => res.json({ db: state.db, settings: state.settings, rev: state.rev }));
app.put('/api/settings', (req, res) => { state.settings = Object.assign({}, PS.DEFAULT_SETTINGS, req.body); save(); res.json({ rev: state.rev }); });
app.post('/api/import', async (req, res) => {
  const { db, settings } = req.body || {}; if (!db) return res.status(400).json({ error: 'Missing data' });
  const keep = new Set(); COLS.forEach(c => (db[c] || []).forEach(r => (r.docs || []).forEach(d => d.kind === 'file' && keep.add(d.id))));
  if (pool) { state.db = {}; COLS.forEach(c => state.db[c] = Array.isArray(db[c]) ? db[c] : []); if (settings) state.settings = Object.assign({}, PS.DEFAULT_SETTINGS, settings); await store.prune([...keep]); }
  else {
    state.db = {}; COLS.forEach(c => state.db[c] = Array.isArray(db[c]) ? db[c] : []);
    if (settings) state.settings = Object.assign({}, PS.DEFAULT_SETTINGS, settings);
    fs.readdirSync(UP).forEach(f => { if (!keep.has(f.split('.')[0])) fs.unlink(path.join(UP, f), () => {}); });
  }
  save(); res.json({ rev: state.rev });
});

/* documents */
app.post('/api/docs', (req, res) => store.multer.single('file')(req, res, async err => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is over 25 MB.' : err.message });
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  try { res.json(await store.putDoc(req.file)); }
  catch (e) { console.error('upload failed:', e.message); res.status(500).json({ error: 'Could not store the file. ' + e.message }); }
}));
app.get('/api/docs/:id/:name', async (req, res) => {
  const d = await store.getDoc(req.params.id);
  if (!d) return res.status(404).send('File not found');
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(req.params.name)}`);
  if (d.mime && d.mime !== 'application/octet-stream') res.set('Content-Type', d.mime);
  res.send(d.data);
});
app.delete('/api/docs/:id', async (req, res) => { await store.delDoc(req.params.id); res.sendStatus(204); });

/* email */
app.post('/api/email/test', async (req, res) => {
  try { const S = state.settings; if (!S.recipients.length) throw new Error('Add at least one recipient first.');
    await sendMail(S.recipients, `[Test] ${S.project}`, 'This is a test message from your Process Safety Tracker. Notifications are working.', '<p style="font-family:Arial,sans-serif">This is a test message from your Process Safety Tracker. <b>Notifications are working.</b></p>');
    res.json({ message: 'Test email sent to ' + S.recipients.join(', ') }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/email/digest', async (req, res) => {
  try { const r = await sendDigest((req.body && req.body.link) || publicUrl(req)); res.json({ message: `Digest sent to ${r.sent.length} recipient${r.sent.length === 1 ? '' : 's'}${r.webhook ? ' and webhook' : ''}` }); } catch (e) { res.status(400).json({ error: e.message }); }
});

/* records */
app.put('/api/:col/:id', (req, res) => {
  const { col, id } = req.params; if (!COLS.includes(col)) return res.sendStatus(404);
  const rec = Object.assign({}, req.body, { id }), arr = state.db[col], i = arr.findIndex(r => r.id === id), prev = i >= 0 ? arr[i] : null;
  if (i >= 0) arr[i] = rec; else arr.push(rec);
  if (col === 'log' && arr.length > 500) arr.splice(0, arr.length - 500);
  save(); res.json({ rev: state.rev });
  if (col === 'act' && !prev && rec.risk === 'H' && rec.status !== 'Closed') instantAlert('New high-risk action: ' + rec.tag, `A high-risk action was added for ${rec.tag}: ${rec.desc}. Owner: ${rec.owner || 'unassigned'}. Target: ${PS.fmtDate(rec.target)}.`);
  if (col === 'insp' && rec.result === 'Fail' && (!prev || prev.result !== 'Fail')) instantAlert('Test failed: ' + rec.tag, `${rec.tag} (${rec.type}) failed its last test. Raise a defect and confirm compensating measures.`);
  if (col === 'ovr' && !prev && rec.risk !== 'Yes' && rec.status !== 'Closed') instantAlert('Override without risk assessment: ' + rec.tag, `An override on ${rec.tag} was recorded without a risk assessment.`);
});
app.delete('/api/:col/:id', (req, res) => {
  const { col, id } = req.params; if (!COLS.includes(col)) return res.sendStatus(404);
  state.db[col] = state.db[col].filter(r => r.id !== id); save(); res.json({ rev: state.rev });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '5m' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

(async () => { await load(); app.listen(PORT, '0.0.0.0', () => console.log(`Process Safety Tracker running on port ${PORT} (storage: ${pool ? 'Postgres – durable' : 'local files'})${PW ? ' (password protected)' : ' (no password set: set APP_PASSWORD)'}`)); })();
