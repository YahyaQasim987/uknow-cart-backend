import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductController } from '../src/controllers/product.controller.js';
import { VariantController } from '../src/controllers/variant.controller.js';

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test('product creation rejects inline variant image previews', async () => {
  const req = {
    body: {
      name: 'Test product',
      sku: 'TEST-1',
      category: 'watches',
      price: 100,
      variants: [{
        id: 'var-test-1',
        name: 'Test variant',
        sku: 'TEST-1-V1',
        price: 100,
        images: ['data:image/png;base64,AAAA']
      }]
    },
    user: { id: 'admin-1', role: 'admin' }
  };
  const res = createResponseRecorder();

  await ProductController.create(req, res, error => { throw error; });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /media must be uploaded as files/);
});

test('variant creation rejects inline image previews', async () => {
  const req = {
    params: { productId: 'product-1' },
    body: {
      name: 'Test variant',
      sku: 'TEST-V1',
      price: 100,
      image: 'blob:http://localhost/preview'
    }
  };
  const res = createResponseRecorder();

  await VariantController.create(req, res, error => { throw error; });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /media must be uploaded as files/);
});
