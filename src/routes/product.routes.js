import { Router } from 'express';
import { ProductController } from '../controllers/product.controller.js';
import { VariantController } from '../controllers/variant.controller.js';
import { authenticate, optionalAuth, requireAdmin } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', optionalAuth, ProductController.list);
router.get('/facets', ProductController.facets);
router.get('/:id', optionalAuth, ProductController.getById);
// Global SKU generator (admin only) - must stay above the parametric routes.
router.post('/generate-sku', authenticate, requireAdmin, ProductController.generateSku);
router.post('/', authenticate, requireAdmin, ProductController.create);
router.put('/:id', authenticate, requireAdmin, ProductController.update);
router.patch('/:id/restore', authenticate, requireAdmin, ProductController.restore);
router.delete('/:id/permanent', authenticate, requireAdmin, ProductController.purge);
router.delete('/:id', authenticate, requireAdmin, ProductController.delete);

// Variants
router.post('/:productId/variants', authenticate, requireAdmin, VariantController.create);
router.put('/variants/:id', authenticate, requireAdmin, VariantController.update);
router.delete('/variants/:id', authenticate, requireAdmin, VariantController.delete);

export default router;
