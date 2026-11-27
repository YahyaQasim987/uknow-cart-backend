import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, testConnection } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';
import { ensureSkuTables, syncSkuRegistry } from '../src/services/sku.service.js';
import { PaymentPolicyService } from '../src/services/payment-policy.service.js';
import { ProductImageService } from '../src/services/product-image.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCHEMA_FILE = path.resolve(__dirname, '../sql/schema.sql');

export async function runMigrations() {
  logger.info('Initializing consolidated database schema...');
  const isConnected = await testConnection();
  if (!isConnected) {
    logger.warn('MySQL database connection unavailable. Schema execution skipped in this environment.');
    return { success: false, applied: [] };
  }

  const connection = await pool.getConnection();
  try {
    if (!fs.existsSync(SCHEMA_FILE)) {
      throw new Error(`Schema file not found at: ${SCHEMA_FILE}`);
    }

    logger.info(`Applying master schema from ${SCHEMA_FILE}...`);
    const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');

    // Split statements safely by semicolon (ignoring semicolons within strings or comments if possible, but basic strip works for standard DDL)
    const uncommentedSql = sql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');
    const statements = uncommentedSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    let executedCount = 0;
    for (const statement of statements) {
      // Skip pure comments or empty blocks
      const cleanStatement = statement
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .trim();

      if (cleanStatement.length > 0) {
        await connection.query(cleanStatement);
        executedCount++;
      }
    }

    const compatibilityColumns = [
      ['email_verified', 'BOOLEAN NOT NULL DEFAULT TRUE AFTER password_hash'],
      ['signup_method', "ENUM('website', 'google', 'facebook', 'unknown') NOT NULL DEFAULT 'unknown' AFTER email_verified"],
      ['whatsapp_phone', 'VARCHAR(50) NULL AFTER secondary_phone'],
      ['whatsapp_number', 'VARCHAR(50) NULL AFTER whatsapp_phone'],
      ['bio', 'TEXT NULL AFTER address'],
      ['owner_id', 'VARCHAR(50) NULL AFTER admin_id'],
      ['owner_name', 'VARCHAR(150) NULL AFTER owner_id'],
      ['owner_phone', 'VARCHAR(50) NULL AFTER owner_name'],
      ['owner_whatsapp', 'VARCHAR(50) NULL AFTER owner_phone'],
      ['gtin', 'VARCHAR(32) NULL AFTER sku'],
      ['mpn', 'VARCHAR(100) NULL AFTER gtin'],
      ['model_number', 'VARCHAR(100) NULL AFTER mpn'],
      ['warranty', 'VARCHAR(255) NULL AFTER model_number'],
      ['advance_payment_value', 'DECIMAL(12, 2) NULL AFTER advance_payment_percent'],
      ['seo_title', 'VARCHAR(255) NULL AFTER sub_category_description'],
      ['meta_description', 'TEXT NULL AFTER seo_title'],
      ['url_slug', 'VARCHAR(255) NULL AFTER meta_description'],
      ['image_alt_text', 'VARCHAR(255) NULL AFTER url_slug']
    ];
    for (const [columnName, definition] of compatibilityColumns.slice(0, 5)) {
      const [columns] = await connection.query(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        ['users', columnName]
      );
      if (columns.length === 0) {
        await connection.query(`ALTER TABLE users ADD COLUMN ${columnName} ${definition}`);
        logger.info(`Added users.${columnName} for existing installations.`);
      }
    }
    for (const [columnName, definition] of compatibilityColumns.slice(5)) {
      const [columns] = await connection.query(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        ['products', columnName]
      );
      if (columns.length === 0) {
        await connection.query(`ALTER TABLE products ADD COLUMN ${columnName} ${definition}`);
        logger.info(`Added products.${columnName} for existing installations.`);
      }
    }

    const variantCompatibilityColumns = [
      ['barcode', 'VARCHAR(100) NULL'],
      ['variant_type', "VARCHAR(50) NULL DEFAULT 'Option'"],
      ['variant_code', 'VARCHAR(50) NULL'],
      ['is_active', 'BOOLEAN NOT NULL DEFAULT TRUE'],
      ['is_full_variant', 'BOOLEAN NOT NULL DEFAULT FALSE'],
      ['reserved_stock', 'INT NOT NULL DEFAULT 0'],
      ['color', 'VARCHAR(50) NULL'],
      ['size', 'VARCHAR(50) NULL'],
      ['image_url', 'VARCHAR(500) NULL'],
      ['video_url', 'VARCHAR(500) NULL'],
      ['subtitle', 'VARCHAR(255) NULL'],
      ['description', 'TEXT NULL'],
      ['images', 'JSON NULL'],
      ['brand', 'VARCHAR(100) NULL'],
      ['sub_category', 'VARCHAR(100) NULL'],
      ['luxury_tier', 'VARCHAR(50) NULL'],
      ['cost_price', 'DECIMAL(12, 2) NULL'],
      ['original_price', 'DECIMAL(12, 2) NULL'],
      ['discount_type', "ENUM('percentage', 'fixed') NULL DEFAULT 'percentage'"],
      ['discount_value', 'DECIMAL(12, 2) NULL DEFAULT 0.00'],
      ['delivery_days', 'INT NULL'],
      ['delivery_timeline_note', 'VARCHAR(255) NULL'],
      ['advance_payment_required', 'BOOLEAN NULL'],
      ['advance_payment_type', "ENUM('percentage', 'fixed') NULL DEFAULT 'percentage'"],
      ['advance_payment_amount', 'DECIMAL(12, 2) NULL'],
      ['advance_payment_percent', 'INT NULL'],
      ['advance_payment_value', 'DECIMAL(12, 2) NULL'],
      ['city_restriction_mode', "ENUM('all', 'restricted') NULL DEFAULT 'all'"],
      ['allowed_cities', 'JSON NULL'],
      ['standalone_in_catalog', 'BOOLEAN NOT NULL DEFAULT TRUE'],
      ['badge', 'VARCHAR(50) NULL'],
      ['expires_at', 'DATETIME NULL']
    ];
    for (const [columnName, definition] of variantCompatibilityColumns) {
      const [columns] = await connection.query(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        ['product_variants', columnName]
      );
      if (columns.length === 0) {
        await connection.query(`ALTER TABLE product_variants ADD COLUMN ${columnName} ${definition}`);
        logger.info(`Added product_variants.${columnName} for existing installations.`);
      }
    }

    const [orderItemCostColumn] = await connection.query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['order_items', 'cost_price']
    );
    if (orderItemCostColumn.length === 0) {
      await connection.query('ALTER TABLE order_items ADD COLUMN cost_price DECIMAL(12, 2) NULL AFTER price');
      logger.info('Added order_items.cost_price for delivered-order profit reporting.');
    }

    const bannerCompatibilityColumns = {
      hero_banners: [
        ['internal_name', 'VARCHAR(255) NULL'],
        ['theme', "VARCHAR(50) NULL DEFAULT 'dark'"],
        ['eyebrow', 'VARCHAR(255) NULL'],
        ['category_label', 'VARCHAR(255) NULL'],
        ['subtitle', 'TEXT NULL'],
        ['image', 'TEXT NULL'],
        ['desktop_image', 'TEXT NULL'],
        ['tablet_image', 'TEXT NULL'],
        ['mobile_image', 'TEXT NULL'],
        ['mobile_image_url', 'TEXT NULL'],
        ['overlay_opacity', 'INT NULL DEFAULT 45'],
        ['button_text', "VARCHAR(100) NULL DEFAULT 'Explore Collection'"],
        ['badge', 'VARCHAR(100) NULL'],
        ['link_type', "VARCHAR(50) NULL DEFAULT 'category'"],
        ['target_product_id', 'VARCHAR(100) NULL'],
        ['target_category', 'VARCHAR(100) NULL'],
        ['target_sub_category', 'VARCHAR(100) NULL'],
        ['custom_url', 'TEXT NULL'],
        ['price', 'DECIMAL(12, 2) NULL'],
        ['original_price', 'DECIMAL(12, 2) NULL'],
        ['accent_label', 'VARCHAR(255) NULL'],
        ['display_order', 'INT NULL DEFAULT 1'],
        ['active', 'BOOLEAN NULL DEFAULT TRUE']
      ],
      promo_cards: [
        ['internal_name', 'VARCHAR(255) NULL'],
        ['description', 'TEXT NULL'],
        ['image', 'TEXT NULL'],
        ['mobile_image_url', 'TEXT NULL'],
        ['overlay_opacity', 'INT NULL DEFAULT 35'],
        ['link_type', "VARCHAR(50) NULL DEFAULT 'category'"],
        ['target_product_id', 'VARCHAR(100) NULL'],
        ['target_category', 'VARCHAR(100) NULL'],
        ['target_sub_category', 'VARCHAR(100) NULL'],
        ['custom_url', 'TEXT NULL'],
        ['action_text', "VARCHAR(100) NULL DEFAULT 'Explore Collection'"],
        ['badge', 'VARCHAR(100) NULL'],
        ['display_order', 'INT NULL DEFAULT 1'],
        ['active', 'BOOLEAN NULL DEFAULT TRUE']
      ],
      trust_indicators: [
        ['subtitle', 'TEXT NULL'],
        ['display_order', 'INT NULL DEFAULT 1'],
        ['active', 'BOOLEAN NULL DEFAULT TRUE']
      ],
      carousel_settings: [
        ['auto_play', 'BOOLEAN NULL DEFAULT TRUE'],
        ['slide_duration', 'INT NULL DEFAULT 6500'],
        ['show_arrows', 'BOOLEAN NULL DEFAULT TRUE'],
        ['show_indicators', 'BOOLEAN NULL DEFAULT TRUE']
      ]
    };
    for (const [tableName, columnsToEnsure] of Object.entries(bannerCompatibilityColumns)) {
      for (const [columnName, definition] of columnsToEnsure) {
        const [columns] = await connection.query(
          'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
          [tableName, columnName]
        );
        if (columns.length === 0) {
          await connection.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
          logger.info(`Added ${tableName}.${columnName} for existing installations.`);
        }
      }

    }

    const ensureColumn = async (tableName, columnName, definition) => {
      const [columns] = await connection.query(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [tableName, columnName]
      );
      if (columns.length === 0) {
        await connection.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
        logger.info(`Added ${tableName}.${columnName} for existing installations.`);
      }
    };
    const ensureIndex = async (tableName, indexName, definition, unique = false) => {
      const [indexes] = await connection.query(
        'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
        [tableName, indexName]
      );
      if (indexes.length === 0) {
        await connection.query(`ALTER TABLE ${tableName} ADD ${unique ? 'UNIQUE ' : ''}INDEX ${indexName} ${definition}`);
      }
    };
    const ensureCascadeFk = async (tableName, constraintName, definition) => {
      const [rules] = await connection.query(
        'SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?',
        [tableName, constraintName]
      );
      if (rules.length && rules[0].DELETE_RULE !== 'CASCADE') {
        await connection.query(`ALTER TABLE ${tableName} DROP FOREIGN KEY ${constraintName}`);
        await connection.query(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition}`);
      }
    };

    await ensureColumn('products', 'advance_payment_percent', 'INT NULL DEFAULT 20');
    await ensureColumn('products', 'advance_payment_required', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await ensureColumn('products', 'archived_at', 'DATETIME NULL');
    await ensureColumn('products', 'archived_by', 'VARCHAR(50) NULL');
    await ensureColumn('products', 'archive_reason', 'VARCHAR(255) NULL');
    await ensureIndex('products', 'idx_prod_archived', '(archived_at)');
    await ensureColumn('products', 'advance_payment_amount', 'DECIMAL(12, 2) NULL');
    await ensureColumn('orders', 'advance_payment_due', 'DECIMAL(12, 2) NOT NULL DEFAULT 0.00');
    await ensureColumn('orders', 'cod_remaining_due', 'DECIMAL(12, 2) NOT NULL DEFAULT 0.00');
    await ensureColumn('orders', 'expires_at', 'DATETIME NULL');
    await ensureColumn('orders', 'customer_hidden_at', 'DATETIME NULL');
    await ensureColumn('users', 'bank_name', 'VARCHAR(100) NULL');
    await ensureColumn('users', 'bank_account_title', 'VARCHAR(150) NULL');
    await ensureColumn('users', 'bank_account_number', 'VARCHAR(100) NULL');
    await ensureColumn('orders', 'guest_access_token', 'VARCHAR(100) NULL');
    await ensureColumn('orders', 'checkout_key', 'VARCHAR(100) NULL AFTER guest_access_token');
    await ensureColumn('orders', 'checkout_request_hash', 'CHAR(64) NULL AFTER checkout_key');
    await ensureIndex('orders', 'uk_order_checkout_key', '(checkout_key)', true);
    await ensureColumn('orders', 'transaction_reference', 'VARCHAR(150) NULL');
    await ensureColumn('orders', 'account_holder_name', 'VARCHAR(150) NULL');
    await ensureColumn('orders', 'payment_platform', 'VARCHAR(100) NULL');
    await ensureColumn('order_payment_proofs', 'admin_id', 'VARCHAR(50) NULL AFTER order_id');
    await ensureColumn('order_payment_proofs', 'amount_due', 'DECIMAL(12, 2) NOT NULL DEFAULT 0.00 AFTER admin_id');
    await ensureColumn('order_payment_proofs', 'created_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
    await ensureColumn('order_payment_proofs', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    await ensureIndex('order_payment_proofs', 'uk_payment_proof_order_admin', '(order_id, admin_id)', true);
    await ensureIndex('order_payment_proofs', 'idx_payment_proof_admin', '(admin_id)');
    await ensureCascadeFk('order_payment_proof_history', 'fk_payment_proof_history_order', 'FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE');
    await ensureCascadeFk('order_payment_proof_history', 'fk_payment_proof_history_proof', 'FOREIGN KEY (`payment_proof_id`) REFERENCES `order_payment_proofs` (`id`) ON DELETE CASCADE');
    await ensureCascadeFk('order_payment_proofs', 'fk_payment_proof_order', 'FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE');
    await ensureCascadeFk('order_payment_status_history', 'fk_order_payment_status_history_order', 'FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE');

    const [proofStatusColumn] = await connection.query(
      'SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['order_payment_proofs', 'status']
    );
    if (proofStatusColumn.length && !proofStatusColumn[0].COLUMN_TYPE.includes("'awaiting_proof'")) {
      await connection.query(
        "ALTER TABLE order_payment_proofs MODIFY COLUMN status ENUM('awaiting_proof', 'verification_pending', 'verified', 'rejected', 'expired') NOT NULL DEFAULT 'awaiting_proof'"
      );
    }
    await connection.query(
      "ALTER TABLE order_payment_proofs MODIFY COLUMN image_storage_path VARCHAR(500) NULL, MODIFY COLUMN account_holder_name VARCHAR(150) NULL, MODIFY COLUMN payment_platform VARCHAR(100) NULL, MODIFY COLUMN transaction_reference VARCHAR(150) NULL, MODIFY COLUMN amount DECIMAL(12, 2) NULL, MODIFY COLUMN submitted_at TIMESTAMP NULL DEFAULT NULL"
    );
    await ensureColumn('store_settings', 'enable_easypaisa', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await ensureColumn('store_settings', 'enable_jazzcash', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await ensureColumn('store_settings', 'enable_bank_transfer', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await ensureColumn('orders', 'payment_review_from_status', 'VARCHAR(30) NULL');
    await ensureColumn('payment_transactions', 'updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
    await ensureColumn('refund_requests', 'payment_transaction_id', 'VARCHAR(50) NULL AFTER requested_by');
    await ensureColumn('refund_requests', 'reason', 'TEXT NULL AFTER amount');
    await ensureColumn('refund_requests', 'refund_method', 'VARCHAR(100) NULL');
    await ensureColumn('refund_requests', 'refund_date', 'DATETIME NULL');
    await ensureColumn('refund_requests', 'admin_notes', 'TEXT NULL');
    await ensureColumn('refund_requests', 'proof_url', 'VARCHAR(500) NULL');
    await ensureIndex('refund_requests', 'idx_refund_transaction', '(payment_transaction_id)');
    await ensureIndex(
      'order_payment_proofs',
      'uq_payment_proof_platform_reference',
      '(payment_platform, transaction_reference)',
      true
    );
    await ensureColumn('notifications', 'link_url', 'VARCHAR(500) NULL AFTER order_id');
    await ensureColumn('orders', 'payment_review', 'BOOLEAN NOT NULL DEFAULT FALSE');
    await ensureColumn('orders', 'payment_review_from_status', 'VARCHAR(30) NULL');
    await ensureIndex('orders', 'idx_order_payment_review', '(payment_review)');
    await ensureIndex('orders', 'idx_order_payment_expiry', '(payment_status, expires_at)');
    await ensureIndex('orders', 'idx_order_customer_visibility', '(customer_id, customer_hidden_at, order_status)');

    const [orderStatusColumn] = await connection.query(
      'SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['orders', 'order_status']
    );
    if (orderStatusColumn.length && orderStatusColumn[0].COLUMN_TYPE.includes("'payment_review'")) {
      await connection.query(`
        UPDATE orders
        SET payment_review = TRUE,
            order_status = COALESCE(NULLIF(payment_review_from_status, ''), 'placed'),
            payment_review_from_status = NULL
        WHERE order_status = 'payment_review'
      `);
      await connection.query(
        "ALTER TABLE orders MODIFY COLUMN order_status ENUM('placed', 'confirmed', 'processing', 'courier_assigned', 'shipped', 'delivered', 'cancelled', 'returned', 'expired') NOT NULL DEFAULT 'placed'"
      );
    }
    if (orderStatusColumn.length && !orderStatusColumn[0].COLUMN_TYPE.includes("'expired'")) {
      await connection.query(
        "ALTER TABLE orders MODIFY COLUMN order_status ENUM('placed', 'confirmed', 'processing', 'courier_assigned', 'shipped', 'delivered', 'cancelled', 'returned', 'expired') NOT NULL DEFAULT 'placed'"
      );
    }

    const [orderPaymentMethodColumn] = await connection.query(
      'SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['orders', 'payment_method']
    );
    if (orderPaymentMethodColumn.length && !orderPaymentMethodColumn[0].COLUMN_TYPE.includes("'payfast'")) {
      await connection.query(
        "ALTER TABLE orders MODIFY COLUMN payment_method ENUM('cod', 'card', 'bank_transfer', 'easypaisa', 'jazzcash', 'payfast') NOT NULL"
      );
    }

    const [orderPaymentStatusColumn] = await connection.query(
      'SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['orders', 'payment_status']
    );
    const advanceStatuses = ['awaiting_proof', 'proof_submitted', 'verification_pending', 'rejected', 'verified', 'expired'];
    if (orderPaymentStatusColumn.length &&
        (!orderPaymentStatusColumn[0].COLUMN_TYPE.includes("'reversed'") ||
         !orderPaymentStatusColumn[0].COLUMN_TYPE.includes("'disputed'") ||
         advanceStatuses.some(status => !orderPaymentStatusColumn[0].COLUMN_TYPE.includes(`'${status}'`)))) {
      await connection.query(
        "ALTER TABLE orders MODIFY COLUMN payment_status ENUM('pending', 'partially_paid', 'paid', 'failed', 'refunded', 'reversed', 'disputed', 'awaiting_proof', 'proof_submitted', 'verification_pending', 'rejected', 'verified', 'expired') NOT NULL DEFAULT 'pending'"
      );
    }

    const [transactionStatusColumn] = await connection.query(
      'SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['payment_transactions', 'status']
    );
    if (transactionStatusColumn.length &&
        (!transactionStatusColumn[0].COLUMN_TYPE.includes("'reversed'") ||
         !transactionStatusColumn[0].COLUMN_TYPE.includes("'disputed'"))) {
      await connection.query(
        "ALTER TABLE payment_transactions MODIFY COLUMN status ENUM('pending', 'completed', 'failed', 'refunded', 'reversed', 'disputed') NOT NULL DEFAULT 'pending'"
      );
    }

    await connection.query(
      "ALTER TABLE refund_requests MODIFY COLUMN provider ENUM('bank_transfer', 'easypaisa', 'jazzcash', 'payfast', 'other') NULL"
    );
    await connection.query(
      "ALTER TABLE refund_requests MODIFY COLUMN status ENUM('requested', 'under_review', 'approved', 'rejected', 'processing', 'completed', 'failed', 'cancelled', 'manually_refunded', 'gateway_refunded') NOT NULL DEFAULT 'requested'"
    );

    const adCompatibilityColumns = [
      ['target_type', "VARCHAR(50) NULL DEFAULT 'category'"],
      ['target_product_id', 'VARCHAR(50) NULL'],
      ['target_category', 'VARCHAR(100) NULL'],
      ['target_brand', 'VARCHAR(100) NULL'],
      ['target_sub_category', 'VARCHAR(100) NULL'],
      ['custom_url', 'VARCHAR(500) NULL'],
      ['city_targets', 'JSON NULL'],
      ['device_target', "ENUM('all', 'desktop', 'mobile') NOT NULL DEFAULT 'all'"],
      ['placements', 'JSON NULL']
    ];
    for (const [columnName, definition] of adCompatibilityColumns) {
      const [columns] = await connection.query(
        'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        ['store_ads', columnName]
      );
      if (columns.length === 0) {
        await connection.query(`ALTER TABLE store_ads ADD COLUMN ${columnName} ${definition}`);
        logger.info(`Added store_ads.${columnName} for existing installations.`);
      }
    }

    await connection.query(`
      ALTER TABLE seo_image_alts
      MODIFY COLUMN entity_type ENUM('product', 'category', 'sub_category', 'brand', 'page', 'banner') NOT NULL
    `);
    // Single-admin installations: claim ownerless seed products so their orders
    // appear in the admin panel (order queries are scoped by product ownership).
    const [adminRows] = await connection.query("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 2");
    if (adminRows.length === 1) {
      await connection.query('UPDATE products SET admin_id = ? WHERE admin_id IS NULL', [adminRows[0].id]);
    }

    await connection.query(`
      UPDATE products p
      INNER JOIN users u ON u.id = COALESCE(p.admin_id, p.owner_id)
      SET p.owner_id = COALESCE(p.admin_id, p.owner_id),
          p.owner_name = COALESCE(NULLIF(p.owner_name, ''), u.full_name, u.name),
          p.owner_phone = COALESCE(NULLIF(p.owner_phone, ''), u.primary_phone, u.phone),
          p.owner_whatsapp = COALESCE(NULLIF(p.owner_whatsapp, ''), u.whatsapp_number, u.whatsapp_phone, u.primary_phone, u.phone)
      WHERE COALESCE(p.admin_id, p.owner_id) IS NOT NULL
    `);
    await connection.query(`
      UPDATE order_items oi
      INNER JOIN products p ON p.id = oi.product_id
      SET oi.admin_id = COALESCE(p.admin_id, p.owner_id)
      WHERE oi.admin_id IS NULL AND COALESCE(p.admin_id, p.owner_id) IS NOT NULL
    `);
    await connection.query(`
      UPDATE order_items oi
      LEFT JOIN product_variants v ON v.id = oi.variant_id
      LEFT JOIN products p ON p.id = oi.product_id
      SET oi.cost_price = COALESCE(v.cost_price, p.cost_price, oi.price * 0.65)
      WHERE oi.cost_price IS NULL
    `);
    await connection.query(`
      UPDATE orders o
      LEFT JOIN (
        SELECT order_id, MIN(created_at) AS delivered_at
        FROM order_status_history
        WHERE new_status = 'delivered'
        GROUP BY order_id
      ) history ON history.order_id = o.id
      SET o.delivered_at = COALESCE(history.delivered_at, o.updated_at, o.created_at)
      WHERE o.order_status = 'delivered' AND o.delivered_at IS NULL
    `);

    const [signupMethodColumn] = await connection.query(
      'SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
      ['users', 'signup_method']
    );
    if (signupMethodColumn.length > 0 && !signupMethodColumn[0].COLUMN_TYPE.includes("'unknown'")) {
      await connection.query(
        "ALTER TABLE users MODIFY COLUMN signup_method ENUM('website', 'google', 'facebook', 'unknown') NOT NULL DEFAULT 'unknown'"
      );
      await connection.query("UPDATE users SET signup_method = 'unknown' WHERE signup_method = 'website'");
    }

    // Global SKU infrastructure is additive and idempotent: the tables come from
    // schema.sql, and the registry is seeded from existing SKUs without renaming any.
    await ensureSkuTables();
    await PaymentPolicyService.ensureSchema();
    await ProductImageService.ensureSchema(connection);
    const checksumBackfillCount = await ProductImageService.backfillChecksums(5000);
    if (checksumBackfillCount > 0) {
      logger.info(`✓ Backfilled ${checksumBackfillCount} product image checksum(s).`);
    }
    const registryCount = await syncSkuRegistry(connection);
    logger.info(`✓ SKU registry synchronized (${registryCount} SKU(s) registered).`);

    logger.info(`✓ Master schema successfully verified and executed (${executedCount} statement(s)).`);
    return { success: true, applied: ['schema.sql'], executedStatements: executedCount };
  } catch (err) {
    logger.error('Fatal database schema initialization error:', err);
    throw err;
  } finally {
    connection.release();
  }
}

// Auto-run if executed directly via CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(res => {
      logger.info('Schema execution completed successfully.');
      process.exit(res.success ? 0 : 1);
    })
    .catch(err => {
      logger.error('Fatal schema execution error:', err);
      process.exit(1);
    });
}
