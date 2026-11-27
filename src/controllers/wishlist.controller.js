import { pool } from '../config/db.js';
import { ProductController } from './product.controller.js';

export class WishlistController {
  static async getOrCreateWishlist(userId) {
    const [rows] = await pool.query('SELECT id FROM wishlists WHERE user_id = ?', [userId]);
    if (rows.length > 0) return rows[0].id;
    const wishlistId = `wsh-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    await pool.query('INSERT INTO wishlists (id, user_id) VALUES (?, ?)', [wishlistId, userId]);
    return wishlistId;
  }

  static async getWishlist(req, res, next) {
    try {
      const userId = req.user.id;
      const wishlistId = await WishlistController.getOrCreateWishlist(userId);

      const [rows] = await pool.query(`
        SELECT p.*, wi.created_at AS added_to_wishlist_at
        FROM wishlist_items wi
        JOIN products p ON wi.product_id = p.id
        WHERE wi.wishlist_id = ?
        ORDER BY wi.created_at DESC
      `, [wishlistId]);

      const [variants] = await pool.query('SELECT * FROM product_variants WHERE is_active = TRUE');
      const [images] = await pool.query('SELECT * FROM product_images ORDER BY display_order ASC');
      const [allowedCities] = await pool.query('SELECT * FROM product_allowed_cities');

      const products = rows.map(p => ProductController.formatProduct(p, variants, images, allowedCities));

      res.json({
        success: true,
        count: products.length,
        productIds: products.map(p => p.id),
        products
      });
    } catch (err) {
      next(err);
    }
  }

  static async addItem(req, res, next) {
    try {
      const userId = req.user.id;
      const { productId } = req.body;

      if (!productId) {
        return res.status(400).json({ success: false, message: 'productId is required.' });
      }

      const [pRows] = await pool.query('SELECT id FROM products WHERE id = ?', [productId]);
      if (pRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Product not found.' });
      }

      const wishlistId = await WishlistController.getOrCreateWishlist(userId);

      await pool.query(`
        INSERT IGNORE INTO wishlist_items (wishlist_id, product_id)
        VALUES (?, ?)
      `, [wishlistId, productId]);

      res.status(201).json({ success: true, message: 'Product added to wishlist.' });
    } catch (err) {
      next(err);
    }
  }

  static async removeItem(req, res, next) {
    try {
      const userId = req.user.id;
      const { productId } = req.params;
      const wishlistId = await WishlistController.getOrCreateWishlist(userId);

      await pool.query('DELETE FROM wishlist_items WHERE wishlist_id = ? AND product_id = ?', [wishlistId, productId]);
      res.json({ success: true, message: 'Product removed from wishlist.' });
    } catch (err) {
      next(err);
    }
  }
}
