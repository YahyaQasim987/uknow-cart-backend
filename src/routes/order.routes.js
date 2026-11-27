import { Router } from 'express';
import { OrderController } from '../controllers/order.controller.js';
import { authenticate, optionalAuth, requireAdmin, requireCustomer, requireCustomerAuthOrGuestToken } from '../middlewares/auth.middleware.js';
import { uploadPaymentProof } from '../middlewares/upload.middleware.js';
import { optimizeUploadedImages } from '../middlewares/image-compress.middleware.js';
import { rateLimit } from '../middlewares/rate-limit.middleware.js';
import { createRefund, listRefunds, requestCustomerRefund, updateRefund } from '../controllers/refund.controller.js';
import {
  bookPostExShipment,
  getPostExLabel,
  preparePostExShipment,
  trackPostExShipment
} from '../controllers/postex.controller.js';
import {
  bookOrderShipment,
  cancelOrderShipment,
  getOrderLabel,
  previewOrderShipment,
  trackOrderShipment
} from '../controllers/courier.controller.js';

const router = Router();

// Pricing
router.post('/pricing/calculate', OrderController.calculatePricing);

// Placement (Guest placement receives secure guestAccessToken, authenticated receives user linkage)
router.post('/', rateLimit({ max: 30 }), optionalAuth, OrderController.place);

// Customer endpoints (optionalAuth strictly removed from sensitive order state operations)
router.get('/my-orders', authenticate, OrderController.listCustomer);
router.post('/:id/payment-proofs', authenticate, uploadPaymentProof, optimizeUploadedImages, OrderController.submitPaymentProof);
router.get('/:id/payment-proofs/:proofId/image', authenticate, OrderController.getPaymentProofImage);
router.delete('/:id/customer-visibility', authenticate, OrderController.hideCustomerOrder);
router.get('/:id', requireCustomerAuthOrGuestToken, OrderController.getById);
router.post('/:id/confirm', requireCustomerAuthOrGuestToken, OrderController.confirm);
router.post('/:id/cancel', requireCustomerAuthOrGuestToken, OrderController.cancel);
router.post('/:id/refunds/request', authenticate, requestCustomerRefund);

// Admin endpoints
router.get('/', authenticate, requireAdmin, OrderController.listAdmin);
router.patch('/:id/courier', authenticate, requireAdmin, OrderController.assignCourier);
router.patch('/:id/shipped', authenticate, requireAdmin, OrderController.markShipped);
router.patch('/:id/status', authenticate, requireAdmin, OrderController.updateStatus);
router.post('/:id/confirm-advance', authenticate, requireAdmin, OrderController.confirmAdvancePayment);
router.patch('/:id/payment-proofs/:proofId/review', authenticate, requireAdmin, OrderController.reviewPaymentProof);
router.get('/:id/refunds', authenticate, requireAdmin, listRefunds);
router.post('/:id/refunds', authenticate, requireAdmin, createRefund);
router.patch('/:id/refunds/:refundId', authenticate, requireAdmin, updateRefund);
router.get('/:id/courier/preview', authenticate, requireAdmin, previewOrderShipment);
router.post('/:id/courier/book', authenticate, requireAdmin, bookOrderShipment);
router.get('/:id/courier/track', authenticate, requireAdmin, trackOrderShipment);
router.post('/:id/courier/cancel', authenticate, requireAdmin, cancelOrderShipment);
router.get('/:id/courier/label', authenticate, requireAdmin, getOrderLabel);
router.post('/:id/postex/prepare', authenticate, requireAdmin, preparePostExShipment);
router.post('/:id/postex/book', authenticate, requireAdmin, bookPostExShipment);
router.get('/:id/postex/tracking', authenticate, requireAdmin, trackPostExShipment);
router.get('/:id/postex/label', authenticate, requireAdmin, getPostExLabel);
router.delete('/:id', authenticate, requireAdmin, OrderController.deleteOrder);

export default router;
