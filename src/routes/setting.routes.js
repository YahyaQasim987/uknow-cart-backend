import { Router } from 'express';
import { SettingController, CouponController } from '../controllers/setting.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import { uploadStoreLogo } from '../middlewares/upload.middleware.js';
import { optimizeUploadedImages } from '../middlewares/image-compress.middleware.js';

const router = Router();

// Store Logo APIs
router.get('/logo', SettingController.getLogo);
router.get('/logo/file', SettingController.getLogoFile);
router.post('/logo', authenticate, requireAdmin, uploadStoreLogo, optimizeUploadedImages, SettingController.uploadLogo);
router.put('/logo', authenticate, requireAdmin, SettingController.updateLogo);
router.delete('/logo', authenticate, requireAdmin, SettingController.deleteLogo);

// Store settings
router.get('/', SettingController.getSettings);
router.put('/', authenticate, requireAdmin, SettingController.updateSettings);

// Coupon validation
router.get('/coupon/:code', CouponController.validate);

export default router;
