import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config/env.js';
import apiRouter from './routes/index.js';
import { notFoundHandler, errorHandler } from './middlewares/error.middleware.js';
import { requestLogging } from './middlewares/request-logging.middleware.js';
import { getIO } from './config/socket.js';
import { SOCKET_EVENTS } from './socket/events.js';
import { logger } from './utils/logger.js';

export const app = express();
const uploadsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../uploads');

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (config.nodeEnv === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(requestLogging);

// Secure Configurable CORS with explicit allowlist (no wildcard with credentials)
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests without origin (cURL, mobile clients, server-to-server)
    if (!origin) return callback(null, true);

    const isAllowed = config.allowedOrigins.includes(origin) ||
      (config.nodeEnv !== 'production' && (origin.includes('localhost') || origin.includes('127.0.0.1')));

    if (isAllowed) {
      return callback(null, true);
    }

    const corsError = new Error(`CORS blocked: Origin "${origin}" is not authorized by server policy.`);
    corsError.statusCode = 403;
    return callback(corsError, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Guest-Token', 'X-Client-Order-Id'],
  exposedHeaders: ['X-Request-Id']
}));

// Body Parsing with safe size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(uploadsDirectory, {
  fallthrough: false,
  maxAge: config.nodeEnv === 'production' ? '1d' : 0
}));

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'atelier-uknow-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    environment: config.nodeEnv
  });
});

// Mount Main API Routes
app.use('/api/v1', (req, res, next) => {
  const method = req.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }
  const requestPath = req.path;
  const resource = requestPath.split('/').filter(Boolean)[0];

  res.once('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;

    const adminMutation = req.user?.role === 'admin';
    const customerOrderMutation = resource === 'orders' && requestPath !== '/orders/pricing/calculate';
    const publicReviewSubmission = resource === 'reviews' && method === 'POST';
    const adEngagement = resource === 'ads' && /\/(impression|click)$/.test(requestPath);

    if (!adminMutation && !customerOrderMutation && !publicReviewSubmission && !adEngagement) return;

    try {
      const event = {
        resource,
        timestamp: new Date().toISOString()
      };
      const io = getIO();
      io.to('admin').emit(SOCKET_EVENTS.ADMIN_DATA_CHANGED, event);
      const storefrontMutation = (adminMutation &&
        ['products', 'categories', 'brands', 'banners', 'discounts', 'settings', 'tax', 'ads', 'reviews'].includes(resource)) ||
        publicReviewSubmission;
      if (storefrontMutation) {
        io.emit(SOCKET_EVENTS.STOREFRONT_DATA_CHANGED, event);
      }
    } catch (error) {
      logger.error('Failed to broadcast admin data change.', {
        resource,
        message: error.message
      });
    }
  });

  next();
});
app.use('/api/v1', apiRouter);

// 404 Handler
app.use(notFoundHandler);

// Centralized Error Handler
app.use(errorHandler);

export default app;
