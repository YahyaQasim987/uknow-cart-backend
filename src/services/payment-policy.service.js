import { pool } from '../config/db.js';
import { logger } from '../utils/logger.js';

/**
 * Admin-wise advance-payment policy engine.
 *
 * Two scopes exist, both owned by a single administrator (vendor):
 *   1. Global  - applies to every product / delivery of that administrator.
 *   2. City    - applies to every order delivered to a targeted city.
 *
 * Product-level delivery advance settings (standard + urgent) live on the
 * `products` table and take precedence over these policies.
 */

let schemaReadyPromise = null;

const RULE_TYPES = new Set(['percentage', 'fixed']);

function normalizeType(value) {
  return RULE_TYPES.has(value) ? value : 'percentage';
}

function normalizeValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

function normalizeRule({ enabled, type, value }, label) {
  const isEnabled = enabled === true || enabled === 1 || enabled === 'true';
  const normalizedValue = normalizeValue(value);
  if (!isEnabled) {
    return {
      enabled: false,
      type: normalizeType(type),
      value: null,
      label
    };
  }
  if (normalizedValue === null) {
    throw Object.assign(new Error(`${label} needs a positive advance value.`), {
      statusCode: 400,
      isOperational: true
    });
  }
  if (normalizeType(type) === 'percentage' && normalizedValue > 100) {
    throw Object.assign(new Error(`${label} percentage cannot exceed 100%.`), {
      statusCode: 400,
      isOperational: true
    });
  }
  return {
    enabled: true,
    type: normalizeType(type),
    value: normalizedValue,
    label
  };
}

function mapGlobalRow(row) {
  return {
    productAdvanceEnabled: !!row?.product_advance_enabled,
    productAdvanceType: row?.product_advance_type || 'percentage',
    productAdvanceValue: row?.product_advance_value !== null && row?.product_advance_value !== undefined
      ? Number(row.product_advance_value)
      : null,
    deliveryAdvanceEnabled: !!row?.delivery_advance_enabled,
    deliveryAdvanceType: row?.delivery_advance_type || 'percentage',
    deliveryAdvanceValue: row?.delivery_advance_value !== null && row?.delivery_advance_value !== undefined
      ? Number(row.delivery_advance_value)
      : null,
    applyDeliveryAdvanceToUrgent: row?.apply_delivery_advance_to_urgent !== undefined
      ? !!row.apply_delivery_advance_to_urgent
      : true
  };
}

function mapCityRow(row) {
  return {
    id: row.id,
    adminId: row.admin_id,
    cityName: row.city_name,
    ...mapGlobalRow(row),
    isActive: row.is_active === undefined ? true : !!row.is_active
  };
}

export class PaymentPolicyService {
  /**
   * Idempotently adds the policy tables and the product delivery-advance
   * columns that existing installations may not have yet.
   */
  static ensureSchema() {
    if (!schemaReadyPromise) {
      schemaReadyPromise = PaymentPolicyService.createSchema().catch(error => {
        schemaReadyPromise = null;
        throw error;
      });
    }
    return schemaReadyPromise;
  }

  static async createSchema() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_payment_policies (
        admin_id VARCHAR(50) NOT NULL,
        product_advance_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        product_advance_type ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
        product_advance_value DECIMAL(12, 2) NULL,
        delivery_advance_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        delivery_advance_type ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
        delivery_advance_value DECIMAL(12, 2) NULL,
        apply_delivery_advance_to_urgent BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (admin_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS city_payment_policies (
        id VARCHAR(60) NOT NULL,
        admin_id VARCHAR(50) NOT NULL,
        city_name VARCHAR(100) NOT NULL,
        product_advance_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        product_advance_type ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
        product_advance_value DECIMAL(12, 2) NULL,
        delivery_advance_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        delivery_advance_type ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage',
        delivery_advance_value DECIMAL(12, 2) NULL,
        apply_delivery_advance_to_urgent BOOLEAN NOT NULL DEFAULT TRUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_city_policy_admin_city (admin_id, city_name),
        INDEX idx_city_policy_city (city_name),
        INDEX idx_city_policy_admin (admin_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const productColumns = [
      ['show_in_carousel', 'BOOLEAN NOT NULL DEFAULT FALSE'],
      ['delivery_advance_required', 'BOOLEAN NOT NULL DEFAULT FALSE'],
      ['delivery_advance_type', "ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage'"],
      ['delivery_advance_value', 'DECIMAL(12, 2) NULL'],
      ['urgent_delivery_advance_required', 'BOOLEAN NOT NULL DEFAULT FALSE'],
      ['urgent_delivery_advance_type', "ENUM('percentage', 'fixed') NOT NULL DEFAULT 'percentage'"],
      ['urgent_delivery_advance_value', 'DECIMAL(12, 2) NULL']
    ];

    for (const [columnName, definition] of productColumns) {
      const [columns] = await pool.query(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        ['products', columnName]
      );
      if (columns.length === 0) {
        await pool.query(`ALTER TABLE products ADD COLUMN ${columnName} ${definition}`);
        logger.info(`Added products.${columnName} for delivery advance / carousel support.`);
      }
    }

    const [carouselIndex] = await pool.query(
      'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
      ['products', 'idx_prod_carousel']
    );
    if (carouselIndex.length === 0) {
      await pool.query('ALTER TABLE products ADD INDEX idx_prod_carousel (show_in_carousel)');
    }
  }

  /** Reads the administrator's global policy (disabled defaults when absent). */
  static async getGlobalPolicy(adminId) {
    await PaymentPolicyService.ensureSchema();
    const [rows] = await pool.query('SELECT * FROM admin_payment_policies WHERE admin_id = ?', [adminId]);
    return mapGlobalRow(rows[0]);
  }

  static async upsertGlobalPolicy(adminId, payload = {}) {
    await PaymentPolicyService.ensureSchema();
    const productRule = normalizeRule({
      enabled: payload.productAdvanceEnabled,
      type: payload.productAdvanceType,
      value: payload.productAdvanceValue
    }, 'Product advance');
    const deliveryRule = normalizeRule({
      enabled: payload.deliveryAdvanceEnabled,
      type: payload.deliveryAdvanceType,
      value: payload.deliveryAdvanceValue
    }, 'Delivery advance');

    await pool.query(
      `INSERT INTO admin_payment_policies
        (admin_id, product_advance_enabled, product_advance_type, product_advance_value,
         delivery_advance_enabled, delivery_advance_type, delivery_advance_value,
         apply_delivery_advance_to_urgent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         product_advance_enabled = VALUES(product_advance_enabled),
         product_advance_type = VALUES(product_advance_type),
         product_advance_value = VALUES(product_advance_value),
         delivery_advance_enabled = VALUES(delivery_advance_enabled),
         delivery_advance_type = VALUES(delivery_advance_type),
         delivery_advance_value = VALUES(delivery_advance_value),
         apply_delivery_advance_to_urgent = VALUES(apply_delivery_advance_to_urgent)`,
      [
        adminId,
        productRule.enabled, productRule.type, productRule.value,
        deliveryRule.enabled, deliveryRule.type, deliveryRule.value,
        payload.applyDeliveryAdvanceToUrgent !== false
      ]
    );

    return PaymentPolicyService.getGlobalPolicy(adminId);
  }

  static async listCityPolicies(adminId, { includeInactive = true } = {}) {
    await PaymentPolicyService.ensureSchema();
    const [rows] = await pool.query(
      `SELECT * FROM city_payment_policies
       WHERE admin_id = ?${includeInactive ? '' : ' AND is_active = TRUE'}
       ORDER BY city_name ASC`,
      [adminId]
    );
    return rows.map(mapCityRow);
  }

  static async upsertCityPolicy(adminId, payload = {}) {
    await PaymentPolicyService.ensureSchema();
    const cityName = typeof payload.cityName === 'string' ? payload.cityName.trim() : '';
    if (!cityName) {
      throw Object.assign(new Error('City name is required for a city advance-payment rule.'), {
        statusCode: 400,
        isOperational: true
      });
    }
    const productRule = normalizeRule({
      enabled: payload.productAdvanceEnabled,
      type: payload.productAdvanceType,
      value: payload.productAdvanceValue
    }, `Product advance for ${cityName}`);
    const deliveryRule = normalizeRule({
      enabled: payload.deliveryAdvanceEnabled,
      type: payload.deliveryAdvanceType,
      value: payload.deliveryAdvanceValue
    }, `Delivery advance for ${cityName}`);

    if (!productRule.enabled && !deliveryRule.enabled) {
      throw Object.assign(new Error('Enable at least one advance rule (product or delivery) for this city.'), {
        statusCode: 400,
        isOperational: true
      });
    }

    const existingId = typeof payload.id === 'string' && payload.id.trim()
      ? payload.id.trim()
      : `citypol-${adminId}-${cityName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    // Never allow one vendor to overwrite another vendor's city rule by id.
    const [ownedRows] = await pool.query('SELECT admin_id FROM city_payment_policies WHERE id = ?', [existingId]);
    if (ownedRows.length > 0 && ownedRows[0].admin_id !== adminId) {
      throw Object.assign(new Error('This city advance-payment rule belongs to another administrator.'), {
        statusCode: 403,
        isOperational: true
      });
    }

    await pool.query(
      `INSERT INTO city_payment_policies
        (id, admin_id, city_name, product_advance_enabled, product_advance_type, product_advance_value,
         delivery_advance_enabled, delivery_advance_type, delivery_advance_value,
         apply_delivery_advance_to_urgent, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         city_name = VALUES(city_name),
         product_advance_enabled = VALUES(product_advance_enabled),
         product_advance_type = VALUES(product_advance_type),
         product_advance_value = VALUES(product_advance_value),
         delivery_advance_enabled = VALUES(delivery_advance_enabled),
         delivery_advance_type = VALUES(delivery_advance_type),
         delivery_advance_value = VALUES(delivery_advance_value),
         apply_delivery_advance_to_urgent = VALUES(apply_delivery_advance_to_urgent),
         is_active = VALUES(is_active)`,
      [
        existingId, adminId, cityName,
        productRule.enabled, productRule.type, productRule.value,
        deliveryRule.enabled, deliveryRule.type, deliveryRule.value,
        payload.applyDeliveryAdvanceToUrgent !== false,
        payload.isActive !== false
      ]
    );

    const [rows] = await pool.query('SELECT * FROM city_payment_policies WHERE id = ?', [existingId]);
    return mapCityRow(rows[0]);
  }

  static async deleteCityPolicy(adminId, id) {
    await PaymentPolicyService.ensureSchema();
    const [result] = await pool.query(
      'DELETE FROM city_payment_policies WHERE id = ? AND admin_id = ?',
      [id, adminId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Resolves the effective policy for every merchant in one calculation.
   * Product-level settings are handled by the pricing service; here we only
   * provide the global and city rules per admin id.
   */
  static async resolvePolicyMap(adminIds = [], city = '') {
    const map = new Map();
    const ids = [...new Set(adminIds.filter(Boolean))];
    for (const id of ids) {
      map.set(id, { global: mapGlobalRow(null), city: null });
    }
    if (ids.length === 0) return map;

    try {
      await PaymentPolicyService.ensureSchema();
      const placeholders = ids.map(() => '?').join(', ');
      const [globalRows] = await pool.query(
        `SELECT * FROM admin_payment_policies WHERE admin_id IN (${placeholders})`,
        ids
      );
      for (const row of globalRows) {
        const current = map.get(row.admin_id) || { global: mapGlobalRow(null), city: null };
        current.global = mapGlobalRow(row);
        map.set(row.admin_id, current);
      }

      const cityName = typeof city === 'string' ? city.trim() : '';
      if (cityName) {
        const [cityRows] = await pool.query(
          `SELECT * FROM city_payment_policies
           WHERE admin_id IN (${placeholders}) AND is_active = TRUE AND LOWER(city_name) = LOWER(?)`,
          [...ids, cityName]
        );
        for (const row of cityRows) {
          const current = map.get(row.admin_id) || { global: mapGlobalRow(null), city: null };
          current.city = mapCityRow(row);
          map.set(row.admin_id, current);
        }
      }
    } catch (error) {
      logger.warn('Advance-payment policies could not be resolved; continuing without policy rules.', {
        message: error.message
      });
    }

    return map;
  }

  /** Shared money helper: computes an advance amount for a rule + base amount. */
  static computeAdvanceAmount(rule, baseAmount) {
    const base = Number(baseAmount);
    if (!rule || !rule.enabled || !Number.isFinite(base) || base <= 0) return 0;
    const value = Number(rule.value);
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (rule.type === 'fixed') {
      return Math.round(Math.min(value, base) * 100) / 100;
    }
    return Math.round(base * (Math.min(value, 100) / 100) * 100) / 100;
  }
}
