import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AuthController, isAllowedSignupEmail } from '../src/controllers/auth.controller.js';
import { getUploadStorageSegment } from '../src/middlewares/upload.middleware.js';
import { requestLogging } from '../src/middlewares/request-logging.middleware.js';
import { logger } from '../src/utils/logger.js';

test('website signup accepts supported mailbox providers, case-insensitively', () => {
  for (const email of [
    'buyer@gmail.com',
    'buyer@googlemail.com',
    'buyer@outlook.com',
    'buyer@outlook.de',
    'buyer@hotmail.com',
    'buyer@yahoo.com',
    'buyer@yahoo.co.uk',
    'buyer@yahoo.com.pk',
    'buyer@icloud.com',
    'buyer@me.com'
  ]) {
    assert.equal(isAllowedSignupEmail(email), true, `${email} should be accepted`);
  }
});

test('website signup rejects disposable, unsupported, and lookalike domains', () => {
  for (const email of [
    'buyer@mailinator.com',
    'buyer@example.net',
    'buyer@gmail.com.evil.test',
    'buyer@fakegmail.com',
    'not-an-email'
  ]) {
    assert.equal(isAllowedSignupEmail(email), false, `${email} should be rejected`);
  }
});

test('serialized user exposes persisted signup method and defaults legacy rows to unknown', () => {
  const user = {
    id: 'user-1',
    name: 'Test Customer',
    email: 'test@gmail.com',
    role: 'customer',
    signup_method: 'google'
  };
  assert.equal(AuthController.serializeUser(user).signupMethod, 'google');
  assert.equal(AuthController.serializeUser({ ...user, signup_method: undefined }).signupMethod, 'unknown');
});

test('website registration rejects claimed social methods without provider verification', async () => {
  let responseStatus = 200;
  let responseBody;
  const response = {
    status(status) {
      responseStatus = status;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    }
  };

  await AuthController.register({ body: { method: 'google' } }, response, error => {
    throw error;
  });

  assert.equal(responseStatus, 400);
  assert.match(responseBody.message, /verified provider credentials/);
});

test('auth request logs include response status and summary without credentials', () => {
  const originalAccess = logger.access;
  let logArguments; 
  logger.access = (...args) => {
    logArguments = args;
  };

  try {
    const response = new EventEmitter();
    response.statusCode = 200;
    response.setHeader = (name, value) => {
      response.headers ??= {};
      response.headers[name] = value;
    };
    response.json = body => body;
    const request = { method: 'POST', path: '/api/v1/auth/login' };

    requestLogging(request, response, () => {});
    response.json({
      success: true,
      message: 'Login successful.',
      token: 'must-not-be-logged',
      user: {
        id: 'private-user-id',
        email: 'private@example.com',
        role: 'customer',
        signupMethod: 'website'
      }
    });
    response.emit('finish');

    assert.ok(request.requestId);
    assert.equal(response.headers['X-Request-Id'], request.requestId);
    const logText = JSON.stringify(logArguments);
    assert.match(logText, /Login successful/);
    assert.match(logText, /customer/);
    assert.doesNotMatch(logText, /must-not-be-logged|private@example.com|private-user-id/);
  } finally {
    logger.access = originalAccess;
  }
});

test('upload storage folders use the requested entity-specific naming', () => {
  assert.equal(getUploadStorageSegment('products', '101'), 'product-101');
  assert.equal(getUploadStorageSegment('categories', '1'), 'category-1');
  assert.equal(getUploadStorageSegment('subcategories', '1'), 'subcategory-1');
  assert.equal(getUploadStorageSegment('banners', 'hero-1'), 'hero-1');
});
