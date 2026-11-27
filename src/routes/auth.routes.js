import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import { rateLimit } from '../middlewares/rate-limit.middleware.js';

const router = Router();

// Public Authentication & Reset Endpoints (Rate Limited)
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many authentication attempts. Please try again after 15 minutes.' });
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many password reset requests. Please try again after 15 minutes.' });

router.post('/register', authLimiter, AuthController.register);
router.post('/login', authLimiter, AuthController.login);
router.post('/oauth-login', authLimiter, AuthController.oauthLogin);

// Facebook Data Deletion / Deauthorize Callback (required by Facebook App Review)
// Facebook hits this endpoint to notify us when a user removes the app.
// Must return JSON with { url, confirmation_code }
router.post('/facebook/deauthorize', AuthController.facebookDeauthorize);
router.get('/facebook/deauthorize', AuthController.facebookDeauthorize);
router.get('/verify-email', AuthController.verifyEmail);
router.post('/resend-verification', authLimiter, AuthController.resendVerification);
router.post('/forgot-password', resetLimiter, AuthController.forgotPassword);
router.post('/reset-password', resetLimiter, AuthController.resetPassword);

// Authenticated Profile & Password Operations
router.get('/me', authenticate, AuthController.me);
router.get('/profile', authenticate, AuthController.me);
router.put('/profile', authenticate, AuthController.updateProfile);
router.post('/change-password', authenticate, AuthController.changePassword);

// Protected Admin Provisioning (Section 3C)
router.post('/admin/provision', authenticate, requireAdmin, AuthController.provisionAdmin);

export default router;
