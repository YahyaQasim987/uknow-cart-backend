import { pool } from '../config/db.js';
import { InventoryService } from '../services/inventory.service.js';

export class InventoryController {
  static async list(req, res, next) {
    try {
      const [rows] = await pool.query(`
        SELECT * FROM (
          SELECT
            id, id AS product_id, NULL AS variant_id, name, sku, category_id,
            stock, reserved_stock, GREATEST(0, stock - reserved_stock) AS available_stock,
            price, brand,
            (SELECT image_url FROM product_images WHERE product_id = products.id ORDER BY display_order ASC LIMIT 1) AS image_url,
            'product' AS item_type
          FROM products
          WHERE archived_at IS NULL
          UNION ALL
          SELECT
            v.id, v.product_id, v.id AS variant_id, CONCAT(p.name, ' - ', v.name) AS name,
            v.sku, p.category_id, v.stock, v.reserved_stock,
            GREATEST(0, v.stock - v.reserved_stock) AS available_stock,
            v.price, p.brand, p.banner_image AS image_url, 'variant' AS item_type
          FROM product_variants v
          JOIN products p ON p.id = v.product_id
          WHERE p.archived_at IS NULL
        ) inventory
        ORDER BY available_stock ASC, name ASC
      `);
      const items = rows.map(row => ({
        ...row,
        isLowStock: Number(row.available_stock) <= 5
      }));
      res.json({ success: true, count: items.length, items });
    } catch (err) {
      next(err);
    }
  }

  static async adjustStock(req, res, next) {
    let connection;
    try {
      const productId = req.params.productId || req.body.productId;
      const { variantId = null, reason = '' } = req.body;
      const isAbsoluteUpdate = req.body.stock !== undefined;
      const requestedValue = Number(isAbsoluteUpdate ? req.body.stock : req.body.adjustment);

      if (!productId || !Number.isSafeInteger(requestedValue)) {
        return res.status(400).json({
          success: false,
          message: 'A productId and integer stock quantity or adjustment are required.'
        });
      }
      if (isAbsoluteUpdate && requestedValue < 0) {
        return res.status(400).json({ success: false, message: 'Stock cannot be negative.' });
      }
      if (typeof reason !== 'string') {
        return res.status(400).json({ success: false, message: 'Adjustment reason must be text.' });
      }
      if (!isAbsoluteUpdate && !reason.trim()) {
        return res.status(400).json({ success: false, message: 'A reason is required for stock adjustments.' });
      }

      connection = await pool.getConnection();
      await connection.beginTransaction();

      const table = variantId ? 'product_variants' : 'products';
      const sql = variantId
        ? 'SELECT stock, reserved_stock FROM product_variants WHERE id = ? AND product_id = ? FOR UPDATE'
        : 'SELECT stock, reserved_stock FROM products WHERE id = ? FOR UPDATE';
      const params = variantId ? [variantId, productId] : [productId];
      const [rows] = await connection.query(sql, params);
      if (!rows.length) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'Inventory item was not found.' });
      }

      const previousStock = Number(rows[0].stock);
      const reservedStock = Number(rows[0].reserved_stock);
      const newStock = isAbsoluteUpdate ? requestedValue : previousStock + requestedValue;
      if (newStock < reservedStock) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: `Stock cannot be reduced below the ${reservedStock} units currently reserved.`
        });
      }

      const inventoryId = variantId || productId;
      await connection.query(`UPDATE ${table} SET stock = ? WHERE id = ?`, [newStock, inventoryId]);
      const adjustment = newStock - previousStock;
      if (adjustment !== 0) {
        await connection.query(`
          INSERT INTO inventory_adjustments
            (product_id, variant_id, admin_id, previous_stock, new_stock, adjustment, reason)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [productId, variantId, req.user?.id || null, previousStock, newStock, adjustment, reason.trim() || 'Manual stock update']);
      }

      await connection.commit();
      const availableStock = Math.max(0, newStock - reservedStock);
      InventoryService.emitStockChange(productId, variantId, availableStock);
      return res.json({
        success: true,
        message: 'Inventory count updated.',
        productId,
        variantId,
        previousStock,
        adjustment,
        newStock,
        availableStock
      });
    } catch (err) {
      if (connection) await connection.rollback();
      next(err);
    } finally {
      if (connection) connection.release();
    }
  }

}
