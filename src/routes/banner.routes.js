import { Router } from 'express';
import {
  getStorefrontBanners,
  listHeroBanners,
  createHeroBanner,
  updateHeroBanner,
  deleteHeroBanner,
  listPromoCards,
  createPromoCard,
  updatePromoCard,
  deletePromoCard,
  listTrustIndicators,
  createTrustIndicator,
  updateTrustIndicator,
  deleteTrustIndicator,
  getCarouselSettings,
  updateCarouselSettings
} from '../controllers/banner.controller.js';
import { requireAdmin, optionalAuth } from '../middlewares/auth.middleware.js';

const router = Router();

// Storefront combined bundle
router.get('/', optionalAuth, getStorefrontBanners);

// Carousel Settings
router.get('/carousel-settings', getCarouselSettings);
router.put('/carousel-settings', requireAdmin, updateCarouselSettings);

// Hero Banners
router.get('/hero', listHeroBanners);
router.post('/hero', requireAdmin, createHeroBanner);
router.put('/hero/:id', requireAdmin, updateHeroBanner);
router.delete('/hero/:id', requireAdmin, deleteHeroBanner);

// Promo Cards
router.get('/promo', listPromoCards);
router.post('/promo', requireAdmin, createPromoCard);
router.put('/promo/:id', requireAdmin, updatePromoCard);
router.delete('/promo/:id', requireAdmin, deletePromoCard);

// Trust Indicators
router.get('/trust', listTrustIndicators);
router.post('/trust', requireAdmin, createTrustIndicator);
router.put('/trust/:id', requireAdmin, updateTrustIndicator);
router.delete('/trust/:id', requireAdmin, deleteTrustIndicator);

export default router;
