// lib/twilio.js
try { require('./loadEnv'); } catch {}
const { encryptToBase64, decryptFromBase64 } = require('./crypto');

function clean(val){
  return val == null ? '' : String(val).trim();
}

function decryptAuthToken(twilio){
  if (!twilio) return '';
  if (twilio.authToken_enc){
    try {
      return decryptFromBase64(twilio.authToken_enc);
    } catch (err) {
      const e = new Error('twilio_auth_decrypt_failed');
      e.cause = err;
      throw e;
    }
  }
  if (twilio.authToken) return clean(twilio.authToken);
  return '';
}

function resolveTwilioCredentials(twilio){
  if (!twilio) return null;
  const accountSid = clean(twilio.accountSid);
  if (!accountSid) return null;
  const authToken = decryptAuthToken(twilio);
  if (!authToken) return null;
  return { accountSid, authToken };
}

async function ensureTwilioAuthEncrypted(db, tenant){
  if (!db || !tenant || !tenant.twilio) return false;

  const twilio = tenant.twilio;
  const hasEncrypted = Boolean(twilio.authToken_enc);
  const plain = clean(twilio.authToken);
  if (!plain || hasEncrypted) return false;

  const authToken_enc = encryptToBase64(plain);
  const filter = tenant._id ? { _id: tenant._id }
    : tenant.tenantId ? { tenantId: tenant.tenantId }
    : null;
  if (!filter) return false;

  try {
    await db.collection('tenants').updateOne(filter, {
      $set: { 'twilio.authToken_enc': authToken_enc, updatedAt: new Date() },
      $unset: { 'twilio.authToken': '' }
    });
    twilio.authToken_enc = authToken_enc;
    delete twilio.authToken;
    return true;
  } catch (err) {
    console.error('[twilio] encrypt_migration_failed', {
      tenantId: tenant.tenantId || tenant._id,
      err: err && (err.stack || err)
    });
    return false;
  }
}

module.exports = {
  resolveTwilioCredentials,
  ensureTwilioAuthEncrypted,
};
