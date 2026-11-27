import test from 'node:test';
import assert from 'node:assert/strict';
import { PostExService } from '../src/services/postex.service.js';

test('PostEx draft contains order data without booking a shipment', () => {
  const draft = PostExService.prepareShipment({
    id: 'AUK-1',
    customer: { name: 'Test Customer', phone: '03001234567', city: 'Lahore', address: 'Test address' },
    paymentMethod: 'cod',
    total: 2500,
    trackingNumber: '',
    items: [{ productName: 'Test product', quantity: 2, price: 1000, variantId: null }]
  });

  assert.equal(draft.integrationEnabled, false);
  assert.equal(draft.mode, 'draft');
  assert.equal(draft.reference, 'AUK-1');
  assert.equal(draft.payment.codAmount, 2500);
  assert.equal(draft.items[0].quantity, 2);
  assert.equal(draft.labelUrl, null);
});

test('PostEx booking, tracking, and label adapters fail explicitly while disabled', () => {
  for (const operation of ['bookShipment', 'trackShipment', 'getLabel']) {
    assert.throws(() => PostExService[operation](), {
      statusCode: 503,
      message: /disabled until official API documentation and server-side credentials/
    });
  }
});
