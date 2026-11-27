import { pool } from '../config/db.js';

/**
 * GLOBAL SKU SERVICE
 * -----------------------------------------------------------------------------
 * Design decision (requirement 5 of the SKU task):
 * `products.sku` and `product_variants.sku` each have their own UNIQUE index, so
 * MySQL alone cannot stop a product SKU from colliding with a variant SKU.
 * We therefore maintain `sku_registry`, whose PRIMARY KEY on `sku` is the single
 * global uniqueness guard for BOTH tables. Every SKU is claimed in that registry
 * inside the same transaction as the row insert, which makes cross-table
 * collisions impossible even under concurrency.
 *
 * Sequence numbers come from `sku_sequences`. The row is locked with
 * `SELECT ... FOR UPDATE` before it is incremented, so two simultaneous requests
 * can never read the same `last_value`.
 *
 * Existing SKUs are never renamed by anything in this file.
 */

export const SKU_MAX_LENGTH = 64;
const SKU_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const PRODUCT_SEQUENCE_PADDING = 5;
const MAX_GENERATION_ATTEMPTS = 20;

export function isMissingSku(value) {
  return typeof value !== 'string' || value.trim() === '';
}

/** Trim, uppercase, collapse anything outside A-Z0-9 into single hyphens, cap at 64. */
export function normalizeSku(value) {
  if (typeof value !== 'string') return '';
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, SKU_MAX_LENGTH)
    .replace(/-+$/, '');
  return normalized;
}

export function isValidSku(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= SKU_MAX_LENGTH &&
    SKU_PATTERN.test(value);
}

/** Creates an operational error that error.middleware.js returns with its status code. */
export function skuError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.isOperational = true;
  return error;
}

let schemaPromise = null;

/**
 * Idempotent DDL for the SKU infrastructure. Always runs OUTSIDE a transaction
 * (MySQL DDL implicitly commits). Safe to call on every request: the result is
 * cached for the life of the process.
 */
export function ensureSkuTables() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await pool.query(
        'CREATE TABLE IF NOT EXISTS `sku_sequences` (' +
        ' `scope_key` VARCHAR(120) NOT NULL,' +
        ' `last_value` BIGINT UNSIGNED NOT NULL DEFAULT 0,' +
        ' `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,' +
        ' PRIMARY KEY (`scope_key`)' +
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
      );
      await pool.query(
        'CREATE TABLE IF NOT EXISTS `sku_registry` (' +
        ' `sku` VARCHAR(64) NOT NULL,' +
        " `entity_type` ENUM('product', 'variant') NOT NULL," +
        ' `entity_id` VARCHAR(50) NOT NULL,' +
        ' `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
        ' PRIMARY KEY (`sku`),' +
        ' INDEX `idx_sku_registry_entity` (`entity_type`, `entity_id`)' +
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
      );
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

/** Atomically reserves the next number for a scope key. Call inside a transaction. */
async function nextSequence(connection, scopeKey) {
  await connection.query(
    'INSERT IGNORE INTO `sku_sequences` (`scope_key`, `last_value`) VALUES (?, 0)',
    [scopeKey]
  );
  const [rows] = await connection.query(
    'SELECT `last_value` FROM `sku_sequences` WHERE `scope_key` = ? FOR UPDATE',
    [scopeKey]
  );
  const next = Number(rows[0]?.last_value || 0) + 1;
  await connection.query(
    'UPDATE `sku_sequences` SET `last_value` = ?, `updated_at` = CURRENT_TIMESTAMP WHERE `scope_key` = ?',
    [next, scopeKey]
  );
  return next;
}

/**
 * Finds whoever already owns a SKU. Checks the registry first (new rows) and
 * then both catalog tables (legacy rows created before the registry existed).
 */
export async function findSkuOwner(executor, sku) {
  const [registryRows] = await executor.query(
    'SELECT entity_type, entity_id FROM sku_registry WHERE sku = ? LIMIT 1',
    [sku]
  );
  if (registryRows.length > 0) {
    return { entityType: registryRows[0].entity_type, entityId: registryRows[0].entity_id };
  }
  const [productRows] = await executor.query('SELECT id FROM products WHERE sku = ? LIMIT 1', [sku]);
  if (productRows.length > 0) {
    return { entityType: 'product', entityId: productRows[0].id };
  }
  const [variantRows] = await executor.query('SELECT id FROM product_variants WHERE sku = ? LIMIT 1', [sku]);
  if (variantRows.length > 0) {
    return { entityType: 'variant', entityId: variantRows[0].id };
  }
  return null;
}

function describeOwner(owner) {
  return owner.entityType === 'variant'
    ? `variant "${owner.entityId}"`
    : `product "${owner.entityId}"`;
}

/** Throws a 409 when the SKU is already used by a different record. */
export async function assertSkuAvailable(executor, sku, { entityType, entityId } = {}) {
  const owner = await findSkuOwner(executor, sku);
  if (owner && !(owner.entityType === entityType && owner.entityId === entityId)) {
    throw skuError(
      `SKU "${sku}" is already used by ${describeOwner(owner)}. SKUs must be globally unique across every seller, product and variant.`,
      409
    );
  }
  return true;
}

/**
 * Claims a SKU in the global registry. The INSERT is the atomic lock: if two
 * transactions race for the same value, exactly one wins and the other gets a
 * duplicate-key error. Call inside a transaction.
 */
export async function reserveSku(connection, { sku, entityType, entityId }) {
  if (!isValidSku(sku)) {
    throw skuError(`SKU "${sku}" is invalid. Use A-Z, 0-9 and hyphens only (maximum ${SKU_MAX_LENGTH} characters).`);
  }
  await assertSkuAvailable(connection, sku, { entityType, entityId });
  try {
    await connection.query(
      'INSERT INTO sku_registry (sku, entity_type, entity_id) VALUES (?, ?, ?)',
      [sku, entityType, entityId]
    );
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      // Re-read: the row may already belong to this same record (idempotent re-save).
      const owner = await findSkuOwner(connection, sku);
      if (!(owner && owner.entityType === entityType && owner.entityId === entityId)) {
        throw skuError(
          `SKU "${sku}" was just claimed by another request. Please generate a new SKU and try again.`,
          409
        );
      }
      return;
    }
    throw error;
  }
}

/** Frees a SKU after a rename or delete so it can be reused. */
export async function releaseSku(executor, sku) {
  if (!sku) return;
  await executor.query('DELETE FROM sku_registry WHERE sku = ?', [sku]);
}

export function deriveCategoryCode(source) {
  const cleaned = String(source || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned ? cleaned.slice(0, 4) : 'GEN';
}

function deriveVariantCode({ variantCode, color, size, variantName, variantType }) {
  const candidates = [
    variantCode,
    [color, size].filter(Boolean).join('-'),
    color,
    size,
    variantName
  ];
  for (const candidate of candidates) {
    const normalized = normalizeSku(candidate);
    if (!normalized) continue;
    if (normalized.length <= 24) return normalized;
    const truncated = normalized.slice(0, 24).replace(/-+$/, '');
    if (truncated) return truncated;
  }
  return '';
}

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * UK-{CATEGORY_CODE}-{YYYYMM}-{SEQUENCE}
 * The sequence is scoped per category + month and is zero padded.
 */
export async function generateProductSku(connection, { category, brand, productName } = {}) {
  const categoryCode = deriveCategoryCode(category || brand || productName);
  const period = currentPeriod();
  const scopeKey = `product:${categoryCode}:${period}`;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const sequence = await nextSequence(connection, scopeKey);
    const candidate = `UK-${categoryCode}-${period}-${String(sequence).padStart(PRODUCT_SEQUENCE_PADDING, '0')}`;
    if (candidate.length <= SKU_MAX_LENGTH && !(await findSkuOwner(connection, candidate))) {
      return candidate;
    }
  }
  throw skuError('A unique product SKU could not be generated. Please try again.', 500);
}

/**
 * {PARENT_PRODUCT_SKU}-{VARIANT_CODE}
 * Falls back to a padded per-parent sequence, then to -2, -3 ... if taken.
 */
export async function generateVariantSku(connection, {
  parentSku,
  variantCode,
  color,
  size,
  variantName,
  variantType
} = {}) {
  const parent = normalizeSku(parentSku) || 'UK-GEN-PARENT';
  let code = deriveVariantCode({ variantCode, color, size, variantName, variantType });

  if (!code) {
    const sequence = await nextSequence(connection, `variant-code:${parent}`);
    code = `V${String(sequence).padStart(2, '0')}`;
  }

  const base = `${parent}-${code}`.slice(0, SKU_MAX_LENGTH).replace(/-+$/, '');
  if (!(await findSkuOwner(connection, base))) return base;

  for (let suffix = 2; suffix <= MAX_GENERATION_ATTEMPTS; suffix++) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, SKU_MAX_LENGTH - suffixText.length).replace(/-+$/, '')}${suffixText}`;
    if (!(await findSkuOwner(connection, candidate))) return candidate;
  }
  throw skuError('A unique variant SKU could not be generated for this parent product. Please try again.', 500);
}

/**
 * Copies every existing catalog SKU into the registry so generated SKUs can
 * never collide with legacy rows. INSERT IGNORE keeps the first owner and never
 * changes stored SKUs. Returns how many registry rows exist afterwards.
 */
export async function syncSkuRegistry(executor = pool) {
  await executor.query(`
    INSERT IGNORE INTO sku_registry (sku, entity_type, entity_id)
    SELECT TRIM(sku), 'product', id FROM products
    WHERE sku IS NOT NULL AND TRIM(sku) <> ''
  `);
  await executor.query(`
    INSERT IGNORE INTO sku_registry (sku, entity_type, entity_id)
    SELECT TRIM(sku), 'variant', id FROM product_variants
    WHERE sku IS NOT NULL AND TRIM(sku) <> ''
  `);
  const [[{ total }]] = await executor.query('SELECT COUNT(*) AS total FROM sku_registry');
  return Number(total);
}
