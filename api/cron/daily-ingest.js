try { require('../../lib/loadEnv'); } catch {}
const { getDb } = require('../../lib/db');
const { runIngestForTenant } = require('../../lib/ingestRunner');
const { ensureTwilioAuthEncrypted } = require('../../lib/twilio');
const { verifyToken } = require('../../lib/auth');
const { isSuperRole } = require('../../lib/superCtx');

const STAGGER_DELAY_MS = Number(process.env.CRON_INGEST_STAGGER_MS || 1500);
const INITIAL_DELAY_MS = Number(process.env.CRON_INGEST_INITIAL_DELAY_MS || 1000);

function sleep(ms){
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ymdUTC(date){
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2,'0');
  const dd = String(date.getUTCDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function previousUtcDay(){
  const now = new Date();
  now.setUTCHours(0,0,0,0);
  now.setUTCDate(now.getUTCDate() - 1);
  return ymdUTC(now);
}

function activeTenantFilter(){
  return {
    $or: [
      { status: 'active' },
      { status: { $exists: false } },
      { status: null }
    ]
  };
}

async function fetchActiveTenants(db){
  const cursor = db.collection('tenants').find(
    activeTenantFilter(),
    { projection: { _id:1, tenantId:1, name:1, twilio:1 } }
  ).sort({ name: 1 });

  const tenants = [];
  for await (const doc of cursor){
    if (!doc) continue;
    const tenantId = doc.tenantId || (doc._id && doc._id.toString());
    if (!tenantId) continue;
    if (!doc.twilio || (!doc.twilio.accountSid && !doc.twilio.authToken && !doc.twilio.authToken_enc)){
      continue;
    }
    tenants.push(doc);
  }
  return tenants;
}

function sanitizeError(err){
  if (!err) return 'unknown_error';
  if (typeof err === 'string') return err;
  return err.message || 'ingest_failed';
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'POST'){
      res.setHeader('Allow', 'GET, POST');
      res.statusCode = 405;
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok:false, error:'method_not_allowed' }));
    }

    const cronSecret = process.env.CRON_SECRET;
    const providedSecret = (req.headers['x-cron-secret'] || '').toString();
    const hasValidSecret = !!cronSecret && providedSecret === cronSecret;
    const isVercelCron = String(req.headers['x-vercel-cron'] || '').toLowerCase() === 'true';
    let claims = null;
    const authHeader = req.headers['authorization'];
    if (authHeader){
      try {
        claims = verifyToken(authHeader);
      } catch (err) {
        claims = null;
      }
    }
    const hasSuperToken = !!(claims && isSuperRole(claims));
    if (!hasValidSecret && !isVercelCron && !hasSuperToken){
      res.statusCode = 401;
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok:false, error:'unauthorized' }));
    }

    res.setHeader('Content-Type','application/json; charset=utf-8');

    await sleep(INITIAL_DELAY_MS);

    const db = await getDb();
    const tenants = await fetchActiveTenants(db);
    const day = previousUtcDay();

    console.log('[cron] daily updates process initiated', { day, tenants: tenants.length });

    const results = [];
    let processed = 0;

    for (const tenant of tenants){
      const info = {
        tenantId: tenant.tenantId || (tenant._id && tenant._id.toString()),
        name: tenant.name || null,
        ok: false
      };
      try {
        await ensureTwilioAuthEncrypted(db, tenant);
        const ingestResult = await runIngestForTenant(db, tenant, day);
        info.ok = true;
        info.stats = {
          fetched: ingestResult?.fetched || 0,
          upserts: ingestResult?.upserts || 0,
          pages: ingestResult?.pages || 0
        };
      } catch (err) {
        info.error = sanitizeError(err);
        console.error('[cron] daily_ingest_error', {
          tenantId: info.tenantId,
          day,
          error: err && (err.stack || err)
        });
      }
      results.push(info);
      processed++;
      if (processed < tenants.length){
        await sleep(STAGGER_DELAY_MS);
      }
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({
      ok: true,
      day,
      tenants: tenants.length,
      processed,
      results
    }));
  } catch (err) {
    console.error('[cron] daily_ingest_fatal', err && (err.stack || err));
    res.statusCode = 500;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:false, error: sanitizeError(err) }));
  }
};
