// api/ghl-contact-lookup.js
try { require('../lib/loadEnv'); } catch {}
const { getDb } = require('../lib/db');
const { decryptFromBase64 } = require('../lib/crypto');
const { searchContactByPhone } = require('../lib/ghl');
const { ObjectId } = require('mongodb');

const DEBUG_GHL = String(process.env.DEBUG_GHL || '').toLowerCase() === '1' || String(process.env.DEBUG_GHL || '').toLowerCase() === 'true';
const log = (...a)=>{ if (DEBUG_GHL) console.log('[lookup]', ...a); };

function tenantFilter(id){
  const ors = [{ tenantId: id }];
  if (/^[a-f0-9]{24}$/i.test(id)) { try { ors.push({ _id: new ObjectId(id) }); } catch {} }
  return { $or: ors };
}
function maskPhone(p){ if(!p) return ''; const s=String(p).replace(/[^\d+]/g,''); return `${s.startsWith('+')?'+':''}***${s.slice(-4)}`; }

module.exports = async (req, res) => {
  try{
    if (req.method !== 'GET'){
      res.setHeader('Allow','GET');
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok:false, error:'method_not_allowed' }));
    }
    const tenantId   = String(req.query.tenantId || '');
    const locationId = String(req.query.locationId || '');
    const phone      = String(req.query.phone || '');
    log('start', { tenantId, locationId, phone: maskPhone(phone) });

    if (!tenantId || !locationId || !phone){
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:'tenantId_locationId_phone_required' }));
    }

    const db = await getDb();
    const Tenants = db.collection('tenants');
    const tenant = await Tenants.findOne(tenantFilter(tenantId), { projection: { 'ghl.locations': 1 } });
    const cred = (tenant?.ghl?.locations || []).find(l => l.locationId === locationId && l.active !== false);
    if (!cred){
      log('no_cred');
      res.statusCode = 404;
      return res.end(JSON.stringify({ ok:false, error:'credential_not_found' }));
    }

    const apiKey = decryptFromBase64(cred.apiKey_enc);
    const contact = await searchContactByPhone({ apiKey, locationId, phone });
    if (!contact){
      log('not_found');
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok:true, found:false }));
    }

    const url = `https://app.gohighlevel.com/v2/location/${encodeURIComponent(locationId)}/contacts/detail/${encodeURIComponent(contact.id)}`;
    log('found', { id: contact.id, firstName: contact.firstName, lastName: contact.lastName });
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok:true, found:true, ...contact, url }));
  }catch(e){
    log('fatal', { err: String(e && e.message || e) });
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok:false, error: e.message || 'server_error' }));
  }
};
