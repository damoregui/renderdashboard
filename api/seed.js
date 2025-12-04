// api/seed.js
try { require('../lib/loadEnv'); } catch {}
const { getDb } = require('../lib/db');
const { encryptToBase64 } = require('../lib/crypto');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

async function readJson(req){
  if (req.body){
    if (typeof req.body === 'string') return JSON.parse(req.body);
    if (typeof req.body === 'object') return req.body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString('utf8') || '';
  return JSON.parse(raw || '{}');
}

module.exports = async (req, res) => {
  try{
    if (req.method !== 'POST'){
      res.setHeader('Allow','POST');
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok:false, error:'method_not_allowed' }));
    }
    if (!process.env.ADMIN_SEED_TOKEN){
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok:false, error:'missing_ADMIN_SEED_TOKEN' }));
    }
    const token = req.headers['x-seed-token'];
    if (token !== process.env.ADMIN_SEED_TOKEN){
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok:false, error:'unauthorized' }));
    }

    const body = await readJson(req);
    const {
      tenantName,
      username, password,
      twilioAccountSid, twilioAuthToken,

      // Formato simple (1 ubicación)
      ghlLocationId, ghlApiKey, ghlAlias, formId,

      // Formato avanzado opcional (varias ubicaciones)
      ghl,
    } = body || {};

    if (!tenantName || !username || !password || !twilioAccountSid || !twilioAuthToken){
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:'missing_required_fields' }));
    }

    const now = new Date();
    const tenantId = randomUUID();

    // Armar bloque GHL (soporta 2 formatos)
    let ghlBlock = null;
    if (ghl && Array.isArray(ghl.locations) && ghl.locations.length){
      ghlBlock = {
        locations: ghl.locations.map(l => ({
          locationId: l.locationId,
          apiKey_enc: encryptToBase64(l.apiKey),
          alias: l.alias || null,
          formId: l.formId || null,
          active: l.active !== false,
          createdAt: now,
          updatedAt: now,
        }))
      };
    } else if (ghlLocationId && ghlApiKey) {
      ghlBlock = {
        locations: [{
          locationId: ghlLocationId,
          apiKey_enc: encryptToBase64(ghlApiKey),
          alias: ghlAlias || null,
          formId: formId || null,
          active: true,
          createdAt: now,
          updatedAt: now,
        }]
      };
    }

    const db = await getDb();

    const tenantDoc = {
      tenantId,
      name: tenantName,
      status: 'active',
      twilio: {
        accountSid: twilioAccountSid.trim(),
        authToken_enc: encryptToBase64(twilioAuthToken.trim())
      },
      createdAt: now,
      updatedAt: now,
    };
    if (ghlBlock) tenantDoc.ghl = ghlBlock;

    await db.collection('tenants').insertOne(tenantDoc);

    const passwordHash = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({
      tenantId, username, passwordHash, role: 'owner', createdAt: now, updatedAt: now
    });

    res.statusCode = 200;
    return res.end(JSON.stringify({ ok:true, tenantId }));
  }catch(e){
    console.error('seed_error', e && e.stack || e);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok:false, error: e.message || 'server_error' }));
  }
};
