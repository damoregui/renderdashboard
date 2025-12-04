// api/responder.js
try { require('../lib/loadEnv'); } catch {}
const { buildFingerprint } = require('../lib/fingerprint');
const { toConversationText, analyzeSentiment, sentimentPromptSignature } = require('../lib/analyzeSentiment');

const { getDb } = require('../lib/db');
const { verifyToken } = require('../lib/auth');
const { effectiveTenantIdFromReq } = require('../lib/superCtx');

// Filtramos inbound con "stop" en body/Body (no distingue mayúsculas)
const STOP_REGEX = 'stop';

function rangeUtc(from, to){
  const start = new Date(from + 'T00:00:00.000Z');
  const end   = new Date(new Date(to + 'T00:00:00.000Z').getTime() + 24*60*60*1000); // exclusivo
  return { start, end };
}
function getStr(q, key){
  let v = q ? q[key] : '';
  if (Array.isArray(v)) v = v[0];
  return (typeof v === 'string') ? v.trim() : '';
}

module.exports = async (req, res) => {
  try{
    if (req.method !== 'GET'){
      res.setHeader('Allow', 'GET');
      res.statusCode = 405;
      return res.end(JSON.stringify({ ok:false, error:'Method Not Allowed' }));
    }
    const claims   = verifyToken(req.headers['authorization']);
    const tenantId = effectiveTenantIdFromReq(claims, req);

    const phoneRaw = getStr(req.query, 'phone');
    const dayFrom  = getStr(req.query, 'from')  || getStr(req.query, 'fromDay');
    const dayTo    = getStr(req.query, 'to')    || getStr(req.query, 'toDay');

    if (!phoneRaw || !/^\+?[0-9()\s.\-]+$/.test(phoneRaw) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(dayFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dayTo)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok:false, error:'bad_request' }));
    }

    const { start, end } = rangeUtc(dayFrom, dayTo);
    const db  = await getDb();
    const col = db.collection('messages');
    const conversations = db.collection('conversations');

    // Variantes del número para maches exactos
    const digits = phoneRaw.replace(/\D/g, '');
    const e164   = '+' + digits;
    const noPlus = digits;
    const variants = Array.from(new Set([phoneRaw, e164, noPlus]));

    // Expresiones para usar en $expr (normalización campo/camel-case)
    const BODY_EXPR = { $ifNull: ['$body', { $ifNull: ['$Body', ''] }] };

    // Filtro común por rango/tenant
    const common = { tenantId, dateSentUtc: { $gte: start, $lt: end } };

    // --- INBOUND (excluyendo STOP) ---
    const inboundFilterBase = {
      ...common,
      direction: 'inbound',
      $expr: { $not: { $regexMatch: { input: BODY_EXPR, regex: STOP_REGEX, options: 'i' } } }
    };

    // 1) inbound: por igualdad contra variantes en from/From
    let inbound = await col.find({
      ...inboundFilterBase,
      $or: [ { from: { $in: variants } }, { From: { $in: variants } } ]
    }, {
      projection: { _id: 0, dateSentUtc: 1, body: 1, Body: 1, sid: 1, direction: 1 },
      sort: { dateSentUtc: 1 }
    }).limit(500).toArray();

    // 2) inbound: fallback normalizando dígitos en from/From (evaluado en Node para compatibilidad Mongo <4.4)
if (!inbound.length){
  const fallback = await col.find({
    ...inboundFilterBase
  }, {
    projection: { _id: 0, dateSentUtc: 1, body: 1, Body: 1, sid: 1, direction: 1, from: 1, From: 1 },
    sort: { dateSentUtc: 1 }
  }).limit(1000).toArray();
  inbound = fallback
    .filter((m)=> digitsOnly(m.from ?? m.From ?? '') === digits)
    .map(({ from, From, ...rest }) => rest);
}

    // --- OUTBOUND (sin filtrar STOP) ---
    // 1) outbound: por igualdad contra variantes en to/To
    let outbound = await col.find({
      ...common,
      direction: 'outbound-api',
      $or: [ { to: { $in: variants } }, { To: { $in: variants } } ]
    }, {
      projection: { _id: 0, dateSentUtc: 1, body: 1, Body: 1, sid: 1, direction: 1 },
      sort: { dateSentUtc: 1 }
    }).limit(500).toArray();

    // 2) outbound: fallback normalizando dígitos en to/To (evaluado en Node para compatibilidad Mongo <4.4)
if (!outbound.length){
  const fallback = await col.find({
    ...common,
    direction: 'outbound-api'
  }, {
    projection: { _id: 0, dateSentUtc: 1, body: 1, Body: 1, sid: 1, direction: 1, to: 1, To: 1 },
    sort: { dateSentUtc: 1 }
  }).limit(1000).toArray();
  outbound = fallback
    .filter((m)=> digitsOnly(m.to ?? m.To ?? '') === digits)
    .map(({ to, To, ...rest }) => rest);
}

    // Normalizo body y direction
    function digitsOnly(v){
      return typeof v === 'string' ? v.replace(/\D/g, '') : '';
    }

    function norm(m){
      return {
        dateSentUtc: m.dateSentUtc,
        body: (m.body ?? m.Body ?? ''),
        sid: m.sid,
        direction: (m.direction || '').toLowerCase() === 'inbound' ? 'inbound' : 'outbound' // todo lo demás = outbound
      };
    }
    const all = inbound.map(norm).concat(outbound.map(norm))
      .sort((a,b)=> new Date(a.dateSentUtc) - new Date(b.dateSentUtc))
      .slice(0, 1000); // seguridad

    res.statusCode = 200;
    res.setHeader('Content-Type','application/json; charset=utf-8');

// --- Sentiment computation & persistence ---
try {
  const msgs = all.map((m,i)=>({ id: m.sid || String(i), createdAt: m.dateSentUtc, direction: m.direction, text: m.body }));
  const promptKey = sentimentPromptSignature();
  const fp = buildFingerprint(
    msgs.map(m => ({ id: m.id, createdAt: m.createdAt, direction: m.direction })),
    promptKey
  );
  const existing = await conversations.findOne({ tenantId, phone: phoneRaw }, {
    projection: {
      sentiment:1,
      sentimentUpdatedAt:1,
      sentimentFingerprint:1,
      sentimentModel:1,
      sentimentTokens:1,
      sentimentPromptKey:1
    }
  });
  let __sentiment;
  if (existing && existing.sentiment && existing.sentimentFingerprint === fp && existing.sentimentPromptKey === promptKey) {
    __sentiment = {
      sentiment: existing.sentiment,
      sentimentUpdatedAt: existing.sentimentUpdatedAt,
      sentimentModel: existing.sentimentModel,
      sentimentTokens: existing.sentimentTokens,
      sentimentPromptKey: existing.sentimentPromptKey
    };
  } else {
    const conversationText = toConversationText(msgs, (d)=> new Date(d).toISOString().replace('T',' ').slice(0,16));
    const { label, usage } = await analyzeSentiment(conversationText);
    const sentiment = label;
    const sentimentUpdatedAt = new Date();
    const sentimentModel = process.env.OPENAI_SENTIMENT_MODEL || 'gpt-4o-mini';
    const sentimentTokens = (usage && usage.total_tokens) || 0;
    await conversations.updateOne(
      { tenantId, phone: phoneRaw },
      { $set: { tenantId, phone: phoneRaw, sentiment, sentimentUpdatedAt, sentimentFingerprint: fp, sentimentModel, sentimentTokens, sentimentPromptKey: promptKey } },
      { upsert: true }
    );
    __sentiment = { sentiment, sentimentUpdatedAt, sentimentModel, sentimentTokens, sentimentPromptKey: promptKey };
  }
  var __sentiment_export = __sentiment;
} catch(e) {
  console.error('sentiment_error', e && e.stack || e);
  var __sentiment_export = { sentiment: 'error' };
}
return res.end(JSON.stringify({ ok:true, phone: phoneRaw, count: all.length, messages: all, ...__sentiment_export }));
}catch(e){
    console.error('responder_error', e && e.stack || e);
    res.statusCode = e.message === 'invalid_token' ? 401 : 500;
    return res.end(JSON.stringify({ ok:false, error: e.message || 'server_error' }));
  }
};
