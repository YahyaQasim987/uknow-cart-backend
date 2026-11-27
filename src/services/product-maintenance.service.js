import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { uploadsRoot } from '../middlewares/upload.middleware.js';
import { resolveUploadedFilePath } from '../utils/product-media.js';

const RETENTION_DAYS = Math.max(1, parseInt(process.env.PRODUCT_EXPIRY_RETENTION_DAYS || '7', 10));
const ORPHAN_MIN_AGE_HOURS = Math.max(1, parseInt(process.env.UPLOAD_ORPHAN_MIN_AGE_HOURS || '24', 10));

/**
 * Expiry no longer destroys catalog history. After the retention window the
 * product is archived (hidden from the storefront and the active admin list)
 * and can still be restored or permanently purged with explicit confirmation.
 */
export class ProductMaintenanceService {
  static async archiveExpiredProducts() {
    const [result] = await pool.query(
      `UPDATE products
       SET archived_at = NOW(),
           archive_reason = 'Expired and retention window elapsed',
           show_on_home = FALSE,
           show_in_carousel = FALSE,
           show_on_banner = FALSE,
           featured = FALSE
       WHERE expires_at IS NOT NULL
         AND expires_at <= DATE_SUB(NOW(), INTERVAL ? DAY)
         AND archived_at IS NULL`,
      [RETENTION_DAYS]
    );
    const archived = Number(result.affectedRows) || 0;
    if (archived > 0) {
      logger.info(`Archived ${archived} expired product(s) older than ${RETENTION_DAYS} day(s).`);
    }
    return archived;
  }

  /**
   * Deletes only old files under uploads/products that no database row points
   * at. The age guard protects a file that was just uploaded but whose product
   * save request has not committed yet.
   */
  static async sweepOrphanUploads() {
    const productsRoot = path.resolve(uploadsRoot, 'products');
    try {
      await fs.access(productsRoot);
    } catch {
      return { scanned: 0, deleted: 0 };
    }

    const referenced = await ProductMaintenanceService.collectReferencedUploadPaths();
    const cutoff = Date.now() - (ORPHAN_MIN_AGE_HOURS * 60 * 60 * 1000);
    let scanned = 0;
    let deleted = 0;

    const walk = async directory => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        scanned += 1;
        const resolved = path.resolve(fullPath);
        if (referenced.has(resolved)) continue;
        const stats = await fs.stat(resolved);
        if (stats.mtimeMs > cutoff) continue;
        await fs.unlink(resolved).catch(error => {
          if (error.code !== 'ENOENT') throw error;
        });
        deleted += 1;
      }
    };

    try {
      await walk(productsRoot);
    } catch (error) {
      logger.warn('Orphan upload sweep could not complete.', { message: error.message });
    }

    if (deleted > 0) {
      logger.info(`Removed ${deleted} orphan product upload(s) out of ${scanned} scanned file(s).`);
    }
    return { scanned, deleted };
  }

  static async collectReferencedUploadPaths() {
    const [
      [products], [gallery], [variants], [orderItems],
      [heroBanners], [promoCards], [categories], [subCategories], [brands],
      [storeAds], [broadcasts]
    ] = await Promise.all([
      pool.query(`
        SELECT banner_image, banner_desktop_image, banner_tablet_image,
               banner_mobile_image, hover_image, video_url, hover_video_url
        FROM products
      `),
      pool.query('SELECT image_url FROM product_images'),
      pool.query('SELECT image_url, images FROM product_variants'),
      pool.query('SELECT image_url FROM order_items WHERE image_url IS NOT NULL'),
      pool.query('SELECT image, desktop_image, tablet_image, mobile_image, mobile_image_url FROM hero_banners'),
      pool.query('SELECT image, mobile_image_url FROM promo_cards'),
      pool.query('SELECT image_url FROM categories'),
      pool.query('SELECT image_url FROM sub_categories'),
      pool.query('SELECT image_url FROM brands'),
      pool.query('SELECT image_url, mobile_image_url FROM store_ads'),
      pool.query('SELECT image_url FROM broadcast_messages')
    ]);

    const urls = new Set();
    const add = url => {
      if (typeof url === 'string' && url.trim()) urls.add(url.trim());
    };

    for (const row of products) {
      add(row.banner_image);
      add(row.banner_desktop_image);
      add(row.banner_tablet_image);
      add(row.banner_mobile_image);
      add(row.hover_image);
      add(row.video_url);
      add(row.hover_video_url);
    }
    for (const row of gallery) add(row.image_url);
    for (const row of orderItems) add(row.image_url);
    for (const row of heroBanners) {
      add(row.image);
      add(row.desktop_image);
      add(row.tablet_image);
      add(row.mobile_image);
      add(row.mobile_image_url);
    }
    for (const row of promoCards) {
      add(row.image);
      add(row.mobile_image_url);
    }
    for (const row of categories) add(row.image_url);
    for (const row of subCategories) add(row.image_url);
    for (const row of brands) add(row.image_url);
    for (const row of storeAds) {
      add(row.image_url);
      add(row.mobile_image_url);
    }
    for (const row of broadcasts) add(row.image_url);
    for (const row of variants) {
      add(row.image_url);
      try {
        const images = typeof row.images === 'string' ? JSON.parse(row.images) : row.images;
        if (Array.isArray(images)) images.forEach(add);
      } catch {
        // Invalid legacy JSON is ignored; its files remain protected by age and
        // are not deleted by this sweep.
      }
    }

    const paths = new Set();
    for (const url of urls) {
      const filePath = resolveUploadedFilePath(url);
      if (filePath) paths.add(path.resolve(filePath));
    }
    return paths;
  }
}
