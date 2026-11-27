import { Router } from 'express';
import { InventoryController } from '../controllers/inventory.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', authenticate, requireAdmin, InventoryController.list);
router.get('/levels', authenticate, requireAdmin, InventoryController.list);
router.post('/adjust', authenticate, requireAdmin, InventoryController.adjustStock);
router.patch('/:productId', authenticate, requireAdmin, InventoryController.adjustStock);

export default router;
