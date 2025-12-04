// server.js - Express entrypoint for Render deployment
try { require('./lib/loadEnv'); } catch {}

const express = require('express');
const path = require('path');

const app = express();

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- Static assets & root login page ---
const ROOT_DIR = __dirname;

app.get('/', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.get('/favicon.png', (req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'favicon.png'));
});

// --- Helper to bind Vercel-style handlers ---
function bindAll(route, handler) {
  app.all(route, (req, res) => handler(req, res));
}

// Main app HTML (dashboard shell)
const appHandler = require('./api/app');
app.get('/api/app', (req, res) => appHandler(req, res));

// Auth
const loginHandler = require('./api/login');
app.post('/api/login', (req, res) => loginHandler(req, res));

// Simple API routes
bindAll('/api/date-availability', require('./api/date-availability'));
bindAll('/api/forms-submissions', require('./api/forms-submissions'));
bindAll('/api/tenants', require('./api/tenants'));
bindAll('/api/metrics', require('./api/metrics'));
bindAll('/api/errors', require('./api/errors'));
bindAll('/api/users', require('./api/users'));
bindAll('/api/refresh', require('./api/refresh'));
bindAll('/api/responder', require('./api/responder'));
bindAll('/api/cron/daily-ingest', require('./api/cron/daily-ingest'));
bindAll('/api/ingest', require('./api/ingest'));
bindAll('/api/usage-day', require('./api/usage-day'));
bindAll('/api/ghl-contact-lookup', require('./api/ghl-contact-lookup'));
bindAll('/api/seed', require('./api/seed'));
bindAll('/api/super-seed', require('./api/super-seed'));

// Dynamic tenant/location routes (mimic Vercel's query merging)
const locationsIndexHandler = require('./api/tenants/[tenantId]/ghl/locations/index');
app.all('/api/tenants/:tenantId/ghl/locations', (req, res) => {
  req.query = Object.assign({}, req.query, { tenantId: req.params.tenantId });
  return locationsIndexHandler(req, res);
});

const locationsItemHandler = require('./api/tenants/[tenantId]/ghl/locations/[locationId]');
app.all('/api/tenants/:tenantId/ghl/locations/:locationId', (req, res) => {
  req.query = Object.assign({}, req.query, {
    tenantId: req.params.tenantId,
    locationId: req.params.locationId,
  });
  return locationsItemHandler(req, res);
});

// Fallback 404 handler
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'not_found' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[render] Server listening on port ${PORT}`);
});
