// api/forms-submissions.js
try { require('../lib/loadEnv'); } catch {}
const { getDb } = require('../lib/db');
const { verifyToken } = require('../lib/auth');
const { decryptFromBase64 } = require('../lib/crypto');
const { effectiveTenantIdFromReq, buildTenantFilter } = require('../lib/superCtx');
const { listFormSubmissions, getContactById } = require('../lib/ghl');

function sendJson(res, status, payload){
  if (!res.headersSent){
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  res.end(JSON.stringify(payload));
}

function cleanDay(val){
  if (!val || typeof val !== 'string') return '';
  const trimmed = val.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : '';
}

function activeLocation(tenant){
  const locations = Array.isArray(tenant?.ghl?.locations) ? tenant.ghl.locations : [];
  return locations.find(l => l && l.active !== false && l.locationId) || locations[0] || null;
}

async function resolveTenant(db, tenantId){
  const filter = buildTenantFilter(tenantId);
  if (!filter) return null;
  return db.collection('tenants').findOne(filter, { projection: { tenantId:1, ghl:1 } });
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET'){
      res.setHeader('Allow','GET');
      return sendJson(res, 405, { ok:false, error:'method_not_allowed' });
    }

    const claims = verifyToken(req.headers['authorization']);
    const tenantId = effectiveTenantIdFromReq(claims, req);
    if (!tenantId){
      return sendJson(res, 400, { ok:false, error:'missing_tenant' });
    }

    const db = await getDb();
    const tenant = await resolveTenant(db, tenantId);
    if (!tenant){
      return sendJson(res, 404, { ok:false, error:'tenant_not_found' });
    }

    const loc = activeLocation(tenant);
    const formId = loc && loc.formId ? String(loc.formId).trim() : '';
    if (!formId){
      return sendJson(res, 400, { ok:false, error:'missing_form_id', hasForm:false });
    }
    const metaOnly = String(req.query?.meta || '').toLowerCase();
    if (metaOnly === '1' || metaOnly === 'true'){
      return sendJson(res, 200, { ok:true, hasForm:true });
    }

    const from = cleanDay(Array.isArray(req.query?.from) ? req.query.from[0] : req.query?.from);
    const to = cleanDay(Array.isArray(req.query?.to) ? req.query.to[0] : req.query?.to);
    if (!from || !to){
      return sendJson(res, 400, { ok:false, error:'missing_date_range', hasForm:true });
    }
    if (from > to){
      return sendJson(res, 400, { ok:false, error:'invalid_date_range', hasForm:true });
    }

    let apiKey = '';
    try { apiKey = loc.apiKey_enc ? decryptFromBase64(loc.apiKey_enc) : ''; }
    catch (err){
      console.error('forms_api_decrypt_error', err && (err.stack || err));
      return sendJson(res, 500, { ok:false, error:'ghl_key_error', hasForm:true });
    }
    if (!apiKey){
      return sendJson(res, 400, { ok:false, error:'missing_api_key', hasForm:true });
    }

    const submissions = await listFormSubmissions({
      apiKey,
      locationId: loc.locationId,
      formId,
      startAt: from,
      endAt: to,
      limit: 50,
    });
    const mappedRaw = (Array.isArray(submissions) ? submissions : []).map(sub => {
      const others = sub?.others && typeof sub.others === 'object' ? sub.others : {};
      return {
        id: sub?.id || sub?.submissionId || sub?.others?.submissionId || '',
        contactId: sub?.contactId || others.query_contact_id || '',
        formId: sub?.formId || formId,
        createdAt: sub?.createdAt || sub?.dateAdded || null,
        others,
      };
    });

    const contactIds = Array.from(new Set(mappedRaw.map(m => m.contactId).filter(Boolean)));
    const contactMap = new Map();

    for (const contactId of contactIds){
      try {
        const contact = await getContactById({ apiKey, contactId });
        if (contact){
          contactMap.set(contactId, contact);
        }
      } catch (err){
        console.error('forms_contact_error', { contactId, err: err?.message || err });
      }
    }

    const mapped = mappedRaw.map(sub => {
      const cf = contactMap.get(sub.contactId)?.customFields || {};
      const others = sub.others || {};
      const pick = (id) => cf[id] !== undefined && cf[id] !== null && cf[id] !== ''
        ? cf[id]
        : others[id];

      return {
        id: sub.id,
        contactId: sub.contactId,
        formId: sub.formId,
        createdAt: sub.createdAt,
        fields: {
          '2ZL13o2LQcC54KvXih3m': pick('2ZL13o2LQcC54KvXih3m'),
          '27h2x1pNm95Q7Y75hoST': pick('27h2x1pNm95Q7Y75hoST'),
          'D6RDbkPjIxCrKOp5M9Oz': pick('D6RDbkPjIxCrKOp5M9Oz'),
          'T61ZX0M3kfxNloNtWItj': pick('T61ZX0M3kfxNloNtWItj'),
          'wzQ2pzo1xXUl08CfQuAu': pick('wzQ2pzo1xXUl08CfQuAu'),
          '046SAY7OWHgegdclGgfm': pick('046SAY7OWHgegdclGgfm'),
          'B1SaLltrM0Go3AuAMeHl': pick('B1SaLltrM0Go3AuAMeHl'),
          'KxD2iCYDJEAgCgUI6zy5': pick('KxD2iCYDJEAgCgUI6zy5'),
          'uPOMJUqI2DzNlKrCyNoG': pick('uPOMJUqI2DzNlKrCyNoG'),
          'P4RjVrU0IfQNUfWSzRWU': pick('P4RjVrU0IfQNUfWSzRWU'),
          '70FLn04r8zQQi0kFLSm0': pick('70FLn04r8zQQi0kFLSm0'),
          'XUhYbv85sUliPKvKw6wV': pick('XUhYbv85sUliPKvKw6wV'),
        },
      };
    });

    return sendJson(res, 200, { ok:true, submissions: mapped, hasForm:true });
  } catch (err) {
    console.error('forms_api_error', err && (err.stack || err));
    return sendJson(res, err && err.message === 'invalid_token' ? 401 : 500, { ok:false, error: err.message || 'server_error' });
  }
};
