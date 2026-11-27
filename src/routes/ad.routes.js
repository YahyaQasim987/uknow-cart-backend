import { Router } from 'express';
import { AdController } from '../controllers/ad.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';

const router = Router();

// Public endpoints
router.get('/', AdController.listActive);
router.post('/:id/impression', AdController.recordImpression);
router.post('/:id/click', AdController.recordClick);

// Admin endpoints
router.get('/admin/all', authenticate, requireAdmin, AdController.listAdmin);
router.post('/', authenticate, requireAdmin, AdController.create);
router.put('/:id', authenticate, requireAdmin, AdController.update);
router.delete('/:id', authenticate, requireAdmin, AdController.delete);
router.patch('/:id/moderate', authenticate, requireAdmin, AdController.moderate);

export default router;
