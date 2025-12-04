// lib/auth.js
try { require('./loadEnv'); } catch {}
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const DEFAULT_TTL = process.env.JWT_TTL || '12h';

function signToken(payload, ttl = DEFAULT_TTL){
  return jwt.sign(payload, SECRET, { expiresIn: ttl });
}
function verifyToken(headerValue){
  if (!headerValue) throw new Error('missing_auth_header');
  const [scheme, token] = String(headerValue).split(' ');
  if (scheme !== 'Bearer' || !token) throw new Error('invalid_auth_header');
  try { return jwt.verify(token, SECRET); }
  catch(e){ const err = new Error('invalid_token'); err.cause = e; throw err; }
}
module.exports = { signToken, verifyToken };
