import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/config/db.js';
import { ProductController } from '../src/controllers/product.controller.js';
import { ProductImageService } from '../src/services/product-image.service.js';
import { toCanonicalMediaKey } from '../src/utils/product-media.js';

test.after(async () => {
  await pool.end();
});

test('product serialization preserves persisted catalog fields without fake image data', () => {
  const product = ProductController.formatProduct({
    id: 'prod-1',
    name: 'Persisted product',
    category_id: 'watches',
    price: '1250.00',
    stock: 7,
    reserved_stock: 2,
    sku: 'WATCH-1',
    description: 'Stored description',
    tags: '["featured"]',
    advance_payment_value: '250.00',
    is_new: true
  });

  assert.equal(product.id, 'prod-1');
  assert.equal(product.availableStock, 5);
  assert.deepEqual(product.tags, ['featured']);
  assert.equal(product.advancePaymentValue, 250);
  assert.equal(product.isNew, true);
  assert.deepEqual(product.images, []);
});

test('toCanonicalMediaKey normalizes local upload origins without touching external URLs', () => {
  assert.equal(
    toCanonicalMediaKey('http://localhost:4100/uploads/products/product-1/img.jpg'),
    '/uploads/products/product-1/img.jpg'
  );
  assert.equal(
    toCanonicalMediaKey('/uploads/products/product-1/img.jpg'),
    '/uploads/products/product-1/img.jpg'
  );
  assert.equal(
    toCanonicalMediaKey('https://images.unsplash.com/photo-123?auto=format'),
    'https://images.unsplash.com/photo-123?auto=format'
  );
});

test('syncProductGallery keeps existing local images when client submits origin-stripped /uploads paths', async () => {
  const queries = [];
  const mockConnection = {
    async query(sql, params) {
      queries.push({ sql, params });
      return [[]];
    }
  };
  const oldGallery = [
    {
      id: 30004,
      image_url: 'http://localhost:4100/uploads/products/product-prod-1/image-a.jpg',
      image_checksum: 'a'.repeat(64),
      display_order: 0
    },
    {
      id: 30005,
      image_url: 'http://localhost:4100/uploads/products/product-prod-1/image-b.jpg',
      image_checksum: 'b'.repeat(64),
      display_order: 1
    }
  ];

  await ProductController.syncProductGallery(mockConnection, 'prod-1', oldGallery, [
    '/uploads/products/product-prod-1/image-a.jpg',
    '/uploads/products/product-prod-1/image-b.jpg'
  ]);

  assert.equal(queries.length, 0);
});

test('syncProductGallery deletes removed rows before inserting replacement URL with matching checksum', async () => {
  const queries = [];
  const activeChecksums = new Set(['same-checksum']);
  const originalChecksumForUrl = ProductImageService.checksumForUrl;
  ProductImageService.checksumForUrl = async () => 'same-checksum';

  try {
    const mockConnection = {
      async query(sql, params) {
        queries.push({ sql, params });
        if (sql.startsWith('DELETE FROM product_images')) {
          activeChecksums.clear();
        } else if (sql.startsWith('INSERT INTO product_images')) {
          const checksum = params[2];
          if (activeChecksums.has(checksum)) {
            const err = new Error('Duplicate entry');
            err.code = 'ER_DUP_ENTRY';
            throw err;
          }
          activeChecksums.add(checksum);
        }
        return [[]];
      }
    };

    await ProductController.syncProductGallery(
      mockConnection,
      'prod-1',
      [{ id: 10, image_url: '/uploads/products/product-prod-1/old.jpg', image_checksum: 'same-checksum', display_order: 0 }],
      ['/uploads/products/product-prod-1/new.jpg']
    );

    assert.equal(queries.length, 2);
    assert.match(queries[0].sql, /^DELETE FROM product_images/);
    assert.match(queries[1].sql, /^INSERT INTO product_images/);
  } finally {
    ProductImageService.checksumForUrl = originalChecksumForUrl;
  }
});

test('collectRemovedMediaUrls ignores local origin differences while reporting removed media', () => {
  const existingRow = {
    banner_image: 'http://localhost:4100/uploads/products/product-prod-1/desktop.jpg',
    banner_desktop_image: 'http://localhost:4100/uploads/products/product-prod-1/desktop.jpg',
    banner_tablet_image: 'http://localhost:4100/uploads/products/product-prod-1/tablet.jpg',
    banner_mobile_image: 'http://localhost:4100/uploads/products/product-prod-1/mobile.jpg',
    hover_image: null
  };
  const updatedRow = {
    banner_image: '/uploads/products/product-prod-1/desktop.jpg',
    banner_desktop_image: '/uploads/products/product-prod-1/desktop.jpg',
    banner_tablet_image: '/uploads/products/product-prod-1/tablet-new.jpg',
    banner_mobile_image: '/uploads/products/product-prod-1/mobile.jpg',
    hover_image: null
  };
  const oldGallery = [
    { id: 1, image_url: 'http://localhost:4100/uploads/products/product-prod-1/img1.jpg' },
    { id: 2, image_url: 'http://localhost:4100/uploads/products/product-prod-1/img2.jpg' }
  ];

  const removed = ProductController.collectRemovedMediaUrls(
    existingRow,
    updatedRow,
    oldGallery,
    ['/uploads/products/product-prod-1/img1.jpg']
  );

  assert.deepEqual(removed, [
    'http://localhost:4100/uploads/products/product-prod-1/img2.jpg',
    'http://localhost:4100/uploads/products/product-prod-1/tablet.jpg'
  ]);
});

test('ProductController.update enables showInCarousel with origin-stripped /uploads media without ER_DUP_ENTRY', async () => {
  const originalPoolQuery = pool.query.bind(pool);
  const originalGetConnection = pool.getConnection.bind(pool);
  const originalGetFormattedProduct = ProductController.getFormattedProduct;

  const existingRow = {
    admin_id: 'admin-1',
    owner_id: 'admin-1',
    sku: 'UK-FRAG-202611-00005',
    price: '3900.00',
    advance_payment_required: 0,
    advance_payment_type: 'percentage',
    advance_payment_amount: null,
    advance_payment_percent: null,
    advance_payment_value: null,
    delivery_advance_required: 0,
    delivery_advance_type: 'percentage',
    delivery_advance_value: null,
    urgent_delivery_advance_required: 0,
    urgent_delivery_advance_type: 'percentage',
    urgent_delivery_advance_value: null,
    banner_image: 'http://localhost:4100/uploads/products/product-prod-1/desktop.jpg',
    banner_desktop_image: 'http://localhost:4100/uploads/products/product-prod-1/desktop.jpg',
    banner_tablet_image: 'http://localhost:4100/uploads/products/product-prod-1/tablet.jpg',
    banner_mobile_image: 'http://localhost:4100/uploads/products/product-prod-1/mobile.jpg',
    hover_image: null
  };
  const galleryRows = [
    {
      id: 30004,
      image_url: 'http://localhost:4100/uploads/products/product-prod-1/img1.jpg',
      image_checksum: 'c'.repeat(64),
      display_order: 0
    }
  ];
  const connectionQueries = [];
  let committed = false;

  pool.query = async sql => {
    if (sql.includes('FROM products WHERE id = ?') && sql.includes('admin_id')) {
      return [[existingRow]];
    }
    if (sql.includes('FROM product_images WHERE product_id = ?')) {
      return [galleryRows];
    }
    if (sql.includes('SELECT banner_image, banner_desktop_image')) {
      return [[{
        banner_image: '/uploads/products/product-prod-1/desktop.jpg',
        banner_desktop_image: '/uploads/products/product-prod-1/desktop.jpg',
        banner_tablet_image: '/uploads/products/product-prod-1/tablet.jpg',
        banner_mobile_image: '/uploads/products/product-prod-1/mobile.jpg',
        hover_image: null
      }]];
    }
    return [[]];
  };
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async query(sql, params) {
      connectionQueries.push({ sql, params });
      if (sql.startsWith('SELECT id FROM categories')) return [[{ id: 'fragrances' }]];
      return [[]];
    },
    async commit() { committed = true; },
    async rollback() {},
    release() {}
  });
  ProductController.getFormattedProduct = async id => ({ id, showInCarousel: true });

  const req = {
    params: { id: 'prod-1' },
    user: { id: 'admin-1', role: 'admin' },
    body: {
      name: 'Benetton Colors Man Blue',
      category: 'fragrances',
      price: 3900,
      sku: 'UK-FRAG-202611-00005',
      showInCarousel: true,
      images: ['/uploads/products/product-prod-1/img1.jpg'],
      bannerImage: '/uploads/products/product-prod-1/desktop.jpg',
      bannerDesktopImage: '/uploads/products/product-prod-1/desktop.jpg',
      bannerTabletImage: '/uploads/products/product-prod-1/tablet.jpg',
      bannerMobileImage: '/uploads/products/product-prod-1/mobile.jpg'
    }
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    let forwardedError = null;
    await ProductController.update(req, res, err => { forwardedError = err; });
    assert.equal(forwardedError, null);
    assert.equal(committed, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.product.showInCarousel, true);
    assert.equal(
      connectionQueries.some(q => q.sql.includes('INSERT INTO product_images')),
      false
    );
    const productUpdateQuery = connectionQueries.find(q => q.sql.startsWith('UPDATE products SET'));
    assert.ok(productUpdateQuery);
    assert.match(productUpdateQuery.sql, /show_in_carousel = \?/);
  } finally {
    pool.query = originalPoolQuery;
    pool.getConnection = originalGetConnection;
    ProductController.getFormattedProduct = originalGetFormattedProduct;
  }
});

test('ProductController.facets returns exact storefront section counts alongside category and brand facets', async () => {
  const originalPoolQuery = pool.query.bind(pool);
  let callIndex = 0;

  pool.query = async () => {
    callIndex += 1;
    if (callIndex === 1) return [[{ id: 'watches', count: 1 }]];
    if (callIndex === 2) return [[{ name: 'Rolex', count: 1 }]];
    if (callIndex === 3) return [[{ brand: 'Rolex', category: 'watches', count: 1 }]];
    if (callIndex === 4) {
      return [[{ shopTotal: 1, homeCount: 1, carouselCount: 0, bannerProductCount: 0 }]];
    }
    return [[{ heroBannerCount: 2, promoCardCount: 1, trustCount: 4 }]];
  };

  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };

  try {
    let forwardedError = null;
    await ProductController.facets({}, res, err => { forwardedError = err; });
    assert.equal(forwardedError, null);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.storefrontCounts, {
      shopTotal: 1,
      homeCount: 1,
      carouselCount: 0,
      bannerProductCount: 0,
      heroBannerCount: 2,
      promoCardCount: 1,
      trustCount: 4
    });
  } finally {
    pool.query = originalPoolQuery;
  }
});
