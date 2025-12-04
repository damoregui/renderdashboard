// /api/tenants.js
try { require('../lib/loadEnv'); } catch {}
const { getDb } = require('../lib/db');
const { verifyToken } = require('../lib/auth');
const { isSuperRole } = require('../lib/superCtx');

function normalizeTenantId(val){
  if (val == null) return '';
  if (typeof val === 'string'){
    const trimmed = val.trim();
    return trimmed && trimmed !== '[object Object]' ? trimmed : '';
  }
  if (typeof val === 'object'){
    try {
      if (val && typeof val.toHexString === 'function'){
        return val.toHexString();
      }
    } catch (_) {}
  }
  const str = String(val).trim();
  return str && str !== '[object Object]' ? str : '';
}

function activeLocation(tenant){
  const locations = Array.isArray(tenant?.ghl?.locations) ? tenant.ghl.locations : [];
  return locations.find(l => l && l.active !== false && l.locationId) || locations[0] || null;
}

module.exports = async (req, res) => {
  try{
    if (req.method !== 'GET'){ res.setHeader('Allow','GET'); res.statusCode=405; return res.end(JSON.stringify({ ok:false, error:'method_not_allowed' })); }
    res.setHeader('Content-Type','application/json; charset=utf-8');

    const claims = verifyToken(req.headers['authorization']);
    if (!isSuperRole(claims)){ res.statusCode=403; return res.end(JSON.stringify({ ok:false, error:'forbidden' })); }

    const db = await getDb();

    const allowedTenantIds = new Set();
    try {
      const userCursor = db.collection('users').find(
        { tenantId: { $exists: true, $ne: null, $ne: '' } },
        { projection: { tenantId: 1, role: 1 } }
      );
      for await (const user of userCursor){
        const role = (user?.role || '').toString().toLowerCase();
        if (role === 'super' || role === 'admin' || role === 'superuser') continue;
        const normalized = normalizeTenantId(user?.tenantId);
        if (normalized) allowedTenantIds.add(normalized);
      }
    } catch (err) {
      console.error('tenants_allowed_fetch_error', err && (err.stack || err));
    }

    const tenants = await db.collection('tenants')
      .find({ status: 'active' }, { projection: { _id:0, tenantId:1, name:1, ghl:1 } })
      .sort({ name:1 })
      .toArray();

    const filteredTenants = (tenants || []).filter(t => {
      const normalizedId = normalizeTenantId(t?.tenantId);
      if (!normalizedId) return false;
      if (allowedTenantIds.size){
        return allowedTenantIds.has(normalizedId);
      }
      const locations = Array.isArray(t?.ghl?.locations) ? t.ghl.locations : [];
      return locations.some(loc => loc && loc.active !== false && normalizeTenantId(loc.locationId));
    });

    return res.end(JSON.stringify({
      ok: true,
      tenants: filteredTenants.map(t => {
        const loc = activeLocation(t);
        const formId = loc && loc.formId ? String(loc.formId).trim() : '';
        return {
          tenantId: t.tenantId,
          name: t.name || t.tenantId,
          hasForm: Boolean(formId),
          formId,
        };
      })
    }));
  }catch(e){
    console.error('tenants_error', e && (e.stack || e));
    res.statusCode = e.message === 'invalid_token' ? 401 : 500;
    return res.end(JSON.stringify({ ok:false, error: e.message || 'server_error' }));
  }
};
