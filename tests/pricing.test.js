import test from 'node:test';
import assert from 'node:assert/strict';
import { PricingService } from '../src/services/pricing.service.js';
import { pool } from '../src/config/db.js';

const originalQuery = pool.query;
test.before(() => {
  pool.query = async () => {
    const error = new Error('test database unavailable');
    error.code = 'ECONNREFUSED';
    throw error;
  };
});

test.after(async () => {
  pool.query = originalQuery;
  try {
    await pool.end();
  } catch (e) {}
});

test('PricingService - Standard delivery fee of 350 PKR applies and automatic free delivery is removed', async () => {
  const items = [
    { productId: 'p1', price: 2000, quantity: 1, productName: 'Scent Sample' }
  ];

  const result = await PricingService.calculateOrderTotals(items, { deliverySpeed: 'standard' });

  assert.equal(result.subtotal, 2000);
  assert.equal(result.freeShippingEligible, false);
  assert.equal(result.shippingFee, 350);
  assert.equal(result.urgentFee, 0);
  assert.equal(result.totalShipping, 350);
  assert.equal(result.total, 2350);
});

test('PricingService - No automatic free shipping for orders >= 3500 PKR; standard 350 PKR fee applies', async () => {
  const items = [
    { productId: 'p2', price: 3500, quantity: 1, productName: 'Silk Scarf' }
  ];

  const result = await PricingService.calculateOrderTotals(items, { deliverySpeed: 'standard' });

  assert.equal(result.subtotal, 3500);
  assert.equal(result.freeShippingEligible, false);
  assert.equal(result.shippingFee, 350);
  assert.equal(result.totalShipping, 350);
  assert.equal(result.total, 3850);
});

test('PricingService - Product-specific delivery charges apply when configured by admin', async () => {
  const items = [
    { productId: 'prod-custom-delivery', quantity: 1 }
  ];

  const result = await PricingService.calculateOrderTotals(items, { deliverySpeed: 'standard' });

  assert.equal(result.subtotal, 4000);
  assert.equal(result.shippingFee, 450); // Explicit product delivery charge
  assert.equal(result.totalShipping, 450);
  assert.equal(result.total, 4450);
});

test('PricingService - Urgent delivery adds 600 PKR fee to standard 350 PKR fee', async () => {
  const items = [
    { productId: 'p3', price: 5000, quantity: 1, productName: 'Horology Timepiece' }
  ];

  const result = await PricingService.calculateOrderTotals(items, { deliverySpeed: 'urgent' });

  assert.equal(result.subtotal, 5000);
  assert.equal(result.freeShippingEligible, false);
  assert.equal(result.shippingFee, 350);
  assert.equal(result.urgentFee, 600);
  assert.equal(result.totalShipping, 950);
  assert.equal(result.total, 5950);
});

test('PricingService - PRIVILEGE20 coupon applies 20% discount correctly with standard shipping', async () => {
  const items = [
    { productId: 'p4', price: 10000, quantity: 1, productName: 'Oud Royale' }
  ];

  const result = await PricingService.calculateOrderTotals(items, {
    couponCode: 'PRIVILEGE20',
    deliverySpeed: 'standard'
  });

  assert.equal(result.subtotal, 10000);
  assert.equal(result.discountAmount, 2000);
  assert.equal(result.appliedCoupon?.percent, 20);
  assert.equal(result.shippingFee, 350);
  assert.equal(result.total, 8350);
});

test('PricingService - advance-configured products split advance and COD balances', async () => {
  const items = [
    { productId: 'p5', price: 50000, quantity: 1, productName: 'Tourbillon Grand Complication' }
  ];

  const result = await PricingService.calculateOrderTotals(items, { deliverySpeed: 'standard' });

  assert.equal(result.subtotal, 50000);
  assert.equal(result.advancePaymentDue, 10000);
  // Total = 50,000 subtotal + 350 delivery; the configured advance is paid before delivery.
  assert.equal(result.total, 50350);
  assert.equal(result.codRemainingDue, 40350);
});

test('PricingService - percentage advance method calculates exact PKR amount (10% of 10000 = 1000 PKR)', async () => {
  const items = [
    { productId: 'p6', price: 10000, quantity: 1, productName: 'Emerald Pendant' }
  ];

  const result = await PricingService.calculateOrderTotals(items, { deliverySpeed: 'standard' });

  assert.equal(result.subtotal, 10000);
  assert.equal(result.advancePaymentDue, 1000); // 10% of 10,000 = 1,000 PKR
  assert.equal(result.total, 10350); // 10,000 + 350 delivery
  assert.equal(result.codRemainingDue, 9350); // 10350 - 1000
});
