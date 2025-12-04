// api/ingest.js
try { require('../lib/loadEnv'); } catch {}
const { getDb } = require('../lib/db');
const { verifyToken } = require('../lib/auth');
const { runIngestForTenant } = require('../lib/ingestRunner');
const { tenantIdFromClaims, isSuperRole, buildTenantFilter } = require('../lib/superCtx');
const { ensureTwilioAuthEncrypted } = require('../lib/twilio');

function parseDayValue(value){
  const day = (value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return day;
}
function parseDayParam(q){
  return parseDayValue(q.day || '');
}
function ymdUTC(d){ // YYYY-MM-DD in UTC
  const yyyy = d.getUTCFullYear();
  const mm   = String(d.getUTCMonth()+1).padStart(2,'0');
  const dd   = String(d.getUTCDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}
function maxIngestDay(){
  const base = new Date();
  base.setUTCHours(0,0,0,0);
  base.setUTCDate(base.getUTCDate() - 1);
  return ymdUTC(base);
}
function enumerateDays(startDay, endDay){
  const out = [];
  const start = new Date(startDay + 'T00:00:00.000Z');
  const end = new Date(endDay + 'T00:00:00.000Z');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  if (start > end) return out;
  let cursor = start;
  while (cursor <= end){
    out.push(ymdUTC(cursor));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return out;
}

module.exports = async (req, res) => {
  try{
    if (req.method !== 'POST'){
      res.setHeader('Allow','POST');
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok:false, error:'Method Not Allowed' }));
    }

    res.setHeader('Content-Type','application/json; charset=utf-8');

    const claims = verifyToken(req.headers['authorization']);
    const _over = String((req.headers['x-tenant-override']||'').trim());
    const _isSuper = isSuperRole(claims);
    const baseTenantId = tenantIdFromClaims(claims);
    const tenantId = (_isSuper && _over) ? _over : baseTenantId;
    if (!tenantId){
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:'tenant_required' }));
    }

    const maxDay = maxIngestDay();
    const q = req.query || {};
    let days = [];
    const fromParam = parseDayValue(q.from);
    const toParam = parseDayValue(q.to);
    if (fromParam || toParam){
      if (!fromParam || !toParam){
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok:false, error:'from_and_to_required' }));
      }
      if (fromParam > toParam){
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok:false, error:'invalid_range' }));
      }
      if (fromParam > maxDay || toParam > maxDay){
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok:false, error:'future_dates_not_allowed' }));
      }
      days = enumerateDays(fromParam, toParam);
    } else {
      let day = parseDayParam(q);
      if (!day) day = maxDay;
      if (day > maxDay) day = maxDay;
      days = [day];
    }
    if (!days.length){
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:'no_days_to_ingest' }));
    }

    const db = await getDb();
    const tenantFilter = buildTenantFilter(tenantId);
    const tenant = tenantFilter ? await db.collection('tenants').findOne(tenantFilter) : null;
    if (!tenant){
      res.statusCode=400;
      return res.end(JSON.stringify({ ok:false, error:'tenant_not_found' }));
    }

    if (!_isSuper){
      res.statusCode = 403;
      return res.end(JSON.stringify({ ok:false, error:'forbidden' }));
    }

    await ensureTwilioAuthEncrypted(db, tenant);

    const results = [];
    let totalFetched = 0;
    let totalUpserts = 0;
    let totalPages = 0;
    for (const day of days){
      const result = await runIngestForTenant(db, tenant, day);
      results.push(result);
      totalFetched += Number(result?.fetched || 0);
      totalUpserts += Number(result?.upserts || 0);
      totalPages += Number(result?.pages || 0);
    }

    res.statusCode=200;
    return res.end(JSON.stringify({
      ok: true,
      tenantId: tenant.tenantId,
      from: days[0],
      to: days[days.length - 1],
      days: days.length,
      totals: { fetched: totalFetched, upserts: totalUpserts, pages: totalPages },
      results
    }));
  }catch(e){
    console.error('ingest_error', e && e.stack || e);
    const status = e.message === 'invalid_token' ? 401 : 500;
    res.statusCode = status;
    return res.end(JSON.stringify({ ok:false, error: e.message || 'server_error' }));
  }
};
