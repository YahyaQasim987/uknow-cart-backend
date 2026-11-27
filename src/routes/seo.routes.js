import { Router } from 'express';
import { SeoController } from '../controllers/seo.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';

const router = Router();

// Public SEO feeds
router.get('/robots.txt', SeoController.getRobots);
router.get('/sitemap.xml', SeoController.getSitemap);
router.get('/sitemap', SeoController.getSitemap);
router.get('/redirects', SeoController.listRedirects);
router.get('/entities', SeoController.listEntities);
router.get('/entity', SeoController.getEntity);
router.get('/jsonld/:productId', SeoController.getJsonLd);

// Admin SEO overrides & Redirects
router.get('/admin/entities', authenticate, requireAdmin, SeoController.listAdminEntities);
router.get('/admin/redirects', authenticate, requireAdmin, SeoController.listAdminRedirects);
router.get('/images', authenticate, requireAdmin, SeoController.listImageAlts);
router.put('/images/:id', authenticate, requireAdmin, SeoController.saveImageAlt);
router.get('/robots', authenticate, requireAdmin, SeoController.getRobotsConfig);
router.put('/robots', authenticate, requireAdmin, SeoController.updateRobotsConfig);
router.get('/audit', authenticate, requireAdmin, SeoController.listAuditIssues);
router.patch('/audit/:id', authenticate, requireAdmin, SeoController.updateAuditIssue);
router.get('/keywords', authenticate, requireAdmin, SeoController.listKeywords);
router.post('/keywords', authenticate, requireAdmin, SeoController.createKeyword);
router.delete('/keywords/:id', authenticate, requireAdmin, SeoController.deleteKeyword);
router.put('/entities/:id', authenticate, requireAdmin, SeoController.updateEntity);
router.post('/redirects', authenticate, requireAdmin, SeoController.createRedirect);
router.patch('/redirects/:id', authenticate, requireAdmin, SeoController.updateRedirect);
router.delete('/redirects/:id', authenticate, requireAdmin, SeoController.deleteRedirect);

export default router;
