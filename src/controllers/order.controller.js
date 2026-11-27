import fs from 'node:fs/promises';
import path from 'node:path';
import { OrderService } from '../services/order.service.js';
import { PricingService } from '../services/pricing.service.js';
import { pool } from '../config/db.js';
import { privatePaymentProofsRoot } from '../middlewares/upload.middleware.js';

export class OrderController {
  static async assertAdminOwnsOrder(orderId, adminId) {
    const [orders] = await pool.query(`
      SELECT o.id
      FROM orders o
      WHERE o.id = ?
        AND EXISTS (
          SELECT 1
          FROM order_items oi
          LEFT JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = o.id
            AND COALESCE(oi.admin_id, p.owner_id, p.admin_id) = ?
        )
    `, [orderId, adminId]);
    if (!orders.length) {
      const [existingOrders] = await pool.query('SELECT id FROM orders WHERE id = ?', [orderId]);
      const error = new Error(existingOrders.length
        ? 'Forbidden. This order does not contain products owned by your account.'
        : `Order "${orderId}" not found.`);
      error.statusCode = existingOrders.length ? 403 : 404;
      throw error;
    }

  }

  static async calculatePricing(req, res, next) {
    try {
      const { items, couponCode, deliverySpeed, city } = req.body || {};
      const breakdown = await PricingService.calculateOrderTotals(items, {
        couponCode,
        deliverySpeed,
        city
      });
      const { items: pricedItems, ...publicBreakdown } = breakdown;
      res.json({
        success: true,
        ...publicBreakdown,
        items: pricedItems.map(({ costPrice, ...item }) => item)
      });
    } catch (err) {
      next(err);
    }
  }

  static async place(req, res, next) {
    try {
      const userId = req.user?.id || null;
      const clientOrderId = req.headers['x-client-order-id'] || req.body?.clientOrderId;
      const result = await OrderService.placeOrder(req.body, userId, { key: clientOrderId });
      const advancePayments = await OrderService.getAdvancePayments(result.orderId);
      const advancePaymentInstructions = advancePayments.map(payment => ({
        adminId: payment.adminId,
        accountHolderName: payment.sellerName,
        bankName: payment.bankName,
        bankAccountTitle: payment.bankAccountTitle,
        bankAccountNumber: payment.bankAccountNumber,
        amountDue: payment.amountDue
      }));
      res.status(result.idempotentReplay ? 200 : 201).json({
        success: true,
        message: result.idempotentReplay
          ? 'This checkout was already processed; returning the original order.'
          : 'Luxury acquisition successfully placed in vault.',
        ...result,
        advancePayments,
        advancePaymentInstructions
      });
    } catch (err) {
      next(err);
    }
  }

  static async confirm(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user?.id || null;
      const guestToken = req.headers['x-guest-token'] || req.query.guestToken || req.body?.guestToken || null;

      const result = await OrderService.confirmOrderByCustomer(id, userId, guestToken);
      res.json({ success: true, message: 'Order confirmed successfully.', ...result });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      next(err);
    }
  }

  static async cancel(req, res, next) {
    try {
      const { id } = req.params;
      const { reason = 'Customer requested cancellation' } = req.body || {};
      const actor = req.user?.name || req.body?.actor || 'Customer';
      const actorRole = req.user?.role || 'customer';
      const userId = req.user?.id || null;
      const guestToken = req.headers['x-guest-token'] || req.query.guestToken || req.body?.guestToken || null;

      const result = await OrderService.cancelOrder(id, actor, actorRole, reason, userId, guestToken);
      res.json({ success: true, message: 'Order successfully cancelled and reservation released.', ...result });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      next(err);
    }
  }

  static async assignCourier(req, res, next) {
    try {
      const { id } = req.params;
      const { courierPartner, trackingNumber, note = '' } = req.body || {};
      await OrderController.assertAdminOwnsOrder(id, req.user.id);
      const result = await OrderService.assignCourier(id, courierPartner, trackingNumber, note);
      res.json({ success: true, message: 'Courier assigned and tracking linked.', ...result });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      next(err);
    }
  }

  static async markShipped(req, res, next) {
    try {
      const { id } = req.params;
      const { notes = '' } = req.body || {};
      await OrderController.assertAdminOwnsOrder(id, req.user.id);
      const result = await OrderService.markOrderShipped(id, notes);
      res.json({ success: true, message: 'Order marked as shipped; inventory was deducted at checkout.', ...result });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      next(err);
    }
  }

  static async updateStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { status, reason = '' } = req.body || {};
      const actor = req.user?.name || 'Store Administrator';
      const actorRole = req.user?.role || 'admin';
      const validStatuses = ['placed', 'confirmed', 'processing', 'courier_assigned', 'shipped', 'delivered', 'cancelled', 'returned'];

      if (typeof status !== 'string' || !validStatuses.includes(status)) {
        const error = new Error(`A valid order status is required. Allowed statuses: ${validStatuses.join(', ')}.`);
        error.statusCode = 400;
        throw error;
      }
      if (typeof reason !== 'string') {
        const error = new Error('Order status reason must be text.');
        error.statusCode = 400;
        throw error;
      }

      await OrderController.assertAdminOwnsOrder(id, req.user.id);
      const result = await OrderService.updateOrderStatus(id, status, actor, actorRole, reason);
      res.json({ success: true, message: `Order status transitioned to ${status}.`, ...result });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      next(err);
    }
  }

  static async deleteOrder(req, res, next) {
    try {
      const { id } = req.params;
      await OrderController.assertAdminOwnsOrder(id, req.user.id);
      const result = await OrderService.deleteOrder(id);
      res.json({ success: true, message: 'Order permanently deleted and stock restored.', ...result });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      next(err);
    }
  }

  static async submitPaymentProof(req, res, next) {
    const uploadedPath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'A payment proof image is required.' });
      }
      const { adminId, accountHolderName, paymentPlatform, transactionReference, amount } = req.body || {};
      if (typeof adminId !== 'string' || !adminId.trim() || adminId.trim().length > 50 ||
          typeof accountHolderName !== 'string' || accountHolderName.trim().length > 150 ||
          typeof paymentPlatform !== 'string' || paymentPlatform.trim().length > 100 ||
          typeof transactionReference !== 'string' || transactionReference.trim().length > 150 ||
          amount === undefined || !Number.isFinite(Number(amount))) {
        await fs.unlink(req.file.path);
        return res.status(400).json({ success: false, message: 'Select the seller and enter the account holder name, platform, transaction reference, and exact payment amount.' });
      }

      const image = await fs.readFile(req.file.path);
      const isJpeg = image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
      const isPng = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const isWebp = image.length >= 12 && image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP';
      if (!isJpeg && !isPng && !isWebp) {
        await fs.unlink(req.file.path);
        return res.status(400).json({ success: false, message: 'The uploaded file is not a valid JPG, PNG, or WEBP image.' });
      }

      const result = await OrderService.submitPaymentProof(req.params.id, req.user.id, {
        adminId,
        accountHolderName,
        paymentPlatform,
        transactionReference,
        amount,
        imageStoragePath: path.basename(req.file.path)
      });
      res.status(201).json({ success: true, message: 'Payment proof submitted for manual verification.', ...result });
    } catch (error) {
      if (uploadedPath) {
        try {
          await fs.unlink(uploadedPath);
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') return next(cleanupError);
        }
      }
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  static async reviewPaymentProof(req, res, next) {
    try {
      const { status, reason = '' } = req.body || {};
      await OrderController.assertAdminOwnsOrder(req.params.id, req.user.id);
      const result = await OrderService.reviewPaymentProof(
        req.params.id,
        req.params.proofId,
        req.user.id,
        status,
        reason
      );
      res.json({ success: true, message: `Payment proof ${status}.`, ...result });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  static async confirmAdvancePayment(req, res, next) {
    try {
      await OrderController.assertAdminOwnsOrder(req.params.id, req.user.id);
      const { transactionReference, accountHolderName, paymentPlatform, amount, note } = req.body || {};
      const result = await OrderService.confirmAdvancePayment(req.params.id, req.user.id, {
        transactionReference,
        accountHolderName,
        paymentPlatform,
        amount,
        note
      });
      res.json({
        success: true,
        message: 'Advance payment confirmed successfully. Order moved to All Orders.',
        ...result
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  static async getPaymentProofImage(req, res, next) {
    try {
      const { id: orderId, proofId } = req.params;
      const [proofs] = await pool.query(
        'SELECT image_storage_path, admin_id FROM order_payment_proofs WHERE id = ? AND order_id = ?',
        [proofId, orderId]
      );
      if (!proofs.length) {
        return res.status(404).json({ success: false, message: 'Payment proof image not found.' });
      }

      if (req.user.role === 'admin') {
        await OrderController.assertAdminOwnsOrder(orderId, req.user.id);
        if (proofs[0].admin_id !== req.user.id) {
          return res.status(403).json({ success: false, message: 'This payment proof belongs to another seller.' });
        }
      } else {
        const [orders] = await pool.query(
          'SELECT id FROM orders WHERE id = ? AND (customer_id = ? OR user_id = ?)',
          [orderId, req.user.id, req.user.id]
        );
        if (!orders.length) {
          return res.status(403).json({ success: false, message: 'You do not own this payment proof.' });
        }
      }

      const imagePath = path.resolve(privatePaymentProofsRoot, proofs[0].image_storage_path);
      const relativePath = path.relative(privatePaymentProofsRoot, imagePath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return res.status(404).json({ success: false, message: 'Payment proof image not found.' });
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(imagePath, { dotfiles: 'deny' }, error => {
        if (error && !res.headersSent) next(error);
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  static async hideCustomerOrder(req, res, next) {
    try {
      const result = await OrderService.hideCancelledOrder(req.params.id, req.user.id);
      res.json({ success: true, ...result });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const guestToken = req.headers['x-guest-token'] || req.query.guestToken;
      const order = await OrderService.getOrderById(id);
      if (!order) {
        return res.status(404).json({ success: false, message: `Order "${id}" not found.` });
      }
      const isAdmin = req.user?.role === 'admin';
      if (isAdmin) {
        await OrderController.assertAdminOwnsOrder(id, req.user.id);
        const adminAdvancePayment = await OrderService.getAdminAdvancePayment(id, req.user.id);
        order.adminAdvancePayment = adminAdvancePayment;
        order.advancePayments = adminAdvancePayment ? [adminAdvancePayment] : [];
        order.advancePaymentDue = adminAdvancePayment ? Number(adminAdvancePayment.amountDue || 0) : 0;
        order.advanceStatus = adminAdvancePayment ? adminAdvancePayment.status : null;
      } else {
        const orderOwnerId = order.userId || order.user_id;
        if (orderOwnerId) {
          if (!req.user) {
            return res.status(401).json({ success: false, message: 'Authentication required to view customer order.' });
          }
          if (req.user.id !== orderOwnerId) {
            return res.status(403).json({ success: false, message: 'Forbidden. You do not own this order.' });
          }
        } else {
          if (!guestToken) {
            return res.status(401).json({ success: false, message: 'Guest access token required to view order details.' });
          }
          let expectedToken = null;
          try {
            const [dbOrder] = await pool.query('SELECT guest_access_token FROM `orders` WHERE id = ?', [id]);
            expectedToken = dbOrder[0]?.guest_access_token;
          } catch (dbErr) {
            const mock = OrderService.mockOrders.get(id);
            expectedToken = mock?.guest_access_token;
          }
          if (guestToken !== expectedToken) {
            return res.status(403).json({ success: false, message: 'Forbidden. Invalid guest access token.' });
          }
        }
      }

      order.advancePaymentInstructions = (order.advancePayments || []).map(payment => ({
        adminId: payment.adminId,
        accountHolderName: payment.sellerName,
        bankName: payment.bankName,
        bankAccountTitle: payment.bankAccountTitle,
        bankAccountNumber: payment.bankAccountNumber,
        amountDue: payment.amountDue
      }));
      res.json({ success: true, order });
    } catch (err) {
      next(err);
    }
  }

  static async listAdmin(req, res, next) {
    try {
      await OrderService.expireUnpaidAdvanceOrders();
      const { status = 'all', search = '', city = '' } = req.query;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
      // 'everything' is used by the admin dashboard/analytics, which must see every
      // status (the default 'all' intentionally hides delivered/cancelled orders).
      const allowedFilters = ['all', 'everything', 'advance_pending', 'pending', 'placed', 'confirmed', 'processing', 'courier_assigned', 'shipped', 'delivered', 'cancelled', 'returned', 'expired', 'payment_review'];
      if (!allowedFilters.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid order status filter.' });
      }

      const ownerCondition = `EXISTS (
          SELECT 1
          FROM order_items owned_item
          LEFT JOIN products p ON p.id = owned_item.product_id
          WHERE owned_item.order_id = o.id
            AND COALESCE(owned_item.admin_id, p.owner_id, p.admin_id) = ?
        )`;
      const where = [];
      const params = [req.user.id];
      const escapedAdminId = pool.escape(req.user.id);
      const ownProofStatusSql = `(SELECT app.status FROM order_payment_proofs app WHERE app.order_id = o.id AND app.admin_id = ${escapedAdminId} LIMIT 1)`;
      const advanceProofSql = `EXISTS (SELECT 1 FROM order_payment_proofs app WHERE app.order_id = o.id AND app.admin_id = ${escapedAdminId} AND app.status IN ('awaiting_proof', 'verification_pending', 'rejected'))`;
      const unconfirmedAdvanceSql = `(o.advance_payment_due > 0 AND ${advanceProofSql})`;

      if (status === 'everything') {
        where.push('1 = 1');
      } else if (status === 'all') {
        where.push(`o.order_status NOT IN ('delivered', 'cancelled', 'returned', 'expired') AND NOT ${unconfirmedAdvanceSql}`);
      } else if (status === 'advance_pending') {
        where.push(`${unconfirmedAdvanceSql} AND o.order_status NOT IN ('cancelled', 'expired', 'returned')`);
      } else if (status === 'pending') {
        where.push(`o.order_status IN ('placed', 'confirmed', 'processing', 'courier_assigned') AND NOT ${unconfirmedAdvanceSql}`);
      } else if (status === 'placed') {
        where.push(`o.order_status = 'placed' AND NOT ${unconfirmedAdvanceSql}`);
      } else if (status === 'payment_review') {
        where.push(`${ownProofStatusSql} IN ('verification_pending', 'rejected')`);
      } else {
        where.push('o.order_status = ?');
        params.push(status);
      }
      const cleanSearch = String(search).trim().slice(0, 100);
      if (cleanSearch) {
        const like = `%${cleanSearch}%`;
        where.push(`(
          o.id LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ? OR
          o.customer_email LIKE ? OR o.customer_city LIKE ? OR o.customer_address LIKE ? OR
          o.tracking_number LIKE ? OR EXISTS (
            SELECT 1 FROM order_items search_item
            WHERE search_item.order_id = o.id AND search_item.product_name LIKE ?
          )
        )`);
        params.push(like, like, like, like, like, like, like, like);
      }
      const cleanCity = String(city).trim().slice(0, 100);
      if (cleanCity && cleanCity.toLowerCase() !== 'all') {
        where.push('o.customer_city = ?');
        params.push(cleanCity);
      }
      const whereSql = `WHERE ${ownerCondition} AND ${where.join(' AND ')}`;
      const offset = (page - 1) * limit;
      const [rows] = await pool.query(
        `SELECT o.* FROM orders o ${whereSql} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM orders o ${whereSql}`,
        params
      );
      const [[counts]] = await pool.query(`
        SELECT
          COUNT(*) AS total,
          SUM(o.order_status NOT IN ('delivered', 'cancelled', 'returned', 'expired') AND NOT ${unconfirmedAdvanceSql}) AS active,
          SUM(o.order_status IN ('placed', 'confirmed', 'processing', 'courier_assigned') AND NOT ${unconfirmedAdvanceSql}) AS pending,
          SUM(o.order_status = 'placed' AND NOT ${unconfirmedAdvanceSql}) AS placed,
          SUM(o.order_status = 'confirmed') AS confirmed,
          SUM(o.order_status = 'processing') AS processing,
          SUM(o.order_status = 'courier_assigned') AS courier_assigned,
          SUM(o.order_status = 'shipped') AS shipped,
          SUM(o.order_status = 'delivered') AS delivered,
          SUM(o.order_status = 'cancelled') AS cancelled,
          SUM(o.order_status = 'returned') AS returned,
          SUM(o.order_status = 'expired') AS expired,
          SUM(${unconfirmedAdvanceSql} AND o.order_status NOT IN ('cancelled', 'expired', 'returned')) AS advance_pending,
          SUM(${ownProofStatusSql} IN ('verification_pending', 'rejected')) AS payment_review
        FROM orders o
        WHERE ${ownerCondition}
      `, [req.user.id]);
      const orders = [];
      for (const r of rows) {
        const [items] = await pool.query(
          `SELECT oi.*
           FROM order_items oi
           LEFT JOIN products p ON p.id = oi.product_id
           WHERE oi.order_id = ?
             AND COALESCE(oi.admin_id, p.owner_id, p.admin_id) = ?`,
          [r.id, req.user.id]
        );
        const adminAdvancePayment = await OrderService.getAdminAdvancePayment(r.id, req.user.id);
        orders.push(OrderService.formatOrder(r, items, [], {
          includeCostSnapshot: true,
          forAdmin: true,
          advancePayments: adminAdvancePayment ? [adminAdvancePayment] : [],
          adminAdvancePayment
        }));
      }

      res.json({
        success: true,
        count: orders.length,
        total: Number(total),
        page,
        limit,
        pages: Math.ceil(Number(total) / limit),
        statusCounts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value || 0)])),
        orders
      });
    } catch (err) {
      next(err);
    }
  }

  static async listCustomer(req, res, next) {
    try {
      await OrderService.expireUnpaidAdvanceOrders();
      const userId = req.user.id;
      const [rows] = await pool.query(
        "SELECT * FROM `orders` WHERE (user_id = ? OR customer_id = ?) AND customer_hidden_at IS NULL ORDER BY created_at DESC",
        [userId, userId]
      );

      const orders = [];
      for (const r of rows) {
        const [items] = await pool.query('SELECT * FROM `order_items` WHERE order_id = ?', [r.id]);
        const advancePayments = await OrderService.getAdvancePayments(r.id);
        orders.push(OrderService.formatOrder(r, items, [], { advancePayments }));
      }

      res.json({ success: true, count: orders.length, orders });
    } catch (err) {
      next(err);
    }
  }
}
