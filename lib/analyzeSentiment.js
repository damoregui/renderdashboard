// lib/analyzeSentiment.js
const crypto = require('crypto');
const { DEFAULT_SENTIMENT_PROMPT } = require('../config/sentimentPrompt');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_SENTIMENT_MODEL || 'gpt-4o-mini';

const SYSTEM_PROMPT = `${DEFAULT_SENTIMENT_PROMPT}\nRespond with exactly one lowercase word: positive, negative, or neutral.`;
const PROMPT_SIGNATURE = crypto
  .createHash('sha1')
  .update(`${SYSTEM_PROMPT}||${OPENAI_MODEL}`)
  .digest('hex');

if (!global.fetch) {
  global.fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
}

function toConversationText(msgs, formatDate, maxChars = 12000) {
  const lines = msgs.map(m => {
    const who = m.direction === 'inbound' ? 'Customer' : 'Company';
    const when = formatDate ? formatDate(new Date(m.createdAt)) : new Date(m.createdAt).toISOString();
    const content = (m.text || '').replace(/\s+/g, ' ').trim();
    return `[${when}] ${who}: ${content}`;
  });
  let joined = lines.join('\n');
  if (joined.length > maxChars) {
    joined = joined.slice(joined.length - maxChars);
  }
  return joined;
}

async function analyzeSentiment(conversationText) {
  if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
  const transcript = (conversationText || '').trim();
  if (!transcript) {
    return { label: 'neutral', usage: null, raw: '' };
  }

  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Conversation transcript:\n${transcript}` }
    ],
    temperature: 0,
    max_tokens: 6
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (err) {
    const error = new Error('openai_invalid_json');
    error.responseText = text;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(payload?.error?.message || `openai_http_${response.status}`);
    error.response = payload;
    error.status = response.status;
    throw error;
  }

  if (payload?.error) {
    const error = new Error(payload.error.message || 'openai_error');
    error.response = payload;
    throw error;
  }

  const raw = payload?.choices?.[0]?.message?.content?.trim() || '';
  if (!raw) {
    const error = new Error('openai_empty_response');
    error.response = payload;
    throw error;
  }

  const lowered = raw.toLowerCase();
  const match = lowered.match(/\b(positive|negative|neutral)\b/);
  const label = match ? match[1] : 'error';

  return { label, usage: payload?.usage, raw };
}

function sentimentPromptSignature() {
  return PROMPT_SIGNATURE;
}

module.exports = { toConversationText, analyzeSentiment, sentimentPromptSignature };
