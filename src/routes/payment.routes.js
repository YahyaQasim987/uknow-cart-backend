import { Router } from 'express';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import {
  releasePaymentReview,
  updatePaymentStatus
} from '../controllers/payment.controller.js';

const router = Router();

router.patch('/orders/:id/status', authenticate, requireAdmin, updatePaymentStatus);
router.post('/orders/:id/release-review', authenticate, requireAdmin, releasePaymentReview);

export default router;
