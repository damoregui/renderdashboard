require('./lib/loadEnv');
const path = require('path');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const loginPagePath = path.join(__dirname, 'index.html');
const faviconPath = path.join(__dirname, 'favicon.png');

app.get('/', (_req, res) => {
  res.sendFile(loginPagePath);
});

app.get('/favicon.png', (_req, res) => {
  res.sendFile(faviconPath);
});

function attachHandler(route, handler, options = {}) {
  const { paramsToQuery = [] } = options;
  app.all(route, async (req, res, next) => {
    try {
      paramsToQuery.forEach((param) => {
        if (req.params && Object.prototype.hasOwnProperty.call(req.params, param)) {
          req.query = req.query || {};
          req.query[param] = req.params[param];
        }
      });
      await handler(req, res);
    } catch (err) {
      next(err);
    }
  });
}

attachHandler('/api/login', require('./api/login'));
attachHandler('/api/users', require('./api/users'));
attachHandler('/api/errors', require('./api/errors'));
attachHandler('/api/refresh', require('./api/refresh'));
attachHandler('/api/date-availability', require('./api/date-availability'));
attachHandler('/api/seed', require('./api/seed'));
attachHandler('/api/super-seed', require('./api/super-seed'));
attachHandler('/api/ghl-contact-lookup', require('./api/ghl-contact-lookup'));
attachHandler('/api/metrics', require('./api/metrics'));
attachHandler('/api/tenants', require('./api/tenants'));
attachHandler('/api/ingest', require('./api/ingest'));
attachHandler('/api/usage-day', require('./api/usage-day'));
attachHandler('/api/responder', require('./api/responder'));
attachHandler('/api/forms-submissions', require('./api/forms-submissions'));
attachHandler('/api/cron/daily-ingest', require('./api/cron/daily-ingest'));
attachHandler('/api/app', require('./api/app'));
attachHandler('/api/tenants/:tenantId/ghl/locations', require('./api/tenants/[tenantId]/ghl/locations/index'), {
  paramsToQuery: ['tenantId'],
});
attachHandler('/api/tenants/:tenantId/ghl/locations/:locationId', require('./api/tenants/[tenantId]/ghl/locations/[locationId]'), {
  paramsToQuery: ['tenantId', 'locationId'],
});

app.use((err, _req, res, _next) => {
  console.error('unhandled_error', err && (err.stack || err));
  if (res.headersSent) return;
  res.status(500).json({ ok: false, error: 'server_error' });
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
