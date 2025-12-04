// api/tenants/[tenantId]/ghl/locations/index.js
try { require('../../../../../lib/loadEnv'); } catch {}
const { getDb } = require('../../../../../lib/db');
const { encryptToBase64, maskSecret } = require('../../../../../lib/crypto');
const { ObjectId } = require('mongodb');

function tenantFilter(id){
  const ors = [{ tenantId: id }];
  if (/^[a-f0-9]{24}$/i.test(id)) { try { ors.push({ _id: new ObjectId(id) }); } catch {} }
  return { $or: ors };
}

module.exports = async (req, res) => {
  try {
    const { tenantId } = req.query;
    const db = await getDb();
    const Tenants = db.collection('tenants');
    const filter = tenantFilter(tenantId);

    if (req.method === 'POST') {
      const { locationId, apiKey, alias } = req.body || {};
      if (!locationId || !apiKey) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify({ ok:false, error:'locationId_and_apiKey_required' }));
      }

      const now = new Date();
      const doc = {
        locationId,
        apiKey_enc: encryptToBase64(apiKey),
        alias: alias || null,
        active: true,
        createdAt: now,
        updatedAt: now,
      };

      await Tenants.updateOne(
        filter,
        { $setOnInsert: { tenantId }, $set: { updatedAt: now }, $push: { 'ghl.locations': doc } },
        { upsert: true }
      );

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok:true, locationId, apiKeyMasked: maskSecret(apiKey) }));
    }

    if (req.method === 'GET') {
      const tenant = await Tenants.findOne(filter, { projection: { 'ghl.locations': 1 } });
      const items = (tenant?.ghl?.locations || []).map(l => ({
        locationId: l.locationId,
        alias: l.alias || null,
        active: l.active !== false,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
        apiKeyMasked: '****',
      }));

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok:true, items }));
    }

    res.setHeader('Allow', 'GET, POST');
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:false, error: 'method_not_allowed' }));
  } catch (e) {
    console.error('ghl_locations_index_error', e && e.stack || e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:false, error: e.message || 'server_error' }));
  }
};
