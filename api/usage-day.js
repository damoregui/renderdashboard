// /api/usage-day.js
// Uses the same auth + DB tenant lookup strategy as the rest of the project.
// Calls Twilio REST Usage API for: mms-inbound, mms-outbound, mms-messages-carrierfees, sms-messages-carrierfees
// Accepts ?from=YYYY-MM-DD&to=YYYY-MM-DD (or ?date=YYYY-MM-DD for a single day).

try { require('../lib/loadEnv'); } catch {}
const { getDb } = require('../lib/db');
const { verifyToken } = require('../lib/auth');
const { tenantIdFromClaims, isSuperRole, buildTenantFilter } = require('../lib/superCtx');
const { resolveTwilioCredentials, ensureTwilioAuthEncrypted } = require('../lib/twilio');

function b64(s){ return Buffer.from(s).toString("base64"); }

async function resolveTenantTwilioCreds(req){
  // 1) allow explicit override via query for testing
  const q = req.query || {};
  if (q.accountSid && q.authToken){
    return { accountSid: String(q.accountSid).trim(), authToken: String(q.authToken).trim() };
  }

  // 2) Resolve from tenant using the same flow as /api/metrics and /api/ingest
  const claims = verifyToken(req.headers['authorization']); // throws if invalid/missing
  const _over = String((req.headers['x-tenant-override']||'').trim());
  const _isSuper = isSuperRole(claims);
  const baseTenantId = tenantIdFromClaims(claims);
  const tenantId = (_isSuper && _over) ? _over : baseTenantId;
  if (!tenantId) throw new Error('tenant_required');
  const db = await getDb();
  const tenantFilter = buildTenantFilter(tenantId);
  const tenant = tenantFilter ? await db.collection('tenants').findOne(tenantFilter) : null;
  if (!tenant) throw new Error('tenant_not_found');

  await ensureTwilioAuthEncrypted(db, tenant);

  let creds;
  try {
    creds = resolveTwilioCredentials(tenant.twilio);
  } catch (err) {
    console.error('[usage-day] twilio_decrypt_failed', {
      tenantId: tenant.tenantId || tenantId,
      err: err && (err.stack || err)
    });
    throw new Error('twilio_credentials_invalid');
  }

  if (!creds) throw new Error('twilio_credentials_missing');
  return creds;
}

function buildUrl(accountSid, params){
  const usp = new URLSearchParams(params);
  return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Usage/Records.json?` + usp.toString();
}

async function fetchCategory({ accountSid, authToken, start, end, category }){
  const url = buildUrl(accountSid, {
    StartDate: start,
    EndDate: end,
    Category: category,
    PageSize: "50"
  });
  const r = await fetch(url, {
    headers: {
      "Authorization": "Basic " + b64(`${accountSid}:${authToken}`)
    }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = (j && (j.message || j.error)) || `HTTP ${r.status}`;
    const e = new Error(`${category}: ${err}`);
    e.status = r.status;
    e.body = j;
    throw e;
  }
  const list = Array.isArray(j?.usage_records) ? j.usage_records : [];
  let price = 0, currency = "usd";
  for (const it of list) {
    const p = Number(it?.price ?? 0);
    if (Number.isFinite(p)) price += p;
    if (it?.price_unit) currency = it.price_unit;
  }
  return { category, price: Number(price.toFixed(6)), currency };
}

function validDay(s){ return /^\d{4}-\d{2}-\d{2}$/.test(s); }

module.exports = async function usageDayHandler(req, res){
  try{
    const from = String((req.query.from || '')).trim();
    const to   = String((req.query.to   || '')).trim();
    const date = String((req.query.date || '')).trim();
    const start = from || date;
    const end   = to   || date;

    if (!start || !end || !validDay(start) || !validDay(end)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:"Missing or invalid ?from=YYYY-MM-DD&to=YYYY-MM-DD (o ?date=YYYY-MM-DD)" }));
    }

    const { accountSid, authToken } = await resolveTenantTwilioCreds(req);

    const cats = [
      "mms-inbound",
      "mms-outbound",
      "mms-messages-carrierfees",
      "sms-messages-carrierfees",
      "lookups"
    ];

    const [mmsIn, mmsOut, mmsCarrier, smsCarrier, lookups] = await Promise.all(
      cats.map(category => fetchCategory({ accountSid, authToken, start, end, category }))
    );

    const currency = mmsIn.currency || mmsOut.currency || mmsCarrier.currency || smsCarrier.currency || lookups.currency || "usd";
    const mmsTotal = Number((mmsIn.price + mmsOut.price).toFixed(6));
    const carrierTotal = Number((mmsCarrier.price + smsCarrier.price).toFixed(6));
    const combinedTotal = Number((mmsTotal + carrierTotal + lookups.price).toFixed(6));

    res.statusCode = 200;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({
      ok: true,
      start, end, currency,
      mms: {
        inbound: mmsIn.price,
        outbound: mmsOut.price,
        total: mmsTotal
      },
      carrierFees: {
        mms: mmsCarrier.price,
        sms: smsCarrier.price,
        total: carrierTotal
      },
      lookups: {
        total: lookups.price
      },
      overall: {
        feesMmsLookups: combinedTotal
      }
    }));
  }catch(err){
    console.error("[usage-day] error", err && (err.stack || err));
    const msg = err?.message || String(err);
    const status = msg === 'invalid_token' ? 401 : (msg === 'tenant_required' ? 400 : 500);
    res.statusCode = status;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:false, error:"usage_fetch_failed", detail: msg }));
  }
};
