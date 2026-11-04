const PS = require('./public/shared.js');
const t = PS.todayISO('Africa/Lagos');
const db = PS.seed(t);
const settings = Object.assign({}, PS.DEFAULT_SETTINGS, {
  project: 'OML 11 JV Process Safety Tracker',
  client: 'NNPC E&P Limited / WAGL OML 11 Limited',
  location: 'OML 11, Niger Delta',
  demo: true,
  digestEnabled: false,
  instantAlerts: false,
});
console.log('seed date', t);
for (const [k, v] of Object.entries(db)) console.log(k, Array.isArray(v) ? v.length : typeof v);
require('fs').writeFileSync(process.env.TEMP + '/opencode/demo-import.json', JSON.stringify({ db, settings }));
console.log('written', (JSON.stringify({ db, settings }).length), 'bytes');
