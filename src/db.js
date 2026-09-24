const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required. Set it to your hosted Postgres connection string.');
}

const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_MAX || 3),
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 20_000),
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error:', error);
});

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
let schemaReady = null;

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(schema).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function query(text, values = [], client = pool) {
  await ensureSchema();
  return client.query(text, values);
}

async function maybeOne(text, values = [], client = pool) {
  const result = await query(text, values, client);
  return result.rows[0] || null;
}

async function withTransaction(fn) {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, maybeOne, withTransaction };
