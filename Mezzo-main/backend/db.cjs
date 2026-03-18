/**
 * Mezzo PostgreSQL Database Module
 *
 * Provides a connection pool and query helper.
 * Reads DATABASE_URL from environment; if not set, exports a no-op stub
 * so the rest of the application can run without a database (dev mode).
 */

const { Pool } = require('pg');
const logger = require('./logger.cjs');

const DATABASE_URL = process.env.DATABASE_URL;

let pool = null;

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  });

  pool.on('error', (err) => {
    logger.error('Unexpected PG pool error', { error: err.message });
  });

  pool.on('connect', () => {
    logger.debug('PG pool: new client connected');
  });
} else {
  logger.warn('DATABASE_URL not set -- database features disabled');
}

/**
 * Execute a SQL query with optional parameters.
 * Returns { rows, rowCount } on success.
 * If no pool is available (dev mode), returns a stub result.
 */
async function query(text, params) {
  if (!pool) {
    logger.debug('DB query skipped (no pool)', { text: text.substring(0, 60) });
    return { rows: [], rowCount: 0 };
  }

  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const ms = Date.now() - start;
    logger.debug('DB query', {
      text: text.substring(0, 80),
      rows: result.rowCount,
      ms,
    });
    return result;
  } catch (err) {
    const ms = Date.now() - start;
    logger.error('DB query error', {
      text: text.substring(0, 80),
      error: err.message,
      ms,
    });
    throw err;
  }
}

/**
 * Run the schema SQL to create tables if they don't exist.
 */
async function initSchema() {
  if (!pool) return;

  const fs = require('fs');
  const path = require('path');
  const schemaPath = path.join(__dirname, 'db-schema.sql');

  try {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    logger.info('Database schema initialized');
  } catch (err) {
    logger.error('Failed to initialize DB schema', { error: err.message });
  }
}

module.exports = { pool, query, initSchema };
