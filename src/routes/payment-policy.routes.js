import { Router } from 'express';
import { PaymentPolicyController } from '../controllers/payment-policy.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', authenticate, requireAdmin, PaymentPolicyController.getPolicies);
router.put('/', authenticate, requireAdmin, PaymentPolicyController.updateGlobalPolicy);
router.post('/cities', authenticate, requireAdmin, PaymentPolicyController.saveCityPolicy);
router.delete('/cities/:id', authenticate, requireAdmin, PaymentPolicyController.deleteCityPolicy);

export default router;
