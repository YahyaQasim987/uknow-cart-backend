import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderService } from '../src/services/order.service.js';
import { PricingService } from '../src/services/pricing.service.js';
import { requestCustomerRefund, updateRefund } from '../src/controllers/refund.controller.js';
import { updatePaymentStatus } from '../src/controllers/payment.controller.js';
import { pool } from '../src/config/db.js';

test.after(async () => {
  await pool.end();
});

async function withOfflineCatalog(callback) {
  const query = pool.query;
  pool.query = async () => {
    const error = new Error('test database unavailable');
    error.code = 'ECONNREFUSED';
    throw error;
  };
  try {
    return await callback();
  } finally {
    pool.query = query;
  }
}

async function withMockConnection(queryHandler, callback, poolQueryHandler = async () => [[], []]) {
  const originalGetConnection = pool.getConnection;
  const originalQuery = pool.query;
  const calls = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: async (sql, params) => {
      calls.push({ sql, params });
      return queryHandler(sql, params, calls);
    }
  };
  pool.getConnection = async () => connection;
  pool.query = poolQueryHandler;
  try {
    return await callback({ connection, calls });
  } finally {
    pool.getConnection = originalGetConnection;
    pool.query = originalQuery;
  }
}

test('fixed advance pricing uses configured PKR amounts in mixed carts', async () => withOfflineCatalog(async () => {
  PricingService.setMockCatalogItem('discounted-advance', {
    id: 'discounted-advance',
    name: 'Discounted item',
    price: 8000,
    original_price: 10000,
    discount_type: 'percentage',
    discount_value: 20,
    stock: 50,
    reserved_stock: 0,
    advance_payment_required: true,
    advance_payment_amount: 1500,
    admin_id: 'usr-admin-1'
  });
  PricingService.setMockCatalogItem('normal-item', {
    id: 'normal-item',
    name: 'Normal item',
    price: 1000,
    stock: 50,
    reserved_stock: 0,
    advance_payment_required: false,
    admin_id: 'usr-admin-1'
  });

  const result = await PricingService.calculateOrderTotals([
    { productId: 'discounted-advance', quantity: 1 },
    { productId: 'normal-item', quantity: 1 }
  ]);
  assert.equal(result.subtotal, 9000);
  assert.equal(result.advancePaymentDue, 1500);
  assert.equal(result.codRemainingDue, result.total - 1500);
  assert.equal(result.items[0].lineAdvance, 1500);
  assert.equal(result.items[1].lineAdvance, 0);
}));

test('backend rejects COD for carts requiring manual advance-payment proof', async () => withOfflineCatalog(async () => {
  await assert.rejects(
    OrderService.placeOrder({
      items: [{ productId: 'p5', quantity: 1 }],
      customer: { name: 'Test Customer', phone: '03001234567', city: 'Karachi', address: 'Test address' },
      paymentMethod: 'cod'
    }),
    error => error.statusCode === 400 && /requires the exact advance amount/i.test(error.message)
  );
}));

test('backend keeps non-advance carts on COD', async () => withOfflineCatalog(async () => {
  await assert.rejects(
    OrderService.placeOrder({
      items: [{ productId: 'p1', quantity: 1 }],
      customer: { name: 'Test Customer', phone: '03001234567', city: 'Karachi', address: 'Test address' },
      paymentMethod: 'bank_transfer'
    }),
    error => error.statusCode === 400 && /cash on delivery is the only/i.test(error.message)
  );
}));

test('advance proof submission requires the exact amount and an enabled configured platform', async () => {
  const order = {
    id: 'order-advance',
    customer_id: 'customer-1',
    customer_name: 'Test Customer',
    payment_method: 'bank_transfer',
    payment_status: 'awaiting_proof',
    advance_payment_due: '500.00',
    expires_at: new Date(Date.now() + 60 * 60 * 1000)
  };
  await withMockConnection(async (sql) => {
    if (sql.includes('SELECT * FROM orders')) return [[order], []];
    if (sql.includes('SELECT enable_bank_transfer')) {
      return [[{ enable_bank_transfer: 1, bank_name: 'Test Bank', bank_iban: 'PK00TEST' }], []];
    }
    if (sql.includes('SELECT id FROM order_payment_proofs')) return [[], []];
    if (sql.includes('SELECT DISTINCT COALESCE')) return [[{ admin_id: 'admin-1' }], []];
    if (sql.includes('INSERT INTO notifications')) return [{ affectedRows: 1 }, []];
    return [{ affectedRows: 1 }, []];
  }, async ({ calls }) => {
    const result = await OrderService.submitPaymentProof('order-advance', 'customer-1', {
      accountHolderName: 'Test Customer',
      paymentPlatform: 'Bank Transfer',
      transactionReference: 'TX-ADVANCE-1',
      amount: 500,
      imageStoragePath: 'proof-image.jpg'
    });
    assert.equal(result.paymentStatus, 'verification_pending');
    assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO order_payment_proofs')));
    assert.ok(calls.some(({ sql, params }) =>
      sql.includes('SELECT id FROM order_payment_proofs WHERE payment_platform') &&
      params[0] === 'Bank Transfer' &&
      params[1] === 'TX-ADVANCE-1'
    ));
    assert.ok(calls.some(({ sql }) => sql.includes('UPDATE orders SET payment_status')));
  });

  await withMockConnection(async sql => {
    if (sql.includes('SELECT * FROM orders')) return [[order], []];
    return [[], []];
  }, async ({ calls }) => {
    await assert.rejects(
      OrderService.submitPaymentProof('order-advance', 'customer-1', {
        accountHolderName: 'Test Customer',
        paymentPlatform: 'Bank Transfer',
        transactionReference: 'TX-ADVANCE-2',
        amount: 499.99,
        imageStoragePath: 'proof-image.jpg'
      }),
      error => error.statusCode === 400 && /exactly match/i.test(error.message)
    );
    assert.ok(!calls.some(({ sql }) => sql.includes('INSERT INTO order_payment_proofs')));
  });
});

test('Admin approval records proof history and leaves the remaining balance payable on delivery', async () => {
  const order = {
    id: 'order-advance',
    customer_id: 'customer-1',
    payment_status: 'verification_pending',
    advance_payment_due: '500.00',
    cod_remaining_due: '300.00'
  };
  await withMockConnection(async sql => {
    if (sql.includes('SELECT * FROM orders')) return [[order], []];
    if (sql.includes('SELECT * FROM order_payment_proofs')) {
      return [[{ id: 'proof-1', status: 'verification_pending' }], []];
    }
    return [{ affectedRows: 1 }, []];
  }, async ({ calls }) => {
    const result = await OrderService.reviewPaymentProof(
      'order-advance',
      'proof-1',
      'admin-1',
      'verified'
    );
    assert.equal(result.proofStatus, 'verified');
    assert.equal(result.paymentStatus, 'partially_paid');
    assert.ok(calls.some(({ sql, params }) =>
      sql.includes('UPDATE orders SET payment_status') && params[0] === 'partially_paid'
    ));
    assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO order_payment_proof_history')));
    assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO order_payment_status_history')));
  });
});

test('Admin cannot mark an advance-payment order paid before a proof is verified', async () => {
  const order = {
    id: 'order-advance',
    order_status: 'placed',
    advance_payment_due: '500.00',
    total: '800.00',
    payment_status: 'awaiting_proof',
    payment_review: false
  };
  let nextError;
  await withMockConnection(async sql => {
    if (sql.includes('SELECT * FROM orders')) return [[order], []];
    if (sql.includes("status = 'verified'")) return [[], []];
    return [{ affectedRows: 1 }, []];
  }, async () => {
    await updatePaymentStatus({
      params: { id: 'order-advance' },
      user: { id: 'admin-1' },
      body: { paymentStatus: 'paid', verifiedManually: true, reason: 'Manual check' }
    }, {
      status() { return this; },
      json() {}
    }, error => { nextError = error; });
  }, async sql => sql.includes('SELECT o.id') ? [[{ id: 'order-advance' }], []] : [[], []]);

  assert.equal(nextError?.statusCode, 409);
  assert.match(nextError?.message || '', /verified through the submitted proof/i);
});

test('expired rejected proofs release the order and retain the prior payment status in history', async () => {
  const expiredOrder = {
    id: 'order-advance',
    order_status: 'placed',
    payment_status: 'rejected',
    advance_payment_due: '500.00',
    expires_at: new Date(Date.now() - 1000),
    customer_id: null,
    user_id: null
  };
  await withMockConnection(async (sql) => {
    if (sql.includes('SELECT * FROM orders') && sql.includes("payment_status IN ('awaiting_proof', 'rejected')")) {
      return [[expiredOrder], []];
    }
    if (sql.includes('SELECT * FROM inventory_reservations')) return [[], []];
    return [{ affectedRows: 1 }, []];
  }, async ({ calls }) => {
    const expired = await OrderService.expireUnpaidAdvanceOrders();
    assert.equal(expired, 1);
    assert.ok(calls.some(({ sql, params }) =>
      sql.includes('INSERT INTO order_payment_status_history') &&
      params[1] === 'rejected'
    ));
    assert.ok(calls.some(({ sql }) => sql.includes("SET order_status = 'expired', payment_status = 'expired'")));
  });
});

test('customer refund request records the order, reason, and complete COD amount and notifies Admin', async () => {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
  let calls;
  await withMockConnection(async (sql) => {
    if (sql.includes('SELECT * FROM orders')) {
      return [[{
        id: 'order-1',
        customer_id: 'customer-1',
        order_status: 'delivered',
        payment_method: 'cod',
        payment_status: 'pending',
        total: '1200.00',
        customer_name: 'Test Customer',
        customer_email: 'customer@example.com'
      }], []];
    }
    if (sql.includes('SELECT id FROM refund_requests')) return [[], []];
    if (sql.includes('SELECT id, provider, transaction_ref')) return [[], []];
    if (sql.includes('SELECT DISTINCT u.id')) return [[{ id: 'admin-1' }], []];
    if (sql.includes('SELECT r.*, p.transaction_ref')) {
      return [[{
        id: 'refund-1',
        order_id: 'order-1',
        amount: '1200.00',
        status: 'requested',
        reason: 'Item arrived damaged',
        created_at: new Date(),
        updated_at: new Date()
      }], []];
    }
    return [{ affectedRows: 1 }, []];
  }, async ({ calls: recordedCalls }) => {
    calls = recordedCalls;
    await requestCustomerRefund(
      { params: { id: 'order-1' }, user: { id: 'customer-1' }, body: { reason: 'Item arrived damaged' } },
      response,
      error => { throw error; }
    );
  }, async sql => sql.includes('SELECT o.id') ? [[{ id: 'order-1' }], []] : [[], []]);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.refund.amount, 1200);
  assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO refund_requests') && params.includes('Item arrived damaged')));
  assert.ok(calls.some(({ sql, params }) => sql.includes('INSERT INTO notifications') && params.some(value => String(value).includes('Item arrived damaged'))));
});

test('manual refund requires explicit confirmation and preserves payment history', async () => {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
  let calls;
  await withMockConnection(async (sql) => {
    if (sql.includes('SELECT * FROM refund_requests WHERE id = ? AND order_id = ?')) {
      return [[{
        id: 'refund-1',
        order_id: 'order-1',
        payment_transaction_id: 'payment-1',
        amount: '1000.00',
        status: 'approved'
      }], []];
    }
    if (sql.includes('SELECT amount, payment_transaction_id')) {
      return [[{ amount: '1000.00', payment_transaction_id: 'payment-1' }], []];
    }
    if (sql.includes('SELECT total FROM orders')) return [[{ total: '1000.00' }], []];
    if (sql.includes('SELECT status FROM payment_transactions')) return [[{ status: 'completed' }], []];
    if (sql.includes('SELECT * FROM refund_requests WHERE id = ?')) {
      return [[{
        id: 'refund-1',
        order_id: 'order-1',
        payment_transaction_id: 'payment-1',
        amount: '1000.00',
        status: 'manually_refunded',
        refund_method: 'Bank transfer',
        refund_date: new Date('2026-01-02T00:00:00.000Z'),
        provider_reference: 'bank-ref-1',
        created_at: new Date(),
        updated_at: new Date()
      }], []];
    }
    return [{ affectedRows: 1 }, []];
  }, async ({ calls: recordedCalls }) => {
    calls = recordedCalls;
    await updateRefund({
      params: { id: 'order-1', refundId: 'refund-1' },
      user: { id: 'admin-1', name: 'Admin' },
      body: {
        status: 'manually_refunded',
        confirmManualRefund: true,
        providerReference: 'bank-ref-1',
        refundMethod: 'Bank transfer',
        refundDate: '2026-01-02',
        adminNotes: 'Returned to customer'
      }
    }, response, error => { throw error; });
  }, async sql => sql.includes('SELECT o.id') ? [[{ id: 'order-1' }], []] : [[], []]);

  assert.equal(response.body.refund.status, 'manually_refunded');
  assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO refund_status_history')));
  assert.ok(calls.some(({ sql }) => sql.includes("UPDATE payment_transactions SET status = \"refunded\"")));
  assert.ok(calls.some(({ sql }) => sql.includes('INSERT INTO payment_status_history')));
});
