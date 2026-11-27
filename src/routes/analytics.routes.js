import { Router } from 'express';
import { getOverview, getSalesAnalytics } from '../controllers/analytics.controller.js';
import { requireAdmin } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/overview', requireAdmin, getOverview);
router.get('/sales', requireAdmin, getSalesAnalytics);

export default router;
