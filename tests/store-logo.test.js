import test from 'node:test';
import assert from 'node:assert/strict';
import { SettingController } from '../src/controllers/setting.controller.js';

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },
    send(content) {
      this.body = content;
      return this;
    },
    redirect(url) {
      this.statusCode = 302;
      this.redirectUrl = url;
      return this;
    }
  };
}

test('Store Logo - GET /api/v1/settings/logo returns valid store logo payload', async () => {
  const req = {};
  const res = createMockResponse();

  await SettingController.getLogo(req, res, err => { throw err; });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.ok(typeof res.body.storeName === 'string' && res.body.storeName.length > 0);
  assert.equal(typeof res.body.brandAccentColor, 'string');
  assert.ok('logoUrl' in res.body);
  assert.ok('hasCustomLogo' in res.body);
});

test('Store Logo - GET /api/v1/settings/logo/file serves SVG placeholder or image redirect', async () => {
  const req = {};
  const res = createMockResponse();

  await SettingController.getLogoFile(req, res, err => { throw err; });

  assert.ok(res.statusCode === 200 || res.statusCode === 302);
  if (res.statusCode === 200) {
    assert.equal(res.headers['Content-Type'], 'image/svg+xml');
    assert.match(res.body, /<svg/);
    assert.match(res.body, /U-KNOW CART/);
  }
});

test('Store Logo - POST /api/v1/settings/logo rejects upload with missing file', async () => {
  const req = { file: null };
  const res = createMockResponse();

  await SettingController.uploadLogo(req, res, err => { throw err; });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Select a logo image file/);
});

test('Store Logo - PUT /api/v1/settings/logo rejects empty logoUrl', async () => {
  const req = { body: { logoUrl: '' } };
  const res = createMockResponse();

  await SettingController.updateLogo(req, res, err => { throw err; });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /Provide a valid logoUrl/);
});
