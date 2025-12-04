// lib/crypto.js (CJS)
try { require('./loadEnv'); } catch {}
const crypto = require('crypto');

const KEY_HEX = process.env.ENCRYPTION_KEY_32B_HEX;
if (!KEY_HEX || KEY_HEX.length !== 64){
  console.warn('[crypto] Missing/invalid ENCRYPTION_KEY_32B_HEX (expect 64 hex chars)');
}
const key = KEY_HEX ? Buffer.from(KEY_HEX, 'hex') : crypto.randomBytes(32);

function encryptToBase64(plain){
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64'); // [12IV][16TAG][NCT]
}

function decryptFromBase64(b64){
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  return pt;
}

function maskSecret(s){
  if (!s) return '';
  s = String(s);
  if (s.length <= 6) return '*'.repeat(Math.max(0, s.length - 2)) + s.slice(-2);
  return s.slice(0,4) + '****' + s.slice(-4);
}

module.exports = { encryptToBase64, decryptFromBase64, maskSecret };
