// /api/users.js
try { require('../lib/loadEnv'); } catch {}
const { getDb } = require('../lib/db');
const { verifyToken } = require('../lib/auth');
const { isSuperRole } = require('../lib/superCtx');
const { encryptToBase64, decryptFromBase64, maskSecret } = require('../lib/crypto');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');

function cleanString(val){
  if (val == null) return '';
  return String(val).trim();
}

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

function formatUserSummary(row){
  const tenant = row.tenant || {};
  const locations = Array.isArray(tenant?.ghl?.locations) ? tenant.ghl.locations : [];
  const primaryLocation = locations.find(l => l && l.active !== false) || locations[0] || null;
  return {
    id: String(row._id),
    username: row.username,
    role: (row.role || 'owner'),
    tenantId: row.tenantId || '',
    tenantName: tenant.name || '',
    twilioAccountSid: tenant?.twilio?.accountSid || '',
    hasTwilioAuthToken: Boolean(tenant?.twilio?.authToken_enc || tenant?.twilio?.authToken),
    twilioAuthTokenMasked: maskSecret(tenant?.twilio?.authToken_enc ? safeDecrypt(tenant.twilio.authToken_enc) : tenant?.twilio?.authToken || ''),
    ghlLocationId: primaryLocation?.locationId || '',
    ghlAlias: primaryLocation?.alias || '',
    calendarId: primaryLocation?.calendarId || '',
    formId: primaryLocation?.formId || '',
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
}

function safeDecrypt(b64){
  if (!b64) return '';
  try {
    return decryptFromBase64(b64);
  } catch (err) {
    console.error('users_decrypt_error', err && (err.stack || err));
    return '';
  }
}

function sendJson(res, status, payload){
  if (!res.headersSent){
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  res.end(JSON.stringify(payload));
}

async function handleList(req, res, db){
  const Users = db.collection('users');
  const cursor = Users.aggregate([
    { $lookup: { from: 'tenants', localField: 'tenantId', foreignField: 'tenantId', as: 'tenant' } },
    { $unwind: { path: '$tenant', preserveNullAndEmptyArrays: true } },
    { $sort: { username: 1 } }
  ]);
  const rows = await cursor.toArray();
  const users = rows.map(row => formatUserSummary(row));
  sendJson(res, 200, { ok: true, users });
}

async function handleDetail(req, res, db, id){
  let objectId;
  try {
    objectId = new ObjectId(id);
  } catch (_) {
    return sendJson(res, 400, { ok: false, error: 'invalid_user_id' });
  }
  const Users = db.collection('users');
  const user = await Users.findOne({ _id: objectId });
  if (!user){
    return sendJson(res, 404, { ok: false, error: 'user_not_found' });
  }
  let tenant = null;
  if (user.tenantId){
    tenant = await db.collection('tenants').findOne({ tenantId: user.tenantId });
  }
  const detail = {
    id: String(user._id),
    username: user.username,
    role: user.role || 'owner',
    tenantId: user.tenantId || '',
    tenantName: tenant?.name || '',
    twilioAccountSid: tenant?.twilio?.accountSid || '',
    twilioAuthToken: '',
    ghlLocationId: '',
    ghlAlias: '',
    ghlApiKey: '',
    calendarId: '',
    formId: '',
  };
  if (tenant?.twilio){
    const token = tenant.twilio.authToken_enc ? safeDecrypt(tenant.twilio.authToken_enc) : cleanString(tenant.twilio.authToken);
    detail.twilioAuthToken = token;
  }
  const locations = Array.isArray(tenant?.ghl?.locations) ? tenant.ghl.locations : [];
  const primaryLocation = locations.find(l => l && l.active !== false) || locations[0];
  if (primaryLocation){
    detail.ghlLocationId = primaryLocation.locationId || '';
    detail.ghlAlias = primaryLocation.alias || '';
    detail.calendarId = primaryLocation.calendarId || '';
    detail.formId = primaryLocation.formId || '';
    if (primaryLocation.apiKey_enc){
      detail.ghlApiKey = safeDecrypt(primaryLocation.apiKey_enc);
    }
  }
  sendJson(res, 200, { ok: true, user: detail });
}

async function handleCreate(req, res, db, body){
  const role = (body.role || 'owner').toLowerCase();
  if (!['owner','super'].includes(role)){
    return sendJson(res, 400, { ok:false, error:'invalid_role' });
  }
  const username = cleanString(body.username);
  const password = String(body.password || '');
  if (!username || !password){
    return sendJson(res, 400, { ok:false, error:'missing_credentials' });
  }

  const Users = db.collection('users');
  const existing = await Users.findOne({ username });
  if (existing){
    return sendJson(res, 409, { ok:false, error:'user_exists' });
  }

  const now = new Date();
  const passwordHash = await bcrypt.hash(password, 10);

  if (role === 'super'){
    const result = await Users.insertOne({
      tenantId: null,
      username,
      passwordHash,
      role: 'super',
      createdAt: now,
      updatedAt: now,
    });
    return sendJson(res, 201, { ok:true, userId: String(result.insertedId) });
  }

  const tenantName = cleanString(body.tenantName);
  const twilioAccountSid = cleanString(body.twilioAccountSid);
  const twilioAuthToken = cleanString(body.twilioAuthToken);
  const ghlLocationId = cleanString(body.ghlLocationId);
  const ghlApiKey = cleanString(body.ghlApiKey);
  const ghlAlias = body.ghlAlias == null ? null : cleanString(body.ghlAlias);
  const calendarId = cleanString(body.calendarId);
  const formId = cleanString(body.formId);

  if (!tenantName || !twilioAccountSid || !twilioAuthToken || !ghlLocationId || !ghlApiKey){
    return sendJson(res, 400, { ok:false, error:'missing_required_fields' });
  }

  const tenantId = randomUUID();
  const Tenants = db.collection('tenants');
  const locationEntry = {
    locationId: ghlLocationId,
    apiKey_enc: encryptToBase64(ghlApiKey),
    alias: ghlAlias || null,
    formId: formId || null,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  if (calendarId){
    locationEntry.calendarId = calendarId;
  }

  const tenantDoc = {
    tenantId,
    name: tenantName,
    status: 'active',
    twilio: {
      accountSid: twilioAccountSid,
      authToken_enc: encryptToBase64(twilioAuthToken),
    },
    ghl: { locations: [locationEntry] },
    createdAt: now,
    updatedAt: now,
  };

  await Tenants.insertOne(tenantDoc);
  const insertUser = await Users.insertOne({
    tenantId,
    username,
    passwordHash,
    role: 'owner',
    createdAt: now,
    updatedAt: now,
  });

  sendJson(res, 201, { ok:true, userId: String(insertUser.insertedId), tenantId });
}

async function handleUpdate(req, res, db, body){
  const userId = cleanString(body.userId || body.id);
  if (!userId){
    return sendJson(res, 400, { ok:false, error:'user_id_required' });
  }
  let objectId;
  try { objectId = new ObjectId(userId); }
  catch(_){ return sendJson(res, 400, { ok:false, error:'invalid_user_id' }); }

  const Users = db.collection('users');
  const user = await Users.findOne({ _id: objectId });
  if (!user){
    return sendJson(res, 404, { ok:false, error:'user_not_found' });
  }

  const updates = {};
  const now = new Date();
  const newUsername = cleanString(body.username);
  if (newUsername && newUsername !== user.username){
    const exists = await Users.findOne({ username: newUsername, _id: { $ne: objectId } });
    if (exists){
      return sendJson(res, 409, { ok:false, error:'user_exists' });
    }
    updates.username = newUsername;
  }

  const role = body.role ? String(body.role).toLowerCase() : '';
  if (role && ['owner','super'].includes(role) && role !== (user.role || 'owner')){
    updates.role = role;
  }

  if (body.password){
    const passwordHash = await bcrypt.hash(String(body.password), 10);
    updates.passwordHash = passwordHash;
  }

  if (Object.keys(updates).length){
    updates.updatedAt = now;
    await Users.updateOne({ _id: objectId }, { $set: updates });
  }

  const tenantId = user.tenantId;
  if (!tenantId){
    return sendJson(res, 200, { ok:true });
  }

  const Tenants = db.collection('tenants');
  const tenant = await Tenants.findOne({ tenantId });
  if (!tenant){
    return sendJson(res, 200, { ok:true });
  }

  const setOps = {};
  const unsetOps = {};

  if (body.tenantName != null){
    const tn = cleanString(body.tenantName);
    if (tn) setOps.name = tn;
  }
  if (body.twilioAccountSid != null){
    const sid = cleanString(body.twilioAccountSid);
    if (sid) setOps['twilio.accountSid'] = sid;
  }
  if (body.twilioAuthToken){
    const token = cleanString(body.twilioAuthToken);
    if (token){
      setOps['twilio.authToken_enc'] = encryptToBase64(token);
      unsetOps['twilio.authToken'] = '';
    }
  }

  const locations = Array.isArray(tenant?.ghl?.locations) ? tenant.ghl.locations.map(l => ({ ...l })) : [];
  const hasLocationInput = ['ghlLocationId','ghlApiKey','ghlAlias','calendarId','formId'].some(key => body[key] != null && body[key] !== '');
  if (!locations.length && hasLocationInput){
    locations.push({ active: true, createdAt: now, updatedAt: now });
  }
  if (locations.length){
    const loc = locations[0];
    let touched = false;
    if (body.ghlLocationId != null){
      const locId = cleanString(body.ghlLocationId);
      if (locId){ loc.locationId = locId; touched = true; }
    }
    if (body.ghlAlias != null){
      const alias = cleanString(body.ghlAlias);
      loc.alias = alias || null;
      touched = true;
    }
    if (body.ghlApiKey){
      const key = cleanString(body.ghlApiKey);
      if (key){ loc.apiKey_enc = encryptToBase64(key); touched = true; }
    }
    if (body.calendarId != null){
      const cal = cleanString(body.calendarId);
      if (cal){ loc.calendarId = cal; }
      else if (loc.calendarId){ delete loc.calendarId; }
      touched = true;
    }
    if (body.formId != null){
      const fid = cleanString(body.formId);
      if (fid){ loc.formId = fid; }
      else if (loc.formId){ delete loc.formId; }
      touched = true;
    }
    if (touched){
      loc.active = loc.active === false ? false : true;
      if (!loc.createdAt) loc.createdAt = now;
      loc.updatedAt = now;
      setOps['ghl.locations'] = locations;
    }
  }

  if (Object.keys(setOps).length){
    setOps.updatedAt = now;
  }
  const updateDoc = {};
  if (Object.keys(setOps).length) updateDoc.$set = setOps;
  if (Object.keys(unsetOps).length) updateDoc.$unset = unsetOps;

  if (Object.keys(updateDoc).length){
    await Tenants.updateOne({ _id: tenant._id }, updateDoc);
  }

  sendJson(res, 200, { ok:true });
}

module.exports = async (req, res) => {
  try {
    const claims = verifyToken(req.headers['authorization']);
    if (!isSuperRole(claims)){
      return sendJson(res, 403, { ok:false, error:'forbidden' });
    }

    const db = await getDb();

    if (req.method === 'GET'){
      const id = cleanString(Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id);
      if (id){
        return await handleDetail(req, res, db, id);
      }
      return await handleList(req, res, db);
    }

    if (req.method === 'POST'){
      const body = await readJson(req);
      return await handleCreate(req, res, db, body);
    }

    if (req.method === 'PUT'){
      const body = await readJson(req);
      return await handleUpdate(req, res, db, body);
    }

    res.setHeader('Allow','GET,POST,PUT');
    sendJson(res, 405, { ok:false, error:'method_not_allowed' });
  } catch (err) {
    console.error('users_api_error', err && (err.stack || err));
    const status = err && err.message === 'invalid_token' ? 401 : 500;
    sendJson(res, status, { ok:false, error: err.message || 'server_error' });
  }
};
