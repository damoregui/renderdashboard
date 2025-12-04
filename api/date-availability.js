try { require('../lib/loadEnv'); } catch {}
const { getDb } = require('../lib/db');
const { verifyToken } = require('../lib/auth');
const { tenantIdFromClaims, isSuperRole } = require('../lib/superCtx');

function send(res, status, body){
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

module.exports = async function dateAvailabilityHandler(req, res){
  try {
    if (req.method !== 'GET'){
      res.setHeader('Allow', 'GET');
      return send(res, 405, { ok:false, error:'method_not_allowed' });
    }

    const claims = verifyToken(req.headers['authorization']);
    const override = String((req.headers['x-tenant-override'] || '').trim());
    const baseTenant = tenantIdFromClaims(claims);
    const tenantId = (isSuperRole(claims) && override) ? override : baseTenant;
    if (!tenantId){
      return send(res, 400, { ok:false, error:'tenant_required' });
    }

    const db = await getDb();
    const col = db.collection('messages');
    const cursor = col.aggregate([
      { $match: { tenantId, dateSentUtc: { $type: 'date' } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$dateSentUtc', timezone: 'UTC' } } } },
      { $match: { _id: { $ne: null } } },
      { $sort: { _id: 1 } }
    ], { allowDiskUse: true });

    const docs = await cursor.toArray();
    const days = docs.map(d => d._id).filter(Boolean);
    return send(res, 200, { ok:true, days });
  } catch (err) {
    console.error('[date-availability] error', err && (err.stack || err));
    const status = err && err.message === 'invalid_token' ? 401 : 500;
    return send(res, status, { ok:false, error: err && err.message ? err.message : 'server_error' });
  }
};
