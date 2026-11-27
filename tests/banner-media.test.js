import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHeroBanner,
  updateHeroBanner,
  createPromoCard,
  updatePromoCard
} from '../src/controllers/banner.controller.js';

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

for (const [operation, handler, params, body] of [
  ['hero banner creation', createHeroBanner, {}, { desktopImage: 'data:image/png;base64,AAAA' }],
  ['hero banner update', updateHeroBanner, { id: 'hero-1' }, { mobileImage: 'blob:http://localhost/preview' }],
  ['promo card creation', createPromoCard, {}, { image: 'data:image/png;base64,AAAA' }],
  ['promo card update', updatePromoCard, { id: 'promo-1' }, { mobileImage: 'blob:http://localhost/preview' }]
]) {
  test(`${operation} rejects inline image previews`, async () => {
    const req = { params, body };
    const res = createResponseRecorder();

    await handler(req, res, error => { throw error; });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /images must be uploaded as files/);
  });
}
