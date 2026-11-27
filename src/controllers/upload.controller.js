import fs from 'node:fs/promises';
import { logger } from '../utils/logger.js';
import { pool } from '../config/db.js';
import { config } from '../config/env.js';
import { getUploadStorageSegment } from '../middlewares/upload.middleware.js';
import { ProductImageService } from '../services/product-image.service.js';
import { removeUploadedFilesIfUnreferenced } from '../utils/product-media.js';

const signatures = {
  'image/jpeg': buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/png': buffer => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/gif': buffer => buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/) !== null,
  'image/webp': buffer => buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
};

const bannerColumns = {
  image: 'image',
  desktop: 'desktop_image',
  tablet: 'tablet_image',
  mobile: 'mobile_image'
};
const productBannerColumns = {
  desktop: 'banner_desktop_image',
  tablet: 'banner_tablet_image',
  mobile: 'banner_mobile_image'
};

export class UploadController {
  static async saveVariantImage(req, res, next) {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Select an image file to upload.' });
    }

    const { productId, variantId } = req.params;
    const productSegment = getUploadStorageSegment('products', productId);
    const variantSegment = `variant-${variantId.replace(/^var-/, '')}`;
    const url = `${config.apiPublicUrl}/uploads/products/${encodeURIComponent(productSegment)}/${encodeURIComponent(variantSegment)}/${encodeURIComponent(req.file.filename)}`;

    try {
      const fileHandle = await fs.open(req.file.path, 'r');
      let header;
      try {
        header = Buffer.alloc(12);
        await fileHandle.read(header, 0, header.length, 0);
      } finally {
        await fileHandle.close();
      }
      if (!signatures[req.file.mimetype]?.(header)) {
        const error = new Error('The uploaded file content is not a valid supported image.');
        error.statusCode = 400;
        error.isOperational = true;
        throw error;
      }

      const [rows] = await pool.query(`
        SELECT v.images, v.image_url, p.admin_id, p.owner_id
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        WHERE v.id = ? AND v.product_id = ?
      `, [variantId, productId]);
      if (rows.length === 0) throw UploadController.notFound('Product variant', variantId);
      const ownerId = rows[0].admin_id || rows[0].owner_id;
      if (ownerId && ownerId !== req.user?.id) {
        const error = new Error('You do not own the product containing this variant.');
        error.statusCode = 403;
        error.isOperational = true;
        throw error;
      }

      let images = [];
      try {
        images = typeof rows[0].images === 'string' ? JSON.parse(rows[0].images) : (rows[0].images || []);
      } catch (error) {
        logger.warn(`Invalid image list stored for product variant ${variantId}; replacing it with the new uploaded image.`);
      }
      const isFirstImage = images.length === 0;
      images.push(url);
      await pool.query(
        'UPDATE product_variants SET images = ?, image_url = IF(?, ?, image_url) WHERE id = ?',
        [JSON.stringify(images), isFirstImage, url, variantId]
      );

      return res.status(201).json({
        success: true,
        message: 'Variant image uploaded and linked to the database record.',
        url,
        productId,
        variantId
      });
    } catch (error) {
      try {
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') return next(cleanupError);
      }
      if (error.statusCode === 404) logger.warn(`Discarded uploaded image for missing product variant ${variantId}.`);
      next(error);
    }
  }

  static async saveImage(req, res, next) {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Select an image file to upload.' });
    }

    const { entity, id, variant } = req.params;
    const storageEntity = entity === 'promo-cards' ? 'banners' : entity;
    const storageSegment = entity === 'promo-cards'
      ? `promo-${id}`
      : getUploadStorageSegment(entity, id);
    const url = `${config.apiPublicUrl}/uploads/${storageEntity}/${encodeURIComponent(storageSegment)}/${encodeURIComponent(req.file.filename)}`;

    try {
      const fileHandle = await fs.open(req.file.path, 'r');
      let header;
      try {
        header = Buffer.alloc(12);
        await fileHandle.read(header, 0, header.length, 0);
      } finally {
        await fileHandle.close();
      }
      if (!signatures[req.file.mimetype]?.(header)) {
        const error = new Error('The uploaded file content is not a valid supported image.');
        error.statusCode = 400;
        error.isOperational = true;
        throw error;
      }

      if (entity === 'products') {
        const [productRows] = await pool.query(
          `SELECT admin_id, owner_id, archived_at,
                  banner_image, banner_desktop_image, banner_tablet_image, banner_mobile_image
           FROM products WHERE id = ?`,
          [id]
        );
        if (productRows.length === 0) throw UploadController.notFound('Product', id);
        const productOwner = productRows[0].admin_id || productRows[0].owner_id;
        if (productOwner && productOwner !== req.user?.id) {
          const error = new Error('You do not own this product.');
          error.statusCode = 403;
          error.isOperational = true;
          throw error;
        }
        if (productRows[0].archived_at) {
          const error = new Error('Restore this archived product before uploading new media.');
          error.statusCode = 409;
          error.isOperational = true;
          throw error;
        }

        if (variant === 'image') {
          // Hash the actual bytes after compression. A retry/double-submit gets a
          // fresh random filename, so URL equality alone cannot catch it.
          const checksum = await ProductImageService.checksumFile(req.file.path);
          const duplicate = await ProductImageService.findDuplicate(id, checksum);
          if (duplicate) {
            await fs.unlink(req.file.path).catch(() => {});
            return res.status(200).json({
              success: true,
              duplicate: true,
              message: 'This image already exists in the product gallery; the existing copy was kept.',
              url: duplicate.image_url,
              entity,
              entityId: id,
              variant
            });
          }

          const [rows] = await pool.query('SELECT COUNT(*) AS count FROM product_images WHERE product_id = ?', [id]);
          try {
            await pool.query(
              'INSERT INTO product_images (product_id, image_url, image_checksum, display_order) VALUES (?, ?, ?, ?)',
              [id, url, checksum, Number(rows[0].count)]
            );
          } catch (insertError) {
            // Two simultaneous retries can both pass the SELECT above. The
            // unique index lets one insert win; the loser reuses that row.
            if (insertError.code !== 'ER_DUP_ENTRY') throw insertError;
            const existing = await ProductImageService.findDuplicate(id, checksum);
            if (!existing) throw insertError;
            await fs.unlink(req.file.path).catch(() => {});
            return res.status(200).json({
              success: true,
              duplicate: true,
              message: 'This image already exists in the product gallery; the existing copy was kept.',
              url: existing.image_url,
              entity,
              entityId: id,
              variant
            });
          }
        } else {
          const column = productBannerColumns[variant];
          if (!column) {
            const error = new Error('Unsupported product banner variant.');
            error.statusCode = 400;
            error.isOperational = true;
            throw error;
          }
          const previousBannerUrls = variant === 'desktop'
            ? [productRows[0].banner_desktop_image, productRows[0].banner_image]
            : [productRows[0][column]];
          const bannerImageUpdate = variant === 'desktop' ? ', banner_image = ?' : '';
          const values = variant === 'desktop' ? [url, url, id] : [url, id];
          await pool.query(
            `UPDATE products SET ${column} = ?${bannerImageUpdate} WHERE id = ?`,
            values
          );
          await removeUploadedFilesIfUnreferenced(previousBannerUrls).catch(cleanupError => {
            logger.warn('Banner saved, but the replaced file could not be cleaned up.', {
              productId: id,
              message: cleanupError.message
            });
          });
        }
      } else if (entity === 'categories') {
        const [result] = await pool.query('UPDATE categories SET image_url = ? WHERE id = ?', [url, id]);
        if (result.affectedRows === 0) throw UploadController.notFound('Category', id);
      } else if (entity === 'subcategories') {
        const [result] = await pool.query('UPDATE sub_categories SET image_url = ? WHERE id = ?', [url, id]);
        if (result.affectedRows === 0) throw UploadController.notFound('Subcategory', id);
      } else if (entity === 'brands') {
        const [result] = await pool.query('UPDATE brands SET image_url = ? WHERE id = ?', [url, id]);
        if (result.affectedRows === 0) throw UploadController.notFound('Brand', id);
      } else if (entity === 'refunds') {
        const [refunds] = await pool.query(
          `SELECT r.id
           FROM refund_requests r
           WHERE r.id = ? AND EXISTS (
             SELECT 1
             FROM order_items oi
             LEFT JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = r.order_id
               AND COALESCE(oi.admin_id, p.owner_id, p.admin_id) = ?
           )`,
          [id, req.user?.id]
        );
        if (!refunds.length) throw UploadController.notFound('Refund workflow', id);
        await pool.query('UPDATE refund_requests SET proof_url = ? WHERE id = ?', [url, id]);
        const [refundRows] = await pool.query('SELECT status FROM refund_requests WHERE id = ?', [id]);
        await pool.query(
          `INSERT INTO refund_status_history (refund_request_id, previous_status, new_status, actor_id, details)
           VALUES (?, ?, ?, ?, JSON_OBJECT('proofUrl', ?))`,
          [id, refundRows[0].status, refundRows[0].status, req.user.id, url]
        );
      } else if (entity === 'banners') {
        const column = bannerColumns[variant];
        const [result] = variant === 'desktop'
          ? await pool.query('UPDATE hero_banners SET desktop_image = ?, image = ? WHERE id = ?', [url, url, id])
          : await pool.query(`UPDATE hero_banners SET ${column} = ? WHERE id = ?`, [url, id]);
        if (result.affectedRows === 0) throw UploadController.notFound('Banner', id);
      } else if (entity === 'promo-cards') {
        const column = variant === 'mobile' ? 'mobile_image_url' : 'image';
        const [result] = await pool.query(`UPDATE promo_cards SET ${column} = ? WHERE id = ?`, [url, id]);
        if (result.affectedRows === 0) throw UploadController.notFound('Promo card', id);
      }

      return res.status(201).json({
        success: true,
        message: 'Image uploaded and linked to the database record.',
        url,
        entity,
        entityId: id,
        variant
      });
    } catch (error) {
      try {
        await fs.unlink(req.file.path);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') return next(cleanupError);
      }
      if (error.statusCode === 404) logger.warn(`Discarded uploaded image for missing ${entity} record ${id}.`);
      next(error);
    }
  }

  static notFound(type, id) {
    const error = new Error(`${type} "${id}" was not found.`);
    error.statusCode = 404;
    error.isOperational = true;
    return error;
  }
}
