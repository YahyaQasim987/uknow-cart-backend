import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PresenceService } from '../src/services/presence.service.js';

beforeEach(() => {
  PresenceService.resetForTests();
});

test('PresenceService - Single visitor opening 1 active tab counts as 1 active shopper', () => {
  const count = PresenceService.registerTab('visitor-1', 'tab-1', 'sock-1', true);
  assert.equal(count, 1);
  assert.equal(PresenceService.getActiveCount(), 1);
});

test('PresenceService - Same visitor opening 3 tabs in parallel is deduplicated to 1 active shopper', () => {
  PresenceService.registerTab('visitor-duplicate', 'tab-a', 'sock-a', true);
  PresenceService.registerTab('visitor-duplicate', 'tab-b', 'sock-b', true);
  PresenceService.registerTab('visitor-duplicate', 'tab-c', 'sock-c', true);

  // Multi-tab deduplication: 3 tabs from same visitor = exactly 1 active shopper
  assert.equal(PresenceService.getActiveCount(), 1);
});

test('PresenceService - Two distinct visitors count as 2 active shoppers', () => {
  PresenceService.registerTab('visitor-alpha', 'tab-1', 'sock-1', true);
  PresenceService.registerTab('visitor-beta', 'tab-2', 'sock-2', true);

  assert.equal(PresenceService.getActiveCount(), 2);
});

test('PresenceService - Hiding all tabs for a visitor decrements active shopper count', () => {
  PresenceService.registerTab('visitor-hide', 'tab-1', 'sock-1', true);
  assert.equal(PresenceService.getActiveCount(), 1);

  // Tab hidden via visibilitychange
  PresenceService.updateTabVisibility('visitor-hide', 'tab-1', false);
  assert.equal(PresenceService.getActiveCount(), 0);

  // Tab becomes visible again
  PresenceService.updateTabVisibility('visitor-hide', 'tab-1', true);
  assert.equal(PresenceService.getActiveCount(), 1);
});

test('PresenceService - Multi-tab visitor remains active if at least one tab is visible', () => {
  PresenceService.registerTab('visitor-mixed', 'tab-1', 'sock-1', true);
  PresenceService.registerTab('visitor-mixed', 'tab-2', 'sock-2', false);

  // Still active because tab-1 is visible
  assert.equal(PresenceService.getActiveCount(), 1);

  // Hide tab-1 too
  PresenceService.updateTabVisibility('visitor-mixed', 'tab-1', false);
  assert.equal(PresenceService.getActiveCount(), 0);
});

test('PresenceService - Closing tab cleans up visitor connection', () => {
  PresenceService.registerTab('visitor-close', 'tab-1', 'sock-1', true);
  assert.equal(PresenceService.getActiveCount(), 1);

  PresenceService.removeTab('visitor-close', 'tab-1');
  assert.equal(PresenceService.getActiveCount(), 0);
});
