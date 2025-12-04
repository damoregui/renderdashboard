// api/tenants/[tenantId]/ghl/locations/[locationId].js
try { require('../../../../../lib/loadEnv'); } catch {}
const { getDb } = require('../../../../../lib/db');
const { encryptToBase64 } = require('../../../../../lib/crypto');
const { ObjectId } = require('mongodb');

function tenantFilter(id){
  const ors = [{ tenantId: id }];
  if (/^[a-f0-9]{24}$/i.test(id)) { try { ors.push({ _id: new ObjectId(id) }); } catch {} }
  return { $or: ors };
}

module.exports = async (req, res) => {
  try {
    const { tenantId, locationId } = req.query;
    const db = await getDb();
    const Tenants = db.collection('tenants');
    const filter = tenantFilter(tenantId);

    if (req.method === 'PATCH') {
      const { apiKey, alias, active } = req.body || {};
      const updates = {};
      if (typeof alias !== 'undefined') updates['ghl.locations.$.alias'] = alias;
      if (typeof active !== 'undefined') updates['ghl.locations.$.active'] = !!active;
      if (apiKey) updates['ghl.locations.$.apiKey_enc'] = encryptToBase64(apiKey);
      updates['ghl.locations.$.updatedAt'] = new Date();

      const r = await Tenants.updateOne(
        { ...filter, 'ghl.locations.locationId': locationId },
        { $set: updates }
      );
      if (!r.matchedCount) {
        res.statusCode = 404;
        res.setHeader('Content-Type','application/json; charset=utf-8');
        return res.end(JSON.stringify({ ok:false, error:'not_found' }));
      }
      res.statusCode = 200;
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok:true }));
    }

    if (req.method === 'DELETE') {
      const r = await Tenants.updateOne(
        filter,
        { $pull: { 'ghl.locations': { locationId } } }
      );
      if (!r.modifiedCount) {
        res.statusCode = 404;
        res.setHeader('Content-Type','application/json; charset=utf-8');
        return res.end(JSON.stringify({ ok:false, error:'not_found' }));
      }
      res.statusCode = 200;
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok:true }));
    }

    res.setHeader('Allow','PATCH, DELETE');
    res.statusCode = 405;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:false, error:'method_not_allowed' }));
  } catch (e) {
    console.error('ghl_locations_one_error', e && e.stack || e);
    res.statusCode = 500;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:false, error: e.message || 'server_error' }));
  }
};
