import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderService } from '../src/services/order.service.js';
import { InventoryService } from '../src/services/inventory.service.js';
import { PricingService } from '../src/services/pricing.service.js';
import { pool } from '../src/config/db.js';

const calculateOrderTotals = PricingService.calculateOrderTotals;
const getConnectionOrNull = OrderService.getConnectionOrNull;
OrderService.getConnectionOrNull = async () => null;
PricingService.calculateOrderTotals = async items => {
  const pricedItems = items.map(item => ({
    productId: item.productId,
    variantId: item.variantId || null,
    adminId: null,
    name: item.productName || item.productId,
    unitPrice: Number(item.price),
    costPrice: Number(item.price) * 0.65,
    quantity: Number(item.quantity)
  }));
  const subtotal = pricedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const shippingFee = 300;
  const advancePaymentDue = items.some(it => it.productId === 'prod-adv-test') ? 2000 : 0;
  return {
    items: pricedItems,
    subtotal,
    discountAmount: 0,
    shippingFee,
    total: subtotal + shippingFee,
    advancePaymentDue,
    codRemainingDue: (subtotal + shippingFee) - advancePaymentDue,
    urgentFee: 0
  };
};

test.after(async () => {
  OrderService.getConnectionOrNull = getConnectionOrNull;
  PricingService.calculateOrderTotals = calculateOrderTotals;
  try {
    await pool.end();
  } catch (e) {}
});

test('Order Workflow - Customer places order successfully in placed status', async () => {
  InventoryService.setMockProductStock('prod-1', 10, 0);

  const payload = {
    customer: {
      name: 'Ahmed Khan',
      phone: '+92 300 1234567',
      city: 'Karachi',
      address: 'House 42, Block 5, Clifton'
    },
    items: [
      { productId: 'prod-1', price: 4500, quantity: 1, productName: 'Horology Timepiece' }
    ],
    deliverySpeed: 'standard'
  };

  const result = await OrderService.placeOrder(payload, 'user-101');
  assert.ok(result.orderId.startsWith('AUK-'));
  assert.equal(result.orderStatus, 'placed');
  assert.equal(result.pricing.total, 4800); // 4500 subtotal + 300 standard shipping (free shipping removed)
  assert.equal(InventoryService.getMockProductStock('prod-1').physical, 9);
});

test('Order Workflow - idempotency key reuses the first order and never double-deducts stock', async () => {
  InventoryService.setMockProductStock('prod-idempotent', 10, 0);
  const ordersBefore = OrderService.mockOrders.size;
  const checkoutKey = `checkout-${Date.now()}-idem`;
  const payload = {
    customer: {
      name: 'Retry Customer',
      phone: '03001234567',
      city: 'Karachi',
      address: 'Clifton Block 5'
    },
    items: [
      { productId: 'prod-idempotent', price: 4000, quantity: 1, productName: 'Retry Watch' }
    ]
  };

  const first = await OrderService.placeOrder(payload, 'user-idem', { key: checkoutKey });
  const retry = await OrderService.placeOrder(payload, 'user-idem', { key: checkoutKey });

  assert.equal(retry.orderId, first.orderId);
  assert.equal(retry.idempotentReplay, true);
  assert.equal(InventoryService.getMockProductStock('prod-idempotent').physical, 9);
  assert.equal(OrderService.mockOrders.size, ordersBefore + 1);

  await assert.rejects(
    () => OrderService.placeOrder({
      ...payload,
      customer: { ...payload.customer, address: 'Different address' }
    }, 'user-idem', { key: checkoutKey }),
    /different order details/i
  );
  assert.equal(InventoryService.getMockProductStock('prod-idempotent').physical, 9);
});

test('Order Workflow - Customer confirms order to confirmed status', async () => {
  InventoryService.setMockProductStock('prod-2', 5, 0);

  const payload = {
    customer: {
      name: 'Sara Ali',
      phone: '+92 321 7654321',
      city: 'Lahore',
      address: 'Gulberg III, Main Blvd'
    },
    items: [
      { productId: 'prod-2', price: 2500, quantity: 1, productName: 'Oud Sample' }
    ]
  };

  const placed = await OrderService.placeOrder(payload, 'user-102');
  const confirmed = await OrderService.confirmOrderByCustomer(placed.orderId, 'user-102');
  assert.equal(confirmed.status, 'confirmed');

  const order = await OrderService.getOrderById(placed.orderId);
  assert.equal(order.orderStatus, 'confirmed');
});

test('Order Workflow - Courier assignment permanently locks customer cancellation', async () => {
  InventoryService.setMockProductStock('prod-3', 10, 0);

  const payload = {
    customer: {
      name: 'Bilal Tariq',
      phone: '+92 333 9998877',
      city: 'Islamabad',
      address: 'Sector F-7/2, Street 15'
    },
    items: [
      { productId: 'prod-3', price: 12000, quantity: 1, productName: 'Titanium Chrono' }
    ]
  };

  const placed = await OrderService.placeOrder(payload, 'user-103');

  // Admin assigns courier partner & tracking code
  await OrderService.assignCourier(placed.orderId, 'tcs', 'TCS-PK-987654321', 'Dispatched to vault air-courier');

  // Attempt customer cancellation MUST be rejected
  await assert.rejects(
    async () => {
      await OrderService.cancelOrder(placed.orderId, 'Bilal Tariq', 'customer', 'Changed mind');
    },
    {
      name: 'Error',
      message: /Cancellation rejected\. Order has already been assigned to courier or dispatched\./
    }
  );

  const order = await OrderService.getOrderById(placed.orderId);
  assert.equal(order.orderStatus, 'courier_assigned');
  assert.equal(order.courierPartner, 'tcs');
  assert.equal(order.trackingNumber, 'TCS-PK-987654321');
});

test('Order Workflow - Customer can cancel unassigned order before courier assignment', async () => {
  InventoryService.setMockProductStock('prod-4', 10, 0);

  const payload = {
    customer: {
      name: 'Zainab Noor',
      phone: '+92 345 1122334',
      city: 'Rawalpindi',
      address: 'Bahria Town Phase 4'
    },
    items: [
      { productId: 'prod-4', price: 3000, quantity: 1, productName: 'Amber Essence' }
    ]
  };

  const placed = await OrderService.placeOrder(payload, 'user-104');

  // Cancel prior to courier assignment
  const cancelled = await OrderService.cancelOrder(placed.orderId, 'Zainab Noor', 'customer', 'Wrong address entered');
  assert.equal(cancelled.status, 'cancelled');

  const order = await OrderService.getOrderById(placed.orderId);
  assert.equal(order.orderStatus, 'cancelled');
  assert.equal(order.cancellationReason, 'Wrong address entered');
  assert.equal(InventoryService.getMockProductStock('prod-4').physical, 10);
});

test('Order Workflow - Returning a delivered order restores stock once', async () => {
  InventoryService.setMockProductStock('prod-return', 6, 0);
  const placed = await OrderService.placeOrder({
    customer: { name: 'Return Customer', phone: '03001234567', city: 'Lahore', address: 'Test address' },
    items: [{ productId: 'prod-return', price: 2500, quantity: 2, productName: 'Test product' }]
  });
  assert.equal(InventoryService.getMockProductStock('prod-return').physical, 4);

  await OrderService.updateOrderStatus(placed.orderId, 'delivered');
  await OrderService.updateOrderStatus(placed.orderId, 'returned');
  await OrderService.updateOrderStatus(placed.orderId, 'returned');

  assert.equal(InventoryService.getMockProductStock('prod-return').physical, 6);
  assert.equal((await OrderService.getOrderById(placed.orderId)).orderStatus, 'returned');
});

test('Order Workflow - Admin deletion restores stock and removes the order', async () => {
  InventoryService.setMockProductStock('prod-delete', 5, 0);
  const placed = await OrderService.placeOrder({
    customer: { name: 'Delete Customer', phone: '03001234567', city: 'Lahore', address: 'Test address' },
    items: [{ productId: 'prod-delete', price: 2500, quantity: 1, productName: 'Test product' }]
  });

  await OrderService.deleteOrder(placed.orderId);
  await assert.rejects(() => OrderService.deleteOrder(placed.orderId), /not found/i);
  assert.equal(InventoryService.getMockProductStock('prod-delete').physical, 5);
  assert.equal(await OrderService.getOrderById(placed.orderId), null);
});

test('Order Workflow - Admin confirms advance payment moves payment to partially_paid and status to confirmed', async () => {
  PricingService.setMockCatalogItem('prod-adv-test', {
    id: 'prod-adv-test',
    name: 'Advance Watch',
    price: 10000,
    stock: 5,
    admin_id: 'usr-admin-1',
    advance_payment_required: true,
    advance_payment_type: 'percentage',
    advance_payment_percent: 20
  });
  InventoryService.setMockProductStock('prod-adv-test', 5, 0);

  const placed = await OrderService.placeOrder({
    customer: { name: 'Ali Khan', phone: '03001234567', city: 'Karachi', address: 'Clifton Block 2' },
    items: [{ productId: 'prod-adv-test', price: 10000, quantity: 1, productName: 'Advance Watch' }],
    paymentMethod: 'bank_transfer'
  });

  assert.equal(placed.pricing.advancePaymentDue, 2000);

  const confirmed = await OrderService.confirmAdvancePayment(placed.orderId, 'usr-admin-1', {
    transactionReference: 'TRX-MEEZAN-991',
    accountHolderName: 'Ali Khan',
    paymentPlatform: 'Meezan Bank',
    amount: 2000
  });

  assert.equal(confirmed.paymentStatus, 'partially_paid');
  assert.equal(confirmed.proofStatus, 'verified');
  assert.equal(confirmed.transactionReference, 'TRX-MEEZAN-991');
  assert.equal(confirmed.accountHolderName, 'Ali Khan');
  assert.equal(confirmed.paymentPlatform, 'Meezan Bank');
});
