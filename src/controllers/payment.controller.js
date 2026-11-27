import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import { OrderController } from './order.controller.js';

// payment_transactions.status belongs to the transaction ledger. Order payment states such as
// paid/partially_paid are recorded on orders.payment_status, while the ledger row is completed.
function toTransactionStatus(paymentStatus) {
  return ['paid', 'partially_paid'].includes(paymentStatus) ? 'completed' : paymentStatus;
}

export async function updatePaymentStatus(req, res, next) {
  const allowedStatuses = ['pending', 'partially_paid', 'paid', 'failed', 'refunded', 'reversed', 'disputed'];
  const { paymentStatus, reference = '', reason = '' } = req.body || {};
  if (!allowedStatuses.includes(paymentStatus) || typeof reference !== 'string' ||
      reference.length > 150 || typeof reason !== 'string' || reason.length > 2000) {
    return res.status(400).json({ success: false, message: 'A valid payment status, reference, and reason are required.' });
  }
  if (['paid', 'partially_paid'].includes(paymentStatus) && (req.body?.verifiedManually !== true || !reason.trim())) {
    return res.status(400).json({ success: false, message: 'Manually confirming payment requires explicit confirmation and a verification note.' });
  }

  let connection;
  try {
    await OrderController.assertAdminOwnsOrder(req.params.id, req.user.id);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    const order = orders[0];
    if (Number(order.advance_payment_due) > 0 && ['paid', 'partially_paid'].includes(paymentStatus)) {
      const [proofRows] = await connection.query(
        'SELECT admin_id, status FROM order_payment_proofs WHERE order_id = ?',
        [order.id]
      );
      const ownProof = proofRows.find(row => row.admin_id === req.user.id);
      if (!ownProof || ownProof.status !== 'verified') {
        const error = new Error('Your seller advance payment must be verified before updating the order payment status.');
        error.statusCode = 409;
        throw error;
      }
      if (paymentStatus === 'paid' && proofRows.some(row => row.status !== 'verified')) {
        const error = new Error('All seller advance payments must be verified before marking the order as paid.');
        error.statusCode = 409;
        throw error;
      }
    }
    const [payments] = await connection.query(
      'SELECT * FROM payment_transactions WHERE order_id = ? ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
      [order.id]
    );
    let transaction = payments[0];
    if (!transaction) {
      const amount = paymentStatus === 'partially_paid'
        ? Number(order.advance_payment_due)
        : Number(order.total);
      const transactionId = `payment-${crypto.randomUUID()}`;
      await connection.query(
        `INSERT INTO payment_transactions (id, order_id, provider, transaction_ref, amount, currency, status)
         VALUES (?, ?, 'admin_manual', ?, ?, 'PKR', ?)`,
        [transactionId, order.id, reference.trim() || null, amount, toTransactionStatus(paymentStatus)]
      );
      const [created] = await connection.query('SELECT * FROM payment_transactions WHERE id = ?', [transactionId]);
      transaction = created[0];
    } else {
      await connection.query(
        'UPDATE payment_transactions SET status = ? WHERE id = ?',
        [toTransactionStatus(paymentStatus), transaction.id]
      );
    }
    const orderStatus = order.order_status;
    let paymentReview = Boolean(order.payment_review);
    if (['reversed', 'disputed'].includes(paymentStatus)) {
      paymentReview = true;
    }
    await connection.query(
      'UPDATE orders SET payment_status = ?, payment_review = ? WHERE id = ?',
      [paymentStatus, paymentReview, order.id]
    );
    await connection.query(
      `INSERT INTO payment_status_history
       (payment_transaction_id, order_id, previous_status, new_status, source, details)
       VALUES (?, ?, ?, ?, 'admin_manual', JSON_OBJECT('reference', ?, 'reason', ?))`,
      [transaction.id, order.id, transaction.status, paymentStatus, reference.trim(), reason.trim()]
    );
    if (['reversed', 'disputed'].includes(paymentStatus)) {
      await notifyAdmins(connection, order, transaction, paymentStatus);
    }
    await connection.commit();
    return res.json({
      success: true,
      orderId: order.id,
      paymentStatus,
      orderStatus,
      paymentReview,
      transactionReference: reference.trim() || transaction.transaction_ref || undefined
    });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
}

export async function releasePaymentReview(req, res, next) {
  let connection;
  try {
    await OrderController.assertAdminOwnsOrder(req.params.id, req.user.id);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [orders] = await connection.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [req.params.id]);
    const order = orders[0];
    if (!order.payment_review) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'This order is not on payment review.' });
    }
    if (!['paid', 'partially_paid'].includes(order.payment_status)) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'Verify or resolve the payment before releasing this order.' });
    }
    await connection.query(
      'UPDATE orders SET payment_review = FALSE, payment_review_from_status = NULL WHERE id = ?',
      [order.id]
    );
    const [payments] = await connection.query(
      'SELECT id FROM payment_transactions WHERE order_id = ? ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
      [order.id]
    );
    if (payments.length) {
      await connection.query(
        `INSERT INTO payment_status_history
         (payment_transaction_id, order_id, previous_status, new_status, source, details)
         VALUES (?, ?, ?, ?, 'admin_review', JSON_OBJECT('actor', ?, 'action', 'release_hold'))`,
        [payments[0].id, order.id, order.payment_status, order.payment_status, req.user.name || 'Store Administrator']
      );
    }
    await connection.commit();
    return res.json({ success: true, orderId: order.id, orderStatus: order.order_status, paymentReview: false });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
}
