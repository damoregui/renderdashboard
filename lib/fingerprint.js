// lib/fingerprint.js
const crypto = require('crypto');
function buildFingerprint(msgs, extra = '') {
  const key = msgs.map(m => `${m.id}|${new Date(m.createdAt).getTime()}|${m.direction}`).join('~');
  const hash = crypto.createHash('sha1');
  hash.update(key);
  if (extra) hash.update(`|${extra}`);
  return hash.digest('hex');
}
module.exports = { buildFingerprint };
