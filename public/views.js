/* Views, record drawer, import/export, email, boot */
(function () {
  const { P, S, esc, ic, clone, toast, dialog, confirmDlg, promptDlg, donut, lineChart, hbar, segBar } = APP;
  const { fmtDate, fmtMonth } = P;
  const $ = s => document.querySelector(s);
  const chip = (t, c) => `<span class="chip ${c || ''}">${esc(t)}</span>`;
  const LV = { H: 'High', M: 'Medium', L: 'Low' }, LVC = { H: 'red', M: 'amber', L: 'green' };
  const riskChip = r => chip(LV[r] || r || '—', LVC[r]);
  const resChip = r => r ? chip(r, { Pass: 'green', Fail: 'red', Conditional: 'amber' }[r]) : '';
  const stateChip = { green: ['Healthy', 'green'], amber: ['Watch', 'amber'], red: ['Action needed', 'red'], grey: ['Not assured', ''] };
  const dnum = r => (r.docs && r.docs.length) ? `<span class="doc-n" title="${r.docs.length} document(s)">${ic('clip')}${r.docs.length}</span>` : '';
  const thisMonth = () => S.t.slice(0, 8) + '01';

  /* ---------- schema ---------- */
  const F = (k, l, t, o) => Object.assign({ k, l, t: t || 'text' }, o);
  const RISKF = (k, l) => F(k, l, 'sel', { opts: ['H', 'M', 'L'], labels: LV });
  const SCHEMA = {
    sce: { name: 'SCE register', one: 'Safety-critical element', tagLabel: true, fields: [F('tag', 'SCE tag no', 'text', { req: 1 }), F('asset', 'Asset'), F('location', 'Location'), F('status', 'Status', 'sel', { opts: ['Active', 'Retired'] }), F('desc', 'SCE description', 'text', { full: 1 }), F('barrier', 'Barrier type', 'sel', { opts: ['Preventive', 'Mitigative'] }), F('sil', 'SIL rating', 'sel', { opts: ['N/A', 'SIL 1', 'SIL 2', 'SIL 3', 'SIL 4'] }), F('ps', 'Performance standard ref'), RISKF('risk', 'Risk ranking'), F('owner', 'Responsible owner'), F('reg', 'Regulatory ref'), F('notes', 'Notes', 'area', { full: 1 })] },
    insp: { name: 'Inspections & tests', one: 'Inspection / test', fields: [F('tag', 'SCE tag no', 'tag', { req: 1 }), F('asset', 'Asset'), F('type', 'Inspection / test type', 'text', { full: 1, req: 1 }), F('freq', 'Test frequency (days)', 'num', { req: 1 }), F('last', 'Last test date', 'date'), F('result', 'Test result', 'sel', { opts: ['Pass', 'Conditional', 'Fail'] }), F('auth', 'Verification authority'), F('remarks', 'Remarks', 'area', { full: 1 })] },
    ovr: { name: 'Barrier overrides', one: 'Barrier override', fields: [F('tag', 'SCE tag no', 'tag', { req: 1 }), F('asset', 'Asset'), F('type', 'Type', 'sel', { opts: ['Override', 'Bypass', 'Inhibit'] }), F('status', 'Status', 'sel', { opts: ['Open', 'Closed'] }), F('start', 'Start', 'dt'), F('end', 'End', 'dt'), F('risk', 'Risk assessment conducted', 'sel', { opts: ['Yes', 'No'] }), F('approver', 'Approved by'), F('comp', 'Compensating measure in place', 'area', { full: 1 }), F('notes', 'Notes', 'area', { full: 1 })] },
    act: { name: 'Defects & actions', one: 'Action item', fields: [F('tag', 'SCE tag no', 'tag', { req: 1 }), F('asset', 'Asset'), F('desc', 'Defect description', 'area', { full: 1, req: 1 }), F('identified', 'Identified date', 'date'), RISKF('risk', 'Risk level'), F('temp', 'Temporary control in place', 'area', { full: 1 }), F('corrective', 'Corrective action', 'area', { full: 1 }), F('owner', 'Action owner'), F('ownerEmail', 'Owner email', 'email', { hint: 'Used for owner reminders' }), F('target', 'Target closure date', 'date'), F('status', 'Status', 'sel', { opts: ['Open', 'In Progress', 'Closed'] }), F('progress', 'Progress', 'range', { full: 1 }), F('notes', 'Progress notes', 'area', { full: 1 })] },
    kpi: { name: 'Process safety KPIs', one: 'KPI month', fields: [F('month', 'Month', 'month', { req: 1 }), F('pop', 'Total SCE population', 'num'), F('verified', 'Total verified this month', 'num'), F('overdue', 'Overdue inspections', 'num'), F('topEvent', 'Top event', 'text', { full: 1 }), F('lopc', 'LOPC incidents', 'num'), F('hipo', 'High-potential near misses', 'num'), F('overrides', 'Active overrides', 'num')] }
  };
  const DEFAULTS = {
    sce: () => ({ status: 'Active', barrier: 'Preventive', risk: 'M', sil: 'N/A' }),
    insp: () => ({ freq: 90, result: 'Pass', last: S.t }),
    ovr: () => ({ type: 'Bypass', risk: 'No', status: 'Open', start: S.t + 'T08:00', end: S.t + 'T18:00' }),
    act: () => ({ risk: 'M', status: 'Open', identified: S.t, progress: 0 }),
    kpi: () => ({ month: thisMonth() })
  };

  /* ---------- derived-info shortcuts ---------- */
  const iI = r => P.inspInfo(r, S.t, S.sm.soon), oI = o => P.ovrInfo(o, S.t, S.sm.maxH), aI = a => P.actInfo(a, S.t);
  const inspStateChip = i => ({ overdue: chip('Overdue', 'red'), soon: chip('Due in ' + i.days + ' d', 'amber'), ok: chip('On track', 'green'), none: chip('No date') }[i.state]);
  const ovrStateChip = i => ({ active: chip('Active', 'amber'), expired: chip('Expired', 'red'), norisk: chip('No risk assessment', 'red'), long: chip('Running long', 'amber'), closed: chip('Closed') }[i.state]);
  const actStateChip = i => ({ overdue: chip('Overdue', 'red'), progress: chip('In progress', 'blue'), open: chip('Open', 'amber'), closed: chip('Closed', 'green') }[i.state]);
  const sceLevel = s => (S.sm.states[s.id] || { level: 'grey' }).level;
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const kpiSorted = () => S.db.kpi.slice().sort((a, b) => (a.month || '').localeCompare(b.month || ''));
  const label = (col, r) => col === 'kpi' ? fmtMonth(r.month) : `${r.tag || ''}${col === 'sce' ? '' : ' · ' + (r.type || r.corrective || r.desc || '')}`.slice(0, 60);

  /* ---------- table definitions ---------- */
  const T = (h, v, s, cls) => ({ h, v, s, cls });
  const TABLES = {
    sce: [T('Tag', r => `<span class="tagno">${esc(r.tag)}</span>`, r => r.tag), T('Asset', r => esc(r.asset), r => r.asset), T('Description', r => esc(r.desc), r => r.desc), T('Barrier', r => chip(r.barrier || '—', r.barrier === 'Mitigative' ? 'blue' : ''), r => r.barrier), T('SIL', r => esc(r.sil), r => r.sil), T('Risk', r => riskChip(r.risk), r => 'HML'.indexOf(r.risk)), T('Owner', r => esc(r.owner), r => r.owner), T('Barrier state', r => r.status === 'Retired' ? chip('Retired') : chip(...stateChip[sceLevel(r)]), r => ['red', 'amber', 'green', 'grey'].indexOf(sceLevel(r))), T('', dnum)],
    insp: [T('Tag', r => `<span class="tagno">${esc(r.tag)}</span>`, r => r.tag), T('Asset', r => esc(r.asset), r => r.asset), T('Test type', r => esc(r.type), r => r.type), T('Every (d)', r => r.freq, r => +r.freq, 'num'), T('Last test', r => fmtDate(r.last), r => r.last), T('Next due', r => fmtDate(iI(r).next), r => iI(r).next || ''), T('Overdue?', r => inspStateChip(iI(r)), r => iI(r).days == null ? 9e9 : iI(r).days), T('Result', r => resChip(r.result), r => r.result), T('Verifier', r => esc(r.auth), r => r.auth), T('', dnum)],
    ovr: [T('Tag', r => `<span class="tagno">${esc(r.tag)}</span>`, r => r.tag), T('Asset', r => esc(r.asset), r => r.asset), T('Type', r => esc(r.type), r => r.type), T('Start', r => fmtDate(r.start), r => r.start), T('End', r => fmtDate(r.end), r => r.end), T('Hours', r => oI(r).hours == null ? '—' : oI(r).hours, r => oI(r).hours, 'num'), T('Risk assessed', r => chip(r.risk || '—', r.risk === 'Yes' ? 'green' : 'red'), r => r.risk), T('Approved by', r => esc(r.approver), r => r.approver), T('Status', r => ovrStateChip(oI(r)), r => oI(r).state), T('', dnum)],
    act: [T('Tag', r => `<span class="tagno">${esc(r.tag)}</span>`, r => r.tag), T('Defect', r => esc(P.short(r.desc, 70)), r => r.desc), T('Risk', r => riskChip(r.risk), r => 'HML'.indexOf(r.risk)), T('Corrective action', r => esc(P.short(r.corrective, 70)), r => r.corrective), T('Owner', r => esc(r.owner), r => r.owner), T('Target', r => fmtDate(r.target), r => r.target), T('Progress', r => `<div class="bar rowbar"><i class="${aI(r).state === 'overdue' ? 'r' : 'g'}" style="width:${+r.progress || 0}%"></i></div>`, r => +r.progress || 0), T('Status', r => actStateChip(aI(r)), r => aI(r).state), T('', dnum)],
    kpi: [T('Month', r => `<b>${fmtMonth(r.month)}</b>`, r => r.month), T('SCE population', r => r.pop, r => +r.pop, 'num'), T('Verified', r => r.verified, r => +r.verified, 'num'), T('% verified', r => pct(r.verified, r.pop) + '%', r => pct(r.verified, r.pop), 'num'), T('Overdue', r => r.overdue, r => +r.overdue, 'num'), T('% overdue', r => pct(r.overdue, r.pop) + '%', r => pct(r.overdue, r.pop), 'num'), T('Top event', r => esc(r.topEvent), r => r.topEvent), T('LOPC', r => r.lopc, r => +r.lopc, 'num'), T('HiPo', r => r.hipo, r => +r.hipo, 'num'), T('Overrides', r => r.overrides, r => +r.overrides, 'num'), T('', dnum)]
  };
  const FILTERS = {
    sce: [['all', 'All', () => true], ['red', 'Action needed', r => r.status !== 'Retired' && sceLevel(r) === 'red'], ['amber', 'Watch', r => r.status !== 'Retired' && sceLevel(r) === 'amber'], ['green', 'Healthy', r => r.status !== 'Retired' && sceLevel(r) === 'green'], ['grey', 'Not assured', r => r.status !== 'Retired' && sceLevel(r) === 'grey'], ['ret', 'Retired', r => r.status === 'Retired']],
    insp: [['all', 'All', () => true], ['overdue', 'Overdue', r => iI(r).state === 'overdue'], ['soon', 'Due soon', r => iI(r).state === 'soon'], ['ok', 'On track', r => iI(r).state === 'ok'], ['fail', 'Failed / conditional', r => r.result === 'Fail' || r.result === 'Conditional']],
    ovr: [['all', 'All', () => true], ['open', 'Open', r => r.status !== 'Closed'], ['bad', 'Expired or unassessed', r => ['expired', 'norisk'].includes(oI(r).state)], ['closed', 'Closed', r => r.status === 'Closed']],
    act: [['all', 'All', () => true], ['open', 'Open', r => ['open', 'progress'].includes(aI(r).state)], ['overdue', 'Overdue', r => aI(r).state === 'overdue'], ['high', 'High risk', r => r.risk === 'H' && r.status !== 'Closed'], ['closed', 'Closed', r => r.status === 'Closed']],
    kpi: [['all', 'All', () => true]]
  };
  const BLURB = {
    sce: 'Every safety-critical element at the location, with its barrier type, performance standard and owner. Each cell on the dashboard strip is one row here.',
    insp: 'Test frequency, last test and next due date. Next due and overdue calculate automatically.',
    ovr: 'Every override, bypass and inhibit with its risk assessment and compensating measures. Duration calculates automatically.',
    act: 'Defects found on safety-critical elements and the actions to close them. Attach evidence, permits and reports to each item.',
    kpi: 'Monthly process safety performance. Percentages calculate automatically.'
  };

  function rowsFor(col, ignoreFilter) {
    let r = S.db[col].slice();
    if (S.asset && col !== 'kpi') r = r.filter(x => x.asset === S.asset);
    const q = (S.q[col] || '').trim().toLowerCase();
    if (q) r = r.filter(x => Object.entries(x).filter(([k]) => k !== 'docs').map(e => e[1]).join(' ').toLowerCase().includes(q) || (x.docs || []).some(d => d.name.toLowerCase().includes(q)));
    if (!ignoreFilter) { const f = FILTERS[col].find(f => f[0] === (S.flt[col] || 'all')); if (f) r = r.filter(f[2]); }
    const so = S.sort[col];
    if (so) { const c = TABLES[col][so.i]; r.sort((a, b) => { const x = c.s(a), y = c.s(b); return (x > y ? 1 : x < y ? -1 : 0) * so.d; }); }
    else if (col === 'kpi') r.sort((a, b) => (b.month || '').localeCompare(a.month || ''));
    return r;
  }
  function tableHtml(col) {
    const rows = rowsFor(col), cols = TABLES[col], so = S.sort[col];
    if (!rows.length) return `<div class="empty"><b>${S.db[col].length ? 'Nothing matches these filters' : 'No records yet'}</b>${S.db[col].length ? 'Clear the search or choose another filter.' : `Add your first ${SCHEMA[col].one.toLowerCase()} to start tracking.`}</div>`;
    return `<div class="tbl-wrap"><table class="t"><thead><tr>${cols.map((c, i) => `<th data-a="sort" data-col="${col}" data-i="${i}" ${so && so.i === i ? `aria-sort="${so.d > 0 ? 'ascending' : 'descending'}"` : ''}>${c.h}${so && so.i === i ? (so.d > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr data-a="open" data-col="${col}" data-id="${r.id}">${cols.map(c => `<td class="${c.cls || ''}">${c.v(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="t-foot">${rows.length} of ${S.db[col].length} record${S.db[col].length === 1 ? '' : 's'}</div>`;
  }
  const assetSelect = () => { const as = [...new Set(S.db.sce.map(s => s.asset).concat(S.db.insp.map(s => s.asset)).filter(Boolean))].sort(); return as.length > 1 ? `<select data-in="asset" style="width:auto;min-width:170px" aria-label="Filter by asset"><option value="">All assets</option>${as.map(a => `<option ${a === S.asset ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>` : ''; };

  function listView(col) {
    const sc = SCHEMA[col], cur = S.flt[col] || 'all';
    const pills = FILTERS[col].length > 1 ? FILTERS[col].map(f => `<button class="pill" aria-pressed="${f[0] === cur}" data-a="filter" data-col="${col}" data-id="${f[0]}">${f[1]}<span class="n">${rowsFor(col, true).filter(f[2]).length}</span></button>`).join('') : '';
    const extra = col === 'kpi' ? `<button class="btn" data-a="kpisync">${ic('refresh')}Fill current month from live data</button>` : '';
    const chart = col === 'kpi' ? `<div class="panel" style="margin-bottom:16px"><div class="panel-h"><h3>Trend</h3><small>% of SCE population</small></div><div class="panel-b">${kpiChart()}</div></div>` : '';
    return `<div class="page-head"><div><h2>${sc.name}</h2><p>${BLURB[col]}</p></div><div class="sp">${extra}<button class="btn primary" data-a="new" data-col="${col}">${ic('plus')}Add ${sc.one.toLowerCase()}</button></div></div>
    ${chart}<div class="filters">${pills}<span style="flex:1"></span>${col !== 'kpi' ? assetSelect() : ''}<input class="search" type="search" placeholder="Search ${sc.name.toLowerCase()}…" value="${esc(S.q[col] || '')}" data-in="q" data-col="${col}" aria-label="Search"></div>
    <div class="panel" id="tbl">${tableHtml(col)}</div>`;
  }
  function kpiChart() {
    const k = kpiSorted(); if (!k.length) return '<div class="empty">Add monthly figures to see the trend.</div>';
    return lineChart(k.map(r => fmtMonth(r.month).slice(0, 3)), [{ name: '% verified', c: 'var(--green)', data: k.map(r => pct(r.verified, r.pop)) }, { name: '% overdue', c: 'var(--red)', data: k.map(r => pct(r.overdue, r.pop)) }], { max: 100, unit: '%', label: 'Percent verified and percent overdue by month' });
  }

  /* ---------- dashboard ---------- */
  function strip(sm, interactive) {
    const list = S.db.sce.filter(s => s.status !== 'Retired');
    if (!list.length) return '<div style="color:var(--on-ink-muted);padding:14px 0">Add safety-critical elements to build your barrier strip.</div>';
    return `<div class="strip">${list.map(s => { const st = sm.states[s.id]; const tip = `${s.tag} — ${s.desc || ''}\n${st.reasons.length ? st.reasons.join('; ') : st.level === 'grey' ? 'No inspections linked yet' : 'All checks on track'}`;
      return interactive ? `<button class="cell ${st.level} ${s.barrier === 'Mitigative' ? 'mit' : ''}" data-a="open" data-col="sce" data-id="${s.id}" title="${esc(tip)}" aria-label="${esc(tip)}"></button>` : `<span class="cell ${st.level} ${s.barrier === 'Mitigative' ? 'mit' : ''}" title="${esc(tip)}"></span>`; }).join('')}</div>`;
  }
  const legend = '<div class="legend"><span><i style="background:var(--green)"></i>Healthy</span><span><i style="background:var(--amber)"></i>Due soon or overridden</span><span><i style="background:var(--red)"></i>Overdue, failed or expired</span><span><i style="background:#59717c"></i>Not yet assured</span><span>Underlined cell = mitigative barrier</span></div>';
  const attList = (items, max) => items.length ? `<ul class="alist">${items.slice(0, max).map(x => `<li data-a="open" data-col="${x.type}" data-id="${x.id}"><span class="sev ${x.sev >= 3 ? 'r' : ''}"></span><div><b>${esc(x.title)}</b><small>${esc(x.sub)}</small></div><span class="tag">${x.asset ? chip(x.asset) : ''}</span></li>`).join('')}</ul>` : `<div class="empty"><b>${S.sm && S.sm.empty ? 'Nothing tracked yet' : 'Nothing overdue'}</b>${S.sm && S.sm.empty ? 'Add records from the menu, or import your existing Excel tracker in Settings.' : 'Every inspection, override and action is within its date.'}</div>`;

  function dashboard() {
    const sm = S.sm, { I, O, A, B } = sm, k = kpiSorted(), last = k[k.length - 1];
    const col = sm.index >= 90 ? 'var(--green)' : sm.index >= 75 ? '#7bd88f' : sm.index >= 60 ? 'var(--signal)' : 'var(--red)';
    const C = 2 * Math.PI * 52;
    const risk = ['H', 'M', 'L'].map(r => S.db.act.filter(a => a.risk === r && a.status !== 'Closed').length);
    return `<div class="hero"><div class="idx"><div class="ring"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="11"/><circle cx="60" cy="60" r="52" fill="none" stroke="${col}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${sm.empty ? 0 : C * sm.index / 100} ${C}"/></svg><div class="v"><div>${sm.empty ? '–' : sm.index}<small>${sm.empty ? 'no data' : 'of 100'}</small></div></div></div><div><div class="rt">${sm.empty ? 'Ready to start' : sm.rating}</div><div class="sub">${sm.empty ? 'Add your SCE register, or import your Excel tracker under Settings.' : 'Process safety health index. Weighted from inspection timeliness, action closure, override control and test results.'}</div></div></div>
    <div class="strip-wrap"><h3>Barrier integrity <small>${B.total} safety-critical elements · ${B.red} need action · ${B.amber} on watch</small></h3>${strip(sm, true)}${legend}</div></div>
    <div class="grid g-4" style="margin-bottom:18px">
      <div class="panel stat ${I.overdue ? 'red' : 'green'}"><span class="n">${I.overdue}</span><span class="l">Overdue inspections</span><span class="d">${I.soon} more due within ${sm.soon} days · ${I.onTimePct}% on time</span>${segBar(I.ok, I.soon, I.overdue)}</div>
      <div class="panel stat ${O.expired || O.norisk ? 'red' : O.open ? 'amber' : 'green'}"><span class="n">${O.open}</span><span class="l">Open barrier overrides</span><span class="d">${O.expired + O.norisk ? (O.expired + O.norisk) + ' expired or without risk assessment' : 'All assessed and in date'}</span></div>
      <div class="panel stat ${A.overdue ? 'red' : 'green'}"><span class="n">${A.open}</span><span class="l">Open actions</span><span class="d">${A.overdue} overdue · ${A.high} high risk · ${A.closedPct}% closed</span><div class="bar"><i class="g" style="width:${A.closedPct}%"></i></div></div>
      <div class="panel stat"><span class="n">${last ? pct(last.verified, last.pop) + '%' : '—'}</span><span class="l">SCEs verified ${last ? 'in ' + fmtMonth(last.month) : ''}</span><span class="d">${last ? last.lopc + ' LOPC · ' + last.hipo + ' high-potential near misses' : 'Add KPI months to track'}</span></div>
    </div>
    <div class="grid g-3" style="margin-bottom:18px">
      <div class="panel"><div class="panel-h"><h3>Needs attention</h3><small>${sm.attention.length} item${sm.attention.length === 1 ? '' : 's'}, most serious first</small><span class="sp"><button class="btn sm" data-a="nav" data-id="alerts">See all</button></span></div>${attList(sm.attention, 7)}</div>
      <div style="display:grid;gap:18px;align-content:start">
        <div class="panel"><div class="panel-h"><h3>Inspection status</h3></div><div class="panel-b">${donut([{ v: I.ok, c: 'var(--green)', l: 'On track' }, { v: I.soon, c: 'var(--amber)', l: 'Due soon' }, { v: I.overdue, c: 'var(--red)', l: 'Overdue' }, { v: I.none, c: 'var(--grey)', l: 'No date' }], I.total, 'inspections')}</div></div>
        <div class="panel"><div class="panel-h"><h3>Open actions by risk</h3></div><div class="panel-b">${hbar('High', risk[0], Math.max(...risk, 1), 'var(--red)')}${hbar('Medium', risk[1], Math.max(...risk, 1), 'var(--amber)')}${hbar('Low', risk[2], Math.max(...risk, 1), 'var(--green)')}</div></div>
      </div></div>
    <div class="grid g-2"><div class="panel"><div class="panel-h"><h3>KPI trend</h3><small>% of SCE population</small></div><div class="panel-b">${kpiChart()}</div></div>
    <div class="panel"><div class="panel-h"><h3>Coming up</h3><small>next 60 days</small></div>${sm.upcoming.filter(u => u.days >= 0).length ? `<ul class="alist">${sm.upcoming.filter(u => u.days >= 0).slice(0, 7).map(u => `<li data-a="open" data-col="${u.type}" data-id="${u.id}"><span class="sev b"></span><div><b>${esc(u.title)}</b><small>${fmtDate(u.date)} · ${u.days === 0 ? 'today' : 'in ' + u.days + ' days'}</small></div><span class="tag">${chip(u.type === 'insp' ? 'Inspection' : 'Action due', 'blue')}</span></li>`).join('')}</ul>` : '<div class="empty"><b>Quiet period</b>No inspections or actions fall due in the next 60 days.</div>'}</div></div>`;
  }

  /* ---------- alerts ---------- */
  function alertsView() {
    const sm = S.sm, d = P.buildDigest(S.db, S.settings, S.t);
    const rec = S.settings.recipients;
    return `<div class="page-head"><div><h2>Alerts & notifications</h2><p>Everything that needs a decision today. The same list goes out by email to the people you choose in Settings.</p></div><div class="sp"><button class="btn" data-a="preview">Preview email</button><button class="btn primary" data-a="senddigest">${ic('send')}Send digest now</button></div></div>
    <div class="note ${rec.length ? '' : 'warn'}" style="margin-bottom:16px">${rec.length ? `Digest goes to ${rec.map(esc).join(', ')}${S.mode === 'server' && S.settings.digestEnabled ? ` and is sent automatically every day at ${String(S.settings.digestHour).padStart(2, '0')}:00 (${esc(S.settings.timezone)}).` : '.'}` : 'No email recipients yet. Add them under <a href="#/settings">Settings</a> to switch on notifications.'}</div>
    <div class="grid g-2"><div class="panel"><div class="panel-h"><h3>Needs attention</h3><small>${sm.attention.length}</small></div>${attList(sm.attention, 100)}</div>
    <div class="panel"><div class="panel-h"><h3>Coming up</h3><small>next 60 days</small></div>${sm.upcoming.filter(u => u.days >= 0).length ? `<ul class="alist">${sm.upcoming.filter(u => u.days >= 0).map(u => `<li data-a="open" data-col="${u.type}" data-id="${u.id}"><span class="sev b"></span><div><b>${esc(u.title)}</b><small>${fmtDate(u.date)} · ${u.days === 0 ? 'today' : 'in ' + u.days + ' days'}</small></div></li>`).join('')}</ul>` : '<div class="empty"><b>Quiet period</b>Nothing falls due in the next 60 days.</div>'}</div></div>
    <div class="panel" style="margin-top:18px"><div class="panel-h"><h3>Recent activity</h3></div><div class="panel-b">${logHtml(S.db.log.slice(-12).reverse())}</div></div>`;
  }
  const logHtml = l => l.length ? `<ul class="log">${l.map(e => `<li><b>${esc(e.by)}</b> ${esc(e.action)} ${esc(e.label)} <small>· ${new Date(e.ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></li>`).join('')}</ul>` : '<div style="color:var(--muted)">No activity recorded yet.</div>';

  /* ---------- timeline ---------- */
  function timeline() {
    const Tl = S.tl, start = P.addDays(S.t, -45), days = Math.round(Tl.months * 30.4), end = P.addDays(start, days);
    const pos = d => Math.max(0, Math.min(100, P.diffDays(P.parse(d.slice(0, 10)), P.parse(start)) / days * 100));
    const q = Tl.q.toLowerCase(), okAsset = r => !S.asset || r.asset === S.asset, okQ = r => !q || JSON.stringify(r).toLowerCase().includes(q);
    const LC = { overdue: 'red', soon: 'amber', ok: 'green', none: 'grey', expired: 'red', norisk: 'red', long: 'amber', active: 'amber', closed: 'grey', progress: 'blue', open: 'blue' };
    const row = (col, r, title, sub, bars, ms) => `<div class="tl-row" data-a="open" data-col="${col}" data-id="${r.id}"><div class="tl-lab"><b>${esc(title)}</b><small>${esc(sub)}</small></div><div class="tl-track">${bars}${ms || ''}</div></div>`;
    const bar = (a, b, c, soft) => { const l = pos(a), w = Math.max(.7, pos(b) - l); return `<span class="tl-bar ${c} ${soft ? 'soft' : ''}" style="left:${l}%;width:${w}%"></span>`; };
    const dia = (d, c) => d >= start && d <= end ? `<span class="tl-ms tl-bar ${c}" style="left:${pos(d)}%;top:10px;height:20px;border-radius:3px"></span>` : '';
    let out = '';
    if (Tl.types.insp) { const rs = S.db.insp.filter(okAsset).filter(okQ).map(r => ({ r, i: iI(r) })).filter(x => x.i.next).sort((a, b) => a.i.next.localeCompare(b.i.next));
      out += `<div class="tl-group">Inspections & tests · last test to next due</div>` + rs.map(({ r, i }) => row('insp', r, `${r.tag} · ${r.type}`, `${r.asset || ''} · ${i.state === 'overdue' ? 'overdue ' + (-i.days) + ' d' : 'due ' + fmtDate(i.next)}`, bar(r.last, i.next, LC[i.state], true) + dia(i.next, LC[i.state]))).join(''); }
    if (Tl.types.ovr) { const rs = S.db.ovr.filter(okAsset).filter(okQ).filter(r => r.start && r.end);
      out += `<div class="tl-group">Barrier overrides · start to end</div>` + rs.map(r => { const i = oI(r); return row('ovr', r, `${r.tag} · ${r.type}`, `${r.asset || ''} · ${i.state === 'closed' ? 'closed' : i.state}`, bar(r.start, r.end, LC[i.state])); }).join(''); }
    if (Tl.types.act) { const rs = S.db.act.filter(okAsset).filter(okQ).filter(r => r.identified && r.target);
      out += `<div class="tl-group">Actions · identified to target closure</div>` + rs.map(r => { const i = aI(r); return row('act', r, `${r.tag} · ${P.short(r.corrective || r.desc, 40)}`, `${r.owner || 'Unassigned'} · ${i.label}${i.state === 'overdue' ? ' ' + (-i.days) + ' d' : ''}`, bar(r.identified, r.target, LC[i.state]) + dia(r.target, LC[i.state])); }).join(''); }
    const months = []; let d = P.parse(start); d = new Date(d.getFullYear(), d.getMonth(), 1); while (P.iso(d) <= end) { const iso = P.iso(d); if (iso >= start) months.push(`<span style="left:${pos(iso)}%">${fmtMonth(iso)}</span>`); d.setMonth(d.getMonth() + 1); }
    const grid = (() => { const g = []; let m = P.parse(start); m = new Date(m.getFullYear(), m.getMonth() + 1, 1); while (P.iso(m) <= end) { g.push(`<div class="tl-grid" style="left:${pos(P.iso(m))}%"></div>`); m.setMonth(m.getMonth() + 1); } return g.join(''); })();
    const tp = pos(S.t);
    return `<div class="page-head"><div><h2>Timeline</h2><p>See every test cycle, override window and action deadline on one axis. Red bars have missed their date.</p></div><div class="sp">${[3, 6, 12].map(m => `<button class="pill" aria-pressed="${Tl.months === m}" data-a="tlmonths" data-id="${m}">${m} months</button>`).join('')}</div></div>
    <div class="filters">${[['insp', 'Inspections'], ['ovr', 'Overrides'], ['act', 'Actions']].map(([k, l]) => `<button class="pill" aria-pressed="${!!Tl.types[k]}" data-a="tltype" data-id="${k}">${l}</button>`).join('')}<span style="flex:1"></span>${assetSelect()}<input class="search" type="search" placeholder="Filter timeline…" value="${esc(Tl.q)}" data-in="tlq" aria-label="Filter timeline"></div>
    <div class="tl"><div class="tl-in"><div class="tl-head"><div class="tl-lab"><b>Item</b></div><div class="tl-months">${months.join('')}</div></div>${out || '<div class="empty"><b>Nothing to plot</b>Turn on a type above or add records with dates.</div>'}
    <div style="position:absolute;top:34px;bottom:0;left:250px;right:0;pointer-events:none">${grid}</div>
    <div class="tl-today" style="left:calc(250px + (100% - 250px) * ${tp / 100})"><span>Today</span></div></div></div>
    <div class="legend" style="color:var(--muted);margin-top:12px"><span><i style="background:var(--green)"></i>On track</span><span><i style="background:var(--amber)"></i>Due soon / active</span><span><i style="background:var(--red)"></i>Overdue / expired</span><span><i style="background:var(--blue)"></i>In progress</span><span>Faded bar = time since last test. Diamond = due date.</span></div>`;
  }

  /* ---------- documents ---------- */
  function allDocs() { const out = []; ['sce', 'insp', 'ovr', 'act', 'kpi'].forEach(col => S.db[col].forEach(r => (r.docs || []).forEach(d => out.push({ d, col, r })))); return out.sort((a, b) => (b.d.added || '').localeCompare(a.d.added || '')); }
  const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : (n || 0) + ' B';
  const ext = n => (/\.([a-z0-9]{1,4})$/i.exec(n) || [, 'file'])[1];
  function docsView() {
    const q = (S.q.docs || '').toLowerCase(), list = allDocs().filter(x => !q || (x.d.name + ' ' + label(x.col, x.r) + ' ' + (x.d.by || '')).toLowerCase().includes(q));
    return `<div class="page-head"><div><h2>Documents</h2><p>Every file and link attached to an SCE, inspection, override or action, in one searchable place. Open a record to add more.</p></div></div>
    <div class="filters"><input class="search" type="search" placeholder="Search documents…" value="${esc(S.q.docs || '')}" data-in="q" data-col="docs" aria-label="Search documents"></div>
    <div class="panel" id="tbl">${docsTable(list)}</div>`;
  }
  const docsTable = list => list.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Document</th><th>Attached to</th><th>Module</th><th>Size</th><th>Added</th></tr></thead><tbody>${list.map(({ d, col, r }) => `<tr data-a="open" data-col="${col}" data-id="${r.id}"><td><b>${esc(d.name)}</b></td><td>${esc(label(col, r))}</td><td>${chip(SCHEMA[col].name)}</td><td>${d.kind === 'link' ? 'Link' : fmtSize(d.size)}</td><td>${esc(d.by || '')} · ${fmtDate((d.added || '').slice(0, 10))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty"><b>No documents yet</b>Open any record and drop files into its Documents section: permits, inspection reports, photos, certificates.</div>`;

  /* ---------- summary sheet ---------- */
  function summaryView() {
    const sm = S.sm, s = S.settings, { I, O, A, B } = sm, k = kpiSorted().slice(-6);
    const tbl = (head, rows) => rows.length ? `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p style="color:#5b6b75">None.</p>';
    const open = S.db.act.filter(a => a.status !== 'Closed').sort((a, b) => ('HML'.indexOf(a.risk) - 'HML'.indexOf(b.risk)) || (a.target || '').localeCompare(b.target || ''));
    return `<div class="page-head"><div><h2>Summary sheet</h2><p>One printable page for review meetings and client reporting.</p></div><div class="sp"><button class="btn" data-a="xlsx">${ic('down')}Excel workbook</button><button class="btn primary" data-a="print">${ic('print')}Print or save as PDF</button></div></div>
    <article class="sheet"><div style="display:flex;gap:18px;align-items:flex-start;justify-content:space-between"><div><h1>${esc(s.project)}</h1><div class="meta">${s.client ? 'Prepared for ' + esc(s.client) + ' · ' : ''}${s.org ? esc(s.org) + ' · ' : ''}${esc(s.location)}${s.bidRef ? ' · Ref ' + esc(s.bidRef) : ''}</div><div class="meta">Report date ${fmtDate(S.t)}</div></div>${s.logo ? `<img src="${esc(s.logo)}" alt="" style="max-height:60px;max-width:160px">` : ''}</div>
    <div class="kpis"><div><b style="color:${sm.index >= 75 ? '#1f9d6b' : sm.index >= 60 ? '#c98200' : '#d6382f'}">${sm.index}</b><span>Health index · ${sm.rating}</span></div><div><b>${I.onTimePct}%</b><span>Inspections on time (${I.overdue} overdue of ${I.total})</span></div><div><b>${O.open}</b><span>Open overrides (${O.expired + O.norisk} non-compliant)</span></div><div><b>${A.open}</b><span>Open actions (${A.overdue} overdue)</span></div></div>
    <h2>Barrier integrity</h2><p style="margin:0 0 6px">${B.total} safety-critical elements: ${B.green} healthy, ${B.amber} on watch, ${B.red} needing action, ${B.grey} not yet assured. ${B.preventive} preventive and ${B.mitigative} mitigative barriers.</p>${strip(sm, false)}
    <h2>Performance by asset</h2>${tbl(['Asset', 'SCEs', 'Barrier health', 'Overdue inspections', 'Open overrides', 'Open actions'], sm.perAsset.map(p => [`<b>${esc(p.asset)}</b>`, p.sce, `<div style="display:flex;gap:8px;align-items:center"><div class="bar" style="width:90px"><i class="${p.health >= 80 ? 'g' : p.health >= 60 ? 'a' : 'r'}" style="width:${p.health}%"></i></div>${p.health}%</div>`, p.overdue, p.openOvr, p.openAct]))}
    <h2>Needs attention</h2>${tbl(['Item', 'Detail', 'Asset'], sm.attention.slice(0, 15).map(x => [`<b>${esc(x.title)}</b>`, esc(x.sub), esc(x.asset || '')]))}
    <h2>Open actions</h2>${tbl(['Tag', 'Defect', 'Risk', 'Owner', 'Target', 'Status'], open.slice(0, 15).map(a => [`<b>${esc(a.tag)}</b>`, esc(P.short(a.desc, 80)), riskChip(a.risk), esc(a.owner), fmtDate(a.target), actStateChip(aI(a))]))}
    <h2>Open barrier overrides</h2>${tbl(['Tag', 'Type', 'Window', 'Hours', 'Risk assessed', 'Status'], S.db.ovr.filter(o => o.status !== 'Closed').map(o => [`<b>${esc(o.tag)}</b>`, esc(o.type), `${fmtDate(o.start)} to ${fmtDate(o.end)}`, oI(o).hours, esc(o.risk), ovrStateChip(oI(o))]))}
    <h2>Process safety KPIs</h2>${tbl(['Month', 'Population', 'Verified', '% verified', 'Overdue', '% overdue', 'LOPC', 'HiPo', 'Overrides'], k.map(r => [fmtMonth(r.month), r.pop, r.verified, pct(r.verified, r.pop) + '%', r.overdue, pct(r.overdue, r.pop) + '%', r.lopc, r.hipo, r.overrides]))}
    <p style="margin-top:26px;color:#5b6b75;font-size:12.5px">Health index = 40% inspections on time + 25% actions on time + 20% overrides controlled + 15% test results (a Fail counts fully, a Conditional counts half).</p></article>`;
  }

  /* ---------- settings ---------- */
  const sw = (k, l, sub, v) => `<label class="switch"><input type="checkbox" data-set="${k}" ${v ? 'checked' : ''}><span>${l}${sub ? `<br><small style="color:var(--muted)">${sub}</small>` : ''}</span></label>`;
  const inp = (k, l, v, o = {}) => `<label class="f ${o.full ? 'full' : ''}"><span>${l}</span><input ${o.type ? `type="${o.type}"` : ''} data-set="${k}" value="${esc(v)}" placeholder="${esc(o.ph || '')}">${o.hint ? `<small>${o.hint}</small>` : ''}</label>`;
  function settingsView() {
    const s = S.settings, R = s.rules, srv = S.mode === 'server', em = S.info.email || {};
    return `<div class="page-head"><div><h2>Settings</h2><p>Branding, who gets notified and how, and your data. Changes save automatically.</p></div></div>
    <div class="grid" style="max-width:920px">
    <div class="panel"><div class="panel-h"><h3>Project & branding</h3></div><div class="panel-b set-grid">
      ${inp('project', 'Project name', s.project)}${inp('client', 'Client', s.client, { ph: 'Who the report is prepared for' })}${inp('org', 'Your organisation', s.org)}${inp('bidRef', 'Bid / contract reference', s.bidRef)}${inp('location', 'Field location', s.location)}${inp('timezone', 'Time zone', s.timezone, { ph: 'Africa/Lagos', hint: 'IANA name, used for "today" and the daily email' })}
      <label class="f full"><span>Logo (shown on the sidebar and summary sheet)</span><input type="file" accept="image/*" data-a="logo"></label>${s.logo ? `<div class="full"><img src="${esc(s.logo)}" alt="Logo" style="max-height:48px"> <button class="btn sm" data-a="rmlogo">Remove logo</button></div>` : ''}</div></div>
    <div class="panel"><div class="panel-h"><h3>Email notifications</h3></div><div class="panel-b">
      <label class="f"><span>Recipients</span><div class="chips-in">${s.recipients.map((r, i) => `<span class="chip blue">${esc(r)} <button data-a="rmrec" data-id="${i}" aria-label="Remove ${esc(r)}">×</button></span>`).join('')}<input type="email" data-in="addrec" placeholder="Type an email and press Enter" aria-label="Add recipient"></div></label>
      <div class="set-grid" style="margin-top:10px"><div>${sw('rules.overdueInspections', 'Overdue inspections', '', R.overdueInspections)}${sw('rules.failedTests', 'Failed tests', '', R.failedTests)}${sw('rules.expiredOverrides', 'Expired or unassessed overrides', '', R.expiredOverrides)}${sw('rules.overdueActions', 'Overdue actions', '', R.overdueActions)}${sw('rules.dueSoon', 'Coming-up list', '', R.dueSoon)}</div>
      <div>${sw('digestEnabled', 'Daily digest email', srv ? 'Sent automatically by the server' : 'Needs server mode; use "Send digest now" on static hosting', s.digestEnabled)}${sw('instantAlerts', 'Instant alerts', 'Email when a test fails or a high-risk action is added (server mode)', s.instantAlerts)}${sw('notifyOwners', 'Remind action owners', 'Each owner receives only their own overdue actions', s.notifyOwners)}
        <label class="f"><span>Digest time (hour, 0–23)</span><input type="number" min="0" max="23" data-set="digestHour" value="${s.digestHour}"></label></div></div>
      <div class="set-grid" style="margin-top:10px">${inp('soonDays', 'Due-soon window (days)', s.soonDays, { type: 'number' })}${inp('rules.overrideMaxHours', 'Flag overrides longer than (hours)', R.overrideMaxHours, { type: 'number', hint: '0 switches this off' })}</div></div></div>
    <div class="panel"><div class="panel-h"><h3>Email delivery</h3><small>${srv ? 'Server mode' : 'Static hosting mode'}</small></div><div class="panel-b">
      ${srv ? `<div class="note ${em.smtp || em.resend ? '' : 'warn'}" style="margin-bottom:12px">${em.smtp ? 'SMTP is configured on the server.' : em.resend ? 'Resend is configured on the server.' : 'No email provider is configured yet. Set SMTP_HOST, SMTP_USER, SMTP_PASS and MAIL_FROM (or RESEND_API_KEY and MAIL_FROM) in your host\'s environment variables. See the README.'}</div>`
        : `<div class="note" style="margin-bottom:12px">This copy is running without a server, so emails go out from your browser. Add free <b>EmailJS</b> details below to send straight from the app. Without them, "Send digest now" opens your own email app with the message filled in. Scheduled daily emails need server mode.</div><div class="set-grid">${inp('emailjs.serviceId', 'EmailJS service ID', s.emailjs.serviceId)}${inp('emailjs.templateId', 'EmailJS template ID', s.emailjs.templateId, { hint: 'Template variables: to_email, subject, message, html' })}${inp('emailjs.publicKey', 'EmailJS public key', s.emailjs.publicKey)}</div>`}
      <div class="set-grid" style="margin-top:10px">${inp('webhook', 'Slack / Teams / Zapier / Make webhook (optional)', s.webhook, { full: 1, ph: 'https://hooks.slack.com/services/…', hint: 'Digest text is posted here as { "text": … }' })}</div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn" data-a="sendtest">${ic('mail')}Send test email</button><button class="btn primary" data-a="senddigest">${ic('send')}Send digest now</button><button class="btn" data-a="preview">Preview</button></div></div></div>
    <div class="panel"><div class="panel-h"><h3>Your data</h3></div><div class="panel-b">
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-a="xlsx">${ic('down')}Export to Excel</button><button class="btn" data-a="json">${ic('down')}Backup (JSON)</button><label class="btn" style="cursor:pointer">${ic('up')}Import Excel or JSON<input type="file" accept=".xlsx,.xls,.json" data-a="import" class="sr"></label><button class="btn" data-a="demo">Load demo data</button><button class="btn danger" data-a="clear">${ic('trash')}Clear all data</button></div>
      <p style="color:var(--muted);font-size:13.5px;margin:12px 0 0">${srv ? 'Data is stored on the server and shared by everyone who signs in.' : 'Data is stored in this browser only. Export a backup regularly, or deploy the server version so a team can share one record.'} Excel import expects the same sheet names and columns as the original NEPL tracker.</p></div></div>
    </div>`;
  }

  /* ---------- drawer ---------- */
  function openDrawer(col, id, preset) {
    const found = id && S.db[col].find(r => r.id === id);
    const rec = found ? clone(found) : Object.assign({ id: P.uid(), docs: [], _new: true }, DEFAULTS[col](), preset || {});
    rec.docs = rec.docs || [];
    S.drawer = { col, rec, added: [] };
    renderDrawer();
  }
  const fieldHtml = (f, rec) => {
    const v = rec[f.k] == null ? '' : rec[f.k], c = f.full ? ' full' : '', d = `data-k="${f.k}"`; let i;
    switch (f.t) {
      case 'area': i = `<textarea ${d}>${esc(v)}</textarea>`; break;
      case 'sel': { const o = f.opts.includes(v) || !v ? f.opts : f.opts.concat(v); i = `<select ${d}>${o.map(x => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${esc((f.labels && f.labels[x]) || x)}</option>`).join('')}</select>`; break; }
      case 'date': i = `<input type="date" ${d} value="${esc(v)}">`; break;
      case 'dt': i = `<input type="datetime-local" ${d} value="${esc(v)}">`; break;
      case 'month': i = `<input type="month" ${d} value="${esc(String(v).slice(0, 7))}">`; break;
      case 'num': i = `<input type="number" ${d} value="${esc(v)}" min="0">`; break;
      case 'email': i = `<input type="email" ${d} value="${esc(v)}" placeholder="name@company.com">`; break;
      case 'tag': i = `<input ${d} list="tags" value="${esc(v)}" autocomplete="off">`; break;
      case 'range': i = `<div class="progress"><input type="range" min="0" max="100" step="5" ${d} value="${+v || 0}" data-out="prog"><b id="prog">${+v || 0}%</b></div>`; break;
      default: i = `<input ${d} value="${esc(v)}">`;
    }
    return `<label class="f${c}"><span>${esc(f.l)}${f.req ? ' *' : ''}</span>${i}${f.hint ? `<small>${f.hint}</small>` : ''}</label>`;
  };
  function autoHtml(col, r) {
    if (col === 'insp') { const i = iI(r); return `<span>Next due <b>${fmtDate(i.next)}</b></span>${inspStateChip(i)}`; }
    if (col === 'ovr') { const i = oI(r); return `<span>Duration <b>${i.hours == null ? '—' : i.hours + ' h'}</b></span>${ovrStateChip(i)}`; }
    if (col === 'act') { const i = aI(r); return `${actStateChip(i)}${i.days != null && i.state !== 'closed' ? `<span>${i.days < 0 ? -i.days + ' days late' : i.days + ' days left'}</span>` : ''}`; }
    if (col === 'kpi') return `<span>% verified <b>${pct(r.verified, r.pop)}%</b></span><span>% overdue <b>${pct(r.overdue, r.pop)}%</b></span>`;
    if (col === 'sce') { const st = S.sm.states[r.id]; return st ? `${chip(...stateChip[st.level])}<span style="color:var(--muted)">${st.reasons.length ? esc(st.reasons.join(' · ')) : st.level === 'grey' ? 'No inspections linked to this tag yet' : 'All linked checks on track'}</span>` : ''; }
    return '';
  }
  const docsHtml = rec => `<div class="drop" data-a="pick" tabindex="0" role="button" aria-label="Add documents">${ic('up')}<div><b>Drop files here</b> or click to browse</div><small>Permits, reports, photos, certificates (up to 25 MB each)</small></div><input type="file" multiple id="filepick" class="sr" tabindex="-1">
    <div style="margin-top:8px"><button class="btn sm" data-a="addlink">${ic('link')}Add a link instead</button></div>
    <ul class="docs">${(rec.docs || []).map((d, i) => `<li><span class="ic ${d.kind === 'link' ? 'link' : ''}">${d.kind === 'link' ? ic('link').replace('<svg', '<svg width="16" height="16"') : esc(ext(d.name))}</span><div class="grow"><a href="#" data-a="opendoc" data-id="${i}">${esc(d.name)}</a><small>${d.kind === 'link' ? esc(d.url) : fmtSize(d.size)} · ${esc(d.by || '')} · ${fmtDate((d.added || '').slice(0, 10))}</small></div><button class="btn sm ghost danger" data-a="deldoc" data-id="${i}" aria-label="Remove ${esc(d.name)}">${ic('trash')}</button></li>`).join('')}</ul>`;
  function linkedHtml(rec) {
    const st = S.sm.states[rec.id]; if (!st) return '';
    const items = [...st.insp.map(r => ['insp', r, r.type, inspStateChip(iI(r))]), ...st.ovr.map(r => ['ovr', r, r.type + ' override', ovrStateChip(oI(r))]), ...st.act.map(r => ['act', r, P.short(r.desc, 50), actStateChip(aI(r))])];
    return `<div class="sec-t">Linked records <small style="color:var(--muted);font-family:var(--font);font-weight:400">${items.length}</small></div>${items.length ? `<ul class="alist" style="border:1px solid var(--line);border-radius:8px">${items.map(([c, r, t, ch]) => `<li data-a="open" data-col="${c}" data-id="${r.id}"><div><b>${esc(t)}</b><small>${SCHEMA[c].one}</small></div><span class="tag">${ch}</span></li>`).join('')}</ul>` : '<div style="color:var(--muted)">Add an inspection with this tag to start assuring this barrier.</div>'}`;
  }
  function renderDrawer() {
    const dr = S.drawer; let layer = $('#layer'); if (!dr) { layer.innerHTML = ''; return; }
    const { col, rec } = dr, sc = SCHEMA[col];
    const title = rec._new ? 'New ' + sc.one.toLowerCase() : (col === 'kpi' ? fmtMonth(rec.month) : rec.tag || sc.one);
    const sub = rec._new ? '' : col === 'sce' ? (rec.desc || '') : [rec.asset, col === 'insp' ? rec.type : ''].filter(Boolean).join(' · ');
    const logs = S.db.log.filter(l => l.rid === rec.id).slice(-6).reverse();
    layer.innerHTML = `<div class="scrim" data-a="closedrawer"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="drawer-h"><div style="flex:1;min-width:0"><h2>${esc(title)}</h2><small>${esc(sub)}</small></div><button class="iconbtn" data-a="closedrawer" aria-label="Close">${ic('x')}</button></div>
    <div class="drawer-b"><datalist id="tags">${S.db.sce.map(s => `<option value="${esc(s.tag)}">${esc(s.desc || '')}</option>`).join('')}</datalist>
    <form class="form" id="rform" onsubmit="return false">${sc.fields.map(f => fieldHtml(f, rec)).join('')}<div class="autobox" id="autobox">${autoHtml(col, rec)}</div></form>
    ${col === 'sce' && !rec._new ? linkedHtml(rec) : ''}
    <div class="sec-t">${ic('clip')} Documents <small style="color:var(--muted);font-family:var(--font);font-weight:400">${(rec.docs || []).length}</small></div><div id="docbox">${docsHtml(rec)}</div>
    ${logs.length ? `<div class="sec-t">History</div>${logHtml(logs)}` : ''}</div>
    <div class="drawer-f"><button class="btn primary" data-a="save">Save</button><button class="btn" data-a="closedrawer">Cancel</button><span style="flex:1"></span>${rec._new ? '' : `<button class="btn danger" data-a="delrec">${ic('trash')}Delete</button>`}</div></aside>`;
    const first = layer.querySelector('input:not([type=range]),select'); if (rec._new && first) first.focus();
  }
  function collect() {
    const dr = S.drawer; if (!dr) return;
    document.querySelectorAll('#rform [data-k]').forEach(el => { let v = el.value; const f = SCHEMA[dr.col].fields.find(f => f.k === el.dataset.k);
      if (f.t === 'num') v = v === '' ? '' : +v; else if (f.t === 'range') v = +v; else if (f.t === 'month') v = v ? v + '-01' : ''; dr.rec[f.k] = v; });
  }
  async function closeDrawer(discard) {
    const dr = S.drawer; if (!dr) return;
    if (discard && dr.rec._new) for (const m of dr.added) await APP.dropFile(m);
    S.drawer = null; renderDrawer();
  }
  async function persistDocs() {
    const dr = S.drawer; if (dr.rec._new) return;
    const stored = S.db[dr.col].find(r => r.id === dr.rec.id); if (!stored) return;
    stored.docs = clone(dr.rec.docs); await APP.upsert(dr.col, stored);
  }
  async function addFiles(files) {
    const dr = S.drawer; collect();
    for (const f of files) { try { const m = await APP.addFile(f); dr.rec.docs.push(m); dr.added.push(m); await persistDocs(); await APP.logEvent('attached ' + f.name + ' to', dr.col, dr.rec, label(dr.col, dr.rec)); toast('Attached ' + f.name); } catch (e) { toast(e.message || 'Could not attach ' + f.name, true); } }
    renderDrawer(); renderChrome();
  }
  async function saveRecord() {
    collect(); const dr = S.drawer, { col, rec } = dr, sc = SCHEMA[col];
    const missing = sc.fields.filter(f => f.req && (rec[f.k] === '' || rec[f.k] == null));
    if (missing.length) return toast('Fill in: ' + missing.map(f => f.l).join(', '), true);
    if (col === 'sce' && S.db.sce.some(s => s.tag === rec.tag && s.id !== rec.id)) return toast('Another SCE already uses the tag ' + rec.tag, true);
    const was = S.db[col].find(r => r.id === rec.id), isNew = rec._new;
    if (col === 'sce' && was && was.tag !== rec.tag) ['insp', 'ovr', 'act'].forEach(c => S.db[c].forEach(r => { if (r.tag === was.tag) { r.tag = rec.tag; APP.upsert(c, r); } }));
    if (col !== 'sce' && col !== 'kpi' && !rec.asset) { const s = S.db.sce.find(s => s.tag === rec.tag); if (s) rec.asset = s.asset; }
    try {
      await APP.upsert(col, rec); await APP.logEvent(isNew ? 'added' : 'updated', col, rec, label(col, rec));
      S.drawer = null; renderDrawer(); render(); toast('Saved');
    } catch (e) { if (e.auth) return showLogin(); toast(e.message || 'Could not save', true); }
  }

  /* ---------- Excel import / export ---------- */
  const XL = 'vendor/xlsx.full.min.js';
  const serial = s => { const d = P.parse(s); return d ? Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 864e5) : ''; };
  const serialDT = s => { const d = P.parseDT(s); return d ? (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) - Date.UTC(1899, 11, 30)) / 864e5 : ''; };
  async function exportXlsx() {
    await APP.loadScript(XL); const X = window.XLSX, wb = X.utils.book_new(), D = S.db;
    const add = (name, head, rows, widths, fix) => { const ws = X.utils.aoa_to_sheet([head, ...rows]); ws['!cols'] = widths.map(w => ({ wch: w })); if (fix) fix(ws); X.utils.book_append_sheet(wb, ws, name); };
    const setC = (ws, a, o) => { ws[a] = Object.assign(ws[a] || {}, o); };
    const sm = S.sm;
    add('Health Summary', ['Measure', 'Value'], [['Report date', S.t], ['Health index', sm.index], ['Rating', sm.rating], ['Inspections on time %', sm.I.onTimePct], ['Overdue inspections', sm.I.overdue], ['Open overrides', sm.O.open], ['Open actions', sm.A.open], ['Overdue actions', sm.A.overdue], ['SCEs needing action', sm.B.red]], [30, 20]);
    add('SCE Master Register', ['S/N', 'Asset', 'Location', 'SCE Tag No', 'SCE Description', 'Barrier Type (Preventive/Mitigative)', 'Performance Standard Ref', 'SIL Rating', 'Risk Ranking (H/M/L)', 'Responsible Owner', 'Regulatory Ref', 'Status (Active/Retired)'], D.sce.map((r, i) => [i + 1, r.asset, r.location, r.tag, r.desc, r.barrier, r.ps, r.sil, r.risk, r.owner, r.reg, r.status]), [6, 20, 20, 14, 36, 22, 18, 10, 14, 20, 18, 14]);
    add('SCE Inspection Tracking', ['S/N', 'Asset', 'SCE Tag No', 'Inspection/Test Type', 'Test Frequency (Days)', 'Last Test Date', 'Next Due Date (Auto)', 'Test Result (Pass/Fail/Conditional)', 'Verification Authority', 'Overdue (Auto)', 'Remarks'],
      D.insp.map((r, i) => { const n = iI(r); return [i + 1, r.asset, r.tag, r.type, +r.freq, serial(r.last), serial(n.next), r.result, r.auth, n.state === 'overdue' ? 'YES' : 'NO', r.remarks]; }), [6, 20, 14, 30, 12, 14, 16, 18, 24, 12, 30], ws => D.insp.forEach((r, i) => { const n = i + 2; setC(ws, 'F' + n, { t: 'n', z: 'dd-mmm-yyyy' }); setC(ws, 'G' + n, { t: 'n', z: 'dd-mmm-yyyy', f: `F${n}+E${n}` }); setC(ws, 'J' + n, { f: `IF(G${n}<TODAY(),"YES","NO")` }); }));
    add('Barrier Overrides', ['Asset', 'SCE Tag No', 'Type (Override/Bypass/Inhibit)', 'Start Date', 'End Date', 'Duration (Hours - Auto)', 'Risk Assessment Conducted (Yes/No)', 'Compensating Measure in Place', 'Approved By', 'Status (Open/Closed)'],
      D.ovr.map(r => [r.asset, r.tag, r.type, serialDT(r.start), serialDT(r.end), oI(r).hours, r.risk, r.comp, r.approver, r.status]), [20, 14, 18, 18, 18, 12, 14, 36, 20, 12], ws => D.ovr.forEach((r, i) => { const n = i + 2; setC(ws, 'D' + n, { t: 'n', z: 'dd-mmm-yyyy hh:mm' }); setC(ws, 'E' + n, { t: 'n', z: 'dd-mmm-yyyy hh:mm' }); setC(ws, 'F' + n, { f: `(E${n}-D${n})*24` }); }));
    add('Defects & Actions', ['Asset', 'SCE Tag No', 'Defect Description', 'Identified Date', 'Risk Level (H/M/L)', 'Temporary Control in Place', 'Corrective Action', 'Action Owner', 'Target Closure Date', 'Status (Open/Closed/Overdue)', 'Progress %', 'Owner Email', 'Documents'],
      D.act.map(r => [r.asset, r.tag, r.desc, serial(r.identified), r.risk, r.temp, r.corrective, r.owner, serial(r.target), aI(r).state === 'overdue' ? 'Overdue' : r.status === 'In Progress' ? 'Open' : r.status, +r.progress || 0, r.ownerEmail, (r.docs || []).map(d => d.name).join('; ')]), [20, 14, 36, 14, 12, 28, 32, 18, 14, 16, 10, 24, 30], ws => D.act.forEach((r, i) => { const n = i + 2; setC(ws, 'D' + n, { t: 'n', z: 'dd-mmm-yyyy' }); setC(ws, 'I' + n, { t: 'n', z: 'dd-mmm-yyyy' }); }));
    add('PS KPI Dashboard', ['Month', 'Total SCE Population', 'Total Verified This Month', '% Verified (Auto)', 'Overdue Inspections', '% Overdue (Auto)', 'Top Event  ', 'LOPC Incidents', 'High Potential Near Misses', 'Active Overrides'],
      kpiSorted().map(r => [serial(r.month), +r.pop, +r.verified, null, +r.overdue, null, r.topEvent, +r.lopc, +r.hipo, +r.overrides]), [12, 14, 14, 12, 12, 12, 30, 10, 14, 14], ws => kpiSorted().forEach((r, i) => { const n = i + 2; setC(ws, 'A' + n, { t: 'n', z: 'mmm-yyyy' }); setC(ws, 'D' + n, { t: 'n', z: '0%', f: `IF(B${n}=0,0,C${n}/B${n})` }); setC(ws, 'F' + n, { t: 'n', z: '0%', f: `IF(B${n}=0,0,E${n}/B${n})` }); }));
    X.writeFile(wb, (S.settings.project || 'Process Safety Tracker').replace(/[^\w]+/g, '_') + '_' + S.t + '.xlsx', { cellDates: false });
  }
  const toISO = v => { if (v == null || v === '') return ''; if (v instanceof Date) return P.iso(new Date(v.getTime() + 12 * 36e5)).slice(0, 10) ; if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10); const s = String(v).trim(); const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; const d = new Date(s); return isNaN(d) ? '' : P.iso(d); };
  const toDT = v => { if (v == null || v === '') return ''; if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 16); } if (v instanceof Date) return new Date(v.getTime() + 12 * 36e5).toISOString().slice(0, 16); const d = new Date(v); return isNaN(d) ? '' : d.toISOString().slice(0, 16); };
  async function importFile(file) {
    let db, settings;
    if (/\.json$/i.test(file.name)) { const j = JSON.parse(await file.text()); db = j.db || j; settings = j.settings; if (!db.sce) throw new Error('This JSON file is not a tracker backup.'); }
    else {
      await APP.loadScript(XL); const X = window.XLSX, wb = X.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      const sh = n => { const k = wb.SheetNames.find(s => s.trim().toLowerCase() === n.toLowerCase()); return k ? X.utils.sheet_to_json(wb.Sheets[k], { header: 1, raw: true, defval: '' }).slice(1).filter(r => r.some(c => c !== '')) : []; };
      const s = v => v == null ? '' : String(v).trim(), n = v => v === '' || v == null ? '' : +v, id = () => P.uid();
      const yn = v => /^y/i.test(s(v)) ? 'Yes' : 'No';
      db = { log: [] };
      db.sce = sh('SCE Master Register').map(r => ({ id: id(), asset: s(r[1]), location: s(r[2]), tag: s(r[3]), desc: s(r[4]), barrier: /mit/i.test(s(r[5])) ? 'Mitigative' : 'Preventive', ps: s(r[6]), sil: s(r[7]) || 'N/A', risk: s(r[8]).toUpperCase().slice(0, 1) || 'M', owner: s(r[9]), reg: s(r[10]), status: /ret/i.test(s(r[11])) ? 'Retired' : 'Active', docs: [] }));
      db.insp = sh('SCE Inspection Tracking').map(r => ({ id: id(), asset: s(r[1]), tag: s(r[2]), type: s(r[3]), freq: n(r[4]) || 90, last: toISO(r[5]), result: ['Pass', 'Fail', 'Conditional'].find(x => x.toLowerCase() === s(r[7]).toLowerCase()) || '', auth: s(r[8]), remarks: s(r[10]), docs: [] }));
      db.ovr = sh('Barrier Overrides').map(r => ({ id: id(), asset: s(r[0]), tag: s(r[1]), type: s(r[2]) || 'Override', start: toDT(r[3]), end: toDT(r[4]), risk: yn(r[6]), comp: s(r[7]), approver: s(r[8]), status: /clos/i.test(s(r[9])) ? 'Closed' : 'Open', docs: [] }));
      db.act = sh('Defects & Actions').map(r => ({ id: id(), asset: s(r[0]), tag: s(r[1]), desc: s(r[2]), identified: toISO(r[3]), risk: s(r[4]).toUpperCase().slice(0, 1) || 'M', temp: s(r[5]), corrective: s(r[6]), owner: s(r[7]), target: toISO(r[8]), status: /clos/i.test(s(r[9])) ? 'Closed' : 'Open', progress: n(r[10]) || 0, ownerEmail: s(r[11]), docs: [] }));
      db.kpi = sh('PS KPI Dashboard').map(r => ({ id: id(), month: toISO(r[0]), pop: n(r[1]), verified: n(r[2]), overdue: n(r[4]), topEvent: s(r[6]), lopc: n(r[7]), hipo: n(r[8]), overrides: n(r[9]), docs: [] }));
    }
    const cnt = ['sce', 'insp', 'ovr', 'act', 'kpi'].map(c => `${(db[c] || []).length} ${SCHEMA[c].name.toLowerCase()}`).join(', ');
    if (!(await confirmDlg('Replace current data?', `Found ${cnt}. This replaces everything in the tracker. Attached documents on existing records will be detached.`, 'Replace data', true))) return;
    ['sce', 'insp', 'ovr', 'act', 'kpi', 'log'].forEach(c => db[c] = db[c] || []);
    S.settings.demo = false; await APP.replaceAll(db, settings); await APP.logEvent('imported data from', 'sce', null, file.name); render(); toast('Imported ' + cnt);
  }

  /* ---------- email ---------- */
  async function emailJS(to, subject, text, html) {
    const ej = S.settings.emailjs; const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_id: ej.serviceId, template_id: ej.templateId, user_id: ej.publicKey, template_params: { to_email: to, subject, message: text, html, project: S.settings.project } }) });
    if (!r.ok) throw new Error('EmailJS refused the message (' + r.status + '): ' + (await r.text()).slice(0, 120));
  }
  async function sendDigest(test) {
    const link = location.href.split('#')[0], d = P.buildDigest(S.db, S.settings, S.t, { link }), rec = S.settings.recipients;
    try {
      if (S.mode === 'server') { const j = await APP.req('POST', '/email/' + (test ? 'test' : 'digest'), { link }); return toast(j.message || 'Sent'); }
      if (!rec.length && !S.settings.webhook) return toast('Add at least one recipient in Settings first.', true);
      const ej = S.settings.emailjs, subj = test ? '[Test] ' + d.subject : d.subject, body = test ? 'This is a test message from your Process Safety Tracker. Notifications are working.' : d.text;
      if (rec.length) { if (ej.serviceId && ej.templateId && ej.publicKey) { for (const to of rec) await emailJS(to, subj, body, test ? '<p>' + esc(body) + '</p>' : d.html); toast('Sent to ' + rec.length + ' recipient' + (rec.length > 1 ? 's' : '')); }
        else { location.href = 'mailto:' + rec.join(',') + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent(body.slice(0, 1800)); toast('Opening your email app. Add EmailJS in Settings to send directly.'); } }
      if (S.settings.webhook) { await fetch(S.settings.webhook, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ text: subj + '\n\n' + body }) }); toast('Posted to webhook'); }
    } catch (e) { if (e.auth) return showLogin(); toast(e.message || 'Could not send', true); }
  }
  function previewDigest() {
    const d = P.buildDigest(S.db, S.settings, S.t, { link: location.href.split('#')[0] });
    dialog(`<h3>Email preview</h3><p style="margin-bottom:8px"><b>Subject:</b> ${esc(d.subject)}</p><div class="preview">${d.html}</div><div class="acts" style="margin-top:14px"><button class="btn primary" data-r="1">Close</button></div>`, (dl, close) => dl.querySelector('[data-r]').onclick = () => close());
    document.querySelector('.dlg-b').style.maxWidth = '700px';
  }

  /* ---------- shell ---------- */
  const NAV = [['dashboard', 'Dashboard', 'dash'], ['alerts', 'Alerts', 'bell'], ['timeline', 'Timeline', 'time'], ['sep'], ['sce', 'SCE register', 'shield'], ['insp', 'Inspections', 'check'], ['ovr', 'Overrides', 'unlock'], ['act', 'Actions', 'flag'], ['kpi', 'KPIs', 'chart'], ['sep'], ['docs', 'Documents', 'folder'], ['summary', 'Summary sheet', 'doc'], ['settings', 'Settings', 'gear']];
  const TITLES = { dashboard: 'Dashboard', alerts: 'Alerts', timeline: 'Timeline', sce: 'SCE register', insp: 'Inspections', ovr: 'Overrides', act: 'Actions', kpi: 'KPIs', docs: 'Documents', summary: 'Summary sheet', settings: 'Settings' };
  function chrome() {
    const sm = S.sm, s = S.settings, n = sm.attention.length;
    return `<aside class="side" id="side"><div class="brand"><div class="brand-mark">${s.logo ? `<img src="${esc(s.logo)}" alt="">` : `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#241700" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>`}</div><div><b>${esc(s.project)}</b><small>${esc(s.client ? 'for ' + s.client : s.location)}</small></div></div>
    <nav class="nav" aria-label="Main">${NAV.map(i => i[0] === 'sep' ? '<div class="sep"></div>' : `<button data-a="nav" data-id="${i[0]}" ${S.view === i[0] ? 'aria-current="page"' : ''}>${ic(i[2])}${i[1]}${i[0] === 'alerts' && n ? `<span class="count">${n}</span>` : ''}</button>`).join('')}</nav>
    <div class="side-foot"><b>${esc(S.user || 'Guest')}</b><br>${S.mode === 'server' ? 'Shared workspace' : 'Saved in this browser'}</div></aside>`;
  }
  function topbar() {
    const sm = S.sm, { I, A, O } = sm, n = sm.attention.length;
    return `<header class="top"><button class="iconbtn menu-btn" data-a="menu" aria-label="Open menu">${ic('menu')}</button><h1>${TITLES[S.view]}</h1>
    <div class="meters" aria-label="Status bar"><div class="meter"><div class="row"><span>Inspections on time</span><b>${I.onTimePct}%</b></div>${segBar(I.ok, I.soon, I.overdue)}</div><div class="meter"><div class="row"><span>Actions closed</span><b>${A.closedPct}%</b></div>${segBar(A.closed, A.open - A.overdue, A.overdue)}</div><div class="meter"><div class="row"><span>Overrides controlled</span><b>${O.controlledPct}%</b></div>${segBar(O.controlled, 0, O.open - O.controlled)}</div><div class="meter" style="min-width:90px"><div class="row"><span>Health index</span><b>${sm.empty ? '–' : sm.index}</b></div><div class="bar"><i class="${sm.index >= 75 ? 'g' : sm.index >= 60 ? 'a' : 'r'}" style="width:${sm.index}%"></i></div></div></div>
    <div class="top-actions"><button class="iconbtn" data-a="nav" data-id="alerts" aria-label="${n} alerts">${ic('bell')}${n ? `<span class="dot">${n}</span>` : ''}</button><button class="iconbtn" data-a="theme" aria-label="Switch colour theme">${ic(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}</button></div></header>`;
  }
  const VIEWS = { dashboard, alerts: alertsView, timeline, docs: docsView, summary: summaryView, settings: settingsView, sce: () => listView('sce'), insp: () => listView('insp'), ovr: () => listView('ovr'), act: () => listView('act'), kpi: () => listView('kpi') };
  function render() {
    S.t = P.todayISO(S.settings.timezone); S.sm = P.summarize(S.db, S.settings, S.t);
    const demo = S.settings.demo ? `<div class="demo-banner"><b>Demo data</b> Sample records are loaded so you can explore. Clear them when you are ready to enter real data.<button class="btn sm" data-a="clear">Clear demo data</button></div>` : '';
    $('#root').innerHTML = `<div id="app">${chrome()}<div class="main">${topbar()}<main class="content" id="content">${demo}${VIEWS[S.view]()}</main></div></div><div id="layer"></div>`;
    if (S.drawer) renderDrawer(); document.title = (S.settings.project || 'Process Safety Tracker') + ' · ' + TITLES[S.view];
  }
  function renderChrome() { S.sm = P.summarize(S.db, S.settings, S.t); $('.side') && ($('.side').outerHTML = chrome()); $('.top') && ($('.top').outerHTML = topbar()); }
  function go(v) { S.view = v; if (location.hash !== '#/' + v) history.replaceState(null, '', '#/' + v); S.drawer = null; render(); window.scrollTo(0, 0); }

  /* ---------- actions ---------- */
  const setPath = (o, p, v) => { const k = p.split('.'); while (k.length > 1) o = o[k.shift()]; o[k[0]] = v; };
  let saveT; const saveSoon = () => { clearTimeout(saveT); saveT = setTimeout(() => APP.saveSettings().catch(e => e.auth ? showLogin() : toast(e.message, true)), 500); };
  const A = {
    nav: el => go(el.dataset.id),
    menu: () => $('#side').classList.toggle('open'),
    theme: () => { const d = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = d; APP.lsSet('ps_theme', d); renderChrome(); },
    open: el => { if (S.drawer) S.drawer = null; openDrawer(el.dataset.col, el.dataset.id); },
    new: el => openDrawer(el.dataset.col),
    sort: el => { const c = el.dataset.col, i = +el.dataset.i; if (!TABLES[c][i].h) return; const o = S.sort[c]; S.sort[c] = o && o.i === i ? (o.d > 0 ? { i, d: -1 } : null) : { i, d: 1 }; if (!S.sort[c]) delete S.sort[c]; $('#tbl').innerHTML = tableHtml(c); },
    filter: el => { S.flt[el.dataset.col] = el.dataset.id; render(); },
    closedrawer: () => closeDrawer(true),
    save: saveRecord,
    delrec: async () => { const { col, rec } = S.drawer; if (!(await confirmDlg('Delete this record?', `${label(col, rec) || SCHEMA[col].one} and its attached documents will be removed. This cannot be undone.`, 'Delete', true))) return; for (const d of rec.docs || []) await APP.dropFile(d); await APP.remove(col, rec.id); await APP.logEvent('deleted', col, rec, label(col, rec)); S.drawer = null; render(); toast('Deleted'); },
    pick: () => $('#filepick').click(),
    addlink: async () => { collect(); const r = await promptDlg('Add a link', [{ k: 'name', l: 'Title', ph: 'e.g. Permit to work PTW-2231', req: 1 }, { k: 'url', l: 'Web address', type: 'url', ph: 'https://', req: 1 }], 'Add link', 'Link to a file on SharePoint, Google Drive, OneDrive or any web page.'); if (!r) return; const m = { id: P.uid(), kind: 'link', name: r.name, url: r.url, added: new Date().toISOString(), by: S.user || 'User' }; S.drawer.rec.docs.push(m); await persistDocs(); await APP.logEvent('linked ' + r.name + ' to', S.drawer.col, S.drawer.rec, label(S.drawer.col, S.drawer.rec)); renderDrawer(); renderChrome(); },
    opendoc: (el, e) => { e.preventDefault(); APP.openDoc(S.drawer.rec.docs[+el.dataset.id]); },
    deldoc: async el => { collect(); const dr = S.drawer, d = dr.rec.docs[+el.dataset.id]; if (!(await confirmDlg('Remove document?', d.name + ' will be removed from this record.', 'Remove', true))) return; dr.rec.docs.splice(+el.dataset.id, 1); await APP.dropFile(d); await persistDocs(); renderDrawer(); renderChrome(); },
    tlmonths: el => { S.tl.months = +el.dataset.id; render(); }, tltype: el => { S.tl.types[el.dataset.id] = S.tl.types[el.dataset.id] ? 0 : 1; render(); },
    print: () => window.print(), xlsx: () => exportXlsx().catch(e => toast(e.message, true)),
    json: () => APP.download('tracker-backup-' + S.t + '.json', new Blob([JSON.stringify({ db: S.db, settings: S.settings }, null, 1)], { type: 'application/json' })),
    senddigest: () => sendDigest(false), sendtest: () => sendDigest(true), preview: previewDigest,
    kpisync: async () => { const m = thisMonth(), sm = S.sm; let r = S.db.kpi.find(k => k.month === m); const verified = S.db.insp.filter(i => (i.last || '').slice(0, 7) === m.slice(0, 7)).length;
      r = Object.assign(r || { id: P.uid(), month: m, lopc: 0, hipo: 0, topEvent: '', docs: [] }, { pop: sm.B.total, verified, overdue: sm.I.overdue, overrides: sm.O.open }); await APP.upsert('kpi', r); await APP.logEvent('synced', 'kpi', r, fmtMonth(m)); render(); toast('Filled ' + fmtMonth(m) + ' from live data'); },
    rmrec: el => { S.settings.recipients.splice(+el.dataset.id, 1); APP.saveSettings(); render(); },
    rmlogo: () => { S.settings.logo = ''; APP.saveSettings(); render(); },
    demo: async () => { if (!(await confirmDlg('Load demo data?', 'This replaces everything in the tracker with sample records.', 'Load demo data', true))) return; await APP.replaceAll(P.seed(S.t)); S.settings.demo = true; await APP.saveSettings(); render(); toast('Demo data loaded'); },
    clear: async () => { if (!(await confirmDlg('Clear all data?', 'Every record and activity entry is removed. Export a backup first if you might need it.', 'Clear everything', true))) return; await APP.replaceAll({ sce: [], insp: [], ovr: [], act: [], kpi: [], log: [] }); S.settings.demo = false; await APP.saveSettings(); render(); toast('Tracker is empty'); }
  };
  document.addEventListener('click', e => { const el = e.target.closest('[data-a]'); if (!el || !A[el.dataset.a]) return; if (el.tagName === 'INPUT') return; A[el.dataset.a](el, e); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && S.drawer && !document.querySelector('.dlg')) closeDrawer(true);
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.drop')) { e.preventDefault(); $('#filepick').click(); }
    if (e.key === 'Enter' && e.target.dataset && e.target.dataset.in === 'addrec') { e.preventDefault(); addRecipient(e.target); }
  });
  function addRecipient(el) { const v = el.value.trim().replace(/,$/, ''); if (!v) return; if (!/^\S+@\S+\.\S+$/.test(v)) return toast('That does not look like an email address.', true); if (!S.settings.recipients.includes(v)) S.settings.recipients.push(v); APP.saveSettings(); render(); }
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.in === 'q') { S.q[el.dataset.col] = el.value; const t = $('#tbl'); if (t) t.innerHTML = el.dataset.col === 'docs' ? docsTable(allDocs().filter(x => (x.d.name + ' ' + label(x.col, x.r)).toLowerCase().includes(el.value.toLowerCase()))) : tableHtml(el.dataset.col); }
    else if (el.dataset.in === 'tlq') { S.tl.q = el.value; clearTimeout(el._t); el._t = setTimeout(() => { render(); const i = $('[data-in=tlq]'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); }
    else if (el.closest('#rform') && S.drawer) {
      if (el.dataset.out) $('#' + el.dataset.out).textContent = el.value + '%';
      collect(); const dr = S.drawer;
      if (el.dataset.k === 'tag' && dr.col !== 'sce') { const s = S.db.sce.find(s => s.tag === el.value); if (s) { const a = document.querySelector('#rform [data-k=asset]'); if (a) { a.value = s.asset; dr.rec.asset = s.asset; } } }
      $('#autobox').innerHTML = autoHtml(dr.col, dr.rec);
    }
  });
  document.addEventListener('change', async e => {
    const el = e.target;
    if (el.dataset.in === 'asset') { S.asset = el.value; render(); }
    else if (el.dataset.set) { const p = el.dataset.set; let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value.trim(); setPath(S.settings, p, v); saveSoon(); if (['project', 'client', 'location', 'timezone', 'soonDays', 'rules.overrideMaxHours'].includes(p)) renderChrome(); }
    else if (el.dataset.in === 'addrec') addRecipient(el);
    else if (el.id === 'filepick') { const f = [...el.files]; el.value = ''; addFiles(f); }
    else if (el.dataset.a === 'logo' && el.files[0]) { const f = el.files[0]; if (f.size > 400000) return toast('Logo must be under 400 KB.', true); const r = new FileReader(); r.onload = () => { S.settings.logo = r.result; APP.saveSettings(); render(); }; r.readAsDataURL(f); }
    else if (el.dataset.a === 'import' && el.files[0]) { const f = el.files[0]; el.value = ''; try { await importFile(f); } catch (err) { toast(err.message || 'Import failed', true); } }
  });
  ['dragover', 'dragenter'].forEach(t => document.addEventListener(t, e => { const d = e.target.closest && e.target.closest('.drop'); if (d) { e.preventDefault(); d.classList.add('over'); } }));
  ['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { const d = e.target.closest && e.target.closest('.drop'); if (d) { e.preventDefault(); d.classList.remove('over'); if (t === 'drop' && e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); } }));
  window.addEventListener('hashchange', () => { const v = location.hash.replace('#/', ''); if (TITLES[v] && v !== S.view) go(v); });

  /* ---------- login + boot ---------- */
  function showLogin(msg) {
    $('#root').innerHTML = `<div class="login"><form id="lf"><div><h2>${esc(S.settings.project)}</h2><p style="color:var(--muted);margin:6px 0 0">Enter the team password to continue.</p></div><label class="f"><span>Your name</span><input name="name" value="${esc(S.user)}" required autocomplete="name"></label><label class="f"><span>Password</span><input name="pw" type="password" required autocomplete="current-password" autofocus></label>${msg ? `<div class="note warn">${esc(msg)}</div>` : ''}<button class="btn primary" style="justify-content:center">Sign in</button></form></div>`;
    $('#lf').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); S.user = f.name.trim(); APP.lsSet('ps_user', S.user);
      try { const j = await APP.req('POST', '/login', { password: f.pw }); APP.setToken(j.token); boot(true); } catch (err) { showLogin('That password is not right.'); } };
  }
  async function boot(skipDetect) {
    const th = APP.lsGet('ps_theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.dataset.theme = th;
    try {
      if (!skipDetect) await APP.detect();
      if (S.mode === 'server' && S.info.auth && !APP.getToken()) return showLogin();
      await APP.load();
    } catch (e) { if (e.auth) return showLogin(); $('#root').innerHTML = `<div class="login"><div class="dlg-b"><h3>Could not start</h3><p>${esc(e.message || e)}</p></div></div>`; return; }
    const v = location.hash.replace('#/', ''); if (TITLES[v]) S.view = v;
    render();
    if (!S.user) { const r = await promptDlg('Welcome', [{ k: 'name', l: 'Your name', ph: 'Shown in the activity history', req: 1 }], 'Continue', 'Your name is recorded against every change you make.'); S.user = (r && r.name.trim()) || 'User'; APP.lsSet('ps_user', S.user); renderChrome(); }
    if (S.mode === 'server') setInterval(async () => { if (S.drawer || document.querySelector('.dlg')) return; try { const j = await APP.req('GET', '/state'); if (j.rev !== S.rev) { S.db = Object.assign({ sce: [], insp: [], ovr: [], act: [], kpi: [], log: [] }, j.db); S.settings = APP.mergeSettings(j.settings); S.rev = j.rev; render(); } } catch (e) { if (e.auth) showLogin(); } }, 30000);
    setInterval(() => { if (P.todayISO(S.settings.timezone) !== S.t && !S.drawer) render(); }, 60000);
  }
  boot();
})();
