import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function buildSslConfig() {
  if (!config.db.sslCa) return undefined;
  const caPath = path.isAbsolute(config.db.sslCa)
    ? config.db.sslCa
    : path.resolve(backendRoot, config.db.sslCa);
  return {
    ca: fs.readFileSync(caPath),
    minVersion: 'TLSv1.2',
    rejectUnauthorized: config.db.sslRejectUnauthorized
  };
}

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  ssl: buildSslConfig(),
  connectionLimit: config.db.connectionLimit,
  queueLimit: config.db.queueLimit,
  waitForConnections: config.db.waitForConnections,
  charset: 'utf8mb4',
  connectTimeout: 20000,
  // Managed MySQL / TiDB closes idle sockets. Keeping TCP alive and letting the
  // pool retire idle connections BEFORE the server drops them prevents the
  // "read ECONNRESET" / "Can't add new command when connection is in closed
  // state" errors that otherwise turn every API call into a 500.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  maxIdle: 2,
  idleTimeout: 60000,
  timezone: '+05:00', // Pakistan Standard Time
  dateStrings: true
});

// A socket the server already killed must be thrown away, not handed back out.
pool.on('connection', connection => {
  connection.on('error', err => {
    logger.warn(`MySQL pooled connection error (${err.code || err.message}); discarding connection.`);
    connection.destroy();
  });
});

const TRANSIENT_DB_CODES = new Set([
  'ECONNRESET',
  'PROTOCOL_CONNECTION_LOST',
  'ETIMEDOUT',
  'EPIPE',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ER_CONNECTION_KILLED'
]);

export function isTransientDbError(err) {
  if (!err) return false;
  if (TRANSIENT_DB_CODES.has(err.code)) return true;
  return /closed state|connection lost|server has gone away|socket hang up/i.test(err.message || '');
}

function isReadOnlyStatement(sql) {
  return /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(String(sql || ''));
}

export async function testConnection() {
  try {
    const conn = await pool.getConnection();
    logger.info(`✓ Successfully connected to MySQL database: ${config.db.database} on ${config.db.host}:${config.db.port}`);
    conn.release();
    return true;
  } catch (err) {
    logger.warn(`MySQL connection notice: ${err.message}. (Database operations will report error or run mock fallback in test suites).`);
    return false;
  }
}

export async function executeQuery(sql, params = []) {
  const canRetry = isReadOnlyStatement(sql);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (err) {
      if (attempt === 0 && canRetry && isTransientDbError(err)) {
        logger.warn(`Transient database connection error (${err.code || err.message}); retrying once.`, { sql });
        continue;
      }
      logger.error(`Database query error: ${err.message}`, { sql, params });
      throw err;
    }
  }
}

// Keeps one warm connection so the pool regularly notices dead sockets even on
// an idle store, instead of failing the first request after a quiet period.
const keepAliveTimer = setInterval(() => {
  pool.query('SELECT 1').catch(() => {});
}, 4 * 60 * 1000);
if (typeof keepAliveTimer.unref === 'function') keepAliveTimer.unref();
