import { Router } from 'express';
import { getTaxSlabs, calculateTax, updateTaxSlab } from '../controllers/tax.controller.js';
import { requireAdmin } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/slabs', getTaxSlabs);
router.post('/calculate', calculateTax);
router.put('/slabs/:id', requireAdmin, updateTaxSlab);

export default router;
