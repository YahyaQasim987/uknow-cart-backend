import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { pool } from '../config/db.js';
import { resolveUploadedFilePath } from '../utils/product-media.js';

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Gallery images are stored in product_images. A SHA-256 checksum lets the
 * upload endpoint recognise the same image bytes even when a retry or a
 * double-submit produced a different random filename/URL.
 */
export class ProductImageService {
  static async ensureSchema(executor = pool) {
    const [tables] = await executor.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_images'"
    );
    if (tables.length === 0) return false;

    const [columns] = await executor.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_images' AND COLUMN_NAME = 'image_checksum'"
    );
    if (columns.length === 0) {
      await executor.query(
        'ALTER TABLE product_images ADD COLUMN image_checksum CHAR(64) NULL AFTER image_url'
      );
    }

    // One product can never store the same image bytes twice. NULL checksums
    // (legacy rows / remote URLs) are allowed multiple times by MySQL.
    const [indexes] = await executor.query(
      `SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_images'
       GROUP BY INDEX_NAME, NON_UNIQUE`
    );
    const hasUniqueChecksumIndex = indexes.some(index =>
      Number(index.NON_UNIQUE) === 0 && index.columns === 'product_id,image_checksum'
    );
    if (!hasUniqueChecksumIndex) {
      // A previous partial backfill can leave duplicate checksums behind. Fold
      // those legacy rows before adding the unique index, otherwise startup and
      // deployment would fail on the very data this migration is meant to fix.
      await executor.query(`
        DELETE duplicate FROM product_images duplicate
        INNER JOIN product_images keeper
          ON keeper.product_id = duplicate.product_id
         AND keeper.image_checksum = duplicate.image_checksum
         AND keeper.id < duplicate.id
        WHERE duplicate.image_checksum IS NOT NULL
      `);
      await executor.query(
        'ALTER TABLE product_images ADD UNIQUE INDEX uq_prod_img_checksum (product_id, image_checksum)'
      );
    }
    return true;
  }

  static isValidChecksum(value) {
    return typeof value === 'string' && CHECKSUM_PATTERN.test(value);
  }

  static async checksumFile(filePath) {
    const buffer = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /** Hashes a local uploaded image; remote or missing URLs return null. */
  static async checksumForUrl(url) {
    const filePath = resolveUploadedFilePath(url);
    if (!filePath) return null;
    try {
      return await ProductImageService.checksumFile(filePath);
    } catch {
      return null;
    }
  }

  static async findDuplicate(productId, checksum, executor = pool) {
    if (!ProductImageService.isValidChecksum(checksum)) return null;
    const [rows] = await executor.query(
      'SELECT id, image_url FROM product_images WHERE product_id = ? AND image_checksum = ? LIMIT 1',
      [productId, checksum]
    );
    return rows[0] || null;
  }

  /**
   * Backfills hashes for gallery files uploaded before this column existed.
   * Legacy rows that hold the same bytes for one product are folded into the
   * first row so the unique checksum index describes the real data. The
   * unreferenced duplicate file is removed later by the orphan-file sweep.
   *
   * A cursor keeps missing/remote files from being hashed again on every loop.
   */
  static async backfillChecksums(maxRows = 5000) {
    const batchSize = 200;
    const rowLimit = Math.max(1, Number(maxRows) || 5000);
    let lastId = 0;
    let processed = 0;

    while (processed < rowLimit) {
      const [rows] = await pool.query(
        `SELECT id, product_id, image_url
         FROM product_images
         WHERE image_checksum IS NULL AND id > ? AND image_url LIKE '%/uploads/%'
         ORDER BY id ASC
         LIMIT ?`,
        [lastId, Math.min(batchSize, rowLimit - processed)]
      );
      if (rows.length === 0) break;

      for (const row of rows) {
        lastId = row.id;
        processed += 1;
        const checksum = await ProductImageService.checksumForUrl(row.image_url);
        if (!checksum) continue;
        try {
          await pool.query(
            'UPDATE product_images SET image_checksum = ? WHERE id = ? AND image_checksum IS NULL',
            [checksum, row.id]
          );
        } catch (error) {
          if (error.code !== 'ER_DUP_ENTRY') throw error;
          await pool.query(
            'DELETE FROM product_images WHERE id = ? AND image_checksum IS NULL',
            [row.id]
          );
        }
      }
    }
    return processed;
  }
}
