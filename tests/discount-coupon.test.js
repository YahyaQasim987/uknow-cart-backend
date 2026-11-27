import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscountController } from '../src/controllers/discount.controller.js';

test('Discount Controller - listCoupons returns success with coupon array', async () => {
  let jsonResponse = null;
  const mockRes = {
    json: (data) => {
      jsonResponse = data;
      return mockRes;
    }
  };
  await DiscountController.listCoupons({}, mockRes, (err) => { throw err; });
  assert.equal(jsonResponse.success, true);
  assert.ok(Array.isArray(jsonResponse.coupons));
});

test('Discount Controller - createCoupon requires code and discountPercent', async () => {
  let statusCode = 200;
  let jsonResponse = null;
  const mockReq = { body: { code: '' } };
  const mockRes = {
    status: (code) => {
      statusCode = code;
      return mockRes;
    },
    json: (data) => {
      jsonResponse = data;
      return mockRes;
    }
  };
  await DiscountController.createCoupon(mockReq, mockRes, (err) => { throw err; });
  assert.equal(statusCode, 400);
  assert.equal(jsonResponse.success, false);
});

test('Discount Controller - applyProductDiscount requires productId', async () => {
  let statusCode = 200;
  let jsonResponse = null;
  const mockReq = { body: {} };
  const mockRes = {
    status: (code) => {
      statusCode = code;
      return mockRes;
    },
    json: (data) => {
      jsonResponse = data;
      return mockRes;
    }
  };
  await DiscountController.applyProductDiscount(mockReq, mockRes, (err) => { throw err; });
  assert.equal(statusCode, 400);
  assert.equal(jsonResponse.success, false);
});

test('Discount Controller - applyProductDiscount succeeds with valid params', async () => {
  let jsonResponse = null;
  const mockReq = { body: { productId: 'test-p1', discountType: 'percentage', discountValue: 15 } };
  const mockRes = {
    json: (data) => {
      jsonResponse = data;
      return mockRes;
    }
  };
  await DiscountController.applyProductDiscount(mockReq, mockRes, (err) => { throw err; });
  assert.equal(jsonResponse.success, true);
  assert.match(jsonResponse.message, /Discount of 15% applied to product test-p1/);
});

test('Discount Controller - applyBulkDiscount succeeds for category and all', async () => {
  let jsonResponse = null;
  const mockReq = { body: { category: 'watches', discountType: 'fixed', discountValue: 500 } };
  const mockRes = {
    json: (data) => {
      jsonResponse = data;
      return mockRes;
    }
  };
  await DiscountController.applyBulkDiscount(mockReq, mockRes, (err) => { throw err; });
  assert.equal(jsonResponse.success, true);
  assert.match(jsonResponse.message, /category "watches"/);
});
