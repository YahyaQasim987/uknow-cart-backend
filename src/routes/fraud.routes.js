import { Router } from 'express';
import {
  getBlacklistedCities,
  addBlacklistedCity,
  removeBlacklistedCity,
  checkFraudRisk
} from '../controllers/fraud.controller.js';
import { requireAdmin } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/cities', getBlacklistedCities);
router.post('/cities', requireAdmin, addBlacklistedCity);
router.delete('/cities/:city', requireAdmin, removeBlacklistedCity);
router.post('/check', checkFraudRisk);

export default router;
