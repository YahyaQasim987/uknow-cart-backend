import { pool } from '../config/db.js';

export class DiscountController {
  // 1. List all discount coupons
  static async listCoupons(req, res, next) {
    try {
      const [rows] = await pool.query('SELECT * FROM coupons ORDER BY created_at DESC');
      return res.json({ success: true, coupons: rows });
    } catch (err) {
      next(err);
    }
  }

  // 2. Create coupon
  static async createCoupon(req, res, next) {
    try {
      const { code, discountPercent, minOrderAmount = 0, maxDiscount = null, expiresAt = null } = req.body;
      const percent = Number(discountPercent);
      const minimum = Number(minOrderAmount);
      const maximum = maxDiscount === null || maxDiscount === '' ? null : Number(maxDiscount);
      if (typeof code !== 'string' || !code.trim() || !Number.isInteger(percent) || percent < 1 || percent > 100) {
        return res.status(400).json({ success: false, message: 'Coupon code and discount percentage are required.' });
      }
      if (!Number.isFinite(minimum) || minimum < 0 || (maximum !== null && (!Number.isFinite(maximum) || maximum < 0))) {
        return res.status(400).json({ success: false, message: 'Coupon amount limits must be non-negative numbers.' });
      }

      const cleanCode = code.trim().toUpperCase();
      const [result] = await pool.query(
        `INSERT INTO coupons (code, discount_percent, min_order_amount, max_discount, expires_at, is_active)
         VALUES (?, ?, ?, ?, ?, TRUE)`,
        [cleanCode, percent, minimum, maximum, expiresAt]
      );
      res.status(201).json({ success: true, message: `Coupon "${cleanCode}" created.`, couponId: result.insertId });
    } catch (err) {
      next(err);
    }
  }

  // 3. Delete coupon
  static async deleteCoupon(req, res, next) {
    try {
      const { id } = req.params;
      const [result] = await pool.query('DELETE FROM coupons WHERE id = ? OR code = ?', [id, id]);
      if (!result.affectedRows) return res.status(404).json({ success: false, message: `Coupon "${id}" was not found.` });
      res.json({ success: true, message: `Coupon "${id}" deleted.` });
    } catch (err) {
      next(err);
    }
  }

  // 4. Apply discount to a single product
  static async applyProductDiscount(req, res, next) {
    try {
      const { productId, discountType = 'percentage', discountValue = 0 } = req.body;
      if (!productId) {
        return res.status(400).json({ success: false, message: 'productId is required.' });
      }

      const val = Number(discountValue);
      if (!Number.isFinite(val) || val < 0) {
        return res.status(400).json({ success: false, message: 'discountValue must be a non-negative number.' });
      }
      const type = discountType === 'fixed' ? 'fixed' : 'percentage';

      const [result] = await pool.query(
        'UPDATE products SET discount_type = ?, discount_value = ? WHERE id = ?',
        [type, val, productId]
      );
      if (!result.affectedRows) return res.status(404).json({ success: false, message: `Product "${productId}" was not found.` });

      res.json({
        success: true,
        message: `Discount of ${val}${type === 'percentage' ? '%' : ' PKR'} applied to product ${productId}.`
      });
    } catch (err) {
      next(err);
    }
  }

  // 5. Apply bulk discount by category or all products
  static async applyBulkDiscount(req, res, next) {
    try {
      const { category = 'all', discountType = 'percentage', discountValue = 0 } = req.body;
      const val = Number(discountValue);
      if (!Number.isFinite(val) || val < 0) {
        return res.status(400).json({ success: false, message: 'discountValue must be a non-negative number.' });
      }
      const type = discountType === 'fixed' ? 'fixed' : 'percentage';

      const [result] = category === 'all'
        ? await pool.query('UPDATE products SET discount_type = ?, discount_value = ?', [type, val])
        : await pool.query(
            'UPDATE products SET discount_type = ?, discount_value = ? WHERE category_id = ?',
            [type, val, category]
          );
      if (!result.affectedRows) return res.status(404).json({ success: false, message: 'No matching products were found.' });

      res.json({
        success: true,
        updatedCount: result.affectedRows,
        message: `Bulk discount applied to ${result.affectedRows} product(s).`
      });
    } catch (err) {
      next(err);
    }
  }

  // 6. Remove discount from product
  static async removeProductDiscount(req, res, next) {
    try {
      const { productId } = req.body;
      if (!productId) {
        return res.status(400).json({ success: false, message: 'productId is required.' });
      }

      const [result] = await pool.query(
        "UPDATE products SET discount_type = 'percentage', discount_value = 0 WHERE id = ?",
        [productId]
      );
      if (!result.affectedRows) return res.status(404).json({ success: false, message: `Product "${productId}" was not found.` });

      res.json({ success: true, message: `Discount removed from product ${productId}.` });
    } catch (err) {
      next(err);
    }
  }
}
