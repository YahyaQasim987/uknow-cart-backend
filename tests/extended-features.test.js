import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFBRTaxPure, FBR_EXEMPTION_THRESHOLD_PKR } from '../src/controllers/tax.controller.js';

test('Tax Calculator - PKR 450,000 is 100% exempt from tax (Slab 1)', () => {
  const result = calculateFBRTaxPure(450000);
  assert.equal(result.taxPayablePKR, 0);
  assert.equal(result.isExempt, true);
  assert.equal(result.slabNumber, 1);
  assert.equal(result.effectiveTaxRate, 0);
  assert.equal(result.exemptionRemainingPKR, 150000);
});

test('Tax Calculator - PKR 600,000 exemption boundary (Slab 1)', () => {
  const result = calculateFBRTaxPure(600000);
  assert.equal(result.taxPayablePKR, 0);
  assert.equal(result.isExempt, true);
  assert.equal(result.slabNumber, 1);
});

test('Tax Calculator - PKR 1,000,000 incurs 15% on excess over 600k (Slab 2)', () => {
  // Excess = 400,000 * 0.15 = 60,000
  const result = calculateFBRTaxPure(1000000);
  assert.equal(result.taxPayablePKR, 60000);
  assert.equal(result.isExempt, false);
  assert.equal(result.slabNumber, 2);
  assert.equal(result.netIncomeAfterTaxPKR, 940000);
  assert.equal(result.effectiveTaxRate, 6.0);
});

test('Tax Calculator - PKR 2,000,000 incurs Rs. 90,000 + 20% on excess over 1.2M (Slab 3)', () => {
  // Excess = 800,000 * 0.20 = 160,000 + 90,000 = 250,000
  const result = calculateFBRTaxPure(2000000);
  assert.equal(result.taxPayablePKR, 250000);
  assert.equal(result.slabNumber, 3);
  assert.equal(result.netIncomeAfterTaxPKR, 1750000);
});

test('Tax Calculator - PKR 3,000,000 incurs Rs. 330,000 + 30% on excess over 2.4M (Slab 4)', () => {
  // Excess = 600,000 * 0.30 = 180,000 + 330,000 = 510,000
  const result = calculateFBRTaxPure(3000000);
  assert.equal(result.taxPayablePKR, 510000);
  assert.equal(result.slabNumber, 4);
});

test('Tax Calculator - PKR 4,000,000 incurs Rs. 690,000 + 40% on excess over 3.6M (Slab 5)', () => {
  // Excess = 400,000 * 0.40 = 160,000 + 690,000 = 850,000
  const result = calculateFBRTaxPure(4000000);
  assert.equal(result.taxPayablePKR, 850000);
  assert.equal(result.slabNumber, 5);
});

test('Tax Calculator - PKR 7,000,000 incurs Rs. 1,490,000 + 45% on excess over 5.6M (Slab 6)', () => {
  // Excess = 1,400,000 * 0.45 = 630,000 + 1,490,000 = 2,120,000
  const result = calculateFBRTaxPure(7000000);
  assert.equal(result.taxPayablePKR, 2120000);
  assert.equal(result.slabNumber, 6);
  assert.equal(result.netIncomeAfterTaxPKR, 4880000);
});

test('Customer Tier Logic - LTV >= 200,000 is Royal Patron, >= 80,000 is High VIP, else Verified Client', () => {
  function tier(spend) {
    if (spend >= 200000) return 'Royal Patron';
    if (spend >= 80000) return 'High VIP';
    return 'Verified Client';
  }

  assert.equal(tier(450000), 'Royal Patron');
  assert.equal(tier(200000), 'Royal Patron');
  assert.equal(tier(150000), 'High VIP');
  assert.equal(tier(80000), 'High VIP');
  assert.equal(tier(79999), 'Verified Client');
  assert.equal(tier(15000), 'Verified Client');
});
