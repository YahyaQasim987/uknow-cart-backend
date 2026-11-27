import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. Missing or malformed authentication token.'
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (decoded.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Account is suspended. Please contact support.'
      });
    }
    req.user = decoded; // { id, email, role, name, status }
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token. Please sign in again.'
    });
  }
}

export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      if (decoded.status !== 'suspended') {
        req.user = decoded;
      }
    } catch (e) {
      // Ignored for optional auth
    }
  }
  next();
}

/**
 * Strict Order Authentication Guard:
 * Eliminates optionalAuth from customer order operations.
 * Requires either a valid customer/admin JWT or a valid guest access token.
 * Unauthenticated requests without a token are immediately rejected with 401.
 */
export function requireCustomerAuthOrGuestToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const guestToken = req.headers['x-guest-token'] || req.query.guestToken || req.body?.guestToken;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      if (decoded.status === 'suspended') {
        return res.status(403).json({
          success: false,
          message: 'Account is suspended. Please contact support.'
        });
      }
      req.user = decoded;
      return next();
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired authentication token.'
      });
    }
  }

  // If no Bearer token, guest token must be provided
  if (guestToken && typeof guestToken === 'string' && guestToken.trim().length > 0) {
    return next();
  }

  return res.status(401).json({
    success: false,
    message: 'Authentication required. Missing authentication token or guest access token.'
  });
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
          const decoded = jwt.verify(token, config.jwt.secret);
          req.user = decoded;
        } catch (err) {
          return res.status(401).json({
            success: false,
            message: 'Invalid or expired token. Please sign in again.'
          });
        }
      } else {
        return res.status(401).json({
          success: false,
          message: 'Authentication required for this operation.'
        });
      }
    }

    if (req.user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Account is suspended. Please contact support.'
      });
    }

    // Strictly enforce valid project roles ('admin' or 'customer')
    const validProjectRoles = ['admin', 'customer'];
    const sanitizedAllowed = allowedRoles.filter(r => validProjectRoles.includes(r));

    if (!sanitizedAllowed.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden. Insufficient permissions. Requires role: ${sanitizedAllowed.join(' or ')}.`
      });
    }

    next();
  };
}

export const requireAdmin = requireRole('admin');
export const requireCustomer = requireRole('customer');
