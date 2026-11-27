import { Router } from 'express';
import { ReviewController } from '../controllers/review.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import { rateLimit } from '../middlewares/rate-limit.middleware.js';
import { uploadReviewVideo } from '../middlewares/upload.middleware.js';

const router = Router();

// Public reviews by product
router.get('/product/:productId', ReviewController.listForProduct);

// Submit review (rate-limited, must be authenticated verified buyer)
router.post('/', rateLimit({ max: 20 }), authenticate, uploadReviewVideo, ReviewController.submit);

// Admin moderation & listing
router.get('/admin/all', authenticate, requireAdmin, ReviewController.listAllAdmin);
router.patch('/:id/moderate', authenticate, requireAdmin, ReviewController.moderate);

export default router;
