// lib/superCtx.js
// Small helper to resolve the effective tenantId, allowing superusers to override via header
const { ObjectId } = require('mongodb');

function isSuperRole(claims){
  if (!claims) return false;
  const r = (claims.role||'').toLowerCase();
  return r === 'super' || r === 'admin' || r === 'superuser' || claims.isSuper === true;
}

function normalizeTenantLike(val){
  if (val == null) return '';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'){
    const str = String(val).trim();
    return str && str !== '[object Object]' ? str : '';
  }
  if (Array.isArray(val)){
    for (const entry of val){
      const nested = normalizeTenantLike(entry);
      if (nested) return nested;
    }
    return '';
  }
  if (typeof val === 'object'){
    const keys = [
      'tenantId', 'tenant_id', 'tenantID', 'tenant', 'tenantid',
      'id', 'Id', 'ID', '_id', 'value'
    ];
    for (const key of keys){
      if (!(key in val)) continue;
      const nested = normalizeTenantLike(val[key]);
      if (nested) return nested;
    }
  }
  return '';
}

function tenantIdFromClaims(claims){
  if (!claims) return '';
  const candidates = [
    claims.tenantId,
    claims.tenant_id,
    claims.tenantID,
    claims.tenant,
    claims.tenantid,
    claims.defaultTenantId,
    claims.defaultTenantID,
    claims.default_tenant_id
  ];
  for (const cand of candidates){
    const normalized = normalizeTenantLike(cand);
    if (normalized) return normalized;
  }

  const collections = [
    claims.tenants,
    claims.locations,
    claims.accounts,
    claims.organizations,
    claims.org,
    claims.orgs
  ];
  for (const group of collections){
    const normalized = normalizeTenantLike(group);
    if (normalized) return normalized;
  }

  return '';
}

function effectiveTenantIdFromReq(claims, req){
  const over = String((req.headers && (req.headers['x-tenant-override'] || req.headers['X-Tenant-Override'])) || '').trim();
  if (isSuperRole(claims) && over) return over;
  return tenantIdFromClaims(claims);
}

function buildTenantFilter(id){
  const normalized = normalizeTenantLike(id);
  if (!normalized) return null;
  const ors = [{ tenantId: normalized }];
  if (/^[a-f0-9]{24}$/i.test(normalized)){
    try { ors.push({ _id: new ObjectId(normalized) }); }
    catch(_){}
  }
  return { $or: ors };
}

module.exports = { isSuperRole, effectiveTenantIdFromReq, tenantIdFromClaims, buildTenantFilter };
