import test from 'node:test';
import assert from 'node:assert/strict';
import { InventoryService } from '../src/services/inventory.service.js';

test('InventoryService - Available stock equals physical minus reserved', () => {
  InventoryService.setMockProductStock('inv-item-1', 10, 3);
  const item = InventoryService.getMockProductStock('inv-item-1');
  const available = item.physical - item.reserved;
  assert.equal(available, 7);
});

test('InventoryService - Atomic reservation rejects when requested quantity exceeds available stock', async () => {
  InventoryService.setMockProductStock('inv-item-2', 5, 4); // Only 1 available

  await assert.rejects(
    async () => {
      await InventoryService.reserveStockTransactionally(null, 'test-order-overflow', [
        { productId: 'inv-item-2', quantity: 2 }
      ]);
    },
    {
      name: 'Error',
      message: /Insufficient stock/
    }
  );
});

test('InventoryService - Successful reservation increments reserved counter', async () => {
  InventoryService.setMockProductStock('inv-item-3', 15, 2); // 13 available

  await InventoryService.reserveStockTransactionally(null, 'test-order-ok', [
    { productId: 'inv-item-3', quantity: 4 }
  ]);

  const state = InventoryService.getMockProductStock('inv-item-3');
  assert.equal(state.physical, 15);
  assert.equal(state.reserved, 6);
  assert.equal(state.physical - state.reserved, 9); // 9 available
});

test('InventoryService - Checkout deducts stock and restoration is idempotent', async () => {
  InventoryService.setMockProductStock('inv-item-checkout', 8, 2);

  const changes = await InventoryService.deductStockForOrder(null, 'checkout-order', [
    { productId: 'inv-item-checkout', quantity: 3 }
  ]);
  assert.equal(changes[0].availableStock, 3);
  assert.deepEqual(InventoryService.getMockProductStock('inv-item-checkout'), { physical: 5, reserved: 2 });

  await InventoryService.restoreOrderStock(null, 'checkout-order');
  await InventoryService.restoreOrderStock(null, 'checkout-order');
  assert.deepEqual(InventoryService.getMockProductStock('inv-item-checkout'), { physical: 8, reserved: 2 });
});

test('InventoryService - Shipment commit decrements physical stock and clears reservation', async () => {
  InventoryService.setMockProductStock('inv-item-4', 20, 0);
  await InventoryService.reserveStockTransactionally(null, 'test-order-ship', [
    { productId: 'inv-item-4', quantity: 5 }
  ]);

  await InventoryService.commitReservationOnShipment(null, 'test-order-ship');

  const state = InventoryService.getMockProductStock('inv-item-4');
  assert.equal(state.physical, 15); // Decremented from 20 to 15
  assert.equal(state.reserved, 0);  // Reserved cleared
  assert.equal(state.physical - state.reserved, 15); // Available remains constant (15)
});
