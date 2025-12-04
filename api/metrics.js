// api/metrics.js
try { require('../lib/loadEnv'); } catch {}
const { getDb } = require('../lib/db');
const { verifyToken } = require('../lib/auth');
const { tenantIdFromClaims, isSuperRole, buildTenantFilter } = require('../lib/superCtx');
const { decryptFromBase64 } = require('../lib/crypto');
const { searchContactByPhone, listCalendarEvents } = require('../lib/ghl');

// Buscamos cualquier "stop" (sin boundary) para no perdernos STOP/Stop/stop.
const STOP_REGEX = 'stop';

function parseDay(s){
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00.000Z') : null;
}
function rangeUtc(from, to){
  const start = parseDay(from), end0 = parseDay(to);
  if (!start || !end0) return null;
  return { start, end: new Date(end0.getTime() + 24*60*60*1000) }; // fin exclusivo
}
function parseGhlDate(s){
  if (!s) return null;
  let iso = String(s).trim();
  if (!iso) return null;
  if (!iso.includes('T')) iso = iso.replace(' ', 'T');
  if (!/[zZ]$/.test(iso) && !/[+-]\d\d:\d\d$/.test(iso)) iso += 'Z';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}
const getQ = (q, k) => Array.isArray(q?.[k]) ? q[k][0] : (q?.[k] || '').trim();

module.exports = async (req, res) => {
  try{
    if (req.method !== 'GET'){
      res.setHeader('Allow','GET');
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok:false, error:'method_not_allowed' }));
    }

    const claims = verifyToken(req.headers['authorization']);
    const _over = String((req.headers['x-tenant-override']||'').trim());
    const _isSuper = isSuperRole(claims);
    const baseTenantId = tenantIdFromClaims(claims);
    const tenantId = (_isSuper && _over) ? _over : baseTenantId;
    if (!tenantId){
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:'tenant_required' }));
    }

    const from = getQ(req.query, 'from');
    const to   = getQ(req.query,   'to');
    const rng  = rangeUtc(from, to);
    if (!rng){
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:'bad_date' }));
    }

    const db = await getDb();
    const col = db.collection('messages');
    const conversations = db.collection('conversations');
    const tenantsCol = db.collection('tenants');

    // Expresiones comunes para usar en $expr
    const BODY_EXPR = { $ifNull: ['$body', { $ifNull: ['$Body', ''] }] };
    const FROM_EXPR = { $ifNull: ['$from', { $ifNull: ['$From', null] }] };

    const facets = await col.aggregate([
      { $match: { tenantId, dateSentUtc: { $gte: rng.start, $lt: rng.end } } },
      { $facet: {
        dirCounts: [
          { $group: { _id: '$direction', c: { $sum: 1 } } }
        ],
        byStatus: [
          { $group: { _id: '$status', c: { $sum: 1 } } }
        ],
        byError: [
          { $match: {
              $or: [
                { errorCode:  { $exists:true, $ne:null } },
                { error_code: { $exists:true, $ne:null } }
              ]
            }
          },
          { $project: { code: { $ifNull: ['$errorCode', '$error_code'] } } },
          { $group: { _id: '$code', c: { $sum: 1 } } }
        ],
        sums: [
          { $group: {
            _id: null,
            sumSegments: { $sum: { $ifNull: ['$numSegments', { $ifNull: ['$num_segments', 0] }] } },
            totalPriceRaw: { $sum: { $toDouble: { $ifNull: ['$price', 0] } } },
            totalPriceAbs: { $sum: { $abs: { $toDouble: { $ifNull: ['$price', 0] } } } }
          } }
        ],
        uniqOut: [
          { $match: { direction: 'outbound-api' } },
          { $group: { _id: null, nums: { $addToSet: '$to' } } },
          { $project: { _id: 0, count: { $size: '$nums' } } }
        ],
        // Conteo de STOP (inbound) mirando body o Body con regexMatch (case-insensitive)
        stopCount: [
          { $match: { direction: 'inbound' } },
          { $match: { $expr: { $regexMatch: { input: BODY_EXPR, regex: STOP_REGEX, options: 'i' } } } },
          { $group: { _id: null, c: { $sum: 1 } } }
        ],
        // Repeat responders (≥1 inbound que NO sea STOP), agrupando por from/From
        repeatResponders: [
          { $match: { direction: 'inbound' } },
          { $match: { $expr: { $not: { $regexMatch: { input: BODY_EXPR, regex: STOP_REGEX, options: 'i' } } } } },
          { $group: { _id: FROM_EXPR, count: { $sum: 1 } } },
          { $match: { _id: { $ne: null } } },
          { $sort: { count: -1 } },
          { $limit: 500 }
        ]
      } }
    ]).toArray();

    const f = facets[0] || {};
    let outbound = 0;
    let inbound = 0;
    for (const row of f.dirCounts || []){
      const dir = typeof row._id === 'string' ? row._id.toLowerCase() : '';
      const count = row?.c || 0;
      if (!dir || !count) continue;
      if (dir.includes('outbound')) {
        outbound += count;
      } else if (dir.includes('inbound')) {
        inbound += count;
      }
    }
    const total    = outbound + inbound;

    const byStatus = {};
    (f.byStatus || []).forEach(s => { if (s._id) byStatus[s._id] = s.c; });

    const byError = {};
    (f.byError || []).forEach(e => { if (e._id != null) byError[String(e._id)] = e.c; });

    const sums = (f.sums && f.sums[0]) || {};
    const uniqueProspectsTotal = (f.uniqOut && f.uniqOut[0]?.count) || 0;
    const stopCount = (f.stopCount && f.stopCount[0]?.c) || 0;

    
    let repeatResponders = (f.repeatResponders || []).map(r => ({ phone: r._id, count: r.count }));
    try {
      const phones = repeatResponders.map(r => r.phone);
      if (phones.length) {
        const cached = await conversations.find(
          { tenantId, phone: { $in: phones } },
          { projection: { phone: 1, sentiment: 1, sentimentUpdatedAt: 1 } }
        ).toArray();
        const map = new Map(cached.map(c => [c.phone, { sentiment: c.sentiment, sentimentUpdatedAt: c.sentimentUpdatedAt }]));
        repeatResponders = repeatResponders.map(r => ({ ...r, ...(map.get(r.phone) || {}) }));
      }
    } catch (e) {}

    // --- GHL enrichment (if locationId is provided) ---
    let tenantDoc = null;
    let locationId = getQ(req.query, 'locationId');
    const effectiveTenantId = tenantId || (req.user && tenantIdFromClaims(req.user));
    const tenantDocFilter = buildTenantFilter(effectiveTenantId || tenantId);
    // Fallback: if no locationId provided, use first active from tenant
    if (!locationId && tenantDocFilter) {
      try {
        tenantDoc = await tenantsCol.findOne(tenantDocFilter, { projection: { 'ghl.locations': 1 } });
        const active = tenantDoc?.ghl?.locations?.find(l => l.active !== false);
        if (active) {
          locationId = active.locationId;
          if (typeof dbg === 'function') dbg('enrich:auto_location', { locationId });
        }
      } catch {}
    }

    if (!tenantDoc && tenantDocFilter) {
      try {
        tenantDoc = await tenantsCol.findOne(tenantDocFilter, { projection: { 'ghl.locations': 1 } });
      } catch {}
    }

    let cred = null;
    let apiKey = null;
    if (locationId && tenantDoc) {
      cred = tenantDoc?.ghl?.locations?.find(l => l.locationId === locationId && l.active !== false);
      if (cred) {
        apiKey = decryptFromBase64(cred.apiKey_enc);
        if (!apiKey && typeof dbg === 'function') dbg('enrich:missing_api_key', { locationId });
      } else if (typeof dbg === 'function') {
        dbg('enrich:no_location_cred', { locationId });
      }
    }

    let calendarEventsCount = 0;
    let calendarEvents = [];

    if (apiKey && locationId && repeatResponders.length) {
      const uniqPhones = [...new Set(repeatResponders.map(r => r.phone).filter(Boolean))];
      // Batch lookups to avoid hammering the API
      const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size));
      const batches = chunk(uniqPhones, 10);
      const byPhone = {};
      for (const b of batches) {
        const results = await Promise.all(b.map(ph => searchContactByPhone({ apiKey, locationId, phone: ph }).catch(() => null)));
        b.forEach((ph, i) => { byPhone[ph] = results[i]; });
      }
      repeatResponders = repeatResponders.map(r => {
        const c = byPhone[r.phone];
        if (c && c.id) {
          const contactUrl = `https://app.leadshub360.com/v2/location/${encodeURIComponent(locationId)}/contacts/detail/${encodeURIComponent(c.id)}`;
          return { ...r, contactId: c.id, firstName: c.firstName || '', lastName: c.lastName || '', ghlUrl: contactUrl };
        }
        return r;
      });
    }

    const calendarId = cred?.calendarId;
    if (apiKey && locationId && calendarId) {
      try {
        const now = new Date();
        const startRange = new Date(now.getTime());
        startRange.setUTCMonth(startRange.getUTCMonth() - 1);
        const endRange = new Date(now.getTime());
        endRange.setUTCMonth(endRange.getUTCMonth() + 2);

        const startMs = startRange.getTime();
        const endMs = endRange.getTime();
        const events = await listCalendarEvents({
          apiKey,
          locationId,
          calendarId,
          startTimeMs: startMs,
          endTimeMs: endMs,
        });

        const seenContacts = new Set();
        const rows = [];

        const windowStartMs = rng.start.getTime();
        const windowEndMs = rng.end.getTime();

        events.forEach(event => {
          if (!event) return;

          const rawAdded = event.dateAdded
            || event.dateadded
            || event.date_added
            || event.createdAt
            || event.created_at
            || event.timestamp;
          const parsedAdded = parseGhlDate(rawAdded);
          if (!parsedAdded) return;
          const addedMs = parsedAdded.getTime();
          if (addedMs < windowStartMs || addedMs >= windowEndMs) return;

          const contactId = event.contactId ? String(event.contactId) : '';
          if (contactId) seenContacts.add(contactId);

          const rawStart = event.startTime || event.startDateTime || event.startDate || event.dateAdded || '';
          const parsedStart = parseGhlDate(rawStart);
          const startIso = parsedStart ? parsedStart.toISOString() : (rawStart ? String(rawStart) : '');
          const startMsVal = parsedStart ? parsedStart.getTime() : (Number(rawStart) || null);

          const title = (event.title || '').trim() || '(untitled event)';
          const ghlUrl = contactId
            ? `https://app.leadshub360.com/v2/location/${encodeURIComponent(locationId)}/contacts/detail/${encodeURIComponent(contactId)}`
            : undefined;

          rows.push({
            title,
            contactId,
            startTimeUtc: parsedStart ? startIso : null,
            startTimeRaw: !parsedStart && rawStart ? String(rawStart) : null,
            appointmentStatus: event.appointmentStatus || event.status || null,
            ghlUrl,
            dateAddedUtc: parsedAdded ? parsedAdded.toISOString() : null,
            dateAddedRaw: !parsedAdded && rawAdded ? String(rawAdded) : null,
            _startSort: typeof startMsVal === 'number' ? startMsVal : null,
          });
        });

        rows.sort((a, b) => {
          const aVal = (typeof a._startSort === 'number') ? a._startSort : Number.MAX_SAFE_INTEGER;
          const bVal = (typeof b._startSort === 'number') ? b._startSort : Number.MAX_SAFE_INTEGER;
          if (aVal !== bVal) return aVal - bVal;
          return (a.title || '').localeCompare(b.title || '');
        });

        calendarEvents = rows.map(({ _startSort, ...rest }) => rest);
        calendarEventsCount = seenContacts.size;
      } catch (err) {
        if (typeof dbg === 'function') dbg('calendar_events:error', { locationId, calendarId, err: err?.message || String(err) });
      }
    }


    res.statusCode = 200;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.end(JSON.stringify({
      ok:true,
      outbound, inbound, total,
      byStatus, byError,
      sumSegments: sums.sumSegments || 0,
      totalPriceRaw: sums.totalPriceRaw || 0,
      totalPriceAbs: sums.totalPriceAbs || 0,
      uniqueProspectsTotal, stopCount,
      calendarEventsCount,
      calendarEvents,
      repeatResponders
    }));
  }catch(e){
    console.error('metrics_error', e && e.stack || e);
    res.statusCode = e.message === 'invalid_token' ? 401 : 500;
    res.end(JSON.stringify({ ok:false, error: e.message || 'server_error' }));
  }
};
