/**
 * SAFE SKU BACKFILL
 * -----------------------------------------------------------------------------
 * Fills ONLY products/variants whose SKU is NULL or empty. Every record that
 * already has a valid SKU is left untouched (never renamed).
 *
 * Usage:
 *   node scripts/backfill-skus.js            # dry run (default) - changes nothing
 *   node scripts/backfill-skus.js --apply    # writes the generated SKUs
 *
 * It also reports cross-table SKU conflicts (a product SKU that is also used by
 * a variant) so they can be resolved manually - it never merges or renames them.
 */
import { pool, testConnection } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';
import {
  ensureSkuTables,
  generateProductSku,
  generateVariantSku,
  reserveSku,
  syncSkuRegistry
} from '../src/services/sku.service.js';

const APPLY = process.argv.includes('--apply');

async function findMissingProducts(executor) {
  const [rows] = await executor.query(`
    SELECT p.id, p.name, p.category_id, p.brand
    FROM products p
    WHERE p.sku IS NULL OR TRIM(p.sku) = ''
    ORDER BY p.created_at ASC
  `);
  return rows;
}

async function findMissingVariants(executor) {
  const [rows] = await executor.query(`
    SELECT v.id, v.name, v.product_id, v.variant_code, v.color, v.size, v.variant_type, p.sku AS parent_sku
    FROM product_variants v
    JOIN products p ON p.id = v.product_id
    WHERE v.sku IS NULL OR TRIM(v.sku) = ''
    ORDER BY v.created_at ASC
  `);
  return rows;
}

async function findConflicts(executor) {
  const [rows] = await executor.query(`
    SELECT sku, GROUP_CONCAT(CONCAT(entity_type, ':', entity_id) ORDER BY entity_type SEPARATOR ', ') AS owners, COUNT(*) AS total
    FROM (
      SELECT TRIM(sku) AS sku, 'product' AS entity_type, id AS entity_id FROM products WHERE sku IS NOT NULL AND TRIM(sku) <> ''
      UNION ALL
      SELECT TRIM(sku) AS sku, 'variant' AS entity_type, id AS entity_id FROM product_variants WHERE sku IS NOT NULL AND TRIM(sku) <> ''
    ) all_skus
    GROUP BY sku
    HAVING total > 1
  `);
  return rows;
}

async function backfillProduct(row) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const sku = await generateProductSku(connection, {
      category: row.category_id,
      brand: row.brand,
      productName: row.name
    });
    await reserveSku(connection, { sku, entityType: 'product', entityId: row.id });
    await connection.query('UPDATE products SET sku = ? WHERE id = ? AND (sku IS NULL OR TRIM(sku) = \'\')', [sku, row.id]);
    await connection.commit();
    return sku;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function backfillVariant(row) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const sku = await generateVariantSku(connection, {
      parentSku: row.parent_sku,
      variantCode: row.variant_code,
      color: row.color,
      size: row.size,
      variantName: row.name,
      variantType: row.variant_type
    });
    await reserveSku(connection, { sku, entityType: 'variant', entityId: row.id });
    await connection.query('UPDATE product_variants SET sku = ? WHERE id = ? AND (sku IS NULL OR TRIM(sku) = \'\')', [sku, row.id]);
    await connection.commit();
    return sku;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function main() {
  const connected = await testConnection();
  if (!connected) {
    logger.error('Cannot run the SKU backfill: MySQL connection unavailable.');
    process.exitCode = 1;
    return;
  }

  await ensureSkuTables();

  const missingProducts = await findMissingProducts(pool);
  const missingVariants = await findMissingVariants(pool);
  const conflicts = await findConflicts(pool);

  logger.info(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}`);
  logger.info(`Products missing a SKU: ${missingProducts.length}`);
  logger.info(`Variants missing a SKU: ${missingVariants.length}`);
  logger.info(`Cross-table SKU conflicts found: ${conflicts.length}`);

  for (const conflict of conflicts) {
    logger.warn(`SKU conflict "${conflict.sku}" -> ${conflict.owners}. Resolve manually; nothing was renamed.`);
  }

  if (!APPLY) {
    for (const row of missingProducts) {
      logger.info(`[dry-run] product "${row.id}" (${row.name}) would receive a generated SKU.`);
    }
    for (const row of missingVariants) {
      logger.info(`[dry-run] variant "${row.id}" (${row.name}, parent ${row.parent_sku || 'N/A'}) would receive a generated SKU.`);
    }
    logger.info('Dry run complete. Re-run with --apply to write the generated SKUs.');
    return;
  }

  let productsFilled = 0;
  let variantsFilled = 0;

  for (const row of missingProducts) {
    try {
      const sku = await backfillProduct(row);
      productsFilled++;
      logger.info(`product "${row.id}" -> ${sku}`);
    } catch (error) {
      logger.error(`Failed to backfill product "${row.id}": ${error.message}`);
    }
  }

  for (const row of missingVariants) {
    try {
      const sku = await backfillVariant(row);
      variantsFilled++;
      logger.info(`variant "${row.id}" -> ${sku}`);
    } catch (error) {
      logger.error(`Failed to backfill variant "${row.id}": ${error.message}`);
    }
  }

  const registryCount = await syncSkuRegistry(pool);
  logger.info(`Backfill complete: ${productsFilled} product(s), ${variantsFilled} variant(s). Registry now holds ${registryCount} SKU(s).`);
}

main()
  .catch(error => {
    logger.error(`SKU backfill failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
