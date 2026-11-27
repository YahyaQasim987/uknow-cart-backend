import { logger } from '../utils/logger.js';

export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || (res.statusCode >= 400 ? res.statusCode : 500);
  logger.error(`Unhandled error on ${req.method} ${req.path}:`, {
    requestId: req.requestId,
    status: statusCode,
    message: err.message,
    stack: err.stack
  });

  res.status(statusCode).json({
    success: false,
    message: err.isOperational ? err.message : (statusCode === 500 ? 'Internal Server Error' : err.message),
    ...(process.env.NODE_ENV === 'development' && { error: err.message }),
    ...(req.requestId && { requestId: req.requestId })
  });
}

export function notFoundHandler(req, res, next) {
  res.status(404).json({
    success: false,
    message: `Resource not found: ${req.method} ${req.originalUrl}`
  });
}
