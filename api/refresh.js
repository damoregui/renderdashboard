// api/responder.js
try { require('../lib/loadEnv'); } catch {}
const { getDb } = require('../lib/db');
const { verifyToken } = require('../lib/auth');
const { tenantIdFromClaims } = require('../lib/superCtx');

function rangeUtc(from, to){
  const start = new Date(from + 'T00:00:00.000Z');
  const end   = new Date(new Date(to + 'T00:00:00.000Z').getTime() + 24*60*60*1000);
  return { start, end };
}
function getStr(q, key){
  let v = q ? q[key] : '';
  if (Array.isArray(v)) v = v[0];
  return (typeof v === 'string') ? v.trim() : '';
}

module.exports = async (req, res) => {
  try{
    if (req.method !== 'GET'){
      res.setHeader('Allow', 'GET');
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok:false, error:'Method Not Allowed' }));
    }
    const claims = verifyToken(req.headers['authorization']);
    const tenantId = tenantIdFromClaims(claims);
    if (!tenantId){
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:'tenant_required' }));
    }

    const phone = getStr(req.query, 'phone');
    const from  = getStr(req.query, 'from')  || getStr(req.query, 'fromDay');
    const to    = getStr(req.query, 'to')    || getStr(req.query, 'toDay');

    if (!phone || !/^\+?[0-9()\s.\-]+$/.test(phone) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:'bad_request' }));
    }

    const { start, end } = rangeUtc(from, to);
    const db = await getDb();
    const col = db.collection('messages');

    const cursor = col.find({
      tenantId,
      direction: 'inbound',
      from: phone,
      dateSentUtc: { $gte: start, $lt: end }
    }, {
      projection: { _id: 0, dateSentUtc: 1, body: 1, sid: 1 },
      sort: { dateSentUtc: 1 }
    }).limit(400);

    const items = await cursor.toArray();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:true, phone, count: items.length, messages: items }));
  }catch(e){
    console.error('responder_error', e && e.stack || e);
    res.statusCode = e.message === 'invalid_token' ? 401 : 500;
    return res.end(JSON.stringify({ ok:false, error: e.message || 'server_error' }));
  }
};
