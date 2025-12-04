// lib/phone.js
function normalizePhoneForSearch(raw){
  if (!raw) return '';
  const s = String(raw).trim();
  if (s.startsWith('+')) return '+' + s.replace(/[^\d]/g,'');
  return s.replace(/[^\d]/g,'');
}
module.exports = { normalizePhoneForSearch };
