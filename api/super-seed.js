// /api/super-seed.js
// One-time helper to create a superuser. Protect with env SUPER_SETUP_TOKEN and header x-setup-token.
try { require('../lib/loadEnv'); } catch {}
const { getDb } = require('../lib/db');
const bcrypt = require('bcryptjs');

async function readJson(req){
  if (req.body){ if (typeof req.body === 'string') return JSON.parse(req.body); if (typeof req.body === 'object') return req.body; }
  const chunks = []; for await (const c of req) chunks.push(Buffer.isBuffer(c)? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString('utf8') || '';
  return JSON.parse(raw || '{}');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST'){ res.setHeader('Allow','POST'); res.statusCode=405; return res.end(JSON.stringify({ ok:false, error:'method_not_allowed' })); }
  try{
    const adminSecret = process.env.SUPER_SETUP_TOKEN || '';
    const provided = String(req.headers['x-setup-token']||'').trim();
    if (!adminSecret || !provided || provided !== adminSecret){ res.statusCode=403; return res.end(JSON.stringify({ ok:false, error:'forbidden' })); }

    const body = await readJson(req);
    const username = (body.username||'').trim();
    const password = String(body.password||'');
    if (!username || !password){ res.statusCode=400; return res.end(JSON.stringify({ ok:false, error:'missing_credentials' })); }

    const db = await getDb();
    const exists = await db.collection('users').findOne({ username });
    if (exists){ res.statusCode=409; return res.end(JSON.stringify({ ok:false, error:'user_exists' })); }

    const now = new Date();
    const passwordHash = await bcrypt.hash(password, 10);
    await db.collection('users').insertOne({ tenantId: null, username, passwordHash, role: 'super', createdAt: now, updatedAt: now });

    res.statusCode=200;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:true }));
  }catch(e){
    console.error('super_seed_error', e && (e.stack || e));
    res.statusCode=500;
    return res.end(JSON.stringify({ ok:false, error: e.message || 'server_error' }));
  }
};
