import { Router } from 'express';
import { listCustomers } from '../controllers/customer.controller.js';
import { requireAdmin } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', requireAdmin, listCustomers);

export default router;
