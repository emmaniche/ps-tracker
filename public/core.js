/* Core: state, storage (static IndexedDB or Node server), UI helpers, charts */
window.APP = (function () {
  const P = PS, esc = P.esc;
  const cfg = window.APP_CONFIG || {};
  const base = (cfg.apiBase || '').replace(/\/$/, '');
  const clone = o => JSON.parse(JSON.stringify(o));
  const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };

  const S = {
    db: { sce: [], insp: [], ovr: [], act: [], kpi: [], log: [] },
    settings: clone(P.DEFAULT_SETTINGS), mode: 'static', info: {}, rev: 0,
    view: 'dashboard', user: lsGet('ps_user'), t: P.todayISO(), sort: {}, flt: {}, q: {}, asset: '', drawer: null, sm: null, tl: { months: 6, types: { insp: 1, ovr: 1, act: 1 }, q: '' }
  };

  /* ---------- icons ---------- */
  const I = {
    dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
    time: '<path d="M3 5h9M3 12h14M3 19h7"/><circle cx="16" cy="5" r="2"/><circle cx="21" cy="19" r="2"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    check: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 3h6v3H9z"/><path d="m8.5 13 2.5 2.5L16 10.5"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
    chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="m8 15 3-4 3 2 5-6"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    down: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>', up: '<path d="M12 20V9m0 0-4 4m4-4 4 4M5 4h14"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
    clip: '<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>', menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    print: '<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4"/>', send: '<path d="m21 3-9.5 18-2.5-8L1 10.5z"/><path d="M21 3 9 13"/>'
  };
  const ic = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n] || ''}</svg>`;

  /* ---------- IndexedDB (static mode) ---------- */
  let _db;
  const idbOpen = () => _db || (_db = new Promise((res, rej) => {
    const r = indexedDB.open('ps-tracker', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('blobs'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const idb = async (store, mode, fn) => { const d = await idbOpen(); return new Promise((res, rej) => { const tx = d.transaction(store, mode); const rq = fn(tx.objectStore(store)); tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error); }); };
  const kvGet = k => idb('kv', 'readonly', s => s.get(k));
  const kvPut = (k, v) => idb('kv', 'readwrite', s => s.put(v, k));
  const blobGet = k => idb('blobs', 'readonly', s => s.get(k));
  const blobPut = (k, v) => idb('blobs', 'readwrite', s => s.put(v, k));
  const blobDel = k => idb('blobs', 'readwrite', s => s.delete(k));

  /* ---------- server API ---------- */
  let token = lsGet('ps_token');
  async function req(method, path, body, form) {
    const h = {}; if (token) h.Authorization = 'Bearer ' + token;
    if (body && !form) h['Content-Type'] = 'application/json';
    const r = await fetch(base + '/api' + path, { method, headers: h, body: form ? body : body ? JSON.stringify(body) : undefined });
    if (r.status === 401) throw { auth: true };
    if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch (e) { /* not json */ } throw new Error(m || r.statusText); }
    return r.status === 204 ? null : r.json();
  }
  const mergeSettings = s => { const d = clone(P.DEFAULT_SETTINGS); s = s || {}; return Object.assign(d, s, { rules: Object.assign(d.rules, s.rules || {}), emailjs: Object.assign(d.emailjs, s.emailjs || {}) }); };

  async function detect() {
    try {
      const c = new AbortController(); const to = setTimeout(() => c.abort(), 2500);
      const r = await fetch(base + '/api/health', { signal: c.signal }); clearTimeout(to);
      if (r.ok) { const j = await r.json(); if (j && j.app === 'ps-tracker') { S.mode = 'server'; S.info = j; return; } }
    } catch (e) { /* static host */ }
    S.mode = 'static';
  }
  async function load() {
    if (S.mode === 'server') {
      const j = await req('GET', '/state');
      S.db = Object.assign({ sce: [], insp: [], ovr: [], act: [], kpi: [], log: [] }, j.db); S.settings = mergeSettings(j.settings); S.rev = j.rev;
    } else {
      const db = await kvGet('db'), st = await kvGet('settings');
      if (db) { S.db = Object.assign({ sce: [], insp: [], ovr: [], act: [], kpi: [], log: [] }, db); S.settings = mergeSettings(st); }
      else { S.db = P.seed(S.t); S.settings = mergeSettings(Object.assign({}, st, { demo: true })); await persistLocal(); }
    }
    if (S.mode === 'server' && !S.db.sce.length && !S.db.insp.length && !S.settings.demo && !S.settings.seeded) { /* fresh server */ }
  }
  const persistLocal = async () => { await kvPut('db', S.db); await kvPut('settings', S.settings); };

  async function upsert(col, rec) {
    const clean = Object.assign({}, rec); delete clean._new;
    const arr = S.db[col]; const i = arr.findIndex(r => r.id === clean.id);
    if (i >= 0) arr[i] = clean; else arr.push(clean);
    if (S.mode === 'server') { const j = await req('PUT', `/${col}/${clean.id}`, clean); if (j && j.rev) S.rev = j.rev; }
    else { if (col === 'log' && arr.length > 400) arr.splice(0, arr.length - 400); await persistLocal(); }
  }
  async function remove(col, id) {
    S.db[col] = S.db[col].filter(r => r.id !== id);
    if (S.mode === 'server') { const j = await req('DELETE', `/${col}/${id}`); if (j && j.rev) S.rev = j.rev; } else await persistLocal();
  }
  async function saveSettings() {
    if (S.mode === 'server') { const j = await req('PUT', '/settings', S.settings); if (j && j.rev) S.rev = j.rev; } else await persistLocal();
  }
  async function replaceAll(db, settings) {
    S.db = Object.assign({ sce: [], insp: [], ovr: [], act: [], kpi: [], log: [] }, db); if (settings) S.settings = mergeSettings(settings);
    if (S.mode === 'server') { const j = await req('POST', '/import', { db: S.db, settings: S.settings }); if (j && j.rev) S.rev = j.rev; } else await persistLocal();
  }
  function logEvent(action, col, rec, label) {
    const e = { id: P.uid(), ts: new Date().toISOString(), by: S.user || 'User', action, col, rid: rec && rec.id, label: label || (rec && (rec.tag || rec.month || rec.asset)) || '' };
    return upsert('log', e).catch(() => {});
  }

  /* documents */
  async function addFile(file) {
    const meta = { id: P.uid() + P.uid(), kind: 'file', name: file.name, size: file.size, type: file.type || '', added: new Date().toISOString(), by: S.user || 'User' };
    if (S.mode === 'server') {
      const fd = new FormData(); fd.append('file', file, file.name); fd.append('id', meta.id);
      const j = await req('POST', '/docs', fd, true); Object.assign(meta, j);
    } else {
      if (file.size > 25 * 1024 * 1024) throw new Error('File is over 25 MB. Attach a link instead, or deploy in server mode.');
      await blobPut(meta.id, file);
    }
    return meta;
  }
  async function dropFile(meta) {
    if (meta.kind !== 'file') return;
    if (S.mode === 'server') { try { await req('DELETE', '/docs/' + meta.id); } catch (e) { /* already gone */ } } else await blobDel(meta.id);
  }
  async function openDoc(meta) {
    if (meta.kind === 'link') return window.open(meta.url, '_blank', 'noopener');
    if (S.mode === 'server') return window.open(base + '/api/docs/' + meta.id + '/' + encodeURIComponent(meta.name) + (token ? '?token=' + encodeURIComponent(token) : ''), '_blank', 'noopener');
    const b = await blobGet(meta.id); if (!b) return toast('That file is no longer stored in this browser.', true);
    const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.download = /^(image|application\/pdf|text)/.test(b.type) ? '' : meta.name; a.rel = 'noopener'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 60000);
  }

  /* ---------- UI helpers ---------- */
  function toast(msg, err) {
    const el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.setAttribute('role', 'status'); el.textContent = msg;
    document.getElementById('toasts').appendChild(el); setTimeout(() => el.remove(), err ? 6000 : 3200);
  }
  function dialog(html, onMount) {
    return new Promise(res => {
      const d = document.createElement('div'); d.className = 'dlg'; d.innerHTML = `<div class="dlg-b" role="dialog" aria-modal="true">${html}</div>`;
      const close = v => { d.remove(); res(v); };
      d.addEventListener('click', e => { if (e.target === d) close(null); });
      d.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
      document.body.appendChild(d); onMount && onMount(d, close); const f = d.querySelector('input,button.primary,button'); f && f.focus();
    });
  }
  const confirmDlg = (title, msg, ok = 'Confirm', danger) => dialog(`<h3>${esc(title)}</h3><p>${esc(msg)}</p><div class="acts"><button class="btn" data-r="0">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`, (d, close) => d.querySelectorAll('[data-r]').forEach(b => b.onclick = () => close(b.dataset.r === '1')));
  const promptDlg = (title, fields, ok = 'Save', intro = '') => dialog(`<h3>${esc(title)}</h3>${intro ? `<p>${esc(intro)}</p>` : ''}<form style="display:grid;gap:10px">${fields.map(f => `<label class="f"><span>${esc(f.l)}</span><input name="${f.k}" ${f.type ? `type="${f.type}"` : ''} value="${esc(f.v || '')}" placeholder="${esc(f.ph || '')}" ${f.req ? 'required' : ''}></label>`).join('')}<div class="acts" style="margin-top:6px"><button type="button" class="btn" data-r="0">Cancel</button><button class="btn primary">${esc(ok)}</button></div></form>`, (d, close) => {
    d.querySelector('[data-r]').onclick = () => close(null);
    d.querySelector('form').onsubmit = e => { e.preventDefault(); close(Object.fromEntries(new FormData(e.target))); };
  });

  /* ---------- charts ---------- */
  function donut(segs, centre, sub) {
    const tot = segs.reduce((a, s) => a + s.v, 0), R = 52, C = 2 * Math.PI * R; let off = 0;
    const arcs = tot ? segs.filter(s => s.v > 0).map(s => { const len = (s.v / tot) * C; const el = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${s.c}" stroke-width="18" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"/>`; off += len; return el; }).join('') : `<circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--grey-bg)" stroke-width="18"/>`;
    return `<div class="donut-wrap"><svg class="chart" viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="${esc(sub || '')}"><g transform="rotate(-90 70 70)">${arcs}</g><text x="70" y="72" text-anchor="middle" style="font-family:var(--display);font-size:32px;font-weight:600;fill:var(--text)">${centre}</text><text x="70" y="90" text-anchor="middle">${esc(sub || '')}</text></svg>
    <div class="donut-legend">${segs.map(s => `<span><i style="background:${s.c}"></i>${esc(s.l)}<b>${s.v}</b></span>`).join('')}</div></div>`;
  }
  function lineChart(labels, series, opts) {
    opts = opts || {}; const W = 640, H = 230, L = 38, Rr = 14, T = 14, B = 30; const max = opts.max || Math.max(10, ...series.flatMap(s => s.data.filter(v => v != null)));
    const x = i => L + (labels.length < 2 ? (W - L - Rr) / 2 : (i * (W - L - Rr)) / (labels.length - 1)), y = v => T + (H - T - B) * (1 - v / max);
    const grid = [0, .25, .5, .75, 1].map(g => `<line x1="${L}" x2="${W - Rr}" y1="${y(max * g)}" y2="${y(max * g)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(max * g) + 4}" text-anchor="end">${Math.round(max * g)}${opts.unit || ''}</text>`).join('');
    const xl = labels.map((l, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`).join('');
    const lines = series.map(s => { const pts = s.data.map((v, i) => v == null ? null : [x(i), y(v)]).filter(Boolean); if (!pts.length) return '';
      return `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${s.c}" stroke-width="2.6" stroke-linejoin="round"/>` + pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.6" fill="${s.c}"><title>${esc(s.name)}: ${s.data.filter(v => v != null)[i]}${opts.unit || ''}</title></circle>`).join(''); }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opts.label || 'Trend chart')}">${grid}${xl}${lines}</svg>
    <div class="legend" style="color:var(--muted);margin-top:4px">${series.map(s => `<span><i style="background:${s.c}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  }
  const hbar = (label, v, max, color) => `<div class="hbar"><span>${esc(label)}</span><div class="bar"><i style="width:${max ? (v / max) * 100 : 0}%;background:${color}"></i></div><b>${v}</b></div>`;
  const segBar = (g, a, r) => { const t = g + a + r || 1; return `<div class="bar" role="img" aria-label="${g} good, ${a} due soon, ${r} overdue"><i class="g" style="width:${g / t * 100}%"></i><i class="a" style="width:${a / t * 100}%"></i><i class="r" style="width:${r / t * 100}%"></i></div>`; };

  function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src + '. Check your internet connection.')); document.head.appendChild(s); }); }
  const download = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };

  return { P, S, esc, clone, ic, I, lsGet, lsSet, req, base, detect, load, upsert, remove, saveSettings, replaceAll, logEvent, addFile, dropFile, openDoc, toast, dialog, confirmDlg, promptDlg, donut, lineChart, hbar, segBar, loadScript, download, mergeSettings, persistLocal, setToken: t => { token = t; lsSet('ps_token', t); }, getToken: () => token };
})();
