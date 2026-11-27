import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';
import { SOCKET_EVENTS } from '../socket/events.js';
import { logger } from '../utils/logger.js';

export class InventoryService {
  /**
   * Internal test fallback memory storage when running offline/unit tests
   */
  static mockProducts = new Map();
  static mockReservations = new Map();

  static async deductStockForOrder(connection, orderId, items) {
    const changes = [];

    for (const item of items) {
      const quantity = Number.parseInt(item.quantity, 10);
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new Error(`Invalid inventory quantity for "${item.productId}".`);
      }

      if (connection) {
        const table = item.variantId ? 'product_variants' : 'products';
        const id = item.variantId || item.productId;
        const [rows] = await connection.query(
          `SELECT stock, reserved_stock FROM \`${table}\` WHERE id = ? FOR UPDATE`,
          [id]
        );
        if (!rows.length) {
          throw new Error(`${item.variantId ? 'Variant' : 'Product'} "${id}" not found in inventory.`);
        }

        const available = Number(rows[0].stock) - Number(rows[0].reserved_stock || 0);
        if (available < quantity) {
          throw new Error(`Insufficient stock for "${id}". Available: ${available}, Requested: ${quantity}`);
        }

        await connection.query(
          `UPDATE \`${table}\` SET stock = stock - ? WHERE id = ?`,
          [quantity, id]
        );
        await connection.query(`
          INSERT INTO \`inventory_reservations\` (\`order_id\`, \`product_id\`, \`variant_id\`, \`quantity\`, \`status\`)
          VALUES (?, ?, ?, ?, 'committed')
        `, [orderId, item.productId, item.variantId || null, quantity]);
        changes.push({
          productId: item.productId,
          variantId: item.variantId || null,
          availableStock: available - quantity
        });
      } else {
        const key = item.variantId || item.productId;
        const stock = this.mockProducts.get(key) || { physical: 20, reserved: 0 };
        const available = stock.physical - stock.reserved;
        if (available < quantity) {
          throw new Error(`Insufficient stock for "${key}". Available: ${available}, Requested: ${quantity}`);
        }
        stock.physical -= quantity;
        this.mockProducts.set(key, stock);
        const reservations = this.mockReservations.get(orderId) || [];
        reservations.push({
          productId: item.productId,
          variantId: item.variantId || null,
          quantity,
          status: 'committed'
        });
        this.mockReservations.set(orderId, reservations);
        changes.push({
          productId: item.productId,
          variantId: item.variantId || null,
          availableStock: stock.physical - stock.reserved
        });
      }
    }

    return changes;
  }

  static async restoreOrderStock(connection, orderId) {
    const changes = [];

    if (connection) {
      const [reservations] = await connection.query(
        'SELECT * FROM inventory_reservations WHERE order_id = ? AND status IN ("active", "committed") FOR UPDATE',
        [orderId]
      );

      for (const reservation of reservations) {
        const quantity = Number(reservation.quantity);
        if (reservation.status === 'committed') {
          const table = reservation.variant_id ? 'product_variants' : 'products';
          const id = reservation.variant_id || reservation.product_id;
          await connection.query(`UPDATE \`${table}\` SET stock = stock + ? WHERE id = ?`, [quantity, id]);
          const [rows] = await connection.query(
            `SELECT stock, reserved_stock FROM \`${table}\` WHERE id = ?`,
            [id]
          );
          changes.push({
            productId: reservation.product_id,
            variantId: reservation.variant_id || null,
            availableStock: Number(rows[0].stock) - Number(rows[0].reserved_stock || 0)
          });
        } else if (reservation.variant_id) {
          await connection.query(
            'UPDATE product_variants SET reserved_stock = GREATEST(0, reserved_stock - ?) WHERE id = ?',
            [quantity, reservation.variant_id]
          );
          const [rows] = await connection.query(
            'SELECT stock, reserved_stock FROM product_variants WHERE id = ?',
            [reservation.variant_id]
          );
          changes.push({
            productId: reservation.product_id,
            variantId: reservation.variant_id,
            availableStock: Number(rows[0].stock) - Number(rows[0].reserved_stock || 0)
          });
        } else {
          await connection.query(
            'UPDATE products SET reserved_stock = GREATEST(0, reserved_stock - ?) WHERE id = ?',
            [quantity, reservation.product_id]
          );
          const [rows] = await connection.query(
            'SELECT stock, reserved_stock FROM products WHERE id = ?',
            [reservation.product_id]
          );
          changes.push({
            productId: reservation.product_id,
            variantId: null,
            availableStock: Number(rows[0].stock) - Number(rows[0].reserved_stock || 0)
          });
        }
      }

      if (reservations.length) {
        await connection.query(
          'UPDATE inventory_reservations SET status = "released" WHERE order_id = ? AND status IN ("active", "committed")',
          [orderId]
        );
      }
    } else {
      const reservations = this.mockReservations.get(orderId) || [];
      for (const reservation of reservations) {
        if (reservation.status === 'released') continue;
        const key = reservation.variantId || reservation.productId;
        const stock = this.mockProducts.get(key);
        if (!stock) continue;

        if (reservation.status === 'committed') {
          stock.physical += reservation.quantity;
        } else {
          stock.reserved = Math.max(0, stock.reserved - reservation.quantity);
        }
        reservation.status = 'released';
        changes.push({
          productId: reservation.productId,
          variantId: reservation.variantId,
          availableStock: stock.physical - stock.reserved
        });
      }
    }

    return changes;
  }

  /**
   * Reserve inventory atomically within a database transaction using row-level locks
   * @param {import('mysql2/promise').PoolConnection} connection
   * @param {string} orderId
   * @param {Array<{ productId: string, variantId?: string, quantity: number }>} items
   */
  static async reserveStockTransactionally(connection, orderId, items) {
    for (const item of items) {
      const qty = parseInt(item.quantity, 10) || 1;

      if (connection) {
        if (item.variantId) {
          // Row-level lock on variant
          const [vRows] = await connection.query(
            'SELECT stock, reserved_stock FROM product_variants WHERE id = ? FOR UPDATE',
            [item.variantId]
          );

          if (vRows.length === 0) {
            throw new Error(`Variant "${item.variantId}" not found in inventory.`);
          }

          const physical = vRows[0].stock;
          const reserved = vRows[0].reserved_stock;
          const available = physical - reserved;

          if (available < qty) {
            throw new Error(`Insufficient stock for variant "${item.variantId}". Available: ${available}, Requested: ${qty}`);
          }

          await connection.query(
            'UPDATE product_variants SET reserved_stock = reserved_stock + ? WHERE id = ?',
            [qty, item.variantId]
          );
        } else {
          // Row-level lock on product
          const [pRows] = await connection.query(
            'SELECT stock, reserved_stock FROM products WHERE id = ? FOR UPDATE',
            [item.productId]
          );

          if (pRows.length === 0) {
            throw new Error(`Product "${item.productId}" not found in inventory.`);
          }

          const physical = pRows[0].stock;
          const reserved = pRows[0].reserved_stock;
          const available = physical - reserved;

          if (available < qty) {
            throw new Error(`Insufficient stock for product "${item.productId}". Available: ${available}, Requested: ${qty}`);
          }

          await connection.query(
            'UPDATE products SET reserved_stock = reserved_stock + ? WHERE id = ?',
            [qty, item.productId]
          );
        }

        // Insert reservation record
        await connection.query(`
          INSERT INTO \`inventory_reservations\` (\`order_id\`, \`product_id\`, \`variant_id\`, \`quantity\`, \`status\`)
          VALUES (?, ?, ?, ?, 'active')
        `, [orderId, item.productId, item.variantId || null, qty]);
      } else {
        // Memory test mode
        const key = item.variantId || item.productId;
        const current = this.mockProducts.get(key) || { physical: 20, reserved: 0 };
        const available = current.physical - current.reserved;
        if (available < qty) {
          throw new Error(`Insufficient stock for "${key}". Available: ${available}, Requested: ${qty}`);
        }
        current.reserved += qty;
        this.mockProducts.set(key, current);
        const reservations = this.mockReservations.get(orderId) || [];
        reservations.push({
          productId: item.productId,
          variantId: item.variantId || null,
          quantity: qty,
          status: 'active'
        });
        this.mockReservations.set(orderId, reservations);
      }
    }
  }

  /**
   * Release reservation once (e.g. on order cancellation before courier or reservation expiry)
   */
  static async releaseReservation(connection, orderId) {
    if (connection) {
      const [reservations] = await connection.query(
        'SELECT * FROM inventory_reservations WHERE order_id = ? AND status = "active" FOR UPDATE',
        [orderId]
      );

      for (const res of reservations) {
        if (res.variant_id) {
          await connection.query(
            'UPDATE product_variants SET reserved_stock = GREATEST(0, reserved_stock - ?) WHERE id = ?',
            [res.quantity, res.variant_id]
          );
        } else {
          await connection.query(
            'UPDATE products SET reserved_stock = GREATEST(0, reserved_stock - ?) WHERE id = ?',
            [res.quantity, res.product_id]
          );
        }
      }

      await connection.query(
        'UPDATE inventory_reservations SET status = "released" WHERE order_id = ? AND status = "active"',
        [orderId]
      );
    } else {
      await this.restoreOrderStock(null, orderId);
    }
  }

  /**
   * Commit reservation to physical stock decrement on shipment
   */
  static async commitReservationOnShipment(connection, orderId) {
    if (connection) {
      const [reservations] = await connection.query(
        'SELECT * FROM inventory_reservations WHERE order_id = ? AND status = "active" FOR UPDATE',
        [orderId]
      );

      for (const res of reservations) {
        if (res.variant_id) {
          await connection.query(`
            UPDATE product_variants 
            SET stock = GREATEST(0, stock - ?),
                reserved_stock = GREATEST(0, reserved_stock - ?) 
            WHERE id = ?
          `, [res.quantity, res.quantity, res.variant_id]);
        } else {
          await connection.query(`
            UPDATE products 
            SET stock = GREATEST(0, stock - ?),
                reserved_stock = GREATEST(0, reserved_stock - ?) 
            WHERE id = ?
          `, [res.quantity, res.quantity, res.product_id]);
        }
      }

      await connection.query(
        'UPDATE inventory_reservations SET status = "committed" WHERE order_id = ? AND status = "active"',
        [orderId]
      );
    } else {
      const reservations = this.mockReservations.get(orderId) || [];
      const changes = [];
      for (const reservation of reservations) {
        if (reservation.status !== 'active') continue;
        const key = reservation.variantId || reservation.productId;
        const stock = this.mockProducts.get(key);
        if (!stock) continue;
        stock.physical = Math.max(0, stock.physical - reservation.quantity);
        stock.reserved = Math.max(0, stock.reserved - reservation.quantity);
        reservation.status = 'committed';
        changes.push({
          productId: reservation.productId,
          variantId: reservation.variantId,
          availableStock: stock.physical - stock.reserved
        });
      }
      this.emitStockChanges(changes);
    }
  }

  // Canonical alias
  static async commitShipment(connection, orderId) {
    return this.commitReservationOnShipment(connection, orderId);
  }

  /**
   * Broadcast real-time stock change
   */
  static emitStockChange(productId, variantId, availableStock) {
    const io = getIO();
    io.emit(SOCKET_EVENTS.INVENTORY_STOCK_CHANGED, {
      productId,
      variantId: variantId || null,
      availableStock,
      timestamp: new Date().toISOString()
    });
  }

  static emitStockChanges(changes = []) {
    for (const change of changes) {
      this.emitStockChange(change.productId, change.variantId, change.availableStock);
    }
  }

  /**
   * Helper to set test product stock in memory
   */
  static setMockProductStock(id, physical, reserved = 0) {
    this.mockProducts.set(id, { physical, reserved });
  }

  static getMockProductStock(id) {
    return this.mockProducts.get(id) || { physical: 0, reserved: 0, available: 0 };
  }
}
