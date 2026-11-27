import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ReviewController } from '../src/controllers/review.controller.js';
import { AdController } from '../src/controllers/ad.controller.js';
import { SeoController } from '../src/controllers/seo.controller.js';
import { CartController } from '../src/controllers/cart.controller.js';
import { WishlistController } from '../src/controllers/wishlist.controller.js';

test('Video-Only Reviews - Rejects a review without an uploaded video', async () => {
  let statusCode = 200;
  let jsonResponse = null;

  const req = {
    user: { id: 'usr-1', name: 'Zaid' },
    body: {
      productId: 'p-1',
      rating: 5,
      comment: 'Great product, looks amazing!'
      // video file omitted
    }
  };

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      jsonResponse = data;
      return res;
    }
  };

  await ReviewController.submit(req, res, (err) => { throw err; });

  assert.equal(statusCode, 400);
  assert.equal(jsonResponse.success, false);
  assert.match(jsonResponse.message, /Upload a video review/);
});

test('Video-Only Reviews - Rejects video exceeding 30-second duration constraint', async () => {
  let statusCode = 200;
  let jsonResponse = null;
  const videoPath = path.join(tmpdir(), `review-${randomUUID()}.mp4`);
  await writeFile(videoPath, Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0]));

  const req = {
    user: { id: 'usr-1', name: 'Zaid' },
    body: {
      productId: 'p-1',
      rating: 5,
      comment: 'Detailed unboxing',
      videoDuration: 45 // 45 seconds > 30 seconds limit
    },
    file: { path: videoPath, filename: 'review.mp4', mimetype: 'video/mp4' }
  };

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      jsonResponse = data;
      return res;
    }
  };

  await ReviewController.submit(req, res, (err) => { throw err; });

  assert.equal(statusCode, 400);
  assert.equal(jsonResponse.success, false);
  assert.match(jsonResponse.message, /no longer than 30.5 seconds/);
});

test('Ad Anti-Inflation - Deduplicates repeat impressions from same IP within 30 seconds', async () => {
  let statusCode = 200;
  let jsonResponse = null;

  const req = {
    params: { id: 'ad-test-dedup' },
    ip: '192.168.1.50',
    headers: {}
  };

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      jsonResponse = data;
      return res;
    }
  };

  // First call (hits DB or offline DB error caught in try/catch or mocked)
  try {
    await AdController.recordImpression(req, res, () => {});
  } catch (e) {}

  // Immediate second call from same IP should be deduplicated
  await AdController.recordImpression(req, res, (err) => { throw err; });
  assert.equal(jsonResponse.success, true);
  assert.match(jsonResponse.message, /already logged recently/);
});

test('SEO Controller - Prevents redirect loops when source equals destination', async () => {
  let statusCode = 200;
  let jsonResponse = null;

  const req = {
    body: {
      sourceUrl: '/products/perfume-oud',
      destinationUrl: '/products/perfume-oud',
      statusCode: 301
    }
  };

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      jsonResponse = data;
      return res;
    }
  };

  await SeoController.createRedirect(req, res, (err) => { throw err; });

  assert.equal(statusCode, 400);
  assert.equal(jsonResponse.success, false);
  assert.match(jsonResponse.message, /Circular redirect detected/);
});

test('Cart Controller - Requires positive integer quantity when adding item', async () => {
  let statusCode = 200;
  let jsonResponse = null;

  const req = {
    user: { id: 'usr-cart-1' },
    body: {
      productId: 'p-1',
      quantity: 0
    }
  };

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      jsonResponse = data;
      return res;
    }
  };

  await CartController.addItem(req, res, (err) => { throw err; });

  assert.equal(statusCode, 400);
  assert.equal(jsonResponse.success, false);
  assert.match(jsonResponse.message, /Quantity must be a positive integer/);
});

test('Wishlist Controller - Requires valid productId when adding item', async () => {
  let statusCode = 200;
  let jsonResponse = null;

  const req = {
    user: { id: 'usr-wish-1' },
    body: {}
  };

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      jsonResponse = data;
      return res;
    }
  };

  await WishlistController.addItem(req, res, (err) => { throw err; });

  assert.equal(statusCode, 400);
  assert.equal(jsonResponse.success, false);
  assert.match(jsonResponse.message, /productId is required/);
});
