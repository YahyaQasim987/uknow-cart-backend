import { randomUUID } from 'node:crypto';
import { logger } from '../utils/logger.js';

const minimumLevel = ({ error: 0, warn: 1, info: 2, debug: 3 })[process.env.LOG_LEVEL || 'warn'] ?? 1;

function responseSummary(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }

  const summary = {};
  for (const key of ['success', 'message', 'method']) {
    if (typeof body[key] === 'boolean' || typeof body[key] === 'string') {
      summary[key] = body[key];
    }
  }
  if (body.user && typeof body.user === 'object') {
    summary.user = {
      role: body.user.role,
      signupMethod: body.user.signupMethod
    };
  }
  return summary;
}

export function requestLogging(req, res, next) {
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  const requestId = randomUUID();
  const startedAt = Date.now();
  const isAuthRequest = req.path.startsWith('/api/v1/auth/');
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const originalJson = res.json.bind(res);
  let safeResponse;
  res.json = body => {
    safeResponse = isAuthRequest ? responseSummary(body) : undefined;
    return originalJson(body);
  };

  res.on('finish', () => {
    const details = {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      ...(safeResponse && { response: safeResponse })
    };
    const message = `API ${req.method} ${req.path}`;

    // Production logging stays quiet on successful non-auth calls and only
    // surfaces real API failures (validation/auth rejections and server errors).
    if (res.statusCode >= 500) {
      logger.error(message, details);
    } else if (res.statusCode >= 400) {
      logger.warn(message, details);
    } else if (isAuthRequest) {
      logger.access(message, details);
    } else if (minimumLevel >= 3) {
      logger.debug(message, details);
    }
  });

  next();
}
