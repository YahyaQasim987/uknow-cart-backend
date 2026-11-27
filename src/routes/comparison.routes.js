import { Router } from 'express';
import {
  getProviders,
  updateProvider,
  getOverrides,
  createOverride,
  deleteOverride,
  compareProduct
} from '../controllers/comparison.controller.js';
import { requireAdmin } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/providers', getProviders);
router.put('/providers/:id', requireAdmin, updateProvider);

router.get('/overrides', getOverrides);
router.post('/overrides', requireAdmin, createOverride);
router.delete('/overrides/:id', requireAdmin, deleteOverride);

router.get('/product/:productId', compareProduct);

export default router;
