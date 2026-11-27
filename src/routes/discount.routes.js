import { Router } from 'express';
import { DiscountController } from '../controllers/discount.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';

const router = Router();

// Coupons
router.get('/coupons', authenticate, requireAdmin, DiscountController.listCoupons);
router.post('/coupons', authenticate, requireAdmin, DiscountController.createCoupon);
router.delete('/coupons/:id', authenticate, requireAdmin, DiscountController.deleteCoupon);

// Product Discounts
router.post('/apply-product', authenticate, requireAdmin, DiscountController.applyProductDiscount);
router.post('/apply-bulk', authenticate, requireAdmin, DiscountController.applyBulkDiscount);
router.post('/remove-product', authenticate, requireAdmin, DiscountController.removeProductDiscount);

export default router;
