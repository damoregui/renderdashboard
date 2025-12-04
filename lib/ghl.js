// lib/ghl.js
try { require('./loadEnv'); } catch {}
const { normalizePhoneForSearch } = require('./phone');

const BASE = process.env.LEADC_BASE_URL || 'https://services.leadconnectorhq.com';

const DEBUG_GHL = String(process.env.DEBUG_GHL || '').toLowerCase() === '1'
  || String(process.env.DEBUG_GHL || '').toLowerCase() === 'true';
const log = (...args) => { if (DEBUG_GHL) console.log('[ghl]', ...args); };

function mapCustomFields(arr){
  const out = {};
  if (!Array.isArray(arr)) return out;
  arr.forEach(cf => {
    if (!cf || !cf.id) return;
    out[cf.id] = cf.value;
  });
  return out;
}

function maskPhone(p){
  if (!p) return '';
  const s = String(p).replace(/[^\d+]/g, '');
  const last4 = s.slice(-4);
  const lead  = s.startsWith('+') ? '+' : '';
  return `${lead}***${last4}`;
}

async function toJson(res){
  const txt = await res.text();
  try { return JSON.parse(txt); } catch { return { _raw: txt }; }
}

/**
 * ÚNICO método de búsqueda: POST /contacts/search con filters [{field:"phone",operator:"eq",value:q}]
 * Devuelve: { id, firstName, lastName } o null si no hay match.
 */
async function searchContactByPhone({ apiKey, locationId, phone }){
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Version: '2021-07-28',
  };

  const q = normalizePhoneForSearch(phone);
  const url = `${BASE}/contacts/search`;
  const body = JSON.stringify({
    locationId,
    page: 1,
    pageLimit: 20,
    filters: [{ field: 'phone', operator: 'eq', value: q }],
  });

  log('lookup:start', { locationId, phone: maskPhone(q) });

  try{
    const res = await fetch(url, { method: 'POST', headers, body });
    const data = await toJson(res);

    if (!res.ok){
      log('lookup:non_ok', { status: res.status, body: data });
      if (res.status === 401 || res.status === 403) {
        throw new Error(`ghl_auth_${res.status}`);
      }
      return null;
    }

    const items = Array.isArray(data?.contacts) ? data.contacts : [];
    log('lookup:ok', { items: items.length });

    if (!items.length) {
      log('lookup:end:not_found', { phone: maskPhone(q) });
      return null;
    }

    // La API ya filtró por eq phone: tomamos el primero
    const c = items[0];
    const out = {
      id: c.id,
      firstName: c.firstName || '',
      lastName: c.lastName || '',
    };

    if (out.id) {
      log('lookup:match', { id: out.id, firstName: out.firstName, lastName: out.lastName });
      return out;
    }

    log('lookup:end:not_found_parsed', { phone: maskPhone(q) });
    return null;
  }catch(e){
    log('lookup:error', { err: String(e?.message || e) });
    throw e;
  }
}

async function getContactById({ apiKey, contactId }){
  if (!apiKey || !contactId) return null;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    Version: '2021-07-28',
  };

  const url = `${BASE}/contacts/${encodeURIComponent(contactId)}`;
  log('contact:start', { contactId });

  try {
    const res = await fetch(url, { method: 'GET', headers });
    const data = await toJson(res);

    if (!res.ok){
      log('contact:non_ok', { contactId, status: res.status, body: data });
      if (res.status === 401 || res.status === 403){
        throw new Error(`ghl_auth_${res.status}`);
      }
      return null;
    }

    const c = data?.contact || data || {};
    const parsed = {
      id: c.id || contactId,
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      phone: c.phone || c.phoneNumber || '',
      customFields: mapCustomFields(c.customFields),
    };

    log('contact:ok', { contactId: parsed.id });
    return parsed;
  } catch (e) {
    log('contact:error', { contactId, err: String(e?.message || e) });
    throw e;
  }
}

function ensureAbsoluteUrl(u){
  if (!u) return null;
  const str = String(u).trim();
  if (!str) return null;
  if (/^https?:/i.test(str)) return str;
  const pref = str.startsWith('/') ? '' : '/';
  return `${BASE}${pref}${str}`;
}

async function listCalendars({ apiKey, locationId }){
  if (!apiKey || !locationId) return [];

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    Version: '2021-04-15',
  };

  const url = `${BASE}/calendars/?locationId=${encodeURIComponent(locationId)}`;

  log('calendars:start', { locationId });

  try {
    const res = await fetch(url, { method: 'GET', headers });
    const data = await toJson(res);

    if (!res.ok){
      log('calendars:non_ok', { locationId, status: res.status, body: data });
      if (res.status === 401 || res.status === 403){
        throw new Error(`ghl_auth_${res.status}`);
      }
      return Array.isArray(data?.calendars) ? data.calendars : [];
    }

    const calendars = Array.isArray(data?.calendars) ? data.calendars : [];
    log('calendars:ok', { locationId, count: calendars.length });
    return calendars;
  } catch (e) {
    log('calendars:error', { locationId, err: String(e?.message || e) });
    throw e;
  }
}

async function listCalendarEvents({ apiKey, locationId, calendarId, startTimeMs, endTimeMs }){
  if (!apiKey || !locationId || !calendarId) return [];

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    Version: '2021-07-28',
  };

  const params = new URLSearchParams();
  params.set('locationId', locationId);
  params.set('calendarId', calendarId);

  if (Number.isFinite(startTimeMs)) {
    params.set('startTime', String(Math.floor(startTimeMs)));
  }
  if (Number.isFinite(endTimeMs)) {
    params.set('endTime', String(Math.floor(endTimeMs)));
  }

  const baseUrl = `${BASE}/calendars/events?${params.toString()}`;

  log('calendar_events:start', {
    locationId,
    calendarId,
    startTime: params.get('startTime'),
    endTime: params.get('endTime'),
  });

  const combined = [];
  const seen = new Set();
  let nextUrl = baseUrl;
  let page = 0;

  try {
    while (nextUrl && page < 30) {
      page += 1;
      const res = await fetch(nextUrl, { method: 'GET', headers });
      const data = await toJson(res);

      if (!res.ok) {
        log('calendar_events:non_ok', { locationId, calendarId, status: res.status, body: data });
        if (res.status === 401 || res.status === 403) {
          throw new Error(`ghl_auth_${res.status}`);
        }
        break;
      }

      const events = Array.isArray(data?.events)
        ? data.events
        : Array.isArray(data?.items)
          ? data.items
          : [];

      events.forEach(event => {
        if (!event) return;
        const key = event.id || `${event.contactId || ''}:${event.startTime || event.dateAdded || ''}`;
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        combined.push(event);
      });

      const nextCandidate = ensureAbsoluteUrl(
        data?.meta?.nextPageUrl
          || data?.meta?.nextPage
          || data?.links?.next
          || data?.nextPageUrl
          || data?.nextPage
      );

      if (!nextCandidate || nextCandidate === nextUrl) {
        break;
      }

      nextUrl = nextCandidate;
    }

    log('calendar_events:ok', { locationId, calendarId, count: combined.length, pages: page });
    return combined;
  } catch (e) {
    log('calendar_events:error', { locationId, calendarId, err: String(e?.message || e) });
    throw e;
  }
}

async function listFormSubmissions({ apiKey, locationId, formId, startAt, endAt, limit = 50 }){
  if (!apiKey || !locationId || !formId) return [];

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    Version: '2021-07-28',
  };

  const params = new URLSearchParams();
  params.set('locationId', locationId);
  params.set('formId', formId);
  if (limit) params.set('limit', String(limit));
  if (startAt) params.set('startAt', startAt);
  if (endAt) params.set('endAt', endAt);

  const baseUrl = `${BASE}/forms/submissions?${params.toString()}`;

  log('forms:start', { locationId, formId, startAt, endAt, limit });

  const combined = [];
  const seen = new Set();
  let nextUrl = baseUrl;
  let page = 0;

  try {
    while (nextUrl && page < 50){
      page += 1;
      const res = await fetch(nextUrl, { method: 'GET', headers });
      const data = await toJson(res);

      if (!res.ok){
        log('forms:non_ok', { status: res.status, body: data });
        if (res.status === 401 || res.status === 403){
          throw new Error(`ghl_auth_${res.status}`);
        }
        break;
      }

      const submissions = Array.isArray(data?.submissions)
        ? data.submissions
        : Array.isArray(data?.items)
          ? data.items
          : [];

      submissions.forEach(sub => {
        if (!sub) return;
        const key = sub.id || sub.submissionId || sub.contactId || sub.createdAt;
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        combined.push(sub);
      });

      const nextCandidate = ensureAbsoluteUrl(
        data?.meta?.nextPageUrl
          || data?.meta?.nextPage
          || data?.links?.next
          || data?.nextPageUrl
          || data?.nextPage
      );

      if (!nextCandidate || nextCandidate === nextUrl) break;
      nextUrl = nextCandidate;
    }

    log('forms:ok', { locationId, formId, count: combined.length, pages: page });
    return combined;
  } catch (e) {
    log('forms:error', { locationId, formId, err: String(e?.message || e) });
    throw e;
  }
}

module.exports = {
  searchContactByPhone,
  getContactById,
  listCalendars,
  listCalendarEvents,
  listFormSubmissions,
};
