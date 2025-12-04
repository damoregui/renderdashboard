// api/login.js
try { require('../lib/loadEnv'); } catch {}
const { getDb } = require('../lib/db');
const bcrypt = require('bcryptjs');
const { signToken } = require('../lib/auth');
const { decryptFromBase64 } = require('../lib/crypto');
const { listCalendars } = require('../lib/ghl');
const { buildTenantFilter } = require('../lib/superCtx');

const TARGET_CALENDAR_NAME = 'Life Insurance Review Calendar';

async function ensureTenantCalendars(db, tenantId){
  if (!tenantId) return;
  try {
    const filter = buildTenantFilter(tenantId);
    if (!filter) return;

    const Tenants = db.collection('tenants');
    const tenant = await Tenants.findOne(filter, { projection: { _id:1, tenantId:1, 'ghl.locations':1 } });
    const locations = Array.isArray(tenant?.ghl?.locations) ? tenant.ghl.locations : [];
    if (!locations.length) return;

    for (const loc of locations){
      if (!loc || loc.active === false) continue;
      if (!loc.locationId) continue;
      if (loc.calendarId) continue;
      if (!loc.apiKey_enc) continue;

      let apiKey = '';
      try {
        apiKey = decryptFromBase64(loc.apiKey_enc);
      } catch (e) {
        console.error('login_calendar_decrypt_error', { tenantId: tenant?.tenantId || tenantId, locationId: loc.locationId, err: e && (e.stack || e) });
        continue;
      }
      if (!apiKey) continue;

      let calendars = [];
      try {
        calendars = await listCalendars({ apiKey, locationId: loc.locationId });
      } catch (e) {
        console.error('login_calendar_fetch_error', { tenantId: tenant?.tenantId || tenantId, locationId: loc.locationId, err: e && (e.stack || e) });
        continue;
      }

      const match = calendars.find(cal => cal && cal.name === TARGET_CALENDAR_NAME);
      if (!match || !match.id) continue;

      try {
        await Tenants.updateOne(
          { _id: tenant._id, 'ghl.locations.locationId': loc.locationId },
          { $set: { 'ghl.locations.$.calendarId': match.id, 'ghl.locations.$.updatedAt': new Date() } }
        );
      } catch (e) {
        console.error('login_calendar_update_error', { tenantId: tenant?.tenantId || tenantId, locationId: loc.locationId, err: e && (e.stack || e) });
      }
    }
  } catch (e) {
    console.error('login_calendar_lookup_error', { tenantId, err: e && (e.stack || e) });
  }
}
async function readJson(req){
  if (req.body){
    if (typeof req.body === 'string') return JSON.parse(req.body);
    if (typeof req.body === 'object') return req.body;
  }
  const chunks = []; for await (const c of req) chunks.push(Buffer.isBuffer(c)? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString('utf8') || '';
  return JSON.parse(raw || '{}');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST'){ res.setHeader('Allow','POST'); res.statusCode=405; return res.end(JSON.stringify({ok:false,error:'Method Not Allowed'})); }
  try{
    const body = await readJson(req);
    const username = (body.username||'').trim();
    const password = String(body.password||'');
    if (!username || !password){ res.statusCode=400; return res.end(JSON.stringify({ok:false,error:'missing_credentials'})); }
    const db = await getDb();
    const user = await db.collection('users').findOne({ username });
    if (!user){ res.statusCode=401; return res.end(JSON.stringify({ok:false,error:'invalid_credentials'})); }
    const match = await bcrypt.compare(password, user.passwordHash||'');
    if (!match){ res.statusCode=401; return res.end(JSON.stringify({ok:false,error:'invalid_credentials'})); }
    const token = signToken({ tenantId: user.tenantId, username: user.username, role: user.role });
    await db.collection('users').updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    await ensureTenantCalendars(db, user.tenantId);
    res.statusCode=200; res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:true, token }));
  }catch(e){ console.error('login_error', e&&e.stack||e); res.statusCode=500; return res.end(JSON.stringify({ok:false,error:'server_error'})); }
};
