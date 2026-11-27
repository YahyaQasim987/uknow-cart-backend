import { Router } from 'express';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';
import {
  listCouriers,
  createCourier,
  updateCourier,
  deleteCourier,
  testCourier
} from '../controllers/courier.controller.js';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/', listCouriers);
router.post('/', createCourier);
router.put('/:key', updateCourier);
router.delete('/:key', deleteCourier);
router.post('/:key/test', testCourier);

export default router;
