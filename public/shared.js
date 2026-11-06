/* Shared logic: runs in the browser AND in Node (server digest emails).
   All dates are ISO strings (YYYY-MM-DD). "t" is today's ISO date. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY = 864e5;
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const parseDT = s => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null; };
  const diffDays = (a, b) => Math.round((a - b) / DAY);
  const addDays = (s, n) => { const d = parse(s); if (!d || n === '' || n == null || isNaN(+n)) return null; d.setDate(d.getDate() + +n); return iso(d); };
  const todayISO = tz => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) { return iso(new Date()); } };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDate = s => { const d = parse(s); return d ? d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() : '—'; };
  const fmtMonth = s => { const d = parse(s); return d ? MON[d.getMonth()] + ' ' + d.getFullYear() : '—'; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

  const DEFAULT_SETTINGS = {
    project: 'OML 11 JV Process Safety Tracker', client: '', org: '', bidRef: '', location: 'OML 11, Niger Delta', logo: '', timezone: 'Africa/Lagos',
    soonDays: 30,
    recipients: [], notifyOwners: false,
    rules: { overdueInspections: true, dueSoon: true, expiredOverrides: true, overdueActions: true, failedTests: true, overrideMaxHours: 72 },
    digestEnabled: true, digestHour: 7, instantAlerts: true,
    emailjs: { serviceId: '', templateId: '', publicKey: '' }, webhook: '',
    locations: ['Okoloma Gas Plant', 'Imo River', 'Bonny', 'Kidney Island', 'Isimiri', 'Okoloma Drilling Site', 'Imo River Drilling Sites', 'Rigs', 'Oloma'],
    signoff: true, offlineMode: true,
    demo: false
  };

  /* ---------- sign-off rules (shared by the browser and the API) ----------
     Returns a list of {k, m}: k is the field to blame, m is the message.

     Auto sign-off: the server stamps signedOff/signedBy/signedAt itself.
     Once a record is signed off, its critical fields lock until a reason
     is supplied to reopen it. */
  const LOCKED = {
    insp: ['result', 'last'],
    ovr: ['status', 'start', 'end', 'type'],
    act: ['status', 'progress', 'corrective', 'owner']
  };
  const LOCKED_MSG = {
    insp: 'This inspection is signed off. Give a reason to reopen it before changing the result or test date.',
    ovr: 'This override has been signed off. A reason is required to reopen it.',
    act: 'This action is signed off. A reason is required to reopen it.'
  };

  function stampRecord(col, rec, before, by, now) {
    const ts = now || new Date().toISOString();
    if (before && before.signedOff && !String(rec.reopenReason || '').trim()) {
      rec.signedOff = before.signedOff; rec.signedBy = before.signedBy; rec.signedAt = before.signedAt; delete rec.reopenReason;
      return rec;
    }
    if (before && before.signedOff && String(rec.reopenReason || '').trim()) { delete rec.signedOff; delete rec.signedBy; delete rec.signedAt; return rec; }
    if (col === 'ovr' && rec.status === 'Closed') { rec.signedOff = true; rec.signedBy = by || rec.signedBy || ''; rec.signedAt = ts; delete rec.reopenReason; }
    if (col === 'act' && rec.status === 'Closed') { rec.signedOff = true; rec.signedBy = by || rec.signedBy || ''; rec.signedAt = ts; delete rec.reopenReason; }
    if (col === 'insp' && (rec.result === 'Pass' || rec.result === 'Conditional' || rec.result === 'Fail') && String(rec.auth || '').trim() && !rec.signedOff) { rec.signedOff = true; rec.signedBy = by || ''; rec.signedAt = ts; delete rec.reopenReason; }
    return rec;
  }

  function signoffIssues(col, rec, before, settings) {
    const s = settings || {}, out = [];
    if (s.signoff === false) return out;
    const changed = k => !before || JSON.stringify(before[k] == null ? '' : before[k]) !== JSON.stringify(rec[k] == null ? '' : rec[k]);

    if (col === 'insp') {
      const touched = !before || changed('result') || changed('last') || changed('freq');
      if (touched && !String(rec.auth || '').trim())
        out.push({ k: 'auth', m: 'Record who verified this test (verification authority) before saving the result.' });
      if (before && before.signedOff && (changed('result') || changed('last')) && !String(rec.reopenReason || '').trim())
        out.push({ k: 'reopenReason', m: LOCKED_MSG.insp });
    }

    if (col === 'ovr') {
      const locked = LOCKED.ovr;
      if (before && before.signedOff && locked.some(changed) && !String(rec.reopenReason || '').trim())
        out.push({ k: 'reopenReason', m: LOCKED_MSG.ovr });
      if (rec.status !== 'Closed') {
        const touched = !before || before.status === 'Closed' || changed('status') || changed('start') || changed('end') || changed('risk');
        if (touched) {
          if (String(rec.risk) !== 'Yes') out.push({ k: 'risk', m: 'A risk assessment must be recorded before an override can be open.' });
          if (!String(rec.approver || '').trim()) out.push({ k: 'approver', m: 'Record who approved this override.' });
          if (!String(rec.comp || '').trim()) out.push({ k: 'comp', m: 'Describe the compensating measure in place.' });
          const a = parseDT(rec.start), b = parseDT(rec.end);
          if (a && b && b <= a) out.push({ k: 'end', m: 'The end time must be after the start time.' });
        }
      }
    }

    if (col === 'act') {
      const locked = LOCKED.act;
      if (before && before.signedOff && locked.some(changed) && !String(rec.reopenReason || '').trim())
        out.push({ k: 'reopenReason', m: LOCKED_MSG.act });
      if (rec.status === 'Closed') {
        const closing = !before || before.status !== 'Closed';
        if (+rec.progress !== 100) out.push({ k: 'progress', m: 'Set progress to 100% before closing the action.' });
        if (closing && !String(rec.notes || '').trim()) out.push({ k: 'notes', m: 'Add a closure note (evidence or reference) before closing.' });
      }
    }
    return out;
  }

  /* Field-level difference between two records, used by the audit trail. */
  function diffRecords(a, b) {
    const skip = new Set(['updatedAt', 'updatedBy', 'reopenReason', '_new']);
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    const out = [];
    keys.forEach(k => {
      if (skip.has(k)) return;
      const av = a ? a[k] : undefined, bv = b ? b[k] : undefined;
      if (JSON.stringify(av) !== JSON.stringify(bv)) out.push({ k, from: av === undefined ? null : av, to: bv === undefined ? null : bv });
    });
    return out;
  }

  /* ---------- per-record status ---------- */
  function activeTags(db) { const s = new Set(); (db.sce || []).forEach(x => { if (x.status !== 'Retired') s.add(x.tag); }); return s; }

  /* ---------- locations ----------
     A site is the physical location (Okoloma Gas Plant, Bonny, ...). SCE rows carry
     it directly; inspections, overrides and actions inherit it from their tag, so the
     location is only ever stored once. */
  function siteMap(db) {
    const m = {};
    (db.sce || []).forEach(s => { if (s.tag) m[s.tag] = s.site || ''; });
    return m;
  }
  function siteOf(rec, map, db) {
    if (!rec) return '';
    const m = map || siteMap(db || { sce: [] });
    return (rec.tag && m[rec.tag]) || rec.site || '';
  }
  function scopeDb(db, site) {
    if (!site) return db;
    const map = siteMap(db), keep = r => siteOf(r, map, db) === site;
    return {
      sce: (db.sce || []).filter(keep),
      insp: (db.insp || []).filter(keep),
      ovr: (db.ovr || []).filter(keep),
      act: (db.act || []).filter(keep),
      kpi: (db.kpi || []).filter(r => (r.site || '') === site),
      log: db.log || [],
      /* reference layers: hazards, barriers and activities carry their own site;
         positions and the SCE catalogue are estate-wide catalogues */
      sca: (db.sca || []).filter(r => (r.site || '') === site),
      haz: (db.haz || []).filter(r => (r.site || '') === site),
      bar: (db.bar || []).filter(r => (r.site || '') === site),
      pos: db.pos || [],
      sceg: db.sceg || []
    };
  }

  function inspInfo(r, t, soon) {
    const next = addDays(r.last, r.freq);
    if (!next) return { next: null, days: null, state: 'none' };
    const days = diffDays(parse(next), parse(t));
    return { next, days, state: days < 0 ? 'overdue' : days <= soon ? 'soon' : 'ok' };
  }
  function ovrInfo(o, t, maxH) {
    const a = parseDT(o.start), b = parseDT(o.end);
    const hours = a && b ? Math.round(((b - a) / 36e5) * 10) / 10 : null;
    let state = 'active';
    if (o.status === 'Closed') state = 'closed';
    else if (o.end && o.end.slice(0, 10) < t) state = 'expired';
    else if (o.risk !== 'Yes') state = 'norisk';
    else if (maxH && hours != null && hours > maxH) state = 'long';
    return { hours, state };
  }
  function actInfo(a, t) {
    if (a.status === 'Closed') return { state: 'closed', days: null, label: 'Closed' };
    const d = parse(a.target);
    const days = d ? diffDays(d, parse(t)) : null;
    if (days != null && days < 0) return { state: 'overdue', days, label: 'Overdue' };
    return { state: a.status === 'In Progress' ? 'progress' : 'open', days, label: a.status || 'Open' };
  }

  /* ---------- barrier state for each SCE ---------- */
  function sceStates(db, t, soon, maxH) {
    const out = {};
    (db.sce || []).forEach(s => { out[s.id] = { sce: s, level: 'grey', reasons: [], insp: [], ovr: [], act: [] }; });
    const byTag = {}; (db.sce || []).forEach(s => { byTag[s.tag] = out[s.id]; });
    const bump = (e, lvl, why) => { const o = { grey: 0, green: 1, amber: 2, red: 3 }; if (o[lvl] > o[e.level]) e.level = lvl; if (why) e.reasons.push(why); };
    (db.insp || []).forEach(r => { const e = byTag[r.tag]; if (!e) return; e.insp.push(r); if (e.level === 'grey') e.level = 'green';
      const i = inspInfo(r, t, soon);
      if (i.state === 'overdue') bump(e, 'red', `${r.type || 'Test'} overdue by ${-i.days} d`);
      else if (i.state === 'soon') bump(e, 'amber', `${r.type || 'Test'} due in ${i.days} d`);
      if (r.result === 'Fail') bump(e, 'red', `${r.type || 'Test'} failed`);
      else if (r.result === 'Conditional') bump(e, 'amber', `${r.type || 'Test'} conditional pass`);
    });
    (db.ovr || []).forEach(o => { const e = byTag[o.tag]; if (!e) return; e.ovr.push(o); const i = ovrInfo(o, t, maxH);
      if (i.state === 'expired') bump(e, 'red', 'Override past end date');
      else if (i.state === 'norisk') bump(e, 'red', 'Override without risk assessment');
      else if (i.state === 'active' || i.state === 'long') bump(e, 'amber', 'Barrier overridden');
    });
    (db.act || []).forEach(a => { const e = byTag[a.tag]; if (!e) return; e.act.push(a); const i = actInfo(a, t);
      if (i.state === 'overdue') bump(e, a.risk === 'H' ? 'red' : 'amber', 'Action overdue');
      else if (i.state !== 'closed' && a.risk === 'H') bump(e, 'amber', 'High-risk action open');
    });
    return out;
  }

  /* ---------- summary / health index ---------- */
  function summarize(db, settings, t, opts) {
    settings = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const soon = +settings.soonDays || 30, maxH = +(settings.rules || {}).overrideMaxHours || 0;
    const site = (opts && opts.site) || '', full = db;
    if (site) db = scopeDb(full, site);
    const act = activeTags(db), map = siteMap(db);
    const inspAll = (db.insp || []).filter(r => !r.tag || act.has(r.tag) || !(db.sce || []).some(s => s.tag === r.tag));
    const I = { total: inspAll.length, overdue: 0, soon: 0, ok: 0, none: 0, fail: 0, cond: 0, measured: 0 };
    const attention = [], upcoming = [];
    inspAll.forEach(r => { const i = inspInfo(r, t, soon); I[i.state]++; if (i.state !== 'none') I.measured++; if (r.result === 'Fail') I.fail++; if (r.result === 'Conditional') I.cond++;
      if (i.state === 'overdue') attention.push({ type: 'insp', id: r.id, sev: 3, days: i.days, title: `${r.tag || ''} · ${r.type || 'Inspection'}`, sub: `Overdue by ${-i.days} days (was due ${fmtDate(i.next)})`, asset: r.asset, site: siteOf(r, map) });
      if (i.state === 'soon' || (i.state === 'ok' && i.days <= 60)) upcoming.push({ type: 'insp', id: r.id, days: i.days, date: i.next, title: `${r.tag || ''} · ${r.type || 'Inspection'}`, asset: r.asset, site: siteOf(r, map) });
      if (r.result === 'Fail') attention.push({ type: 'insp', id: r.id, sev: 4, days: 0, title: `${r.tag || ''} · ${r.type || 'Test'} FAILED`, sub: 'Last test result is Fail — raise a defect and put compensating measures in place', asset: r.asset, site: siteOf(r, map) });
    });
    I.onTimePct = I.measured ? Math.round(((I.measured - I.overdue) / I.measured) * 100) : null;

    const O = { total: (db.ovr || []).length, open: 0, expired: 0, norisk: 0, long: 0, hours: 0, controlled: 0 };
    (db.ovr || []).forEach(o => { const i = ovrInfo(o, t, maxH); if (i.state === 'closed') return; O.open++; O.hours += i.hours || 0;
      if (i.state === 'expired') { O.expired++; attention.push({ type: 'ovr', id: o.id, sev: 4, days: 0, title: `${o.tag || ''} · ${o.type || 'Override'} expired`, sub: `Ended ${fmtDate(o.end)} but still open — close it out or re-approve`, asset: o.asset, site: siteOf(o, map) }); }
      else if (i.state === 'norisk') { O.norisk++; attention.push({ type: 'ovr', id: o.id, sev: 4, days: 0, title: `${o.tag || ''} · ${o.type || 'Override'} has no risk assessment`, sub: 'An override without a risk assessment is a compliance gap', asset: o.asset, site: siteOf(o, map) }); }
      else { O.controlled++; if (i.state === 'long') { O.long++; attention.push({ type: 'ovr', id: o.id, sev: 2, days: 0, title: `${o.tag || ''} · ${o.type || 'Override'} running long`, sub: `${i.hours} h exceeds the ${maxH} h limit`, asset: o.asset, site: siteOf(o, map) }); } }
    });
    O.controlledPct = O.open ? Math.round((O.controlled / O.open) * 100) : null;

    const A = { total: (db.act || []).length, open: 0, overdue: 0, closed: 0, high: 0, progress: 0 };
    (db.act || []).forEach(a => { const i = actInfo(a, t);
      if (i.state === 'closed') { A.closed++; return; }
      A.open++; if (a.risk === 'H') A.high++; if (i.state === 'progress') A.progress++;
      if (i.state === 'overdue') { A.overdue++; attention.push({ type: 'act', id: a.id, sev: a.risk === 'H' ? 3.5 : 2.5, days: i.days, title: `${a.tag || ''} · ${short(a.corrective || a.desc, 60)}`, sub: `Overdue by ${-i.days} days · owner ${a.owner || 'unassigned'}`, asset: a.asset, site: siteOf(a, map) }); }
      else if (i.days != null && i.days <= 14) upcoming.push({ type: 'act', id: a.id, days: i.days, date: a.target, title: `${a.tag || ''} · ${short(a.corrective || a.desc, 60)}`, asset: a.asset, site: siteOf(a, map) });
    });
    A.closedPct = A.total ? Math.round((A.closed / A.total) * 100) : null;
    A.onTimePct = A.open ? Math.round(((A.open - A.overdue) / A.open) * 100) : null;

    const states = sceStates(db, t, soon, maxH);
    const B = { green: 0, amber: 0, red: 0, grey: 0, total: 0, preventive: 0, mitigative: 0, high: 0 };
    (db.sce || []).forEach(s => { if (s.status === 'Retired') return; B.total++; B[states[s.id].level]++; if (s.barrier === 'Preventive') B.preventive++; if (s.barrier === 'Mitigative') B.mitigative++; if (s.risk === 'H') B.high++; });

    /* Health index: weight redistributes over the components that actually have data,
       so an empty tracker never scores itself 100. No data at all = not assured. */
    const failPen = I.measured ? ((I.fail + I.cond * 0.5) / I.measured) : 0;
    const parts = [];
    if (I.measured > 0) parts.push([I.onTimePct, 0.40]);
    if (A.open > 0) parts.push([A.onTimePct, 0.25]);
    if (O.open > 0) parts.push([O.controlledPct, 0.20]);
    if (I.measured > 0) parts.push([(1 - failPen) * 100, 0.15]);
    let index = null, rating = 'Not assured';
    if (parts.length) {
      const wsum = parts.reduce((a, p) => a + p[1], 0);
      index = Math.max(0, Math.min(100, Math.round(parts.reduce((a, p) => a + p[0] * p[1], 0) / wsum)));
      rating = index >= 90 ? 'Strong' : index >= 75 ? 'Stable' : index >= 60 ? 'Watch' : 'Critical';
    }

    const perAsset = {};
    const slot = n => perAsset[n || '—'] || (perAsset[n || '—'] = { asset: n || '—', sce: 0, red: 0, amber: 0, overdue: 0, openOvr: 0, openAct: 0, linked: 0 });
    (db.sce || []).forEach(s => { if (s.status === 'Retired') return; const p = slot(s.asset); p.sce++; const l = states[s.id].level; if (l === 'red') p.red++; if (l === 'amber') p.amber++; });
    inspAll.forEach(r => { const p = slot(r.asset); p.linked++; if (inspInfo(r, t, soon).state === 'overdue') p.overdue++; });
    (db.ovr || []).forEach(o => { const p = slot(o.asset); p.linked++; if (o.status !== 'Closed') p.openOvr++; });
    (db.act || []).forEach(a => { const p = slot(a.asset); p.linked++; if (a.status !== 'Closed') p.openAct++; });
    Object.values(perAsset).forEach(p => { p.health = (p.sce && p.linked) ? Math.round(((p.sce - p.red - p.amber * 0.4) / p.sce) * 100) : null; });

    attention.sort((a, b) => b.sev - a.sev || (a.days || 0) - (b.days || 0));
    upcoming.sort((a, b) => a.days - b.days);
    /* "empty" = no assurance evidence logged yet (registers may hold SCEs but nothing measured) */
    const empty = (I.total + A.total + O.total) === 0;

    /* one roll-up row per configured location, for the combined report */
    const perSite = [];
    if (!site && (settings.locations || []).length) {
      settings.locations.forEach(loc => {
        const one = summarize(full, settings, t, { site: loc });
        perSite.push({ site: loc, index: one.index, rating: one.rating, empty: one.empty, sce: one.B.total,
          red: one.B.red, amber: one.B.amber, overdue: one.I.overdue, onTimePct: one.I.onTimePct,
          openOvr: one.O.open, openAct: one.A.open, overdueAct: one.A.overdue });
      });
    }
    return { t, site, I, O, A, B, empty, index, rating, attention, upcoming, perAsset: Object.values(perAsset), perSite, states, soon, maxH };
  }
  function short(s, n) { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* ---------- digest (email / webhook text) ---------- */
  function buildDigest(db, settings, t, opts) {
    opts = opts || {};
    const S = Object.assign({}, DEFAULT_SETTINGS, settings || {}), R = S.rules || {};
    const sm = summarize(db, S, t, { site: opts.site });
    let items = sm.attention.filter(x => {
      if (x.type === 'insp') return x.sev === 4 ? R.failedTests !== false : R.overdueInspections !== false;
      if (x.type === 'ovr') return R.expiredOverrides !== false;
      if (x.type === 'act') return R.overdueActions !== false;
      return true; });
    if (opts.ownerEmail) { const mine = new Set((db.act || []).filter(a => (a.ownerEmail || '').toLowerCase() === opts.ownerEmail.toLowerCase()).map(a => a.id)); items = items.filter(x => x.type === 'act' && mine.has(x.id)); }
    const soonItems = R.dueSoon !== false && !opts.ownerEmail ? sm.upcoming.filter(u => u.days >= 0 && u.days <= (+S.soonDays || 30)).slice(0, 15) : [];
    const name = S.project || 'Process Safety Tracker';
    const where = opts.site ? ' · ' + opts.site : '';
    const nIdx = sm.index == null ? '—' : sm.index;
    const subject = `[${name}${where}] ${items.length ? items.length + ' item' + (items.length > 1 ? 's' : '') + ' need attention' : 'All clear'} · Health index ${nIdx} (${sm.rating})`;
    const lines = [`${name}${S.client ? ' — ' + S.client : ''}`, `Report date: ${fmtDate(t)}`, `Location: ${opts.site || 'All locations'}`, '', `Process safety health index: ${sm.index == null ? 'not measurable — no assurance data yet' : sm.index + '/100 (' + sm.rating + ')'}`,
      `Inspections on time: ${sm.I.onTimePct == null ? 'not measured (no tests logged)' : sm.I.onTimePct + '%'}  |  Overdue: ${sm.I.overdue}  |  Due soon: ${sm.I.soon}`,
      `Open overrides: ${sm.O.open}  |  Open actions: ${sm.A.open}  |  Overdue actions: ${sm.A.overdue}`, ''];
    if (items.length) { lines.push('NEEDS ATTENTION'); items.slice(0, 40).forEach(x => lines.push(`• ${x.title} — ${x.sub}`)); lines.push(''); }
    if (soonItems.length) { lines.push('COMING UP'); soonItems.forEach(x => lines.push(`• ${fmtDate(x.date)} (${x.days === 0 ? 'today' : 'in ' + x.days + ' d'}): ${x.title}`)); lines.push(''); }
    const row = (c, a, b) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #e3e8ec"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:8px"></span><b>${esc(a)}</b><br><span style="color:#5b6b75;font-size:13px">${esc(b)}</span></td></tr>`;
    const stat = (v, l, c) => `<td style="padding:12px 14px;background:#f1f4f6;border-radius:8px;text-align:center"><div style="font-size:24px;font-weight:700;color:${c || '#0d2530'}">${v}</div><div style="font-size:12px;color:#5b6b75">${l}</div></td><td width="8"></td>`;
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:auto;color:#0d2530">
<div style="background:#0d2530;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0"><div style="font-size:12px;opacity:.7">${esc([S.client, opts.site].filter(Boolean).join(' · '))}</div><div style="font-size:20px;font-weight:700">${esc(name)}</div><div style="opacity:.75;font-size:13px">${fmtDate(t)}${opts.site ? ' · ' + esc(opts.site) : ''}</div></div>
<div style="border:1px solid #e3e8ec;border-top:0;padding:20px 24px;border-radius:0 0 10px 10px">
<table width="100%" cellspacing="0"><tr>${stat(sm.index == null ? '—' : sm.index, 'Health index · ' + sm.rating, sm.index == null ? '#5b6b75' : sm.index >= 75 ? '#1f9d6b' : sm.index >= 60 ? '#c98200' : '#d6382f')}${stat(sm.I.overdue, 'Overdue inspections', sm.I.overdue ? '#d6382f' : '#1f9d6b')}${stat(sm.O.open, 'Open overrides')}${stat(sm.A.overdue, 'Overdue actions', sm.A.overdue ? '#d6382f' : '#1f9d6b')}</tr></table>
${items.length ? `<h3 style="margin:22px 0 6px;font-size:15px">Needs attention</h3><table width="100%" cellspacing="0">${items.slice(0, 40).map(x => row(x.sev >= 3 ? '#d6382f' : '#f5a100', x.title, x.sub)).join('')}</table>` : '<p style="margin-top:20px">No overdue items. Nice work.</p>'}
${soonItems.length ? `<h3 style="margin:22px 0 6px;font-size:15px">Coming up</h3><table width="100%" cellspacing="0">${soonItems.map(x => row('#14424f', x.title, fmtDate(x.date) + (x.days === 0 ? ' · today' : ' · in ' + x.days + ' days'))).join('')}</table>` : ''}
${opts.link ? `<p style="margin-top:24px"><a href="${esc(opts.link)}" style="background:#0d2530;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Open tracker</a></p>` : ''}
</div></div>`;
    return { subject, text: lines.join('\n'), html, count: items.length, summary: sm };
  }

  /* ---------- seed data (dates are relative to today so the demo is always "live") ---------- */
  function seed(t) {
    const D = n => addDays(t, n);
    const A1 = 'Flowstation FS-1', A2 = 'Gas Plant GP-2', A3 = 'Wellpad WP-3';
    const A4 = 'Flowstation KI-1', A5 = 'Flowstation IS-1', A6 = 'Rig ODL-1', A7 = 'Rig IRS-1', A8 = 'Rig 4';
    const sceRows = [
      [A1, 'Separation Area', 'PSV-1101', 'Inlet separator pressure safety valve', 'Preventive', 'PS-014', 'N/A', 'H', 'Ops Lead FS-1', 'API 520/521'],
      [A1, 'Inlet Manifold', 'ESD-1001', 'Inlet emergency shutdown valve', 'Preventive', 'PS-002', 'SIL 2', 'H', 'Ops Lead FS-1', 'IEC 61511'],
      [A1, 'Separation Area', 'PSHH-1102', 'Separator high-high pressure trip', 'Preventive', 'PS-003', 'SIL 2', 'H', 'Instrument Lead', 'IEC 61511'],
      [A1, 'Separation Area', 'LSHH-1103', 'Separator level high-high trip', 'Preventive', 'PS-004', 'SIL 1', 'M', 'Instrument Lead', 'IEC 61511'],
      [A1, 'Process Area', 'FG-2001', 'Fire & gas detection – process area', 'Mitigative', 'PS-021', 'SIL 2', 'H', 'Safety Officer', 'ISO 13702'],
      [A1, 'Utility Area', 'FW-3001', 'Firewater pump P-3001', 'Mitigative', 'PS-030', 'N/A', 'M', 'Mechanical Lead', 'NFPA 20'],
      [A2, 'Compression', 'BDV-2101', 'Compressor blowdown valve', 'Mitigative', 'PS-011', 'SIL 2', 'H', 'Ops Lead GP-2', 'API 521'],
      [A2, 'Compression', 'PSV-2102', 'Compressor discharge PSV', 'Preventive', 'PS-014', 'N/A', 'H', 'Ops Lead GP-2', 'API 520/521'],
      [A2, 'Compression', 'ESD-2001', 'Plant emergency shutdown logic', 'Preventive', 'PS-002', 'SIL 3', 'H', 'Instrument Lead', 'IEC 61511'],
      [A2, 'Process Area', 'FD-2201', 'Flame detectors – compressor hall', 'Mitigative', 'PS-021', 'SIL 2', 'H', 'Safety Officer', 'ISO 13702'],
      [A2, 'Utility Area', 'DEL-2301', 'Deluge system – compressor hall', 'Mitigative', 'PS-031', 'N/A', 'M', 'Mechanical Lead', 'NFPA 15'],
      [A2, 'Compression', 'TSHH-2103', 'Compressor high-high temperature trip', 'Preventive', 'PS-005', 'SIL 1', 'M', 'Instrument Lead', 'IEC 61511'],
      [A3, 'Wellhead', 'SSV-3101', 'Surface safety valve – well 3A', 'Preventive', 'PS-001', 'SIL 2', 'H', 'Wells Lead', 'API 14C'],
      [A3, 'Wellhead', 'MOV-3103', 'Wing valve actuator', 'Preventive', 'PS-001', 'N/A', 'M', 'Wells Lead', 'API 6A'],
      [A3, 'Flowline', 'PSHL-3102', 'Flowline high/low pressure pilot', 'Preventive', 'PS-006', 'SIL 1', 'M', 'Instrument Lead', 'API 14C'],
      [A3, 'Wellpad', 'FIRE-3201', 'Fire detection – wellpad', 'Mitigative', 'PS-022', 'N/A', 'L', 'Safety Officer', 'ISO 13702'],
      [A4, 'Separation Area', 'PSHH-4101', 'Separator high-high pressure trip', 'Preventive', 'PS-003', 'SIL 2', 'H', 'Ops Lead KI-1', 'IEC 61511'],
      [A4, 'Separation Area', 'LSHH-4102', 'Separator level high-high trip', 'Preventive', 'PS-004', 'SIL 1', 'M', 'Instrument Lead', 'IEC 61511'],
      [A4, 'Separation Area', 'PSV-4103', 'Inlet separator pressure safety valve', 'Preventive', 'PS-014', 'N/A', 'H', 'Mechanical Lead', 'API 520/521'],
      [A5, 'Inlet Manifold', 'ESD-5101', 'Inlet emergency shutdown valve', 'Preventive', 'PS-002', 'SIL 2', 'H', 'Ops Lead IS-1', 'IEC 61511'],
      [A5, 'Process Area', 'FG-5201', 'Fire & gas detection – process area', 'Mitigative', 'PS-021', 'SIL 2', 'H', 'Safety Officer', 'ISO 13702'],
      [A5, 'Utility Area', 'FW-5301', 'Firewater pump P-5301', 'Mitigative', 'PS-030', 'N/A', 'M', 'Mechanical Lead', 'NFPA 20'],
      [A6, 'Well Control', 'BOP-6101', 'Blowout preventer – annular and rams', 'Preventive', 'PS-040', 'SIL 3', 'H', 'Drilling Supervisor', 'API 53'],
      [A6, 'Well Control', 'ESD-6102', 'Driller emergency shutdown', 'Preventive', 'PS-041', 'SIL 2', 'H', 'Drilling Supervisor', 'API 53'],
      [A7, 'Well Control', 'BOP-6201', 'Blowout preventer – annular and rams', 'Preventive', 'PS-040', 'SIL 3', 'H', 'Drilling Supervisor', 'API 53'],
      [A7, 'Well Control', 'PSHH-6202', 'Mud/gas separator high pressure trip', 'Preventive', 'PS-042', 'SIL 2', 'M', 'Instrument Lead', 'API 53'],
      [A8, 'Well Control', 'BOP-6301', 'Blowout preventer – annular and rams', 'Preventive', 'PS-040', 'SIL 3', 'H', 'Drilling Supervisor', 'API 53'],
      [A8, 'Accommodation', 'FIRE-6301', 'Fire detection – accommodation block', 'Mitigative', 'PS-022', 'N/A', 'L', 'Safety Officer', 'ISO 13702']
    ];
    const SITE_BY_ASSET = {
      [A1]: 'Imo River', [A2]: 'Okoloma Gas Plant', [A3]: 'Bonny',
      [A4]: 'Kidney Island', [A5]: 'Isimiri', [A6]: 'Okoloma Drilling Site',
      [A7]: 'Imo River Drilling Sites', [A8]: 'Rigs'
    };
    const sce = sceRows.map((r, i) => ({ id: 's' + (i + 1), asset: r[0], site: SITE_BY_ASSET[r[0]] || '', location: r[1], tag: r[2], desc: r[3], barrier: r[4], ps: r[5], sil: r[6], risk: r[7], owner: r[8], reg: r[9], status: 'Active', docs: [] }));
    const tests = [
      ['PSV-1101', 'Bench test & recertification', 365, -340, 'Pass'], ['ESD-1001', 'Partial stroke test', 90, -95, 'Pass'], ['ESD-1001', 'Full stroke test', 365, -200, 'Pass'],
      ['PSHH-1102', 'Trip function test', 180, -60, 'Pass'], ['LSHH-1103', 'Trip function test', 180, -170, 'Conditional'], ['FG-2001', 'Gas detector calibration', 90, -80, 'Pass'],
      ['FW-3001', 'Weekly run test', 7, -3, 'Pass'], ['FW-3001', 'Annual flow test', 365, -320, 'Pass'], ['BDV-2101', 'Valve stroke & timing', 180, -200, 'Pass'],
      ['PSV-2102', 'Bench test & recertification', 365, -380, 'Pass'], ['ESD-2001', 'Logic solver proof test', 365, -150, 'Pass'], ['FD-2201', 'Flame detector function test', 90, -30, 'Pass'],
      ['DEL-2301', 'Deluge release test', 180, -150, 'Pass'], ['TSHH-2103', 'Trip function test', 180, -110, 'Pass'], ['SSV-3101', 'Valve closure & leak test', 90, -100, 'Fail'],
      ['MOV-3103', 'Actuator function test', 180, -90, 'Pass'], ['PSHL-3102', 'Pilot calibration', 180, -175, 'Pass'], ['FIRE-3201', 'Detector function test', 180, -60, 'Pass'],
      ['PSHH-4101', 'Trip function test', 180, -200, 'Pass'], ['LSHH-4102', 'Trip function test', 180, -30, 'Pass'], ['PSV-4103', 'Bench test & recertification', 365, -120, 'Pass'],
      ['ESD-5101', 'Partial stroke test', 90, -100, 'Fail'], ['FG-5201', 'Gas detector calibration', 90, -20, 'Pass'], ['FW-5301', 'Weekly run test', 7, -2, 'Pass'],
      ['BOP-6101', 'BOP function & pressure test', 90, -95, 'Pass'], ['ESD-6102', 'Trip function test', 180, -60, 'Pass'],
      ['BOP-6201', 'BOP function & pressure test', 90, -30, 'Pass'], ['PSHH-6202', 'Trip function test', 180, -175, 'Conditional'],
      ['BOP-6301', 'BOP function & pressure test', 90, -88, 'Pass'], ['FIRE-6301', 'Detector function test', 180, -60, 'Pass']
    ];
    const auth = ['Third-party verifier', 'Integrity Engineer', 'Safety Officer', 'Independent Competent Person'];
    const insp = tests.map((x, i) => { const s = sce.find(q => q.tag === x[0]); return { id: 'i' + (i + 1), asset: s.asset, tag: x[0], type: x[1], freq: x[2], last: D(x[3]), result: x[4], auth: auth[i % 4], remarks: x[4] === 'Fail' ? 'Slow closure on test; defect raised' : x[4] === 'Conditional' ? 'Passed with trip delay noted' : '', docs: [] }; });
    const ovr = [
      { id: 'o1', asset: A1, tag: 'LSHH-1103', type: 'Bypass', start: D(-2) + 'T08:00', end: D(2) + 'T18:00', risk: 'Yes', comp: 'Operator stationed at separator; manual level checks every 30 min', approver: 'Operations Manager', status: 'Open', docs: [] },
      { id: 'o2', asset: A2, tag: 'FD-2201', type: 'Inhibit', start: D(-9) + 'T07:00', end: D(-1) + 'T17:00', risk: 'Yes', comp: 'Portable gas detection and fire watch', approver: 'Operations Manager', status: 'Open', docs: [] },
      { id: 'o3', asset: A3, tag: 'SSV-3101', type: 'Override', start: D(-20) + 'T09:00', end: D(-18) + 'T15:00', risk: 'Yes', comp: 'Well shut-in during repair', approver: 'Asset Manager', status: 'Closed', docs: [] },
      { id: 'o4', asset: A4, tag: 'LSHH-4102', type: 'Bypass', start: D(-1) + 'T08:00', end: D(1) + 'T18:00', risk: 'Yes', comp: 'Operator stationed at separator; manual level checks every 30 min', approver: 'Operations Manager', status: 'Open', docs: [] },
      { id: 'o5', asset: A6, tag: 'BOP-6101', type: 'Inhibit', start: D(-5) + 'T07:00', end: D(2) + 'T19:00', risk: 'No', comp: 'Drilling suspended; well shut in and monitored', approver: '', status: 'Open', docs: [] },
      { id: 'o6', asset: A5, tag: 'ESD-5101', type: 'Override', start: D(-12) + 'T09:00', end: D(-1) + 'T15:00', risk: 'Yes', comp: 'Manual ESD station manned for the duration', approver: 'Asset Manager', status: 'Open', docs: [] }
    ];
    const act = [
      { id: 'a1', asset: A3, tag: 'SSV-3101', desc: 'Surface safety valve failed leak/closure test', identified: D(-100), risk: 'H', temp: 'Well manually isolated at wing valve; daily checks', corrective: 'Replace SSV actuator and re-test', owner: 'Wells Lead', ownerEmail: '', target: D(-12), status: 'Open', progress: 40, docs: [] },
      { id: 'a2', asset: A2, tag: 'PSV-2102', desc: 'PSV recertification overdue', identified: D(-15), risk: 'H', temp: 'Pressure limited to 90% MAWP', corrective: 'Remove PSV for bench test; install certified spare', owner: 'Ops Lead GP-2', ownerEmail: '', target: D(9), status: 'In Progress', progress: 60, docs: [] },
      { id: 'a3', asset: A1, tag: 'LSHH-1103', desc: 'Trip response slower than performance standard', identified: D(-170), risk: 'M', temp: 'Operator level checks', corrective: 'Re-tune level transmitter and repeat proof test', owner: 'Instrument Lead', ownerEmail: '', target: D(21), status: 'In Progress', progress: 25, docs: [] },
      { id: 'a4', asset: A2, tag: 'BDV-2101', desc: 'Valve stroke time trending upward', identified: D(-40), risk: 'M', temp: 'Monitor monthly stroke time', corrective: 'Overhaul actuator seals', owner: 'Mechanical Lead', ownerEmail: '', target: D(-5), status: 'Open', progress: 10, docs: [] },
      { id: 'a5', asset: A1, tag: 'FG-2001', desc: 'Two detectors past calibration gas expiry', identified: D(-60), risk: 'L', temp: 'None required', corrective: 'Replace calibration gas stock; recalibrate', owner: 'Safety Officer', ownerEmail: '', target: D(-30), status: 'Closed', progress: 100, docs: [] },
      { id: 'a6', asset: A2, tag: 'DEL-2301', desc: 'Deluge nozzle blockage found in compressor hall', identified: D(-45), risk: 'M', temp: 'Fire watch during hot work', corrective: 'Flush and replace blocked nozzles', owner: 'Mechanical Lead', ownerEmail: '', target: D(-20), status: 'Closed', progress: 100, docs: [] },
      { id: 'a7', asset: A3, tag: 'MOV-3103', desc: 'Wing valve actuator hydraulic seep', identified: D(-8), risk: 'L', temp: 'Weekly visual check', corrective: 'Replace hydraulic seal kit', owner: 'Wells Lead', ownerEmail: '', target: D(30), status: 'Open', progress: 0, docs: [] },
      { id: 'a8', asset: A5, tag: 'ESD-5101', desc: 'Shutdown valve failed partial stroke test', identified: D(-30), risk: 'H', temp: 'Manual ESD station manned; override logged', corrective: 'Replace actuator and repeat partial stroke test', owner: 'Ops Lead IS-1', ownerEmail: '', target: D(-6), status: 'Open', progress: 20, docs: [] },
      { id: 'a9', asset: A4, tag: 'PSHH-4101', desc: 'Pressure trip proof test more than 180 days overdue', identified: D(-25), risk: 'M', temp: 'Pressure alarm monitored continuously', corrective: 'Schedule trip function test with instrument crew', owner: 'Instrument Lead', ownerEmail: '', target: D(12), status: 'In Progress', progress: 50, docs: [] },
      { id: 'a10', asset: A8, tag: 'BOP-6301', desc: 'BOP pressure test due before next well section', identified: D(-5), risk: 'L', temp: 'No drilling until test is complete', corrective: 'Run BOP function and pressure test', owner: 'Drilling Supervisor', ownerEmail: '', target: D(25), status: 'Open', progress: 0, docs: [] }
    ];
    const ym = n => { const d = parse(t); d.setMonth(d.getMonth() - n, 1); return iso(d); };
    const siteOrder = [...new Set(sce.map(s => s.site))];
    const topEvents = ['Loss of containment', 'Overpressure of separator', 'Well control', 'Fire in process area'];
    const kpi = [];
    for (let m = 5; m >= 0; m--) siteOrder.forEach((site, si) => {
      const pop = sce.filter(s => s.site === site && s.status !== 'Retired').length;
      const overdue = [0, 1, 2][(m + si) % 3];
      kpi.push({ id: 'k' + (kpi.length + 1), site, month: ym(m), pop, verified: Math.max(0, pop - overdue - (si % 2)), overdue,
        topEvent: topEvents[si % topEvents.length], lopc: (m + si) % 17 === 0 ? 1 : 0, hipo: (m + si) % 11 === 0 ? 1 : 0,
        overrides: (m + si) % 4, docs: [] });
    });
    return { sce, insp, ovr, act, kpi, log: [] };
  }

  return { DAY, iso, parse, parseDT, diffDays, addDays, todayISO, fmtDate, fmtMonth, esc, uid, short, DEFAULT_SETTINGS, siteMap, siteOf, scopeDb, inspInfo, ovrInfo, actInfo, sceStates, summarize, buildDigest, seed, signoffIssues, stampRecord, LOCKED, LOCKED_MSG, diffRecords };
});
