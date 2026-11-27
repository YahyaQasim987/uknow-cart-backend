import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import { OrderController } from './order.controller.js';

const providers = ['bank_transfer', 'easypaisa', 'jazzcash', 'other'];
const validStatuses = ['requested', 'under_review', 'approved', 'rejected', 'processing', 'failed', 'cancelled', 'manually_refunded'];
const allowedTransitions = {
  requested: ['under_review', 'approved', 'rejected', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'],
  approved: ['processing', 'manually_refunded', 'cancelled'],
  processing: ['manually_refunded', 'failed', 'cancelled'],
  failed: ['processing', 'cancelled'],
  rejected: [],
  completed: [],
  manually_refunded: [],
  cancelled: []
};

function formatRefund(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    provider: row.provider,
    paymentTransactionId: row.payment_transaction_id || undefined,
    paymentReference: row.transaction_ref || row.provider_reference || undefined,
    amount: Number(row.amount),
    destinationHint: row.destination_hint || undefined,
    status: row.status,
    reason: row.reason || undefined,
    providerReference: row.provider_reference || undefined,
    notes: row.notes || undefined,
    refundMethod: row.refund_method || undefined,
    refundDate: row.refund_date ? new Date(row.refund_date).toISOString() : undefined,
    adminNotes: row.admin_notes || undefined,
    proofUrl: row.proof_url || undefined,
    customerName: row.customer_name || undefined,
    customerEmail: row.customer_email || undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

export async function listRefunds(req, res, next) {
  try {
    await OrderController.assertAdminOwnsOrder(req.params.id, req.user.id);
    const [rows] = await pool.query(
      `SELECT r.*, p.transaction_ref, o.customer_name, o.customer_email
       FROM refund_requests r
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN payment_transactions p ON p.id = r.payment_transaction_id
       WHERE r.order_id = ? ORDER BY r.created_at DESC`,
      [req.params.id]
    );
    return res.json({ success: true, refunds: rows.map(formatRefund) });
  } catch (error) {
    next(error);
  }
}

export async function requestCustomerRefund(req, res, next) {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 2000) {
    return res.status(400).json({ success: false, message: 'Please enter a refund reason between 5 and 2,000 characters.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [orders] = await connection.query(
      'SELECT * FROM orders WHERE id = ? AND COALESCE(customer_id, user_id) = ? FOR UPDATE',
      [req.params.id, req.user.id]
    );
    if (!orders.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Order not found for this customer.' });
    }
    const order = orders[0];
    if (!['delivered', 'returned', 'cancelled'].includes(order.order_status)) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'A refund can only be requested for a delivered, returned, or cancelled order.' });
    }

    const [existing] = await connection.query(
      `SELECT id FROM refund_requests
       WHERE order_id = ? AND requested_by = ? AND status IN ('requested', 'under_review', 'approved', 'processing')
       LIMIT 1`,
      [order.id, req.user.id]
    );
    if (existing.length) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'There is already an open refund request for this order.' });
    }

    const [payments] = await connection.query(
      `SELECT id, provider, transaction_ref
       FROM payment_transactions
       WHERE order_id = ? AND status = 'completed'
       ORDER BY created_at DESC LIMIT 1`,
      [order.id]
    );
    const payment = payments[0] || null;
    const isDeliveredCod = order.payment_method === 'cod' && order.order_status === 'delivered';
    const refundAmount = payment
      ? (order.payment_status === 'partially_paid' ? Number(order.advance_payment_due) : Number(order.total))
      : (isDeliveredCod ? Number(order.total) : 0);
    if (!(refundAmount > 0)) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'No completed payment is recorded for this order yet.' });
    }

    const refundId = `refund-${crypto.randomUUID()}`;
    const provider = payment && providers.includes(payment.provider) ? payment.provider : (payment ? 'other' : null);
    await connection.query(
      `INSERT INTO refund_requests
       (id, order_id, requested_by, payment_transaction_id, provider, amount, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'requested')`,
      [refundId, order.id, req.user.id, payment?.id || null, provider, refundAmount, reason]
    );
    await connection.query(
      `INSERT INTO refund_status_history (refund_request_id, previous_status, new_status, actor_id, details)
       VALUES (?, NULL, 'requested', ?, JSON_OBJECT('reason', ?))`,
      [refundId, req.user.id, reason]
    );

    const [admins] = await connection.query(
      `SELECT DISTINCT u.id
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN users u ON u.id = COALESCE(oi.admin_id, p.admin_id, p.owner_id)
       WHERE oi.order_id = ? AND u.role = 'admin'`,
      [order.id]
    );
    for (const admin of admins) {
      await connection.query(
        `INSERT INTO notifications (id, recipient_id, audience, type, title, message, order_id)
         VALUES (?, ?, 'admin', 'refund', ?, ?, ?)`,
        [
          `notif-${crypto.randomUUID()}`,
          admin.id,
          `Refund requested for ${order.id}`,
          `Customer ${order.customer_name}; order ${order.id}; payment reference ${payment?.transaction_ref || 'not recorded'}; amount PKR ${refundAmount.toFixed(2)}; reason: ${reason}; status Requested.`,
          order.id
        ]
      );
    }
    const [rows] = await connection.query(
      `SELECT r.*, p.transaction_ref, o.customer_name, o.customer_email
       FROM refund_requests r JOIN orders o ON o.id = r.order_id
       LEFT JOIN payment_transactions p ON p.id = r.payment_transaction_id
       WHERE r.id = ?`,
      [refundId]
    );
    await connection.commit();
    return res.status(201).json({ success: true, refund: formatRefund(rows[0]) });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}

export async function createRefund(req, res, next) {
  let connection;
  try {
    const { id: orderId } = req.params;
    const { provider, amount, destinationHint = '', notes = '' } = req.body || {};
    await OrderController.assertAdminOwnsOrder(orderId, req.user.id);

    if (!providers.includes(provider)) {
      return res.status(400).json({ success: false, message: 'Choose bank_transfer, easypaisa, or jazzcash.' });
    }
    const refundAmount = Number(amount);
    if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Refund amount must be greater than zero.' });
    }
    if (typeof notes !== 'string' || notes.length > 2000) {
      return res.status(400).json({ success: false, message: 'Refund notes must be 2,000 characters or fewer.' });
    }
    if (typeof destinationHint !== 'string' || (destinationHint && !/^(?:[*•]{4,}\d{4}|ending in \d{4})$/i.test(destinationHint.trim()))) {
      return res.status(400).json({
        success: false,
        message: 'Only a masked refund destination ending in four digits may be stored; do not submit a full account number.'
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [orders] = await connection.query(
      'SELECT total, order_status FROM orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (!orders.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (!['delivered', 'returned', 'cancelled'].includes(orders[0].order_status)) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: 'Refund requests can only be prepared for delivered, returned, or cancelled orders.'
      });
    }
    if (refundAmount > Number(orders[0].total)) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Refund amount cannot exceed the order total.' });
    }

    const [existing] = await connection.query(
      `SELECT id FROM refund_requests
      WHERE order_id = ? AND status IN ('requested', 'under_review', 'approved', 'processing')
      LIMIT 1 FOR UPDATE`,
      [orderId]
    );
    if (existing.length) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'An open refund workflow already exists for this order.' });
    }
    const [payments] = await connection.query(
      `SELECT id FROM payment_transactions
       WHERE order_id = ? AND status = 'completed'
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [orderId]
    );
    const refundId = `refund-${crypto.randomUUID()}`;
    await connection.query(
      `INSERT INTO refund_requests
       (id, order_id, requested_by, payment_transaction_id, provider, amount, destination_hint, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?)`,
      [refundId, orderId, req.user.id, payments[0]?.id || null, provider, refundAmount, destinationHint.trim() || null, notes.trim() || null]
    );
    await connection.query(
      `INSERT INTO refund_status_history (refund_request_id, previous_status, new_status, actor_id)
       VALUES (?, NULL, 'requested', ?)`,
      [refundId, req.user.id]
    );
    const [rows] = await connection.query('SELECT * FROM refund_requests WHERE id = ?', [refundId]);
    await connection.commit();
    return res.status(201).json({
      success: true,
      message: 'Refund workflow created. No money was transferred; provider execution is not configured.',
      refund: formatRefund(rows[0])
    });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
}

export async function updateRefund(req, res, next) {
  try {
    const { id: orderId, refundId } = req.params;
    const {
      status,
      providerReference = '',
      notes,
      refundMethod = '',
      refundDate = '',
      adminNotes = '',
      proofUrl = '',
      confirmManualRefund = false
    } = req.body || {};
    await OrderController.assertAdminOwnsOrder(orderId, req.user.id);
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'A valid refund status is required.' });
    }
    if (typeof providerReference !== 'string' || providerReference.length > 150) {
      return res.status(400).json({ success: false, message: 'Provider reference must be 150 characters or fewer.' });
    }
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000)) {
      return res.status(400).json({ success: false, message: 'Refund notes must be 2,000 characters or fewer.' });
    }
    if (status === 'manually_refunded') {
      if (confirmManualRefund !== true) {
        return res.status(400).json({ success: false, message: 'Explicitly confirm that the money has been returned before completing a manual refund.' });
      }
      if (typeof refundMethod !== 'string' || !refundMethod.trim() || refundMethod.length > 100 ||
          typeof providerReference !== 'string' || !providerReference.trim() ||
          !refundDate || Number.isNaN(Date.parse(refundDate))) {
        return res.status(400).json({ success: false, message: 'Manual refund method, date, and transaction reference are required.' });
      }
    }
    if (typeof adminNotes !== 'string' || adminNotes.length > 2000 ||
        typeof proofUrl !== 'string' || proofUrl.length > 500) {
      return res.status(400).json({ success: false, message: 'Admin notes or receipt link exceeds the allowed length.' });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        'SELECT * FROM refund_requests WHERE id = ? AND order_id = ? FOR UPDATE',
        [refundId, orderId]
      );
      if (!rows.length) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'Refund workflow not found.' });
      }
      const currentStatus = rows[0].status;
      if (currentStatus !== status && !allowedTransitions[currentStatus]?.includes(status)) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: `Refund cannot transition from "${currentStatus}" to "${status}".`
        });
      }
      await connection.query(
        `UPDATE refund_requests
         SET status = ?, provider_reference = ?, notes = COALESCE(?, notes),
             refund_method = COALESCE(?, refund_method),
             refund_date = COALESCE(?, refund_date),
             admin_notes = COALESCE(?, admin_notes),
             proof_url = COALESCE(?, proof_url)
         WHERE id = ? AND order_id = ?`,
        [
          status,
          providerReference.trim() || null,
          notes === undefined ? null : notes.trim() || null,
          refundMethod.trim() || null,
          refundDate || null,
          adminNotes.trim() || null,
          proofUrl.trim() || null,
          refundId,
          orderId
        ]
      );
      await connection.query(
        `INSERT INTO refund_status_history (refund_request_id, previous_status, new_status, actor_id, details)
         VALUES (?, ?, ?, ?, JSON_OBJECT('providerReference', ?, 'refundMethod', ?, 'refundDate', ?, 'adminNotes', ?))`,
        [refundId, currentStatus, status, req.user.id, providerReference.trim(), refundMethod.trim(), refundDate || null, adminNotes.trim()]
      );
      if (status === 'manually_refunded') {
        const [refundRows] = await connection.query(
          'SELECT amount, payment_transaction_id FROM refund_requests WHERE id = ? FOR UPDATE',
          [refundId]
        );
        const [orderRows] = await connection.query('SELECT total FROM orders WHERE id = ? FOR UPDATE', [orderId]);
        if (Number(refundRows[0].amount) >= Number(orderRows[0].total)) {
          await connection.query('UPDATE orders SET payment_status = "refunded" WHERE id = ?', [orderId]);
          if (refundRows[0].payment_transaction_id) {
            const [paymentRows] = await connection.query(
              'SELECT status FROM payment_transactions WHERE id = ? FOR UPDATE',
              [refundRows[0].payment_transaction_id]
            );
            if (paymentRows.length) {
              await connection.query(
                'UPDATE payment_transactions SET status = "refunded" WHERE id = ?',
                [refundRows[0].payment_transaction_id]
              );
              await connection.query(
                `INSERT INTO payment_status_history
                 (payment_transaction_id, order_id, previous_status, new_status, source, details)
                 VALUES (?, ?, ?, 'refunded', 'manual_refund', JSON_OBJECT('refundRequestId', ?, 'amount', ?))`,
                [refundRows[0].payment_transaction_id, orderId, paymentRows[0].status, refundId, refundRows[0].amount]
              );
            }
          }
        }
      }
      const [updatedRows] = await connection.query('SELECT * FROM refund_requests WHERE id = ?', [refundId]);
      await connection.commit();
      return res.json({
        success: true,
        message: status === 'manually_refunded'
          ? 'Manual refund recorded after explicit confirmation. No gateway API call was made.'
          : `Refund workflow updated to ${status}.`,
        refund: formatRefund(updatedRows[0])
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
}
