// api/errors.js
try { require('../lib/loadEnv'); } catch {}
const { getDb } = require('../lib/db');
const { verifyToken } = require('../lib/auth');
const { tenantIdFromClaims, isSuperRole } = require('../lib/superCtx');

const KNOWN_DESC = {
  "30001":"Queue overflow",
  "30002":"Account suspended",
  "30003":"Unreachable destination handset",
  "30004":"Message blocked",
  "30005":"Unknown destination handset",
  "30006":"Landline or unreachable carrier",
  "30007":"Carrier violation (message filtered)",
  "30008":"Unknown error",
  "21610":"Message blocked: customer replied STOP",
  "21612":"To number not verified (trial)",
  "21614":"Invalid To phone number"
};

function parseDay(s){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(s + 'T00:00:00.000Z');
}
function rangeUtc(from, to){
  const start = parseDay(from);
  const end   = parseDay(to);
  if (!start || !end) return null;
  // end is exclusive: add 1 day
  return { start, end: new Date(end.getTime() + 24*60*60*1000) };
}

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

    const from = Array.isArray(req.query.from) ? req.query.from[0] : req.query.from;
    const to   = Array.isArray(req.query.to)   ? req.query.to[0]   : req.query.to;
    const rng = rangeUtc(from, to);
    if (!rng){
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:'bad_date' }));
    }

    const db = await getDb();
    const col = db.collection('messages');

    const matchStage = {
      tenantId,
      dateSentUtc: { $gte: rng.start, $lt: rng.end },
      $or: [
        { errorCode:   { $exists:true, $ne:null } },
        { error_code:  { $exists:true, $ne:null } }
      ]
    };

    const projection = {
      _id: 0,
      sid: 1,
      to: 1,
      from: 1,
      direction: 1,
      status: 1,
      errorCode: 1,
      error_code: 1,
      errorMessage: 1,
      error_message: 1,
      body: 1,
      price: 1,
      priceUnit: 1,
      price_unit: 1,
      numSegments: 1,
      num_segments: 1,
      messagingServiceSid: 1,
      messaging_service_sid: 1,
      dateSentUtc: 1,
      date_sent: 1,
      updatedAt: 1,
      twilioPayload: 1,
      twilio: 1
    };

    const docs = await col.find(matchStage, { projection }).toArray();

    const groups = new Map();

    function sanitizePayload(src){
      if (!src || typeof src !== 'object') return null;
      try {
        return JSON.parse(JSON.stringify(src));
      } catch {
        return null;
      }
    }

    function toIso(val){
      if (!val) return null;
      if (val instanceof Date) return val.toISOString();
      return val;
    }

    for (const doc of docs){
      const rawCode = doc.errorCode ?? doc.error_code;
      if (rawCode == null) continue;
      const code = String(rawCode);
      let entry = groups.get(code);
      if (!entry){
        entry = { code, description: '', details: [] };
        groups.set(code, entry);
      }

      const errorMessage = (doc.errorMessage ?? doc.error_message ?? '').toString().trim();
      if (!entry.description && errorMessage){
        entry.description = errorMessage;
      }

      const detail = {
        sid: doc.sid || null,
        to: doc.to || null,
        from: doc.from || null,
        status: doc.status || null,
        direction: doc.direction || null,
        dateSentUtc: toIso(doc.dateSentUtc || doc.date_sent || null),
        body: doc.body || null,
        price: doc.price ?? null,
        priceUnit: doc.priceUnit || doc.price_unit || null,
        numSegments: doc.numSegments ?? doc.num_segments ?? null,
        messagingServiceSid: doc.messagingServiceSid || doc.messaging_service_sid || null,
        errorCode: rawCode,
        errorMessage: errorMessage || null,
        updatedAt: toIso(doc.updatedAt || null)
      };

      const payload = sanitizePayload(doc.twilioPayload) || sanitizePayload(doc.twilio);
      if (payload){
        detail.twilioPayload = payload;
      } else {
        detail.twilioPayload = sanitizePayload({
          sid: detail.sid,
          to: detail.to,
          from: detail.from,
          status: detail.status,
          direction: detail.direction,
          dateSentUtc: detail.dateSentUtc,
          body: detail.body,
          errorCode: detail.errorCode,
          errorMessage: detail.errorMessage,
          price: detail.price,
          priceUnit: detail.priceUnit,
          numSegments: detail.numSegments,
          messagingServiceSid: detail.messagingServiceSid
        });
      }

      entry.details.push(detail);
    }

    const items = Array.from(groups.values()).map(entry => {
      entry.details.sort((a, b) => {
        const aTs = a.dateSentUtc ? new Date(a.dateSentUtc).getTime() : 0;
        const bTs = b.dateSentUtc ? new Date(b.dateSentUtc).getTime() : 0;
        return bTs - aTs;
      });
      const desc = entry.description && entry.description.trim();
      return {
        code: entry.code,
        count: entry.details.length,
        description: desc || KNOWN_DESC[entry.code] || 'See Twilio docs',
        details: entry.details
      };
    }).sort((a, b) => (b.count || 0) - (a.count || 0));

    res.statusCode = 200;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.end(JSON.stringify({ ok:true, items }));
  }catch(e){
    console.error('errors_api', e && e.stack || e);
    res.statusCode = e.message === 'invalid_token' ? 401 : 500;
    res.end(JSON.stringify({ ok:false, error: e.message || 'server_error' }));
  }
};
