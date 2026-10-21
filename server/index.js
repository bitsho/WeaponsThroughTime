'use strict';
/**
 * Weapons Through Time — API + static server.
 *   npm install && npm start      →  http://localhost:3000
 * Env: PORT, WTT_ADMIN_TOKEN (enables write endpoints), WTT_DATA_DIR, WTT_NO_WATCH
 */
const path = require('path');
const express = require('express');
const compression = require('compression');
const { Store } = require('./store');
const api = require('./routes');

const PORT = Number(process.env.PORT) || 3000;
const store = new Store();

const problems = store.validate();
if (problems.length) {
  console.warn(`[data] ${problems.length} validation issue(s):`);
  problems.slice(0, 20).forEach((p) => console.warn('  - ' + p));
}

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

app.use('/api/v1', api(store));
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Weapons Through Time  →  http://localhost:${PORT}   (${store.state.aircraft.length} aircraft, ${store.state.conflicts.length} events)`));
}
module.exports = app;
