// lib/ingestRunner.js
const https = require('https');
const { resolveTwilioCredentials } = require('./twilio');

function basicAuthHeader(user, pass){
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}
function httpGet(url, headers){
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data='';
      res.on('data', ch => data += ch);
      res.on('end', () => {
        if (res.statusCode !== 200){
          const err = new Error(`HTTP ${res.statusCode}`);
          err.status = res.statusCode;
          err.body = data;
          return reject(err);
        }
        try { resolve(JSON.parse(data)); }
        catch(e){ reject(e); }
      });
    });
    req.on('error', reject);
  });
}
async function withRetry(fn, retries=5){
  let attempt=0;
  while (true){
    try { return await fn(); }
    catch(e){
      attempt++;
      if (attempt > retries) throw e;
      const backoff = Math.min(1000 * Math.pow(2, attempt-1), 8000);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}

function newestTimestampOf(m){
  const ts = [];
  if (m.date_sent)    ts.push(new Date(m.date_sent).getTime());
  if (m.date_created) ts.push(new Date(m.date_created).getTime());
  if (m.date_updated) ts.push(new Date(m.date_updated).getTime());
  return ts.length ? Math.max(...ts) : 0;
}
function isInRange(m, start, end){
  const sent    = m.date_sent    ? new Date(m.date_sent)    : null;
  const created = m.date_created ? new Date(m.date_created) : null;
  return Boolean(
    (sent && sent >= start && sent < end) ||
    (!sent && created && created >= start && created < end)
  );
}
function toUtcRange(dayStr){
  const start = new Date(dayStr + 'T00:00:00.000Z');
  const end   = new Date(start.getTime() + 24*60*60*1000);
  return { start, end };
}

/**
 * Run ingest for a single tenant and a given day (YYYY-MM-DD, UTC day).
 * @param {import('mongodb').Db} db
 * @param {object} tenant - { tenantId, twilio: { accountSid, authToken|authToken_enc } }
 * @param {string} day
 * @returns {Promise<{tenantId:string, day:string, fetched:number, upserts:number, pages:number}>}
 */
async function runIngestForTenant(db, tenant, day){
  if (!tenant || !tenant.tenantId) throw new Error('tenant_required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('invalid_day');

  const { start, end } = toUtcRange(day);

  let creds;
  try {
    creds = resolveTwilioCredentials(tenant.twilio);
  } catch (err) {
    const e = new Error('twilio_credentials_invalid');
    e.cause = err;
    throw e;
  }
  if (!creds) throw new Error('twilio_credentials_missing');

  const { accountSid, authToken } = creds;

  const col = db.collection('messages');
  try { await col.createIndex({ tenantId:1, sid:1 }, { unique:true }); } catch {}

  let fetched=0, upserts=0, pages=0;
  const now = new Date();
  const opsBatch = [];
  const BATCH_SIZE = 500;

function clonePayload(m){
  if (!m || typeof m !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(m));
  } catch {
    return null;
  }
}

function pushOp(m){
    const sent    = m.date_sent    ? new Date(m.date_sent)    : null;
    const created = m.date_created ? new Date(m.date_created) : null;
    const primary = sent || created || now;
    const payload = clonePayload(m);
    const doc = {
      tenantId: tenant.tenantId,
      sid: m.sid,
      accountSid: m.account_sid || accountSid,
      dateSentUtc: primary,
      from: m.from,
      to: m.to,
      direction: m.direction,
      status: m.status,
      errorCode: m.error_code != null ? Number(m.error_code) : null,
      errorMessage: m.error_message || null,
      numSegments: m.num_segments != null ? Number(m.num_segments) : null,
      price: m.price != null ? Number(m.price) : null,
      priceUnit: m.price_unit || null,
      messagingServiceSid: m.messaging_service_sid || null,
      body: m.body || null,
      twilioPayload: payload,
      updatedAt: now
    };
    opsBatch.push({
      updateOne: {
        filter: { tenantId: tenant.tenantId, sid: m.sid },
        update: { $set: doc, $setOnInsert: { createdAt: now } },
        upsert: true
      }
    });
  }
  async function flush(){
    if (!opsBatch.length) return;
    const ops = opsBatch.splice(0, opsBatch.length);
    const r = await col.bulkWrite(ops, { ordered:false });
    upserts += (r.upsertedCount || 0) + (r.modifiedCount || 0) + (r.matchedCount || 0);
  }

  const baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const headers = { 'Authorization': basicAuthHeader(accountSid, authToken) };
  let nextPageUrl = `${baseUrl}?PageSize=1000`;
  let stop = false;

  while (nextPageUrl && !stop){
    pages++;
    const payload = await withRetry(() => httpGet(nextPageUrl, headers));
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    for (const m of messages){
      const newestTs = newestTimestampOf(m);
      if (newestTs && newestTs < start.getTime()){
        nextPageUrl = null; stop = true; break;
      }
      if (!isInRange(m, start, end)) continue;
      fetched++;
      pushOp(m);
      if (opsBatch.length >= BATCH_SIZE) await flush();
    }
    if (!stop){
      if (payload.next_page_uri){
        nextPageUrl = `https://api.twilio.com${payload.next_page_uri}`;
      } else {
        nextPageUrl = null;
      }
    }
  }

  await flush();
  return { tenantId: tenant.tenantId, day, fetched, upserts, pages };
}

module.exports = { runIngestForTenant };
