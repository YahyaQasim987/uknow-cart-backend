import { Router } from 'express';
import { getBroadcastAudienceCounts, listBroadcasts, sendBroadcast, deleteBroadcast } from '../controllers/broadcast.controller.js';
import { requireAdmin } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', requireAdmin, listBroadcasts);
router.get('/audiences', requireAdmin, getBroadcastAudienceCounts);
router.post('/', requireAdmin, sendBroadcast);
router.delete('/:id', requireAdmin, deleteBroadcast);

export default router;
