import { pool } from '../config/db.js';
import { PricingService } from '../services/pricing.service.js';

export class CartController {
  static async getOrCreateCart(userId) {
    const [rows] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
    if (rows.length > 0) {
      return rows[0].id;
    }
    const cartId = `crt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    await pool.query('INSERT INTO carts (id, user_id) VALUES (?, ?)', [cartId, userId]);
    return cartId;
  }

  static async getCart(req, res, next) {
    try {
      const userId = req.user.id;
      const cartId = await CartController.getOrCreateCart(userId);

      const [items] = await pool.query(`
        SELECT ci.id AS item_id, ci.product_id, ci.variant_id, ci.quantity,
               p.name AS product_name, p.price AS product_price, p.stock AS product_stock, p.reserved_stock AS product_reserved,
               v.name AS variant_name, v.price AS variant_price, v.stock AS variant_stock, v.reserved_stock AS variant_reserved
        FROM cart_items ci
        JOIN products p ON ci.product_id = p.id
        LEFT JOIN product_variants v ON ci.variant_id = v.id
        WHERE ci.cart_id = ?
        ORDER BY ci.created_at ASC
      `, [cartId]);

      // Calculate authoritative breakdown if items exist
      let breakdown = {
        subtotal: 0,
        discountAmount: 0,
        shippingFee: 0,
        total: 0,
        advancePaymentDue: 0,
        codRemainingDue: 0,
        freeShippingEligible: false
      };

      if (items.length > 0) {
        try {
          breakdown = await PricingService.calculateOrderTotals(
            items.map(i => ({ productId: i.product_id, variantId: i.variant_id, quantity: i.quantity })),
            { couponCode: req.query.couponCode || null, deliverySpeed: req.query.deliverySpeed || 'standard' }
          );
        } catch (e) {}
      }

      const formattedItems = items.map(i => {
        const unitPrice = parseFloat(i.variant_price || i.product_price);
        const physical = parseInt(i.variant_stock ?? i.product_stock, 10) || 0;
        const reserved = parseInt(i.variant_reserved ?? i.product_reserved, 10) || 0;
        const availableStock = Math.max(0, physical - reserved);

        return {
          id: i.item_id,
          productId: i.product_id,
          productName: i.product_name,
          variantId: i.variant_id || undefined,
          variantName: i.variant_name || undefined,
          unitPrice,
          quantity: i.quantity,
          lineTotal: Math.round(unitPrice * i.quantity * 100) / 100,
          availableStock,
          isAvailable: availableStock >= i.quantity
        };
      });

      res.json({
        success: true,
        cartId,
        items: formattedItems,
        itemCount: formattedItems.reduce((sum, it) => sum + it.quantity, 0),
        pricing: breakdown
      });
    } catch (err) {
      next(err);
    }
  }

  static async addItem(req, res, next) {
    try {
      const userId = req.user.id;
      const { productId, variantId = null, quantity = 1 } = req.body || {};

      if (!productId) {
        return res.status(400).json({ success: false, message: 'productId is required.' });
      }

      const qty = parseInt(quantity, 10);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ success: false, message: 'Quantity must be a positive integer.' });
      }

      // Check stock availability
      if (variantId) {
        const [vRows] = await pool.query('SELECT stock, reserved_stock FROM product_variants WHERE id = ? AND product_id = ?', [variantId, productId]);
        if (vRows.length === 0) return res.status(404).json({ success: false, message: 'Variant not found.' });
        const avail = vRows[0].stock - vRows[0].reserved_stock;
        if (avail < qty) return res.status(400).json({ success: false, message: `Insufficient stock. Only ${avail} available.` });
      } else {
        const [pRows] = await pool.query('SELECT stock, reserved_stock FROM products WHERE id = ?', [productId]);
        if (pRows.length === 0) return res.status(404).json({ success: false, message: 'Product not found.' });
        const avail = pRows[0].stock - pRows[0].reserved_stock;
        if (avail < qty) return res.status(400).json({ success: false, message: `Insufficient stock. Only ${avail} available.` });
      }

      const cartId = await CartController.getOrCreateCart(userId);

      // Upsert cart item
      await pool.query(`
        INSERT INTO cart_items (cart_id, product_id, variant_id, quantity)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)
      `, [cartId, productId, variantId || null, qty]);

      res.status(201).json({ success: true, message: 'Item added to shopping bag.' });
    } catch (err) {
      next(err);
    }
  }

  static async updateQuantity(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const { quantity } = req.body;
      const qty = parseInt(quantity, 10);

      const cartId = await CartController.getOrCreateCart(userId);

      if (qty <= 0) {
        await pool.query('DELETE FROM cart_items WHERE id = ? AND cart_id = ?', [id, cartId]);
        return res.json({ success: true, message: 'Item removed from shopping bag.' });
      }

      // Verify available stock
      const [itemRows] = await pool.query('SELECT product_id, variant_id FROM cart_items WHERE id = ? AND cart_id = ?', [id, cartId]);
      if (itemRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Cart item not found.' });
      }

      const { product_id, variant_id } = itemRows[0];
      if (variant_id) {
        const [vRows] = await pool.query('SELECT stock, reserved_stock FROM product_variants WHERE id = ?', [variant_id]);
        const avail = vRows[0]?.stock - vRows[0]?.reserved_stock;
        if (avail < qty) return res.status(400).json({ success: false, message: `Insufficient stock. Only ${avail} available.` });
      } else {
        const [pRows] = await pool.query('SELECT stock, reserved_stock FROM products WHERE id = ?', [product_id]);
        const avail = pRows[0]?.stock - pRows[0]?.reserved_stock;
        if (avail < qty) return res.status(400).json({ success: false, message: `Insufficient stock. Only ${avail} available.` });
      }

      await pool.query('UPDATE cart_items SET quantity = ? WHERE id = ? AND cart_id = ?', [qty, id, cartId]);
      res.json({ success: true, message: 'Cart quantity updated.' });
    } catch (err) {
      next(err);
    }
  }

  static async removeItem(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;
      const cartId = await CartController.getOrCreateCart(userId);

      await pool.query('DELETE FROM cart_items WHERE id = ? AND cart_id = ?', [id, cartId]);
      res.json({ success: true, message: 'Item removed from shopping bag.' });
    } catch (err) {
      next(err);
    }
  }

  static async clearCart(req, res, next) {
    try {
      const userId = req.user.id;
      const cartId = await CartController.getOrCreateCart(userId);

      await pool.query('DELETE FROM cart_items WHERE cart_id = ?', [cartId]);
      res.json({ success: true, message: 'Shopping bag cleared.' });
    } catch (err) {
      next(err);
    }
  }
}
