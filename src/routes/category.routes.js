import { Router } from 'express';
import { CategoryController, BrandController } from '../controllers/category.controller.js';
import { authenticate, requireAdmin } from '../middlewares/auth.middleware.js';

export const categoryRouter = Router();
export const brandRouter = Router();

// Category Routes
categoryRouter.get('/', CategoryController.list);
categoryRouter.post('/', authenticate, requireAdmin, CategoryController.create);
categoryRouter.put('/:id', authenticate, requireAdmin, CategoryController.update);
categoryRouter.delete('/:id', authenticate, requireAdmin, CategoryController.delete);
categoryRouter.post('/:categoryId/subcategories', authenticate, requireAdmin, CategoryController.createSubcategory);
categoryRouter.put('/subcategories/:id', authenticate, requireAdmin, CategoryController.updateSubcategory);
categoryRouter.delete('/subcategories/:id', authenticate, requireAdmin, CategoryController.deleteSubcategory);

// Brand Routes
brandRouter.get('/', BrandController.list);
brandRouter.post('/', authenticate, requireAdmin, BrandController.create);
brandRouter.put('/:id', authenticate, requireAdmin, BrandController.update);
brandRouter.delete('/:id', authenticate, requireAdmin, BrandController.delete);

export default { categoryRouter, brandRouter };
