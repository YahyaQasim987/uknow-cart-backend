import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';
import { SOCKET_EVENTS } from '../socket/events.js';
import { PricingService } from './pricing.service.js';
import { InventoryService } from './inventory.service.js';
import { logger } from '../utils/logger.js';

function emitOrderStatusChanged(orderId, payload, userId = null) {
  try {
    const io = getIO();
    let target = io.to(`order:${orderId}`);
    if (userId && typeof target.to === 'function') {
      target = target.to(`user:${userId}`);
    }
    target.emit(SOCKET_EVENTS.ORDER_STATUS_CHANGED, payload);
    // Admin panels never join customer `order:` rooms, so they would miss
    // status/payment changes coming from another session, the expiry timer or a
    // customer action. Broadcast to the shared admin room so every open admin
    // dashboard refreshes live.
    io.to('admin').emit(SOCKET_EVENTS.ORDER_STATUS_CHANGED, payload);
  } catch (error) {
    logger.error('Failed to broadcast order status change.', {
      orderId,
      message: error.message
    });
  }
}

const CHECKOUT_KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

function normalizeCheckoutKey(value) {
  if (value === undefined || value === null || value === '') return null;
  const key = String(value).trim();
  if (!CHECKOUT_KEY_PATTERN.test(key)) {
    const error = new Error('Checkout idempotency key must be 8-100 characters using letters, numbers, hyphens or underscores.');
    error.statusCode = 400;
    throw error;
  }
  return key;
}

function checkoutFingerprint(payload = {}) {
  const customer = payload.customer || {};
  const stable = {
    items: (Array.isArray(payload.items) ? payload.items : []).map(item => ({
      productId: item.productId,
      variantId: item.variantId || null,
      quantity: Number(item.quantity)
    })),
    customer: {
      name: String(customer.name || '').trim(),
      phone: String(customer.phone || '').trim(),
      email: String(customer.email || '').trim(),
      city: String(customer.city || '').trim(),
      address: String(customer.address || '').trim(),
      postalCode: String(customer.postalCode || '').trim()
    },
    paymentMethod: payload.paymentMethod || 'cod',
    deliverySpeed: payload.deliverySpeed || 'standard',
    couponCode: payload.couponCode || null,
    notes: String(payload.notes || '').trim()
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function paymentBlocksFulfillment(order) {
  if (order.payment_review || ['reversed', 'disputed'].includes(order.payment_status)) return true;
  if (order.payment_method === 'cod') return false;
  return Number(order.advance_payment_due) > 0
    ? !['paid', 'partially_paid'].includes(order.payment_status)
    : order.payment_status !== 'paid';
}

async function persistNotification(connection, recipientId, audience, type, title, message, orderId) {
  const id = `notif-${crypto.randomUUID()}`;
  await connection.query(
    `INSERT INTO notifications (id, recipient_id, audience, type, title, message, order_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, recipientId, audience, type, title, message, orderId]
  );
  return { id, recipientId };
}

function emitPersistedNotification(notification) {
  try {
    getIO().to(`user:${notification.recipientId}`).emit(SOCKET_EVENTS.NOTIFICATION_NEW, {
      id: notification.id
    });
  } catch (error) {
    logger.error('Failed to broadcast notification.', {
      notificationId: notification.id,
      message: error.message
    });
  }
}

export class OrderService {
  /**
   * In-memory test store fallback when MySQL connection is unavailable in unit tests
   */
  static mockOrders = new Map();
  static mockCheckouts = new Map();

  static async getConnectionOrNull() {
    try {
      return await pool.getConnection();
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Format one seller-wise advance-payment row. Each row belongs to one seller (admin_id)
   * and carries that seller's bank details, amount due, proof fields and verification state.
   */
  static mapAdvancePayment(row) {
    if (!row) return null;
    return {
      id: row.id,
      adminId: row.admin_id || null,
      sellerName: row.seller_name || null,
      amountDue: Number(row.amount_due || 0),
      amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
      status: row.status,
      bankName: row.bank_name || null,
      bankAccountTitle: row.bank_account_title || null,
      bankAccountNumber: row.bank_account_number || null,
      paymentPlatform: row.payment_platform || null,
      accountHolderName: row.account_holder_name || null,
      transactionReference: row.transaction_reference || null,
      hasImage: Boolean(row.image_storage_path),
      submittedAt: row.submitted_at || null,
      verifiedAt: row.verified_at || null,
      rejectionReason: row.rejection_reason || null
    };
  }

  static async getAdvancePayments(orderId, executor = pool) {
    try {
      const [rows] = await executor.query(`
        SELECT opp.*, COALESCE(u.full_name, u.name) AS seller_name,
               u.bank_name, u.bank_account_title, u.bank_account_number
        FROM order_payment_proofs opp
        LEFT JOIN users u ON u.id = opp.admin_id
        WHERE opp.order_id = ?
        ORDER BY opp.created_at ASC, opp.id ASC
      `, [orderId]);
      return rows.map(row => this.mapAdvancePayment(row));
    } catch (error) {
      logger.warn('Could not load seller advance payments.', {
        orderId,
        message: error.message
      });
      return [];
    }
  }

  static async getAdminAdvancePayment(orderId, adminId, executor = pool) {
    try {
      const [rows] = await executor.query(`
        SELECT opp.*, COALESCE(u.full_name, u.name) AS seller_name,
               u.bank_name, u.bank_account_title, u.bank_account_number
        FROM order_payment_proofs opp
        LEFT JOIN users u ON u.id = opp.admin_id
        WHERE opp.order_id = ? AND opp.admin_id = ?
        LIMIT 1
      `, [orderId, adminId]);
      return rows.length ? this.mapAdvancePayment(rows[0]) : null;
    } catch (error) {
      logger.warn('Could not load admin advance payment.', {
        orderId,
        adminId,
        message: error.message
      });
      return null;
    }
  }

  /**
   * Create one advance-payment row per seller when an order is placed.
   * pricing.items already carries the discount-adjusted lineAdvance and the seller id.
   */
  static async createAdvancePaymentRows(connection, orderId, items = []) {
    const byAdmin = new Map();
    for (const item of items) {
      const amount = Number(item.lineAdvance || 0);
      if (!(amount > 0) || !item.adminId) continue;
      byAdmin.set(item.adminId, Math.round(((byAdmin.get(item.adminId) || 0) + amount) * 100) / 100);
    }
    const created = [];
    for (const [adminId, amountDue] of byAdmin) {
      const id = `adv-${crypto.randomUUID()}`;
      await connection.query(`
        INSERT INTO order_payment_proofs
          (id, order_id, admin_id, amount_due, amount, status, created_at)
        VALUES (?, ?, ?, ?, NULL, 'awaiting_proof', NOW())
      `, [id, orderId, adminId, amountDue]);
      created.push({ id, adminId, amountDue });
    }
    return created;
  }

  /**
   * Recalculate the order-level payment/order state after any seller-wise change.
   * The order is only confirmed once every seller's advance row is verified.
   */
  static async recomputeOrderAdvanceStatus(connection, orderId) {
    const [advances] = await connection.query(
      'SELECT status FROM order_payment_proofs WHERE order_id = ?',
      [orderId]
    );
    const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!orders.length) return null;
    const order = orders[0];
    if (!advances.length) {
      return { paymentStatus: order.payment_status, orderStatus: order.order_status };
    }

    const statuses = advances.map(row => row.status);
    const allVerified = statuses.every(status => status === 'verified');
    const anyVerified = statuses.some(status => status === 'verified');
    const anyPending = statuses.some(status => ['awaiting_proof', 'verification_pending'].includes(status));
    const anyRejected = statuses.some(status => status === 'rejected');
    const allExpired = statuses.every(status => status === 'expired');

    let paymentStatus;
    if (allVerified) {
      paymentStatus = Number(order.cod_remaining_due) > 0 ? 'partially_paid' : 'paid';
    } else if (anyVerified) {
      paymentStatus = 'partially_paid';
    } else if (anyPending) {
      paymentStatus = statuses.includes('verification_pending') ? 'verification_pending' : 'awaiting_proof';
    } else if (anyRejected) {
      paymentStatus = 'rejected';
    } else if (allExpired) {
      paymentStatus = 'expired';
    } else {
      paymentStatus = order.payment_status;
    }

    const nextOrderStatus = allVerified && ['placed', 'confirmed'].includes(order.order_status)
      ? 'confirmed'
      : order.order_status;
    await connection.query(
      'UPDATE orders SET payment_status = ?, order_status = ?, payment_review = FALSE WHERE id = ?',
      [paymentStatus, nextOrderStatus, orderId]
    );
    if (nextOrderStatus !== order.order_status) {
      await connection.query(`
        INSERT INTO order_status_history
          (order_id, previous_status, new_status, actor, actor_role, reason)
        VALUES (?, ?, ?, 'System', 'system', 'All seller advance payments verified')
      `, [orderId, order.order_status, nextOrderStatus]);
    }
    return { paymentStatus, orderStatus: nextOrderStatus };
  }

  static async submitPaymentProof(orderId, userId, proof) {
    const connection = await this.getConnectionOrNull();
    if (!connection) {
      const error = new Error('Payment proof submission is temporarily unavailable.');
      error.statusCode = 503;
      throw error;
    }

    let notifications = [];
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
      if (!orders.length) {
        const error = new Error('Order not found.');
        error.statusCode = 404;
        throw error;
      }
      const order = orders[0];
      if ((order.customer_id || order.user_id) !== userId) {
        const error = new Error('You do not own this order.');
        error.statusCode = 403;
        throw error;
      }
      if (Number(order.advance_payment_due) <= 0) {
        const error = new Error('This order does not require advance payment proof.');
        error.statusCode = 400;
        throw error;
      }
      const adminId = String(proof.adminId || '').trim();
      if (!adminId) {
        const error = new Error('Select the seller whose advance payment you are submitting.');
        error.statusCode = 400;
        throw error;
      }
      const [advanceRows] = await connection.query(
        'SELECT * FROM order_payment_proofs WHERE order_id = ? AND admin_id = ? FOR UPDATE',
        [orderId, adminId]
      );
      if (!advanceRows.length) {
        const error = new Error('No advance payment is due to this seller for this order.');
        error.statusCode = 404;
        throw error;
      }
      const advance = advanceRows[0];
      if (['cancelled', 'returned', 'delivered', 'expired'].includes(order.order_status) ||
          order.payment_status === 'expired' ||
          (order.expires_at && new Date(order.expires_at).getTime() <= Date.now())) {
        const error = new Error('The proof submission period for this order has expired.');
        error.statusCode = 410;
        throw error;
      }
      if (!['awaiting_proof', 'rejected'].includes(advance.status)) {
        const error = new Error('Payment proof for this seller has already been submitted and is awaiting Admin review.');
        error.statusCode = 409;
        throw error;
      }

      const amountDue = Number(advance.amount_due || 0);
      const amountCents = Math.round(Number(proof.amount) * 100);
      if (!Number.isFinite(amountCents) || amountCents !== Math.round(amountDue * 100)) {
        const error = new Error(`Payment proof amount must exactly match this seller's advance of PKR ${amountDue.toFixed(2)}.`);
        error.statusCode = 400;
        throw error;
      }
      const accountHolderName = String(proof.accountHolderName || '').trim();
      const rawPlatform = String(proof.paymentPlatform || '').trim();
      const platformKey = rawPlatform.toLowerCase().replace(/[\s_-]/g, '');
      const paymentPlatform = {
        banktransfer: 'Bank Transfer',
        easypaisa: 'EasyPaisa',
        jazzcash: 'JazzCash'
      }[platformKey] || rawPlatform;
      const transactionReference = String(proof.transactionReference || '').trim();
      if (!accountHolderName || !paymentPlatform || !transactionReference || !proof.imageStoragePath) {
        const error = new Error('Account holder name, payment platform, transaction reference, amount, and proof image are required.');
        error.statusCode = 400;
        throw error;
      }
      // Bank details are maintained per seller (users.bank_*), not in global store settings.
      // The seller verifies the transaction manually in their own bank account, so any
      // platform the customer actually used is accepted here.

      const [duplicateReferences] = await connection.query(
        'SELECT id FROM order_payment_proofs WHERE payment_platform = ? AND transaction_reference = ? LIMIT 1',
        [paymentPlatform, transactionReference]
      );
      if (duplicateReferences.length) {
        const error = new Error('This payment transaction reference has already been submitted.');
        error.statusCode = 409;
        throw error;
      }

      const proofId = advance.id;
      await connection.query(`
        UPDATE order_payment_proofs
        SET image_storage_path = ?, account_holder_name = ?, payment_platform = ?,
            transaction_reference = ?, amount = ?, status = 'verification_pending',
            submitted_at = NOW(), verified_by = NULL, verified_at = NULL, rejection_reason = NULL
        WHERE id = ?
      `, [proof.imageStoragePath, accountHolderName, paymentPlatform, transactionReference, amountDue, proofId]);
      await connection.query(
        `INSERT INTO order_payment_proof_history
          (payment_proof_id, order_id, previous_status, new_status, actor_id, actor_role, reason)
         VALUES (?, ?, ?, 'verification_pending', ?, 'customer', 'Customer submitted payment proof')`,
        [proofId, orderId, advance.status, userId]
      );
      const recomputed = await this.recomputeOrderAdvanceStatus(connection, orderId);
      await connection.query(
        `INSERT INTO order_payment_status_history
          (order_id, previous_status, new_status, actor_id, actor_role, reason)
         VALUES (?, ?, ?, ?, 'customer', 'Customer submitted advance payment proof for one seller')`,
        [orderId, order.payment_status, recomputed.paymentStatus, userId]
      );
      notifications.push(await persistNotification(
        connection,
        adminId,
        'admin',
        'payment',
        `Advance payment proof for ${orderId}`,
        `${order.customer_name} submitted PKR ${amountDue.toFixed(2)} via ${paymentPlatform}. Reference: ${transactionReference}. Status: verification pending.`,
        orderId
      ));

      await connection.commit();
      notifications.forEach(emitPersistedNotification);
      return { proofId, orderId, adminId, paymentStatus: recomputed.paymentStatus, proofStatus: 'verification_pending' };
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') {
        error.statusCode = 409;
        error.message = 'This payment transaction reference has already been submitted.';
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  static async reviewPaymentProof(orderId, proofId, adminId, status, reason = '') {
    if (!['verified', 'rejected'].includes(status)) {
      const error = new Error('Proof review status must be verified or rejected.');
      error.statusCode = 400;
      throw error;
    }
    if (status === 'rejected' && !String(reason).trim()) {
      const error = new Error('A rejection reason is required.');
      error.statusCode = 400;
      throw error;
    }

    const connection = await this.getConnectionOrNull();
    if (!connection) {
      const error = new Error('Payment proof review is temporarily unavailable.');
      error.statusCode = 503;
      throw error;
    }

    let notification = null;
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
      if (!orders.length) {
        const error = new Error('Order not found.');
        error.statusCode = 404;
        throw error;
      }
      const [proofs] = await connection.query(
        'SELECT * FROM order_payment_proofs WHERE id = ? AND order_id = ? AND admin_id = ? FOR UPDATE',
        [proofId, orderId, adminId]
      );
      if (!proofs.length) {
        const error = new Error('Payment proof not found for this order.');
        error.statusCode = 404;
        throw error;
      }
      const proof = proofs[0];
      if (proof.status !== 'verification_pending') {
        const error = new Error('Only a pending payment proof can be reviewed.');
        error.statusCode = 409;
        throw error;
      }
      const order = orders[0];
      const previousStatus = order.payment_status;

      await connection.query(`
        UPDATE order_payment_proofs
        SET status = ?, verified_by = ?, verified_at = NOW(), rejection_reason = ?
        WHERE id = ?
      `, [status, adminId, status === 'rejected' ? String(reason).trim() : null, proofId]);
      await connection.query(`
        INSERT INTO order_payment_proof_history
          (payment_proof_id, order_id, previous_status, new_status, actor_id, actor_role, reason)
        VALUES (?, ?, 'verification_pending', ?, ?, 'admin', ?)
      `, [proofId, orderId, status, adminId, String(reason).trim() || null]);
      const recomputed = await this.recomputeOrderAdvanceStatus(connection, orderId);
      await connection.query(`
        INSERT INTO order_payment_status_history
          (order_id, previous_status, new_status, actor_id, actor_role, reason)
        VALUES (?, ?, ?, ?, 'admin', ?)
      `, [orderId, previousStatus, recomputed.paymentStatus, adminId, String(reason).trim() || `Payment proof ${status} for seller`]);

      const customerId = order.customer_id || order.user_id;
      if (customerId) {
        notification = await persistNotification(
          connection,
          customerId,
          'customer',
          'payment',
          status === 'verified' ? 'Advance payment verified' : 'Payment proof needs correction',
          status === 'verified'
            ? (recomputed.orderStatus === 'confirmed'
                ? `All seller advance payments for order ${orderId} are verified. The order is confirmed.`
                : `One seller payment for order ${orderId} was manually verified. Other seller payments may still be pending.`)
            : `Your payment proof for order ${orderId} was rejected. ${String(reason).trim()}`,
          orderId
        );
      }
      await connection.commit();
      if (notification) emitPersistedNotification(notification);
      emitOrderStatusChanged(orderId, {
        orderId,
        paymentStatus: recomputed.paymentStatus,
        orderStatus: recomputed.orderStatus,
        proofStatus: status,
        timestamp: new Date().toISOString()
      }, customerId);
      return { orderId, proofId, proofStatus: status, paymentStatus: recomputed.paymentStatus, orderStatus: recomputed.orderStatus };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async confirmAdvancePayment(orderId, adminId, details = {}) {
    const {
      transactionReference = '',
      accountHolderName = '',
      paymentPlatform = '',
      amount = null,
      note = ''
    } = details;

    const connection = await this.getConnectionOrNull();
    const finalTxRef = String(transactionReference || '').trim() || `ADV-${Date.now().toString().slice(-6)}`;
    const finalHolder = String(accountHolderName || '').trim();
    const finalPlatform = String(paymentPlatform || '').trim() || 'Bank Transfer';

    if (!connection) {
      const order = this.mockOrders.get(orderId);
      if (!order) {
        const error = new Error('Order not found.');
        error.statusCode = 404;
        throw error;
      }
      const finalAmount = Number(amount) > 0 ? Number(amount) : Number(order.advance_payment_due || 0);
      const nextPaymentStatus = Number(order.cod_remaining_due) > 0 ? 'partially_paid' : 'paid';
      order.payment_status = nextPaymentStatus;
      order.order_status = 'confirmed';
      order.latest_proof_id = 'proof-manual';
      order.latest_proof_status = 'verified';
      order.latest_proof_transaction_reference = finalTxRef;
      order.latest_proof_account_holder_name = finalHolder || order.customer_name || 'Customer';
      order.latest_proof_payment_platform = finalPlatform;
      order.latest_proof_amount = finalAmount;
      return {
        orderId,
        proofId: 'proof-manual',
        paymentStatus: nextPaymentStatus,
        orderStatus: 'confirmed',
        proofStatus: 'verified',
        transactionReference: finalTxRef,
        accountHolderName: finalHolder || order.customer_name || 'Customer',
        paymentPlatform: finalPlatform,
        amount: finalAmount
      };
    }

    let notification = null;
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
      if (!orders.length) {
        const error = new Error('Order not found.');
        error.statusCode = 404;
        throw error;
      }
      const order = orders[0];
      const [advanceRows] = await connection.query(
        'SELECT * FROM order_payment_proofs WHERE order_id = ? AND admin_id = ? FOR UPDATE',
        [orderId, adminId]
      );
      if (!advanceRows.length) {
        const error = new Error('No advance payment is due to your account for this order.');
        error.statusCode = 404;
        throw error;
      }
      const advance = advanceRows[0];
      const advanceDue = Number(advance.amount_due || 0);
      if (advanceDue <= 0) {
        const error = new Error('This order does not have an advance payment requirement for your account.');
        error.statusCode = 400;
        throw error;
      }

      const finalAmount = Number(amount) > 0 ? Number(amount) : advanceDue;
      const resolvedHolder = finalHolder || order.customer_name || 'Customer';
      const proofId = advance.id;

      await connection.query(`
        UPDATE order_payment_proofs
        SET status = 'verified',
            transaction_reference = ?,
            account_holder_name = ?,
            payment_platform = ?,
            amount = ?,
            submitted_at = COALESCE(submitted_at, NOW()),
            verified_by = ?,
            verified_at = NOW(),
            rejection_reason = NULL
        WHERE id = ?
      `, [finalTxRef, resolvedHolder, finalPlatform, finalAmount, adminId, proofId]);

      await connection.query(`
        INSERT INTO order_payment_proof_history
          (payment_proof_id, order_id, previous_status, new_status, actor_id, actor_role, reason)
        VALUES (?, ?, ?, 'verified', ?, 'admin', ?)
      `, [proofId, orderId, advance.status, adminId, note || 'Advance payment confirmed manually by admin']);

      // Record in payment_transactions
      const [payments] = await connection.query(
        'SELECT * FROM payment_transactions WHERE order_id = ? ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
        [orderId]
      );
      // payment_transactions tracks the gateway/ledger transaction, not the order payment status.
      // A verified advance (full or partial) is a completed transaction in this ledger.
      if (!payments.length) {
        const transactionId = `payment-${crypto.randomUUID()}`;
        await connection.query(
          `INSERT INTO payment_transactions (id, order_id, provider, transaction_ref, amount, currency, status)
           VALUES (?, ?, ?, ?, ?, 'PKR', ?)`,
          [transactionId, orderId, finalPlatform, finalTxRef, finalAmount, 'completed']
        );
      } else {
        await connection.query(
          'UPDATE payment_transactions SET status = ?, provider = ?, transaction_ref = ? WHERE id = ?',
          ['completed', finalPlatform, finalTxRef, payments[0].id]
        );
      }

      const previousStatus = order.payment_status;
      const recomputed = await this.recomputeOrderAdvanceStatus(connection, orderId);
      await connection.query(`
        INSERT INTO order_payment_status_history
          (order_id, previous_status, new_status, actor_id, actor_role, reason)
        VALUES (?, ?, ?, ?, 'admin', ?)
      `, [orderId, previousStatus, recomputed.paymentStatus, adminId, note || 'Advance payment manually verified by admin']);

      const customerId = order.customer_id || order.user_id;
      if (customerId) {
        notification = await persistNotification(
          connection,
          customerId,
          'customer',
          'payment',
          'Advance payment confirmed',
          `Your advance payment of PKR ${finalAmount.toLocaleString()} via ${finalPlatform} (Ref: ${finalTxRef}) has been confirmed for one seller. ${recomputed.orderStatus === 'confirmed' ? `All seller payments are verified and order ${orderId} is confirmed.` : `Order ${orderId} will be confirmed after the remaining seller payments are verified.`}`,
          orderId
        );
      }

      await connection.commit();
      if (notification) emitPersistedNotification(notification);
      emitOrderStatusChanged(orderId, {
        orderId,
        paymentStatus: recomputed.paymentStatus,
        orderStatus: recomputed.orderStatus,
        proofStatus: 'verified',
        timestamp: new Date().toISOString()
      }, customerId);

      return {
        orderId,
        proofId,
        paymentStatus: recomputed.paymentStatus,
        orderStatus: recomputed.orderStatus,
        proofStatus: 'verified',
        transactionReference: finalTxRef,
        accountHolderName: resolvedHolder,
        paymentPlatform: finalPlatform,
        amount: finalAmount
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async hideCancelledOrder(orderId, userId) {
    const [result] = await pool.query(`
      UPDATE orders
      SET customer_hidden_at = NOW()
      WHERE id = ?
        AND (customer_id = ? OR user_id = ?)
        AND order_status = 'cancelled'
    `, [orderId, userId, userId]);
    if (!result.affectedRows) {
      const error = new Error('Only your cancelled orders can be hidden.');
      error.statusCode = 404;
      throw error;
    }
    return { orderId, hidden: true };
  }

  static async expireUnpaidAdvanceOrders() {
    const connection = await this.getConnectionOrNull();
    if (!connection) return 0;
    let expiredCount = 0;
    const stockChanges = [];
    const notifications = [];
    const expiredOrders = [];
    try {
      await connection.beginTransaction();
      const [orders] = await connection.query(`
        SELECT * FROM orders
        WHERE payment_status IN ('awaiting_proof', 'verification_pending', 'rejected')
          AND advance_payment_due > 0
          AND expires_at IS NOT NULL AND expires_at <= NOW()
          AND order_status NOT IN ('cancelled', 'returned', 'delivered', 'expired')
        ORDER BY expires_at ASC
        LIMIT 25
        FOR UPDATE
      `);
      for (const order of orders) {
        const previousOrderStatus = order.order_status;
        await connection.query(
          "UPDATE orders SET order_status = 'expired', payment_status = 'expired' WHERE id = ?",
          [order.id]
        );
        await connection.query(
          "UPDATE order_payment_proofs SET status = 'expired' WHERE order_id = ? AND status IN ('awaiting_proof', 'verification_pending', 'rejected')",
          [order.id]
        );
        stockChanges.push(...await InventoryService.restoreOrderStock(connection, order.id));
        await connection.query(`
          INSERT INTO order_status_history
            (order_id, previous_status, new_status, actor, actor_role, reason)
          VALUES (?, ?, 'expired', 'System', 'system', 'Advance payment proof was not approved within 36 hours')
        `, [order.id, previousOrderStatus]);
        await connection.query(`
          INSERT INTO order_payment_status_history
            (order_id, previous_status, new_status, actor_role, reason)
          VALUES (?, ?, 'expired', 'system', 'Advance payment proof was not approved within 36 hours')
        `, [order.id, order.payment_status]);
        const customerId = order.customer_id || order.user_id;
        if (customerId) {
          notifications.push(await persistNotification(
            connection,
            customerId,
            'customer',
            'payment',
            `Order ${order.id} expired`,
            `Order ${order.id} expired because its advance payment was not approved within 36 hours.`,
            order.id
          ));
        }
        expiredOrders.push({
          id: order.id,
          previousStatus: previousOrderStatus,
          customerId
        });
        expiredCount += 1;
      }
      await connection.commit();
      InventoryService.emitStockChanges(stockChanges);
      notifications.forEach(emitPersistedNotification);
      // The expiry sweep runs on a timer (no HTTP request), so admins only learn
      // about it through this socket broadcast.
      for (const expired of expiredOrders) {
        emitOrderStatusChanged(expired.id, {
          orderId: expired.id,
          previousStatus: expired.previousStatus,
          newStatus: 'expired',
          paymentStatus: 'expired',
          reason: 'Advance payment proof was not approved within 36 hours',
          timestamp: new Date().toISOString()
        }, expired.customerId || null);
      }
      return expiredCount;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Safe Order Formatter
   */
  static formatOrder(orderRow, items = [], history = [], { includeCostSnapshot = false, forAdmin = false, advancePaymentInstructions = [], advancePayments = [], adminAdvancePayment = null } = {}) {
    if (!orderRow) return null;
    const advancePaymentDue = parseFloat(orderRow.advance_payment_due || 0);
    const detailsLocked = false;
    const paymentProofRow = adminAdvancePayment || (advancePayments.length === 1 ? advancePayments[0] : null);
    const advanceStatus = adminAdvancePayment
      ? adminAdvancePayment.status
      : (advancePayments.length
          ? (advancePayments.every(row => row.status === 'verified') ? 'verified'
            : advancePayments.some(row => row.status === 'verification_pending') ? 'verification_pending'
            : advancePayments.some(row => row.status === 'rejected') ? 'rejected'
            : advancePayments.every(row => row.status === 'expired') ? 'expired'
            : 'awaiting_proof')
          : (orderRow.payment_status === 'expired' ? 'expired' : null));
    const dueForViewer = adminAdvancePayment ? Number(adminAdvancePayment.amountDue || 0) : advancePaymentDue;
    const customer = {
      name: detailsLocked ? 'Advance payment required' : orderRow.customer_name,
      phone: detailsLocked ? '' : orderRow.customer_phone,
      email: detailsLocked ? '' : orderRow.customer_email,
      city: detailsLocked ? '' : orderRow.customer_city,
      address: detailsLocked ? '' : orderRow.customer_address,
      postalCode: detailsLocked ? '' : orderRow.customer_postal_code || undefined
    };
    return {
      id: orderRow.id,
      userId: orderRow.user_id || undefined,
      user_id: orderRow.user_id || undefined,
      customer,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      customerCity: customer.city,
      customerAddress: customer.address,
      paymentMethod: orderRow.payment_method,
      paymentStatus: orderRow.payment_status || 'pending',
      paymentReview: Boolean(orderRow.payment_review),
      orderStatus: orderRow.order_status,
      order_status: orderRow.order_status,
      subtotal: parseFloat(orderRow.subtotal),
      discountAmount: parseFloat(orderRow.discount_amount || 0),
      shipping: parseFloat(orderRow.shipping || 0),
      total: parseFloat(orderRow.total),
      advancePaymentDue: dueForViewer,
      codRemainingDue: parseFloat(orderRow.cod_remaining_due || 0),
      expiresAt: orderRow.expires_at ? new Date(orderRow.expires_at).toISOString() : undefined,
      transactionReference: paymentProofRow?.transactionReference || orderRow.transaction_reference || undefined,
      accountHolderName: paymentProofRow?.accountHolderName || orderRow.account_holder_name || undefined,
      paymentPlatform: paymentProofRow?.paymentPlatform || orderRow.payment_platform || undefined,
      paymentProof: paymentProofRow ? {
        id: paymentProofRow.id,
        status: paymentProofRow.status,
        accountHolderName: paymentProofRow.accountHolderName || undefined,
        paymentPlatform: paymentProofRow.paymentPlatform || undefined,
        transactionReference: paymentProofRow.transactionReference || undefined,
        amount: paymentProofRow.amount === null || paymentProofRow.amount === undefined ? undefined : Number(paymentProofRow.amount),
        hasImage: Boolean(paymentProofRow.hasImage),
        submittedAt: paymentProofRow.submittedAt
          ? new Date(paymentProofRow.submittedAt).toISOString()
          : undefined,
        rejectionReason: paymentProofRow.rejectionReason || undefined
      } : undefined,
      advancePayments,
      adminAdvancePayment: adminAdvancePayment || null,
      advanceStatus,
      advancePaymentInstructions,
      customerDetailsLocked: detailsLocked,
      deliverySpeed: orderRow.delivery_speed || 'standard',
      urgentDeliveryFee: parseFloat(orderRow.urgent_delivery_fee || 0),
      courierPartner: orderRow.courier_partner || undefined,
      trackingNumber: orderRow.tracking_number || undefined,
      courierStatusNote: orderRow.courier_status_note || undefined,
      cancellationReason: orderRow.cancellation_reason || undefined,
      notes: orderRow.notes || undefined,
      createdAt: orderRow.created_at ? new Date(orderRow.created_at).toISOString() : new Date().toISOString(),
      updatedAt: orderRow.updated_at ? new Date(orderRow.updated_at).toISOString() : new Date().toISOString(),
      deliveredAt: orderRow.delivered_at ? new Date(orderRow.delivered_at).toISOString() : undefined,
      items: items.map(it => {
        const formattedItem = {
          id: it.id,
          productId: it.product_id,
          adminId: it.admin_id || undefined,
          productName: it.product_name,
          variantId: it.variant_id || undefined,
          variantName: it.variant_name || undefined,
          price: parseFloat(it.price),
          quantity: parseInt(it.quantity, 10),
          imageUrl: it.image_url || undefined,
          lineTotal: Math.round(parseFloat(it.price) * parseInt(it.quantity, 10) * 100) / 100
        };
        if (includeCostSnapshot) {
          formattedItem.costPriceSnapshot = it.cost_price === null || it.cost_price === undefined
            ? undefined
            : Number(it.cost_price);
        }
        return formattedItem;
      }),
      history: history.map(h => ({
        id: h.id,
        previousStatus: h.previous_status,
        newStatus: h.new_status,
        actor: h.actor,
        actorRole: h.actor_role,
        reason: h.reason,
        timestamp: h.created_at ? new Date(h.created_at).toISOString() : new Date().toISOString()
      }))
    };
  }

  static checkoutConflict(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
  }

  static buildPlaceOrderReplay(row, items = []) {
    const shipping = Number(row.shipping || 0);
    return {
      orderId: row.id,
      orderStatus: row.order_status,
      paymentStatus: row.payment_status,
      paymentMethod: row.payment_method,
      status: row.order_status,
      customer: {
        name: row.customer_name,
        phone: row.customer_phone,
        email: row.customer_email,
        city: row.customer_city,
        address: row.customer_address,
        postalCode: row.customer_postal_code || undefined
      },
      pricing: {
        subtotal: Number(row.subtotal || 0),
        discountAmount: Number(row.discount_amount || 0),
        shippingFee: shipping,
        totalShipping: shipping,
        total: Number(row.total || 0),
        advancePaymentDue: Number(row.advance_payment_due || 0),
        codRemainingDue: Number(row.cod_remaining_due || 0),
        urgentFee: Number(row.urgent_delivery_fee || 0),
        items: items.map(item => ({
          productId: item.product_id,
          variantId: item.variant_id || null,
          name: item.product_name,
          unitPrice: Number(item.price || 0),
          quantity: Number(item.quantity || 0),
          lineTotal: Math.round(Number(item.price || 0) * Number(item.quantity || 0) * 100) / 100
        }))
      },
      guestAccessToken: row.guest_access_token || undefined,
      idempotentReplay: true
    };
  }

  static async findCheckoutReplay(executor, checkoutKey, requestHash, userId) {
    if (!checkoutKey) return null;
    const [rows] = await executor.query(
      'SELECT * FROM orders WHERE checkout_key = ? LIMIT 1',
      [checkoutKey]
    );
    if (!rows.length) return null;
    const order = rows[0];
    if (order.checkout_request_hash !== requestHash) {
      throw this.checkoutConflict('This checkout idempotency key was already used with different order details.');
    }
    const ownerId = order.customer_id || order.user_id || null;
    if (ownerId !== (userId || null)) {
      throw this.checkoutConflict('This checkout idempotency key belongs to a different customer session.');
    }
    const [items] = await executor.query(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC',
      [order.id]
    );
    return this.buildPlaceOrderReplay(order, items);
  }

  /**
   * Place an order transactionally with immediate stock deduction and authoritative pricing.
   * The optional X-Client-Order-Id key makes retries return the first order instead
   * of creating a second order or deducting stock twice.
   */
  static async placeOrder(orderPayload, userId = null, checkout = {}) {
    const {
      items,
      customer,
      paymentMethod = 'cod',
      deliverySpeed = 'standard',
      couponCode = null,
      notes = ''
    } = orderPayload;

    const checkoutKey = normalizeCheckoutKey(checkout?.key ?? orderPayload?.checkoutKey);
    const checkoutRequestHash = checkoutKey ? checkoutFingerprint(orderPayload) : null;

    if (checkoutKey) {
      const mock = this.mockCheckouts.get(checkoutKey);
      if (mock) {
        if (mock.requestHash !== checkoutRequestHash) {
          throw this.checkoutConflict('This checkout idempotency key was already used with different order details.');
        }
        if ((mock.userId || null) !== (userId || null)) {
          throw this.checkoutConflict('This checkout idempotency key belongs to a different customer session.');
        }
        const mockOrder = this.mockOrders.get(mock.orderId);
        if (mockOrder) return this.buildPlaceOrderReplay(mockOrder, mockOrder.items || []);
      }

      const lookupConnection = await this.getConnectionOrNull();
      if (lookupConnection) {
        try {
          const replay = await this.findCheckoutReplay(
            lookupConnection,
            checkoutKey,
            checkoutRequestHash,
            userId
          );
          if (replay) return replay;
        } finally {
          lookupConnection.release();
        }
      }
    }

    if (!items || !items.length) {
      const error = new Error('Order must contain at least one item.');
      error.statusCode = 400;
      error.isOperational = true;
      throw error;
    }
    if (!customer || !customer.name || !customer.phone || !customer.city || !customer.address) {
      const error = new Error('Complete customer details (name, phone, city, address) are required.');
      error.statusCode = 400;
      error.isOperational = true;
      throw error;
    }
    // 1. Calculate authoritative server pricing
    const pricing = await PricingService.calculateOrderTotals(items, {
      couponCode,
      deliverySpeed,
      city: customer.city
    });
    const requiresAdvance = pricing.advancePaymentDue > 0;
    const normalizedPaymentMethod = requiresAdvance ? 'bank_transfer' : (paymentMethod || 'cod');
    const initialPaymentStatus = requiresAdvance ? 'awaiting_proof' : 'pending';
    const orderId = `AUK-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
    const guestAccessToken = !userId ? crypto.randomBytes(24).toString('hex') : null;

    const connection = await this.getConnectionOrNull();
    let stockChanges = [];
    let persistedNotifications = [];
    if (connection) {
      try {
        await connection.beginTransaction();

        // Validate userId if provided (must exist in users table for FK constraint)
        let effectiveUserId = null;
        if (userId) {
          const [uCheck] = await connection.query('SELECT id FROM users WHERE id = ?', [userId]);
          if (uCheck.length > 0) {
            effectiveUserId = userId;
          }
        }
        if (requiresAdvance) {
          try {
            const sellerIds = [...new Set(pricing.items.map(item => item.adminId).filter(Boolean))];
            if (sellerIds.length) {
              const placeholders = sellerIds.map(() => '?').join(', ');
              const [sellers] = await connection.query(
                `SELECT id FROM users
                 WHERE id IN (${placeholders})
                   AND (bank_account_number IS NULL OR bank_account_number = ''
                        OR bank_name IS NULL OR bank_name = '')`,
                sellerIds
              );
              if (sellers.length) {
                logger.warn('Advance payment order has sellers without bank details.', {
                  orderId,
                  sellerIds: sellers.map(row => row.id)
                });
              }
            }
          } catch (e) {
            // Non-blocking: missing bank details must never stop checkout.
          }
        }

        // 2. Insert order FIRST so orderId exists in `orders` for child tables (inventory_reservations, order_items, order_status_history)
        await connection.query(`
          INSERT INTO \`orders\` (
            \`id\`, \`user_id\`, \`customer_id\`, \`guest_access_token\`, \`checkout_key\`, \`checkout_request_hash\`,
            \`customer_name\`, \`customer_phone\`, \`customer_email\`,
            \`customer_city\`, \`customer_address\`, \`customer_postal_code\`, \`payment_method\`,
            \`order_status\`, \`payment_status\`, \`expires_at\`, \`subtotal\`, \`discount_amount\`, \`shipping\`, \`total\`,
            \`advance_payment_due\`, \`cod_remaining_due\`, \`delivery_speed\`, \`urgent_delivery_fee\`,
            \`tracking_number\`, \`notes\`
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'placed', ?, IF(? > 0, DATE_ADD(NOW(), INTERVAL 36 HOUR), NULL), ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        `, [
          orderId, effectiveUserId, effectiveUserId, guestAccessToken, checkoutKey, checkoutRequestHash,
          customer.name.trim(), customer.phone.trim(),
          customer.email ? customer.email.trim() : 'customer@example.com',
          customer.city.trim(), customer.address.trim(), customer.postalCode || '', normalizedPaymentMethod,
          initialPaymentStatus, pricing.advancePaymentDue,
          pricing.subtotal, pricing.discountAmount, pricing.shippingFee, pricing.total,
          pricing.advancePaymentDue, pricing.codRemainingDue, deliverySpeed, pricing.urgentFee,
          notes.trim()
        ]);

        // Deduct stock inside the order transaction; later shipment transitions must not deduct it again.
        stockChanges = await InventoryService.deductStockForOrder(connection, orderId, pricing.items);

        // 4. Insert order items with snapshot pricing and authoritative admin_id
        const advanceItemSellers = [];
        for (const item of pricing.items) {
          let itemAdminId = null;
          if (item.adminId) {
            const [adminCheck] = await connection.query('SELECT id FROM users WHERE id = ?', [item.adminId]);
            if (adminCheck.length > 0) itemAdminId = item.adminId;
          }
          if (itemAdminId) advanceItemSellers.push({ ...item, adminId: itemAdminId });
          await connection.query(`
            INSERT INTO \`order_items\` (\`order_id\`, \`product_id\`, \`admin_id\`, \`product_name\`, \`variant_id\`, \`price\`, \`cost_price\`, \`quantity\`)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `, [orderId, item.productId, itemAdminId, item.name, item.variantId || null, item.unitPrice, item.costPrice, item.quantity]);
        }

        // 4b. One advance-payment row per seller, using the discount-adjusted line advance.
        const advanceRows = await this.createAdvancePaymentRows(connection, orderId, advanceItemSellers);
        if (requiresAdvance && Number(pricing.advancePaymentDue) > 0 && !advanceRows.length) {
          logger.warn('Advance payment is due but no seller advance row could be created. Check product owner/admin ids.', { orderId });
        }

        // 5. Record initial status history
        await connection.query(`
          INSERT INTO \`order_status_history\` (\`order_id\`, \`previous_status\`, \`new_status\`, \`actor\`, \`actor_role\`, \`reason\`)
          VALUES (?, NULL, 'placed', ?, ?, 'Order placed by customer')
        `, [orderId, customer.name.trim(), effectiveUserId ? 'customer' : 'guest']);
        await connection.query(`
          INSERT INTO order_payment_status_history
            (order_id, previous_status, new_status, actor_id, actor_role, reason)
          VALUES (?, NULL, ?, ?, ?, ?)
        `, [
          orderId,
          initialPaymentStatus,
          effectiveUserId,
          effectiveUserId ? 'customer' : 'guest',
          requiresAdvance ? 'Order awaits manual advance-payment proof' : 'Cash on Delivery order placed'
        ]);

        const orderNotificationMessage =
          `${customer.name.trim()} placed order ${orderId} for Rs. ${Number(pricing.total).toLocaleString()}.`;
        if (effectiveUserId) {
          persistedNotifications.push(await persistNotification(
            connection,
            effectiveUserId,
            'customer',
            'order',
            'Order placed successfully',
            `Your order ${orderId} has been placed.`,
            orderId
          ));
        }
        if (requiresAdvance && effectiveUserId) {
          persistedNotifications.push(await persistNotification(
            connection,
            effectiveUserId,
            'customer',
            'payment',
            'Advance payment required',
            `Order ${orderId} needs a manual advance payment to each seller. Open My Orders to view each seller's bank details and submit the payment proof. Your order will only be confirmed after the seller verifies it.`,
            orderId
          ));
        }
        const adminIds = [...new Set(pricing.items.map(item => item.adminId).filter(Boolean))];
        for (const adminId of adminIds) {
          const [adminRows] = await connection.query('SELECT id FROM users WHERE id = ? AND role = "admin"', [adminId]);
          if (!adminRows.length) continue;
          persistedNotifications.push(await persistNotification(
            connection,
            adminId,
            'admin',
            'order',
            `New order ${orderId}`,
            orderNotificationMessage,
            orderId
          ));
          if (requiresAdvance) {
            const sellerDue = pricing.items
              .filter(item => item.adminId === adminId)
              .reduce((sum, item) => sum + Number(item.lineAdvance || 0), 0);
            persistedNotifications.push(await persistNotification(
              connection,
              adminId,
              'admin',
              'payment',
              `Advance payment pending for ${orderId}`,
              `${customer.name.trim()} must pay PKR ${sellerDue.toLocaleString()} advance to your bank account. Verify the proof in Admin > Advance Payments.`,
              orderId
            ));
          }
        }

        await connection.commit();
      } catch (err) {
        await connection.rollback();
        if (checkoutKey && err.code === 'ER_DUP_ENTRY') {
          const replay = await this.findCheckoutReplay(
            pool,
            checkoutKey,
            checkoutRequestHash,
            userId
          );
          if (replay) return replay;
        }
        throw err;
      } finally {
        connection.release();
      }
    } else {
      // Memory test mode
      stockChanges = await InventoryService.deductStockForOrder(null, orderId, pricing.items);
      this.mockOrders.set(orderId, {
        id: orderId,
        user_id: userId || null,
        customer_id: userId || null,
        guest_access_token: guestAccessToken,
        checkout_key: checkoutKey,
        checkout_request_hash: checkoutRequestHash,
        customer_name: customer.name.trim(),
        customer_phone: customer.phone.trim(),
        customer_email: customer.email ? customer.email.trim() : 'customer@example.com',
        customer_city: customer.city.trim(),
        customer_address: customer.address.trim(),
        customer_postal_code: customer.postalCode || '',
        payment_method: normalizedPaymentMethod,
        payment_status: initialPaymentStatus,
        order_status: 'placed',
        subtotal: pricing.subtotal,
        discount_amount: pricing.discountAmount,
        shipping: pricing.shippingFee,
        total: pricing.total,
        advance_payment_due: pricing.advancePaymentDue,
        cod_remaining_due: pricing.codRemainingDue,
        expires_at: requiresAdvance ? new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString() : null,
        delivery_speed: deliverySpeed,
        urgent_delivery_fee: pricing.urgentFee,
        notes: notes.trim(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        items: pricing.items.map((it, idx) => ({
          id: `item-${idx}`,
          product_id: it.productId,
          admin_id: it.adminId || null,
          product_name: it.name,
          variant_id: it.variantId || null,
          price: it.unitPrice,
          cost_price: it.costPrice,
          quantity: it.quantity
        })),
        history: [
          {
            id: 1,
            previous_status: null,
            new_status: 'placed',
            actor: customer.name.trim(),
            actor_role: userId ? 'customer' : 'guest',
            reason: 'Order placed by customer',
            created_at: new Date().toISOString()
          }
        ]
      });
      if (checkoutKey) {
        this.mockCheckouts.set(checkoutKey, {
          orderId,
          requestHash: checkoutRequestHash,
          userId: userId || null
        });
      }
    }

    InventoryService.emitStockChanges(stockChanges);
    persistedNotifications.forEach(emitPersistedNotification);

    // Notify only merchants whose products are in this order.
    try {
      const io = getIO();
      const adminIds = [...new Set(pricing.items.map(item => item.adminId).filter(Boolean))];
      for (const adminId of adminIds) {
      io.to(`admin:${adminId}`).emit(SOCKET_EVENTS.ORDER_NEW, {
        orderId,
        customerName: customer.name,
        total: pricing.total,
        paymentMethod: normalizedPaymentMethod,
        timestamp: new Date().toISOString()
      });
      }
    } catch (socketErr) {
      logger.warn('Socket broadcast skipped:', socketErr.message);
    }

    const { items: pricedItems, ...publicPricing } = pricing;
    return {
      orderId,
      orderStatus: 'placed',
      paymentStatus: initialPaymentStatus,
      paymentMethod: normalizedPaymentMethod,
      status: 'placed',
      customer,
      pricing: {
        ...publicPricing,
        items: pricedItems.map(({ costPrice, ...item }) => item)
      },
      guestAccessToken: guestAccessToken || undefined
    };
  }

  /**
   * Explicit customer confirmation (Must own order or supply valid guest token)
   */
  static async confirmOrderByCustomer(orderId, userId = null, guestToken = null) {
    const connection = await this.getConnectionOrNull();
    if (connection) {
      try {
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT * FROM `orders` WHERE id = ? FOR UPDATE', [orderId]);
        if (rows.length === 0) {
          const err = new Error(`Order "${orderId}" not found.`);
          err.statusCode = 404;
          throw err;
        }

        const order = rows[0];
        const orderOwnerId = order.customer_id || order.user_id;

        // Check ownership: authenticated order requires authenticated customer match
        if (orderOwnerId) {
          if (!userId) {
            const err = new Error('Authentication required. You must sign in to confirm this order.');
            err.statusCode = 401;
            throw err;
          }
          if (orderOwnerId !== userId) {
            const err = new Error('Forbidden. You do not own this order.');
            err.statusCode = 403;
            throw err;
          }
        } else {
          // Guest order check: requires matching guest token
          if (!guestToken) {
            const err = new Error('Guest access token required to confirm this order.');
            err.statusCode = 401;
            throw err;
          }
          if (order.guest_access_token !== guestToken) {
            const err = new Error('Forbidden. Invalid guest access token for this order.');
            err.statusCode = 403;
            throw err;
          }
        }

        // State machine validation: only 'placed' orders can be confirmed
        if (order.order_status !== 'placed') {
          const err = new Error(`Order cannot be confirmed. Current status is already "${order.order_status}".`);
          err.statusCode = 400;
          throw err;
        }

        await connection.query('UPDATE `orders` SET `order_status` = "confirmed" WHERE id = ?', [orderId]);
        await connection.query(`
          INSERT INTO \`order_status_history\` (\`order_id\`, \`previous_status\`, \`new_status\`, \`actor\`, \`actor_role\`, \`reason\`)
          VALUES (?, 'placed', 'confirmed', ?, ?, 'Explicit client confirmation')
        `, [orderId, order.customer_name, userId ? 'customer' : 'guest']);

        await connection.commit();

        emitOrderStatusChanged(orderId, {
          orderId,
          previousStatus: 'placed',
          newStatus: 'confirmed',
          timestamp: new Date().toISOString()
        }, order.customer_id || order.user_id);

        return { orderId, orderStatus: 'confirmed', status: 'confirmed' };
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } else {
      // Memory mode
      const order = this.mockOrders.get(orderId);
      if (!order) {
        const err = new Error(`Order "${orderId}" not found.`);
        err.statusCode = 404;
        throw err;
      }
      const orderOwnerId = order.customer_id || order.user_id;
      if (orderOwnerId) {
        if (!userId) {
          const err = new Error('Authentication required. You must sign in to confirm this order.');
          err.statusCode = 401;
          throw err;
        }
        if (orderOwnerId !== userId) {
          const err = new Error('Forbidden. You do not own this order.');
          err.statusCode = 403;
          throw err;
        }
      } else {
        if (!guestToken) {
          const err = new Error('Guest access token required to confirm this order.');
          err.statusCode = 401;
          throw err;
        }
        if (order.guest_access_token !== guestToken) {
          const err = new Error('Forbidden. Invalid guest access token for this order.');
          err.statusCode = 403;
          throw err;
        }
      }
      if (order.order_status !== 'placed') {
        const err = new Error(`Order cannot be confirmed. Current status is already "${order.order_status}".`);
        err.statusCode = 400;
        throw err;
      }
      order.order_status = 'confirmed';
      order.history.push({
        id: order.history.length + 1,
        previous_status: 'placed',
        new_status: 'confirmed',
        actor: order.customer_name,
        actor_role: userId ? 'customer' : 'guest',
        reason: 'Explicit client confirmation',
        created_at: new Date().toISOString()
      });
      return { orderId, orderStatus: 'confirmed', status: 'confirmed' };
    }
  }

  /**
   * Customer cancellation with Courier Lock and Ownership Verification
   */
  static async cancelOrder(orderId, actor = 'Customer', actorRole = 'customer', reason = 'Customer requested cancellation', userId = null, guestToken = null) {
    const connection = await this.getConnectionOrNull();
    if (connection) {
      try {
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT * FROM `orders` WHERE id = ? FOR UPDATE', [orderId]);
        if (rows.length === 0) {
          const err = new Error(`Order "${orderId}" not found.`);
          err.statusCode = 404;
          throw err;
        }

        const order = rows[0];
        const orderOwnerId = order.customer_id || order.user_id;

        // 1. STRICT LOCK: Cancellation is forbidden once courier is assigned or order is dispatched
        const lockedStatuses = ['courier_assigned', 'shipped', 'delivered', 'cancelled'];
        if (lockedStatuses.includes(order.order_status)) {
          const err = new Error('Cancellation rejected. Order has already been assigned to courier or dispatched.');
          err.statusCode = 400;
          throw err;
        }

        // 2. Strict ownership verification for non-admin actors
        if (actorRole !== 'admin') {
          if (userId) {
            if (orderOwnerId !== userId) {
              const err = new Error('Forbidden. You do not own this order.');
              err.statusCode = 403;
              throw err;
            }
          } else if (guestToken) {
            if (orderOwnerId || order.guest_access_token !== guestToken) {
              const err = new Error('Forbidden. Invalid guest access token for this order.');
              err.statusCode = 403;
              throw err;
            }
          } else if (actor && orderOwnerId && actor === orderOwnerId) {
            // Actor passed matching user id
          } else if (actor && order.customer_name && actor.trim().toLowerCase() === order.customer_name.trim().toLowerCase()) {
            // Verified customer actor name match in trusted service invocation
          } else {
            const err = new Error('Authentication required. Please sign in to cancel this order.');
            err.statusCode = 401;
            throw err;
          }
        }

        const previousStatus = order.order_status;

        await connection.query(`
          UPDATE \`orders\` 
          SET \`order_status\` = 'cancelled', \`cancellation_reason\` = ? 
          WHERE id = ?
        `, [reason, orderId]);

        const stockChanges = await InventoryService.restoreOrderStock(connection, orderId);

        // Audit trail record
        await connection.query(`
          INSERT INTO \`order_status_history\` (\`order_id\`, \`previous_status\`, \`new_status\`, \`actor\`, \`actor_role\`, \`reason\`)
          VALUES (?, ?, 'cancelled', ?, ?, ?)
        `, [orderId, previousStatus, actor, actorRole, reason]);

        const notifications = [];
        const customerId = order.customer_id || order.user_id;
        if (customerId) {
          notifications.push(await persistNotification(
            connection,
            customerId,
            'customer',
            'order',
            'Order cancelled',
            `Your order ${orderId} was cancelled. ${reason}`,
            orderId
          ));
        }
        if (actorRole !== 'admin') {
          const [adminRows] = await connection.query(`
            SELECT DISTINCT COALESCE(oi.admin_id, p.owner_id, p.admin_id) AS admin_id
            FROM order_items oi
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = ? AND COALESCE(oi.admin_id, p.owner_id, p.admin_id) IS NOT NULL
          `, [orderId]);
          for (const row of adminRows) {
            notifications.push(await persistNotification(
              connection,
              row.admin_id,
              'admin',
              'cancellation',
              `Order ${orderId} cancelled`,
              `${order.customer_name} cancelled the order. ${reason}`,
              orderId
            ));
          }
        }

        await connection.commit();

        emitOrderStatusChanged(orderId, {
          orderId,
          previousStatus,
          newStatus: 'cancelled',
          reason,
          timestamp: new Date().toISOString()
        }, order.customer_id || order.user_id);
        InventoryService.emitStockChanges(stockChanges);
        notifications.forEach(emitPersistedNotification);

        return { orderId, orderStatus: 'cancelled', status: 'cancelled', reason };
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } else {
      // Memory mode
      const order = this.mockOrders.get(orderId);
      if (!order) {
        const err = new Error(`Order "${orderId}" not found.`);
        err.statusCode = 404;
        throw err;
      }
      const orderOwnerId = order.customer_id || order.user_id;

      // 1. STRICT LOCK: Cancellation is forbidden once courier is assigned or order is dispatched
      const lockedStatuses = ['courier_assigned', 'shipped', 'delivered', 'cancelled'];
      if (lockedStatuses.includes(order.order_status)) {
        const err = new Error('Cancellation rejected. Order has already been assigned to courier or dispatched.');
        err.statusCode = 400;
        throw err;
      }

      // 2. Strict ownership verification for non-admin actors
      if (actorRole !== 'admin') {
        if (userId) {
          if (orderOwnerId !== userId) {
            const err = new Error('Forbidden. You do not own this order.');
            err.statusCode = 403;
            throw err;
          }
        } else if (guestToken) {
          if (orderOwnerId || order.guest_access_token !== guestToken) {
            const err = new Error('Forbidden. Invalid guest access token for this order.');
            err.statusCode = 403;
            throw err;
          }
        } else if (actor && orderOwnerId && actor === orderOwnerId) {
          // Actor passed matching user id
        } else if (actor && order.customer_name && actor.trim().toLowerCase() === order.customer_name.trim().toLowerCase()) {
          // Verified customer actor name match in trusted service invocation
        } else {
          const err = new Error('Authentication required. Please sign in to cancel this order.');
          err.statusCode = 401;
          throw err;
        }
      }

      const previousStatus = order.order_status;
      order.order_status = 'cancelled';
      order.cancellation_reason = reason;
      order.history.push({
        id: order.history.length + 1,
        previous_status: previousStatus,
        new_status: 'cancelled',
        actor,
        actor_role: actorRole,
        reason,
        created_at: new Date().toISOString()
      });
      const stockChanges = await InventoryService.restoreOrderStock(null, orderId);
      InventoryService.emitStockChanges(stockChanges);
      return { orderId, orderStatus: 'cancelled', status: 'cancelled', reason };
    }
  }

  /**
   * Admin Assigns Courier (Permanent Cancellation Lock applied)
   */
  static async assignCourier(orderId, courierPartner, trackingNumber, note = '') {
    if (!courierPartner || !trackingNumber) {
      const error = new Error('Courier partner name and tracking number are required.');
      error.statusCode = 400;
      throw error;
    }

    const connection = await this.getConnectionOrNull();
    if (connection) {
      try {
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT * FROM `orders` WHERE id = ? FOR UPDATE', [orderId]);
        if (rows.length === 0) {
          const error = new Error(`Order "${orderId}" not found.`);
          error.statusCode = 404;
          throw error;
        }

        const order = rows[0];
        if (order.order_status === 'cancelled') {
          const error = new Error('Cannot assign courier to a cancelled order.');
          error.statusCode = 400;
          throw error;
        }
        if (paymentBlocksFulfillment(order)) {
          const error = new Error('Payment requires verification or Admin review before courier assignment.');
          error.statusCode = 409;
          throw error;
        }

        const previousStatus = order.order_status;

        await connection.query(`
          UPDATE \`orders\` 
          SET \`courier_partner\` = ?, \`tracking_number\` = ?, \`courier_status_note\` = ?, \`order_status\` = 'courier_assigned'
          WHERE id = ?
        `, [courierPartner, trackingNumber, note, orderId]);

        await connection.query(`
          INSERT INTO \`order_status_history\` (\`order_id\`, \`previous_status\`, \`new_status\`, \`actor\`, \`actor_role\`, \`reason\`)
          VALUES (?, ?, 'courier_assigned', 'Store Administrator', 'admin', ?)
        `, [orderId, previousStatus, `Courier assigned: ${courierPartner} (Tracking: ${trackingNumber})`]);

        await connection.commit();

        emitOrderStatusChanged(orderId, {
          orderId,
          previousStatus,
          newStatus: 'courier_assigned',
          courierPartner,
          trackingNumber,
          timestamp: new Date().toISOString()
        }, order.customer_id || order.user_id);

        return {
          orderId,
          orderStatus: 'courier_assigned',
          courierPartner,
          trackingNumber
        };
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } else {
      // Memory mode
      const order = this.mockOrders.get(orderId);
      if (!order) {
        const error = new Error(`Order "${orderId}" not found.`);
        error.statusCode = 404;
        throw error;
      }
      if (order.order_status === 'cancelled') {
        const error = new Error('Cannot assign courier to a cancelled order.');
        error.statusCode = 400;
        throw error;
      }
      if (paymentBlocksFulfillment(order)) {
        const error = new Error('Payment requires verification or Admin review before courier assignment.');
        error.statusCode = 409;
        throw error;
      }
      const previousStatus = order.order_status;
      order.courier_partner = courierPartner;
      order.tracking_number = trackingNumber;
      order.courier_status_note = note;
      order.order_status = 'courier_assigned';
      order.history.push({
        id: order.history.length + 1,
        previous_status: previousStatus,
        new_status: 'courier_assigned',
        actor: 'Store Administrator',
        actor_role: 'admin',
        reason: `Courier assigned: ${courierPartner} (Tracking: ${trackingNumber})`,
        created_at: new Date().toISOString()
      });
      return {
        orderId,
        orderStatus: 'courier_assigned',
        courierPartner,
        trackingNumber
      };
    }
  }

  /**
   * Admin Marks Shipped (Commits inventory reservation to physical stock deduction)
   */
  static async markOrderShipped(orderId, note = '') {
    const connection = await this.getConnectionOrNull();
    if (connection) {
      try {
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT * FROM `orders` WHERE id = ? FOR UPDATE', [orderId]);
        if (rows.length === 0) {
          const error = new Error(`Order "${orderId}" not found.`);
          error.statusCode = 404;
          throw error;
        }

        const order = rows[0];
        if (order.order_status === 'cancelled') {
          const error = new Error('Cannot ship a cancelled order.');
          error.statusCode = 400;
          throw error;
        }
        if (paymentBlocksFulfillment(order)) {
          const error = new Error('Payment requires verification or Admin review before shipment.');
          error.statusCode = 409;
          throw error;
        }
        if (order.order_status === 'shipped') {
          const error = new Error('Order is already marked as shipped.');
          error.statusCode = 400;
          throw error;
        }

        const previousStatus = order.order_status;

        await connection.query('UPDATE `orders` SET `order_status` = "shipped" WHERE id = ?', [orderId]);

        // Commit inventory reservation
        await InventoryService.commitShipment(connection, orderId);

        await connection.query(`
          INSERT INTO \`order_status_history\` (\`order_id\`, \`previous_status\`, \`new_status\`, \`actor\`, \`actor_role\`, \`reason\`)
          VALUES (?, ?, 'shipped', 'Store Administrator', 'admin', ?)
        `, [orderId, previousStatus, note || 'Dispatched with insured courier']);

        await connection.commit();

        emitOrderStatusChanged(orderId, {
          orderId,
          previousStatus,
          newStatus: 'shipped',
          timestamp: new Date().toISOString()
        }, order.customer_id || order.user_id);

        return { orderId, orderStatus: 'shipped' };
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } else {
      // Memory mode
      const order = this.mockOrders.get(orderId);
      if (!order) {
        const error = new Error(`Order "${orderId}" not found.`);
        error.statusCode = 404;
        throw error;
      }
      if (order.order_status === 'cancelled') {
        const error = new Error('Cannot ship a cancelled order.');
        error.statusCode = 400;
        throw error;
      }
      if (paymentBlocksFulfillment(order)) {
        const error = new Error('Payment requires verification or Admin review before shipment.');
        error.statusCode = 409;
        throw error;
      }
      if (order.order_status === 'shipped') {
        const error = new Error('Order is already marked as shipped.');
        error.statusCode = 400;
        throw error;
      }
      const previousStatus = order.order_status;
      order.order_status = 'shipped';
      await InventoryService.commitReservationOnShipment(null, orderId);
      order.history.push({
        id: order.history.length + 1,
        previous_status: previousStatus,
        new_status: 'shipped',
        actor: 'Store Administrator',
        actor_role: 'admin',
        reason: note || 'Dispatched with insured courier',
        created_at: new Date().toISOString()
      });
      return { orderId, orderStatus: 'shipped' };
    }
  }

  // Admins may advance an order to any later stage in one step; cancellation stays
  // possible until dispatch. Delivered and cancelled are terminal.
  static VALID_TRANSITIONS = {
    placed: ['confirmed', 'processing', 'courier_assigned', 'delivered', 'cancelled'],
    confirmed: ['processing', 'courier_assigned', 'shipped', 'delivered', 'cancelled'],
    processing: ['confirmed', 'courier_assigned', 'shipped', 'delivered', 'cancelled'],
    courier_assigned: ['shipped', 'delivered', 'cancelled'],
    shipped: ['delivered'],
    delivered: ['returned'],
    returned: [],
    cancelled: []
  };

  /**
   * Transition order status strictly validating valid state machine paths
   */
  static async updateOrderStatus(orderId, newStatus, actor = 'Store Administrator', actorRole = 'admin', reason = '') {
    const validStatuses = ['placed', 'confirmed', 'processing', 'courier_assigned', 'shipped', 'delivered', 'cancelled', 'returned'];
    if (!validStatuses.includes(newStatus)) {
      const err = new Error(`Invalid status "${newStatus}". Must be one of: ${validStatuses.join(', ')}.`);
      err.statusCode = 400;
      throw err;
    }

    const connection = await this.getConnectionOrNull();
    if (connection) {
      try {
        await connection.beginTransaction();
        const [rows] = await connection.query('SELECT * FROM `orders` WHERE id = ? FOR UPDATE', [orderId]);
        if (rows.length === 0) {
          const err = new Error(`Order "${orderId}" not found.`);
          err.statusCode = 404;
          throw err;
        }

        const currentStatus = rows[0].order_status;
        if (currentStatus === newStatus) {
          await connection.commit();
          return { orderId, previousStatus: currentStatus, newStatus, unchanged: true };
        }
        const allowedNext = this.VALID_TRANSITIONS[currentStatus] || [];
        if (!allowedNext.includes(newStatus)) {
          const err = new Error(`Invalid order status transition from "${currentStatus}" to "${newStatus}". Allowed transitions: ${allowedNext.join(', ') || 'none (terminal state)'}.`);
          err.statusCode = 400;
          throw err;
        }
        if (['processing', 'courier_assigned', 'shipped', 'delivered'].includes(newStatus) && paymentBlocksFulfillment(rows[0])) {
          const err = new Error('Payment requires verification or Admin review before fulfillment.');
          err.statusCode = 409;
          throw err;
        }

        let deliveredAt;
        let paymentStatus = rows[0].payment_status;
        if (newStatus === 'delivered') {
          await connection.query('UPDATE `orders` SET `order_status` = ?, `delivered_at` = COALESCE(`delivered_at`, NOW()) WHERE id = ?', [newStatus, orderId]);
          const [deliveryRows] = await connection.query('SELECT delivered_at, payment_status FROM `orders` WHERE id = ?', [orderId]);
          deliveredAt = deliveryRows[0]?.delivered_at
            ? new Date(deliveryRows[0].delivered_at).toISOString()
            : undefined;
          paymentStatus = deliveryRows[0]?.payment_status || paymentStatus;

          // Cash is collected at the door, so a delivered order is settled here:
          // plain COD orders, and advance orders whose remaining COD is paid on
          // delivery. Money is never claimed for an unverified/rejected advance.
          const advanceDue = Number(rows[0].advance_payment_due || 0);
          const settlesAtDoor = (rows[0].payment_method || 'cod') === 'cod' || advanceDue > 0;
          if (settlesAtDoor && ['pending', 'partially_paid'].includes(paymentStatus)) {
            const [advanceRows] = await connection.query(
              'SELECT status FROM order_payment_proofs WHERE order_id = ?',
              [orderId]
            );
            const advanceUnsettled = advanceRows.some(row => row.status !== 'verified');
            if (!advanceUnsettled) {
              await connection.query('UPDATE `orders` SET `payment_status` = ? WHERE id = ?', ['paid', orderId]);
              await connection.query(`
                INSERT INTO order_payment_status_history
                  (order_id, previous_status, new_status, actor_id, actor_role, reason)
                VALUES (?, ?, 'paid', NULL, 'system', 'COD collected on delivery')
              `, [orderId, paymentStatus]);
              paymentStatus = 'paid';
            }
          }
        } else {
          await connection.query('UPDATE `orders` SET `order_status` = ? WHERE id = ?', [newStatus, orderId]);
        }

        let stockChanges = [];
        if (newStatus === 'cancelled' || newStatus === 'returned') {
          stockChanges = await InventoryService.restoreOrderStock(connection, orderId);
        } else if (newStatus === 'shipped' || newStatus === 'delivered') {
          // Legacy active reservations are committed here; new orders were deducted at checkout.
          await InventoryService.commitShipment(connection, orderId);
        }

        await connection.query(`
          INSERT INTO \`order_status_history\` (\`order_id\`, \`previous_status\`, \`new_status\`, \`actor\`, \`actor_role\`, \`reason\`)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [orderId, currentStatus, newStatus, actor, actorRole, reason || `Status updated to ${newStatus}`]);

        const customerId = rows[0].customer_id || rows[0].user_id;
        const notification = customerId
          ? await persistNotification(
            connection,
            customerId,
            'customer',
            'order',
            `Order ${newStatus.replaceAll('_', ' ')}`,
            `Your order ${orderId} status is now ${newStatus.replaceAll('_', ' ')}.${reason ? ` ${reason}` : ''}`,
            orderId
          )
          : null;

        await connection.commit();

        emitOrderStatusChanged(orderId, {
          orderId,
          previousStatus: currentStatus,
          newStatus,
          reason,
          deliveredAt,
          paymentStatus,
          timestamp: new Date().toISOString()
        }, rows[0].customer_id || rows[0].user_id);
        InventoryService.emitStockChanges(stockChanges);
        if (notification) emitPersistedNotification(notification);

        return { orderId, previousStatus: currentStatus, newStatus, deliveredAt, paymentStatus };
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } else {
      const order = this.mockOrders.get(orderId);
      if (!order) {
        const err = new Error(`Order "${orderId}" not found.`);
        err.statusCode = 404;
        throw err;
      }
      const currentStatus = order.order_status;
      if (currentStatus === newStatus) {
        return { orderId, previousStatus: currentStatus, newStatus, unchanged: true };
      }
      const allowedNext = this.VALID_TRANSITIONS[currentStatus] || [];
      if (!allowedNext.includes(newStatus)) {
        const err = new Error(`Invalid order status transition from "${currentStatus}" to "${newStatus}". Allowed transitions: ${allowedNext.join(', ') || 'none (terminal state)'}.`);
        err.statusCode = 400;
        throw err;
      }
      order.order_status = newStatus;
      if (newStatus === 'delivered') {
        order.delivered_at = new Date().toISOString();
        // Mirror the COD settlement applied by the transactional path.
        if ((order.payment_method || 'cod') === 'cod' && ['pending', 'partially_paid'].includes(order.payment_status)) {
          order.payment_status = 'paid';
        }
      }
      let stockChanges = [];
      if (newStatus === 'cancelled' || newStatus === 'returned') {
        stockChanges = await InventoryService.restoreOrderStock(null, orderId);
      } else if (newStatus === 'shipped' || newStatus === 'delivered') {
        await InventoryService.commitReservationOnShipment(null, orderId);
      }
      order.history.push({
        id: order.history.length + 1,
        previous_status: currentStatus,
        new_status: newStatus,
        actor,
        actor_role: actorRole,
        reason: reason || `Status updated to ${newStatus}`,
        created_at: new Date().toISOString()
      });
      InventoryService.emitStockChanges(stockChanges);
      emitOrderStatusChanged(orderId, {
        orderId,
        previousStatus: currentStatus,
        newStatus,
        paymentStatus: order.payment_status,
        deliveredAt: order.delivered_at,
        timestamp: new Date().toISOString()
      }, order.customer_id || order.user_id);
      return { orderId, previousStatus: currentStatus, newStatus, deliveredAt: order.delivered_at, paymentStatus: order.payment_status };
    }
  }

  static async deleteOrder(orderId) {
    const connection = await this.getConnectionOrNull();
    if (connection) {
      try {
        await connection.beginTransaction();
        const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
        if (!orders.length) {
          const error = new Error(`Order "${orderId}" not found.`);
          error.statusCode = 404;
          throw error;
        }
        const stockChanges = await InventoryService.restoreOrderStock(connection, orderId);
        await connection.query('DELETE FROM notifications WHERE order_id = ?', [orderId]);
        await connection.query('DELETE FROM orders WHERE id = ?', [orderId]);
        await connection.commit();
        InventoryService.emitStockChanges(stockChanges);
        emitOrderStatusChanged(orderId, {
          orderId,
          deleted: true,
          timestamp: new Date().toISOString()
        }, orders[0].customer_id || orders[0].user_id);
        return { orderId, deleted: true };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    }

    const order = this.mockOrders.get(orderId);
    if (!order) {
      const error = new Error(`Order "${orderId}" not found.`);
      error.statusCode = 404;
      throw error;
    }
    const stockChanges = await InventoryService.restoreOrderStock(null, orderId);
    this.mockOrders.delete(orderId);
    InventoryService.emitStockChanges(stockChanges);
    return { orderId, deleted: true };
  }

  /**
   * Get single order by ID with items and durable status history
   */
  static async getOrderById(orderId) {
    const mockOrder = this.mockOrders.get(orderId);
    if (mockOrder) {
      return this.formatOrder(mockOrder, mockOrder.items || [], mockOrder.history || []);
    }
    try {
      const [orderRows] = await pool.query('SELECT * FROM `orders` WHERE id = ?', [orderId]);
      if (orderRows.length === 0) return null;

      const [items] = await pool.query('SELECT * FROM `order_items` WHERE order_id = ?', [orderId]);
      const [history] = await pool.query('SELECT * FROM `order_status_history` WHERE order_id = ? ORDER BY created_at ASC', [orderId]);
      const advancePayments = await this.getAdvancePayments(orderId);

      return this.formatOrder(orderRows[0], items, history, { advancePayments });
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
        const order = this.mockOrders.get(orderId);
        if (!order) return null;
        return this.formatOrder(order, order.items || [], order.history || []);
      }
      throw err;
    }
  }
}
