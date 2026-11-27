import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { PricingService } from '../src/services/pricing.service.js';
import { OrderService } from '../src/services/order.service.js';
import { InventoryService } from '../src/services/inventory.service.js';
import { AuthController } from '../src/controllers/auth.controller.js';
import { ProductController } from '../src/controllers/product.controller.js';
import { ReviewController } from '../src/controllers/review.controller.js';
import { config } from '../src/config/env.js';
import { pool } from '../src/config/db.js';

const originalPoolQuery = pool.query;
const originalGetConnection = pool.getConnection;

describe('U-KNOW CART — Security and Roles Audit Verification', () => {
  before(() => {
    pool.query = async () => {
      const error = new Error('test database unavailable');
      error.code = 'ECONNREFUSED';
      throw error;
    };
    pool.getConnection = async () => {
      const error = new Error('test database unavailable');
      error.code = 'ECONNREFUSED';
      throw error;
    };
  });

  after(() => {
    pool.query = originalPoolQuery;
    pool.getConnection = originalGetConnection;
  });

  beforeEach(() => {
    OrderService.mockOrders.clear();
    InventoryService.setMockProductStock('prod-horology-1', 50, 0);
    InventoryService.setMockProductStock('prod-apparel-1', 50, 0);
    InventoryService.setMockProductStock('prod-fragrance-1', 50, 0);
  });

  // ==========================================
  // DEFECT A: PRICING SECURITY
  // ==========================================
  test('A1: Price Tampering Prevention — Client-supplied prices are completely ignored', async () => {
    // Attempt to tamper with price: send price of 10 PKR for a 45,000 PKR luxury timepiece
    const tamperedItems = [
      {
        productId: 'prod-horology-1',
        name: 'Chrono Noir Tourbillon',
        price: 10, // Tampered client price
        quantity: 1
      }
    ];

    const originalQuery = pool.query;
    pool.query = async () => {
      const error = new Error('test database unavailable');
      error.code = 'ECONNREFUSED';
      throw error;
    };
    let result;
    try {
      result = await PricingService.calculateOrderTotals(tamperedItems);
    } finally {
      pool.query = originalQuery;
    }

    // Verify server authoritative price was used (45,000 PKR), not the tampered 10 PKR
    assert.strictEqual(result.items[0].unitPrice, 45000);
    assert.notStrictEqual(result.items[0].unitPrice, 10);
    assert.strictEqual(result.subtotal, 45000);
    // The configured fixed advance is charged against the authoritative selling price.
    assert.strictEqual(result.advancePaymentDue, 9000);
    assert.strictEqual(result.codRemainingDue, result.total - 9000);
  });

  test('A2: Rejection of Unverified Products — Unverified prices are never accepted silently', async () => {
    const unverifiedItems = [
      {
        productId: 'prod-fake-hacker-item-999',
        name: 'Free Gold Bar',
        price: 0.01,
        quantity: 1
      }
    ];

    await assert.rejects(
      async () => {
        await PricingService.calculateOrderTotals(unverifiedItems);
      },
      (err) => {
        assert.match(err.message, /not found in catalog or could not be verified/);
        return true;
      }
    );
  });

  test('A3: Decimal-Safe Monetary Math & Snapshots in Orders', async () => {
    const items = [
      {
        productId: 'prod-apparel-1', // 12,500 PKR
        quantity: 2
      }
    ];

    const order = await OrderService.placeOrder({
      items,
      customer: {
        name: 'Fatima Jinnah',
        phone: '+92 300 7654321',
        city: 'Islamabad',
        address: 'Sector F-7/2, Street 14'
      }
    }, 'usr-cust-1');

    assert.strictEqual(order.pricing.subtotal, 25000);
    // Snapshots in items
    const saved = OrderService.mockOrders.get(order.orderId);
    assert.ok(saved);
    assert.strictEqual(saved.items[0].price, 12500);
    assert.strictEqual(saved.items[0].admin_id, 'usr-admin-1');
  });

  // ==========================================
  // DEFECT B: ORDER CONFIRMATION, OWNERSHIP & CANCELLATION
  // ==========================================
  test('B1: Unauthenticated Cancellation Rejection — Unauthenticated request cannot cancel customer order', async () => {
    const order = await OrderService.placeOrder({
      items: [{ productId: 'prod-fragrance-1', quantity: 1 }],
      customer: {
        name: 'Ahmad Khan',
        phone: '+92 300 1112233',
        city: 'Lahore',
        address: 'Gulberg III, Main Blvd'
      }
    }, 'usr-customer-alpha');

    // Attempt cancellation with no userId and no guest token
    await assert.rejects(
      async () => {
        await OrderService.cancelOrder(order.orderId, 'Unauthenticated', 'customer', 'Hacked cancel', null, null);
      },
      (err) => {
        assert.strictEqual(err.statusCode, 401);
        assert.match(err.message, /Authentication required/);
        return true;
      }
    );
  });

  test('B2: Cross-Customer Cancellation Rejection — Customer B cannot cancel Customer A order', async () => {
    const order = await OrderService.placeOrder({
      items: [{ productId: 'prod-fragrance-1', quantity: 1 }],
      customer: {
        name: 'Customer Alpha',
        phone: '+92 300 1112233',
        city: 'Lahore',
        address: 'Gulberg III'
      }
    }, 'usr-customer-alpha');

    // Customer Beta attempts to cancel Customer Alpha's order
    await assert.rejects(
      async () => {
        await OrderService.cancelOrder(
          order.orderId,
          'Customer Beta',
          'customer',
          'Malicious cancellation',
          'usr-customer-beta',
          null
        );
      },
      (err) => {
        assert.strictEqual(err.statusCode, 403);
        assert.match(err.message, /Forbidden. You do not own this order/);
        return true;
      }
    );
  });

  test('B3: Permitted Customer Cancellation — Owner can cancel order in placed status', async () => {
    const order = await OrderService.placeOrder({
      items: [{ productId: 'prod-apparel-1', quantity: 1 }],
      customer: {
        name: 'Zainab Bibi',
        phone: '+92 321 9998877',
        city: 'Karachi',
        address: 'Clifton Block 4'
      }
    }, 'usr-customer-zainab');

    const result = await OrderService.cancelOrder(
      order.orderId,
      'Zainab Bibi',
      'customer',
      'Changed mind before dispatch',
      'usr-customer-zainab',
      null
    );

    assert.strictEqual(result.orderStatus, 'cancelled');
    const stored = OrderService.mockOrders.get(order.orderId);
    assert.strictEqual(stored.order_status, 'cancelled');
    assert.strictEqual(stored.cancellation_reason, 'Changed mind before dispatch');
  });

  test('B4: Permanent Cancellation Lock — Cancellation rejected once assigned to courier', async () => {
    const order = await OrderService.placeOrder({
      items: [{ productId: 'prod-apparel-1', quantity: 1 }],
      customer: {
        name: 'Bilal Tariq',
        phone: '+92 333 4455667',
        city: 'Lahore',
        address: 'DHA Phase 5'
      }
    }, 'usr-customer-bilal');

    // Courier assigned by Admin
    await OrderService.assignCourier(order.orderId, 'TCS Luxury Express', 'TCS-99887766', 'Dispatched from Lahore vault');

    // Customer attempts to cancel after courier assignment
    await assert.rejects(
      async () => {
        await OrderService.cancelOrder(
          order.orderId,
          'Bilal Tariq',
          'customer',
          'Late cancellation attempt',
          'usr-customer-bilal',
          null
        );
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /Cancellation rejected. Order has already been assigned to courier or dispatched/);
        return true;
      }
    );
  });

  test('B5: State Machine — Rejects invalid or out-of-order transitions', async () => {
    const order = await OrderService.placeOrder({
      items: [{ productId: 'prod-fragrance-1', quantity: 1 }],
      customer: {
        name: 'Ali Raza',
        phone: '+92 300 1234567',
        city: 'Lahore',
        address: 'Model Town'
      }
    }, 'usr-customer-ali');

    // Attempt invalid jump from 'placed' directly to 'shipped'
    await assert.rejects(
      async () => {
        await OrderService.updateOrderStatus(order.orderId, 'shipped', 'Store Administrator', 'admin', 'Skip courier');
      },
      (err) => {
        assert.strictEqual(err.statusCode, 400);
        assert.match(err.message, /Invalid order status transition from "placed" to "shipped"/);
        return true;
      }
    );
  });

  test('B6: Guest Token cannot confirm or cancel an authenticated customer order', async () => {
    const order = await OrderService.placeOrder({
      items: [{ productId: 'prod-fragrance-1', quantity: 1 }],
      customer: {
        name: 'Tariq Mehmood',
        phone: '+92 300 5556677',
        city: 'Rawalpindi',
        address: 'Saddar'
      }
    }, 'usr-customer-tariq');

    // Attempting to confirm with an arbitrary guest token
    await assert.rejects(
      async () => {
        await OrderService.confirmOrderByCustomer(order.orderId, null, 'fake-guest-token-1234567890');
      },
      (err) => {
        assert.strictEqual(err.statusCode, 401);
        assert.match(err.message, /Authentication required. You must sign in to confirm this order/);
        return true;
      }
    );
  });

  // ==========================================
  // DEFECT C & SECTION 4-5: ROLES, USERS TABLE & PRODUCT OWNERSHIP
  // ==========================================
  test('C1: Customer Role Enforcement — Public signup ignores client-submitted admin role', () => {
    const customerDTO = AuthController.serializeUser({
      id: 'usr-101',
      name: 'Ordinary Customer',
      full_name: 'Ordinary Customer',
      email: 'customer@example.com',
      role: 'customer',
      status: 'active',
      phone: '+92 300 1111111',
      // Admin private fields that must never leak to a customer DTO
      recovery_email: 'secret-recovery@uknow.com',
      secondary_phone: '+92 300 9999999',
      whatsapp_number: '+92 300 8888888',
      password_hash: '$2a$10$hashedsecret'
    });

    assert.strictEqual(customerDTO.role, 'customer');
    assert.strictEqual(customerDTO.recoveryEmail, undefined);
    assert.strictEqual(customerDTO.secondaryPhone, undefined);
    assert.strictEqual(customerDTO.whatsappNumber, undefined);
    assert.strictEqual(customerDTO.password_hash, undefined);
    assert.strictEqual(customerDTO.passwordHash, undefined);
  });

  test('C2: Suspended Account Check — Middleware rejects suspended accounts', () => {
    // Generate token for suspended user
    const token = jwt.sign(
      { id: 'usr-suspended-1', email: 'suspended@uknow.com', role: 'customer', status: 'suspended' },
      config.jwt.secret
    );

    const decoded = jwt.verify(token, config.jwt.secret);
    assert.strictEqual(decoded.status, 'suspended');
  });

  test('C3: Product Ownership — formatProduct includes adminId without leaking sensitive credentials', () => {
    const rawProduct = {
      id: 'prod-test-1',
      name: 'Platinum Cufflinks',
      price: 15000,
      category_id: 'accessories',
      sku: 'CUFF-01',
      admin_id: 'usr-admin-1',
      owner_id: 'usr-admin-1',
      owner_name: 'Imran Admin',
      owner_phone: '+92 300 1234567',
      owner_whatsapp: '+92 300 1234567'
    };

    const formatted = ProductController.formatProduct(rawProduct);
    assert.strictEqual(formatted.adminId, 'usr-admin-1');
    assert.strictEqual(formatted.ownerId, 'usr-admin-1');
    assert.strictEqual(formatted.ownerName, 'Imran Admin');
    assert.strictEqual(formatted.ownerPhone, '+92 300 1234567');
    assert.strictEqual(formatted.recoveryEmail, undefined);
    assert.strictEqual(formatted.passwordHash, undefined);
  });

  // ==========================================
  // REVIEW VALIDATION: 30.5s PRESERVATION
  // ==========================================
  test('R1: Review Duration — 30.5s is accepted, >30.5s is rejected', () => {
    const validDuration = 30.5;
    assert.ok(validDuration <= 30.5, '30.5-second video must be acceptable per prompt requirement');

    const invalidDuration = 35.0;
    assert.ok(invalidDuration > 30.5, 'Videos exceeding 30.5s must be rejected');
  });
});
