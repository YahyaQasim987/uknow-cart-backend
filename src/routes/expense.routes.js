import { Router } from 'express';
import { ExpenseController } from '../controllers/expense.controller.js';
import { authenticate, requireRole } from '../middlewares/auth.middleware.js';
import { uploadExpenseReceipt } from '../middlewares/upload.middleware.js';
import { optimizeUploadedImages } from '../middlewares/image-compress.middleware.js';

const expenseRouter = Router();

// All expense routes require administrative authentication
expenseRouter.use(authenticate, requireRole('admin'));

// Summary & analytics
expenseRouter.get('/summary', ExpenseController.getFinancialSummary);

// Search orders for linking
expenseRouter.get('/orders/search', ExpenseController.searchOrders);

// CRUD operations
expenseRouter.get('/', ExpenseController.getTransactions);
expenseRouter.post('/', uploadExpenseReceipt, optimizeUploadedImages, ExpenseController.createTransaction);
expenseRouter.put('/:id', uploadExpenseReceipt, optimizeUploadedImages, ExpenseController.updateTransaction);
expenseRouter.delete('/:id', ExpenseController.deleteTransaction);

// Receipt image download / view
expenseRouter.get('/:id/receipt', ExpenseController.getReceiptImage);

export default expenseRouter;
