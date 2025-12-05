
// Simple HTTP server to run the dashboard on platforms like DigitalOcean App Platform.
// It adapts the existing serverless-style handlers under /api into a single Node process.

const http = require('http');
const fs = require('fs');
const path = require('path');

// --- Helpers ---------------------------------------------------------------

function enhanceReq(req) {
  try {
    const url = new URL(req.url, 'http://localhost');
    req.pathname = url.pathname;
    const query = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (Object.prototype.hasOwnProperty.call(query, key)) {
        const prev = query[key];
        if (Array.isArray(prev)) query[key].push(value);
        else query[key] = [prev, value];
      } else {
        query[key] = value;
      }
    }
    req.query = query;
  } catch {
    req.pathname = req.url || '/';
    req.query = {};
  }
}

function sendNotFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
}

function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405;
  if (allow) res.setHeader('Allow', allow);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: false, error: 'method_not_allowed' }));
}

// --- Static files ----------------------------------------------------------

const ROOT_DIR = __dirname;
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');
const FAVICON_PNG_PATH = path.join(ROOT_DIR, 'favicon.png');

// --- Import handlers -------------------------------------------------------

const appHandler = require('./api/app');
const loginHandler = require('./api/login');
const metricsHandler = require('./api/metrics');
const errorsHandler = require('./api/errors');
const formsSubmissionsHandler = require('./api/forms-submissions');
const dateAvailabilityHandler = require('./api/date-availability');
const ghlContactLookupHandler = require('./api/ghl-contact-lookup');
const ingestHandler = require('./api/ingest');
const refreshHandler = require('./api/refresh');
const responderHandler = require('./api/responder');
const seedHandler = require('./api/seed');
const superSeedHandler = require('./api/super-seed');
const tenantsHandler = require('./api/tenants');
const usageDayHandler = require('./api/usage-day');
const usersHandler = require('./api/users');
const cronDailyIngestHandler = require('./api/cron/daily-ingest');

// --- Server & routing ------------------------------------------------------

const server = http.createServer((req, res) => {
  enhanceReq(req);

  // Very simple health-check endpoint
  if (req.pathname === '/healthz') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok: true, status: 'healthy' }));
  }

  // Static assets for the login page
  if (req.method === 'GET' && req.pathname === '/') {
    fs.readFile(INDEX_HTML_PATH, (err, data) => {
      if (err) {
        console.error('index_read_error', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify({ ok: false, error: 'index_read_error' }));
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET' && req.pathname === '/favicon.png') {
    fs.readFile(FAVICON_PNG_PATH, (err, data) => {
      if (err) {
        res.statusCode = 404;
        return res.end();
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/png');
      res.end(data);
    });
    return;
  }

  // Application routes
  if (req.pathname === '/api/login') {
    if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
    return loginHandler(req, res);
  }

  if (req.pathname === '/api/app') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
    return appHandler(req, res);
  }

  if (req.pathname === '/api/metrics') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
    return metricsHandler(req, res);
  }

  if (req.pathname === '/api/errors') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
    return errorsHandler(req, res);
  }

  if (req.pathname === '/api/forms-submissions') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
    return formsSubmissionsHandler(req, res);
  }

  if (req.pathname === '/api/date-availability') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
    return dateAvailabilityHandler(req, res);
  }

  if (req.pathname === '/api/ghl-contact-lookup') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
    return ghlContactLookupHandler(req, res);
  }

  if (req.pathname === '/api/ingest') {
    if (req.method !== 'POST' && req.method !== 'GET') return sendMethodNotAllowed(res, 'GET,POST');
    return ingestHandler(req, res);
  }

  if (req.pathname === '/api/refresh') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
    return refreshHandler(req, res);
  }

  if (req.pathname === '/api/responder') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
    return responderHandler(req, res);
  }

  if (req.pathname === '/api/seed') {
    if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
    return seedHandler(req, res);
  }

  if (req.pathname === '/api/super-seed') {
    if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
    return superSeedHandler(req, res);
  }

  if (req.pathname === '/api/tenants') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
    return tenantsHandler(req, res);
  }

  if (req.pathname === '/api/usage-day') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET');
    return usageDayHandler(req, res);
  }

  if (req.pathname === '/api/users') {
    if (!['GET', 'POST', 'PUT'].includes(req.method)) return sendMethodNotAllowed(res, 'GET,POST,PUT');
    return usersHandler(req, res);
  }

  if (req.pathname === '/api/cron/daily-ingest') {
    if (req.method !== 'GET' && req.method !== 'POST') return sendMethodNotAllowed(res, 'GET,POST');
    return cronDailyIngestHandler(req, res);
  }

  // Fallback
  return sendNotFound(res);
});

// DigitalOcean sets PORT; default to 8080 locally.
const port = process.env.PORT || 8080;
server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
