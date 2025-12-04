// lib/db.js
try { require('./loadEnv'); } catch {}
const { MongoClient } = require('mongodb');

let client, db;
async function getDb(){
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  const name = process.env.DB_NAME || 'dashboard_lh360';
  if (!uri) throw new Error('missing_MONGODB_URI');
  client = new MongoClient(uri, { ignoreUndefined: true });
  await client.connect();
  db = client.db(name);
  try {
    await db.collection('messages').createIndex({ tenantId:1, sid:1 }, { unique:true });
    await db.collection('users').createIndex({ username:1 }, { unique:true });
  } catch {}
  return db;
}
module.exports = { getDb };
