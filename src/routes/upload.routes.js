import { Router } from 'express';
import { UploadController } from '../controllers/upload.controller.js';
import { SettingController } from '../controllers/setting.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import { uploadSingleImage, uploadStoreLogo } from '../middlewares/upload.middleware.js';
import { optimizeUploadedImages } from '../middlewares/image-compress.middleware.js';

const router = Router();

// Store Logo upload endpoint
router.post('/logo', authenticate, requireAdmin, uploadStoreLogo, optimizeUploadedImages, SettingController.uploadLogo);

router.post('/:entity/:id/:variant', authenticate, requireAdmin, uploadSingleImage, optimizeUploadedImages, UploadController.saveImage);
router.post('/products/:productId/variants/:variantId/image', authenticate, requireAdmin, uploadSingleImage, optimizeUploadedImages, UploadController.saveVariantImage);

export default router;
