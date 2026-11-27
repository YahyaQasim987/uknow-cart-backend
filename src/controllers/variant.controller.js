import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import {
  ensureSkuTables,
  generateVariantSku,
  isMissingSku,
  isValidSku,
  normalizeSku,
  releaseSku,
  reserveSku,
  skuError,
  SKU_MAX_LENGTH
} from '../services/sku.service.js';

const createVariantId = () => `var-${crypto.randomUUID()}`;
const toJson = value => JSON.stringify(Array.isArray(value) ? value : []);
const nullableNumber = value => value === '' || value === null || value === undefined ? null : Number(value);
const nullableInteger = value => value === '' || value === null || value === undefined ? null : parseInt(value, 10);
const isInlineMedia = value => typeof value === 'string' && /^(blob|data):/i.test(value);

function hasInlineMedia(body) {
  return isInlineMedia(body.image) || isInlineMedia(body.imageUrl) || isInlineMedia(body.videoUrl) ||
    (Array.isArray(body.images) && body.images.some(isInlineMedia));
}

function validateSku(rawSku) {
  const normalized = normalizeSku(rawSku);
  if (!normalized) {
    throw skuError('SKU cannot be empty. Generate one or provide a valid SKU.');
  }
  if (!isValidSku(normalized)) {
    throw skuError(`SKU "${rawSku}" is invalid. Use A-Z, 0-9 and hyphens only (maximum ${SKU_MAX_LENGTH} characters).`);
  }
  return normalized;
}

export class VariantController {
  static async assertProductOwnership(req, res, productId) {
    const [rows] = await pool.query('SELECT admin_id, owner_id FROM products WHERE id = ?', [productId]);
    if (rows.length === 0) {
      res.status(404).json({ success: false, message: `Product "${productId}" not found.` });
      return false;
    }

    const ownerId = rows[0].admin_id || rows[0].owner_id;
    if (ownerId && ownerId !== req.user?.id) {
      res.status(403).json({ success: false, message: 'You do not own this product.' });
      return false;
    }
    return true;
  }

  static async assertVariantOwnership(req, res, variantId) {
    const [rows] = await pool.query(`
      SELECT p.id AS product_id, p.admin_id, p.owner_id
      FROM product_variants v
      JOIN products p ON p.id = v.product_id
      WHERE v.id = ?
    `, [variantId]);
    if (rows.length === 0) {
      res.status(404).json({ success: false, message: `Variant "${variantId}" not found.` });
      return null;
    }

    const ownerId = rows[0].admin_id || rows[0].owner_id;
    if (ownerId && ownerId !== req.user?.id) {
      res.status(403).json({ success: false, message: 'You do not own the product containing this variant.' });
      return null;
    }
    return rows[0];
  }

  static async create(req, res, next) {
    let connection = null;
    try {
      const { productId } = req.params;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const requestedSku = typeof body.sku === 'string' ? body.sku.trim() : '';
      const price = Number(body.price);
      const stock = body.stock === undefined ? 0 : Number(body.stock);
      if (hasInlineMedia(body)) {
        return res.status(400).json({ success: false, message: 'Variant media must be uploaded as files; inline preview data cannot be saved.' });
      }
      if (!name || body.price === undefined || !Number.isFinite(price) || price < 0 ||
          !Number.isInteger(stock) || stock < 0) {
        return res.status(400).json({ success: false, message: 'Variant name, price, and non-negative stock are required.' });
      }
      if (!(await VariantController.assertProductOwnership(req, res, productId))) return;

      // DDL must run outside the transaction (MySQL implicitly commits on DDL).
      await ensureSkuTables();

      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Lock the parent row so concurrent variant creations for the same parent
      // serialize and cannot derive the same fallback variant code.
      const [parentRows] = await connection.query('SELECT sku FROM products WHERE id = ? FOR UPDATE', [productId]);
      if (parentRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: `Product "${productId}" not found.` });
      }

      const id = typeof body.id === 'string' && /^[a-zA-Z0-9_-]{1,50}$/.test(body.id)
        ? body.id
        : createVariantId();

      const sku = isMissingSku(requestedSku)
        ? await generateVariantSku(connection, {
            parentSku: parentRows[0].sku,
            variantCode: body.variantCode,
            color: body.color,
            size: body.size,
            variantName: name,
            variantType: body.variantType
          })
        : validateSku(requestedSku);

      // Claims the SKU in the global registry (products + variants share it).
      await reserveSku(connection, { sku, entityType: 'variant', entityId: id });

      const originalPrice = nullableNumber(body.originalPrice) ?? price;
      const columns = [
        'id', 'product_id', 'name', 'subtitle', 'sku', 'barcode', 'variant_type', 'variant_code',
        'is_active', 'is_full_variant', 'price', 'cost_price', 'original_price', 'discount_type',
        'discount_value', 'stock', 'color', 'size', 'image_url', 'video_url', 'description',
        'images', 'brand', 'sub_category', 'luxury_tier', 'delivery_days', 'delivery_timeline_note',
        'advance_payment_required', 'advance_payment_type', 'advance_payment_amount',
        'advance_payment_percent', 'advance_payment_value', 'city_restriction_mode',
        'allowed_cities', 'standalone_in_catalog', 'badge', 'expires_at'
      ];
      const values = [
        id, productId, name, body.subtitle || null, sku, body.barcode || null,
        body.variantType || 'Option', body.variantCode || null, body.isActive !== false,
        !!body.isFullVariant, price, nullableNumber(body.costPrice), originalPrice,
        body.discountType || 'percentage', Number(body.discountValue) || 0, stock,
        body.color || null, body.size || null, body.image || body.imageUrl || null,
        body.videoUrl || null, body.description || null, toJson(body.images),
        body.brand || null, body.subCategory || null, body.luxuryTier || 'Luxury',
        nullableInteger(body.deliveryDays) ?? 3, body.deliveryTimelineNote || null,
        body.advancePaymentRequired === undefined ? null : !!body.advancePaymentRequired,
        body.advancePaymentType || 'percentage', nullableNumber(body.advancePaymentAmount),
        nullableInteger(body.advancePaymentPercent), nullableNumber(body.advancePaymentValue),
        body.cityRestrictionMode || 'all', toJson(body.allowedCities),
        body.standaloneInCatalog !== false, body.badge || null,
        body.expiresAt ? new Date(body.expiresAt) : null
      ];

      await connection.query(
        `INSERT INTO product_variants (${columns.join(', ')}) VALUES (${values.map(() => '?').join(', ')})`,
        values
      );
      await connection.commit();
      return res.status(201).json({
        success: true,
        message: 'Product variant created successfully.',
        variantId: id,
        productId,
        sku
      });
    } catch (err) {
      if (connection) {
        try { await connection.rollback(); } catch (rollbackError) { /* already rolled back */ }
      }
      next(err);
    } finally {
      if (connection) connection.release();
    }
  }

  static async update(req, res, next) {
    let connection = null;
    try {
      const { id } = req.params;
      const variant = await VariantController.assertVariantOwnership(req, res, id);
      if (!variant) return;

      const updates = req.body && typeof req.body === 'object' ? { ...req.body } : {};
      if (hasInlineMedia(updates)) {
        return res.status(400).json({ success: false, message: 'Variant media must be uploaded as files; inline preview data cannot be saved.' });
      }

      // Never regenerate silently: a SKU is only changed when it is explicitly sent.
      const requestedSku = updates.sku !== undefined ? validateSku(updates.sku) : null;
      delete updates.sku;

      const mapping = {
        name: ['name', value => value],
        subtitle: ['subtitle', value => value || null],
        barcode: ['barcode', value => value || null],
        variantType: ['variant_type', value => value || 'Option'],
        variantCode: ['variant_code', value => value || null],
        isActive: ['is_active', Boolean],
        isFullVariant: ['is_full_variant', Boolean],
        price: ['price', Number],
        originalPrice: ['original_price', nullableNumber],
        costPrice: ['cost_price', nullableNumber],
        discountType: ['discount_type', value => value || null],
        discountValue: ['discount_value', Number],
        stock: ['stock', value => parseInt(value, 10)],
        color: ['color', value => value || null],
        size: ['size', value => value || null],
        image: ['image_url', value => value || null],
        imageUrl: ['image_url', value => value || null],
        images: ['images', toJson],
        videoUrl: ['video_url', value => value || null],
        description: ['description', value => value || null],
        brand: ['brand', value => value || null],
        subCategory: ['sub_category', value => value || null],
        luxuryTier: ['luxury_tier', value => value || null],
        deliveryDays: ['delivery_days', nullableInteger],
        deliveryTimelineNote: ['delivery_timeline_note', value => value || null],
        advancePaymentRequired: ['advance_payment_required', value => value === null ? null : Boolean(value)],
        advancePaymentType: ['advance_payment_type', value => value || null],
        advancePaymentAmount: ['advance_payment_amount', nullableNumber],
        advancePaymentPercent: ['advance_payment_percent', nullableInteger],
        advancePaymentValue: ['advance_payment_value', nullableNumber],
        cityRestrictionMode: ['city_restriction_mode', value => value || null],
        allowedCities: ['allowed_cities', toJson],
        standaloneInCatalog: ['standalone_in_catalog', Boolean],
        badge: ['badge', value => value || null],
        expiresAt: ['expires_at', value => value ? new Date(value) : null]
      };

      const fields = [];
      const values = [];
      const mappedColumns = new Set();
      for (const [key, value] of Object.entries(updates)) {
        const definition = mapping[key];
        if (!definition || mappedColumns.has(definition[0])) continue;
        fields.push(`${definition[0]} = ?`);
        values.push(definition[1](value));
        mappedColumns.add(definition[0]);
      }
      if (fields.length === 0 && requestedSku === null) {
        return res.status(400).json({ success: false, message: 'No valid variant fields were supplied to update.' });
      }

      if (requestedSku !== null) {
        await ensureSkuTables();
      }

      connection = await pool.getConnection();
      await connection.beginTransaction();

      if (requestedSku !== null) {
        const [currentRows] = await connection.query(
          'SELECT sku FROM product_variants WHERE id = ? FOR UPDATE',
          [id]
        );
        const currentSku = currentRows[0]?.sku || '';
        if (currentSku === requestedSku) {
          // Unchanged: never touch the existing SKU.
        } else if (currentSku && currentSku.toUpperCase() === requestedSku) {
          // Case-only change: the registry key is case-insensitive.
          fields.push('sku = ?');
          values.push(requestedSku);
        } else {
          await reserveSku(connection, { sku: requestedSku, entityType: 'variant', entityId: id });
          await releaseSku(connection, currentSku);
          fields.push('sku = ?');
          values.push(requestedSku);
        }
      }

      if (fields.length > 0) {
        values.push(id);
        await connection.query(`UPDATE product_variants SET ${fields.join(', ')} WHERE id = ?`, values);
      }

      await connection.commit();
      res.json({ success: true, message: 'Variant updated successfully.', productId: variant.product_id });
    } catch (err) {
      if (connection) {
        try { await connection.rollback(); } catch (rollbackError) { /* already rolled back */ }
      }
      next(err);
    } finally {
      if (connection) connection.release();
    }
  }

  static async delete(req, res, next) {
    try {
      const { id } = req.params;
      const variant = await VariantController.assertVariantOwnership(req, res, id);
      if (!variant) return;
      const [rows] = await pool.query('SELECT sku FROM product_variants WHERE id = ?', [id]);
      await pool.query('DELETE FROM product_variants WHERE id = ?', [id]);
      // Free the SKU so it can be claimed again by a new variant.
      if (rows.length > 0) await releaseSku(pool, rows[0].sku);
      res.json({ success: true, message: 'Variant deleted successfully.', productId: variant.product_id });
    } catch (err) {
      next(err);
    }
  }
}
