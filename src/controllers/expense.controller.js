import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pool, executeQuery as query } from '../config/db.js';
import { privateReceiptsRoot } from '../middlewares/upload.middleware.js';

export class ExpenseController {
  /**
   * Calculate financial summary based on actual orders, product costs, and expense transactions.
   * Accounting formula:
   * 1. Net Sales = Gross Sales - Discounts - Returns
   * 2. Gross Profit = Net Sales - COGS (Cost of Goods Sold)
   * 3. Net Profit = Gross Profit - Business Expenses + Additional Business Income
   */
  static async getFinancialSummary(req, res, next) {
    try {
      const { startDate, endDate, month, year } = req.query;

      // Construct date filters for orders and expenses
      let orderDateClause = '';
      let orderParams = [];
      let expenseDateClause = '';
      let expenseParams = [];

      if (month && /^\d{4}-\d{2}$/.test(month)) {
        orderDateClause = " AND DATE_FORMAT(COALESCE(o.delivered_at, o.created_at), '%Y-%m') = ?";
        orderParams.push(month);
        expenseDateClause = " AND DATE_FORMAT(transaction_date, '%Y-%m') = ?";
        expenseParams.push(month);
      } else if (year && /^\d{4}$/.test(year)) {
        orderDateClause = " AND DATE_FORMAT(COALESCE(o.delivered_at, o.created_at), '%Y') = ?";
        orderParams.push(year);
        expenseDateClause = " AND DATE_FORMAT(transaction_date, '%Y') = ?";
        expenseParams.push(year);
      } else if (startDate && endDate) {
        orderDateClause = ' AND DATE(COALESCE(o.delivered_at, o.created_at)) BETWEEN ? AND ?';
        orderParams.push(startDate, endDate);
        expenseDateClause = ' AND transaction_date BETWEEN ? AND ?';
        expenseParams.push(startDate, endDate);
      } else if (startDate) {
        orderDateClause = ' AND DATE(COALESCE(o.delivered_at, o.created_at)) >= ?';
        orderParams.push(startDate);
        expenseDateClause = ' AND transaction_date >= ?';
        expenseParams.push(startDate);
      } else if (endDate) {
        orderDateClause = ' AND DATE(COALESCE(o.delivered_at, o.created_at)) <= ?';
        orderParams.push(endDate);
        expenseDateClause = ' AND transaction_date <= ?';
        expenseParams.push(endDate);
      }

      // 1. Gross Sales, Discounts, and Completed Order Counts
      // Realized completed sales: orders delivered or completed
      const [salesRows] = await pool.query(`
        SELECT 
          COALESCE(SUM(o.subtotal), 0) AS gross_sales,
          COALESCE(SUM(o.discount_amount), 0) AS total_discounts,
          COUNT(DISTINCT o.id) AS delivered_orders_count
        FROM orders o
        WHERE o.order_status = 'delivered'
          ${orderDateClause}
      `, orderParams);

      // Returns and Refunds: orders that were returned or refunded
      const [returnRows] = await pool.query(`
        SELECT 
          COALESCE(SUM(o.subtotal), 0) AS total_returns,
          COUNT(DISTINCT o.id) AS returned_orders_count
        FROM orders o
        WHERE (o.order_status = 'returned' OR o.payment_status = 'refunded')
          ${orderDateClause}
      `, orderParams);

      // 2. Cost of Goods Sold (COGS) for delivered orders
      // Calculated from actual sold quantities and cost_price (falling back to variant/product cost_price)
      const [cogsRows] = await pool.query(`
        SELECT 
          COALESCE(SUM(
            COALESCE(oi.cost_price, v.cost_price, p.cost_price, 0) * oi.quantity
          ), 0) AS total_cogs
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants v ON v.id = oi.variant_id
        WHERE o.order_status = 'delivered'
          ${orderDateClause}
      `, orderParams);

      // 3. Business Expenses & Additional Business Income (excluding soft-deleted)
      const [expenseSummaryRows] = await pool.query(`
        SELECT 
          COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses,
          COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS additional_income,
          COUNT(CASE WHEN type = 'expense' THEN 1 END) AS expense_count,
          COUNT(CASE WHEN type = 'income' THEN 1 END) AS income_count
        FROM expense_transactions
        WHERE deleted_at IS NULL
          ${expenseDateClause}
      `, expenseParams);

      // 4. Breakdown of Expenses by Category
      const [expenseCategories] = await pool.query(`
        SELECT 
          category,
          COALESCE(SUM(amount), 0) AS total_amount,
          COUNT(*) AS transaction_count
        FROM expense_transactions
        WHERE type = 'expense' AND deleted_at IS NULL
          ${expenseDateClause}
        GROUP BY category
        ORDER BY total_amount DESC
      `, expenseParams);

      // 5. Breakdown of Income by Category
      const [incomeCategories] = await pool.query(`
        SELECT 
          category,
          COALESCE(SUM(amount), 0) AS total_amount,
          COUNT(*) AS transaction_count
        FROM expense_transactions
        WHERE type = 'income' AND deleted_at IS NULL
          ${expenseDateClause}
        GROUP BY category
        ORDER BY total_amount DESC
      `, expenseParams);

      const grossSales = Number(salesRows[0]?.gross_sales) || 0;
      const totalDiscounts = Number(salesRows[0]?.total_discounts) || 0;
      const totalReturns = Number(returnRows[0]?.total_returns) || 0;
      const deliveredOrdersCount = Number(salesRows[0]?.delivered_orders_count) || 0;
      const returnedOrdersCount = Number(returnRows[0]?.returned_orders_count) || 0;

      // Net Sales = Gross Sales - Discounts - Returns
      const netSales = Math.max(0, grossSales - totalDiscounts - totalReturns);

      // COGS (Product Cost)
      const totalProductCost = Number(cogsRows[0]?.total_cogs) || 0;

      // Gross Profit = Net Sales - COGS
      const grossProfit = netSales - totalProductCost;

      // Operating Expenses & Additional Business Income
      const totalExpenses = Number(expenseSummaryRows[0]?.total_expenses) || 0;
      const additionalIncome = Number(expenseSummaryRows[0]?.additional_income) || 0;
      const expenseCount = Number(expenseSummaryRows[0]?.expense_count) || 0;
      const incomeCount = Number(expenseSummaryRows[0]?.income_count) || 0;

      // Net Business Profit = Gross Profit - Operating Expenses + Additional Income
      const netProfit = grossProfit - totalExpenses + additionalIncome;

      // Profit Margins
      const grossMarginPercent = netSales > 0 ? (grossProfit / netSales) * 100 : 0;
      const netMarginPercent = netSales > 0 ? (netProfit / netSales) * 100 : 0;

      res.json({
        success: true,
        data: {
          period: {
            startDate: startDate || null,
            endDate: endDate || null,
            month: month || null,
            year: year || null
          },
          summary: {
            grossSales,
            totalDiscounts,
            totalReturns,
            netSales,
            totalProductCost,
            grossProfit,
            totalExpenses,
            additionalIncome,
            netProfit,
            grossMarginPercent: Number(grossMarginPercent.toFixed(2)),
            netMarginPercent: Number(netMarginPercent.toFixed(2)),
            deliveredOrdersCount,
            returnedOrdersCount,
            expenseCount,
            incomeCount
          },
          expenseCategories,
          incomeCategories
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List all expense and income records with search, filter, and pagination
   */
  static async getTransactions(req, res, next) {
    try {
      const {
        type,
        category,
        startDate,
        endDate,
        month,
        year,
        search,
        orderId,
        page = 1,
        limit = 50
      } = req.query;

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
      const offset = (pageNum - 1) * limitNum;

      const whereClauses = ['et.deleted_at IS NULL'];
      const params = [];

      if (type && ['expense', 'income'].includes(type.toLowerCase())) {
        whereClauses.push('et.type = ?');
        params.push(type.toLowerCase());
      }

      if (category && category.trim()) {
        whereClauses.push('et.category = ?');
        params.push(category.trim());
      }

      if (orderId && orderId.trim()) {
        whereClauses.push('et.order_id = ?');
        params.push(orderId.trim());
      }

      if (month && /^\d{4}-\d{2}$/.test(month)) {
        whereClauses.push("DATE_FORMAT(et.transaction_date, '%Y-%m') = ?");
        params.push(month);
      } else if (year && /^\d{4}$/.test(year)) {
        whereClauses.push("DATE_FORMAT(et.transaction_date, '%Y') = ?");
        params.push(year);
      } else if (startDate && endDate) {
        whereClauses.push('et.transaction_date BETWEEN ? AND ?');
        params.push(startDate, endDate);
      } else if (startDate) {
        whereClauses.push('et.transaction_date >= ?');
        params.push(startDate);
      } else if (endDate) {
        whereClauses.push('et.transaction_date <= ?');
        params.push(endDate);
      }

      if (search && search.trim()) {
        whereClauses.push('(et.description LIKE ? OR et.category LIKE ? OR et.order_id LIKE ?)');
        const searchPattern = `%${search.trim()}%`;
        params.push(searchPattern, searchPattern, searchPattern);
      }

      const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

      // Count query
      const [countResult] = await pool.query(`
        SELECT COUNT(*) AS total
        FROM expense_transactions et
        ${whereSql}
      `, params);

      const totalRecords = Number(countResult[0]?.total) || 0;

      // Records query with user join and order details
      const [rows] = await pool.query(`
        SELECT 
          et.id,
          et.type,
          et.category,
          et.amount,
          et.description,
          et.order_id AS orderId,
          DATE_FORMAT(et.transaction_date, '%Y-%m-%d') AS transactionDate,
          et.receipt_image_path AS receiptImagePath,
          et.created_at AS createdAt,
          et.updated_at AS updatedAt,
          u_creator.name AS createdByName,
          u_updater.name AS updatedByName,
          o.total AS orderTotal,
          o.order_status AS orderStatus,
          o.customer_name AS orderCustomerName
        FROM expense_transactions et
        LEFT JOIN users u_creator ON u_creator.id = et.created_by
        LEFT JOIN users u_updater ON u_updater.id = et.updated_by
        LEFT JOIN orders o ON o.id = et.order_id
        ${whereSql}
        ORDER BY et.transaction_date DESC, et.created_at DESC
        LIMIT ? OFFSET ?
      `, [...params, limitNum, offset]);

      const transactions = rows.map(r => ({
        id: r.id,
        type: r.type,
        category: r.category,
        amount: Number(r.amount),
        description: r.description,
        orderId: r.orderId,
        transactionDate: r.transactionDate,
        hasReceipt: Boolean(r.receiptImagePath),
        receiptUrl: r.receiptImagePath ? `/api/v1/expenses/${r.id}/receipt` : null,
        createdByName: r.createdByName || 'Administrator',
        updatedByName: r.updatedByName || null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        order: r.orderId ? {
          id: r.orderId,
          total: Number(r.orderTotal) || 0,
          status: r.orderStatus,
          customerName: r.orderCustomerName
        } : null
      }));

      res.json({
        success: true,
        data: transactions,
        pagination: {
          total: totalRecords,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(totalRecords / limitNum) || 1
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new expense or income transaction
   */
  static async createTransaction(req, res, next) {
    let uploadedReceiptPath = req.file?.path;
    try {
      const { type, category, amount, description, orderId, transactionDate } = req.body || {};

      if (!type || !['expense', 'income'].includes(type.toLowerCase())) {
        return res.status(400).json({
          success: false,
          message: 'Transaction type must be either "expense" or "income".'
        });
      }

      if (!category || typeof category !== 'string' || !category.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Category is required and must not be empty.'
        });
      }

      const numericAmount = Number(amount);
      if (isNaN(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Amount must be a valid positive number in PKR.'
        });
      }

      if (!description || typeof description !== 'string' || !description.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Description / reason is required.'
        });
      }

      let sanitizedOrderId = null;
      if (orderId && typeof orderId === 'string' && orderId.trim()) {
        sanitizedOrderId = orderId.trim();
        const [orders] = await pool.query('SELECT id FROM orders WHERE id = ?', [sanitizedOrderId]);
        if (!orders.length) {
          return res.status(400).json({
            success: false,
            message: `Related Order "${sanitizedOrderId}" was not found.`
          });
        }
      }

      let formattedDate = new Date().toISOString().split('T')[0];
      if (transactionDate && typeof transactionDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(transactionDate.trim())) {
        formattedDate = transactionDate.trim();
      }

      const transactionId = `exp-${crypto.randomUUID()}`;
      const receiptFilename = req.file ? path.basename(req.file.path) : null;
      const adminId = req.user?.id || null;

      await pool.query(`
        INSERT INTO expense_transactions 
          (id, type, category, amount, description, order_id, transaction_date, receipt_image_path, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        transactionId,
        type.toLowerCase(),
        category.trim(),
        numericAmount,
        description.trim(),
        sanitizedOrderId,
        formattedDate,
        receiptFilename,
        adminId,
        adminId
      ]);

      const [created] = await pool.query(`
        SELECT 
          et.id, et.type, et.category, et.amount, et.description, et.order_id AS orderId,
          DATE_FORMAT(et.transaction_date, '%Y-%m-%d') AS transactionDate,
          et.receipt_image_path AS receiptImagePath,
          et.created_at AS createdAt,
          u.name AS createdByName
        FROM expense_transactions et
        LEFT JOIN users u ON u.id = et.created_by
        WHERE et.id = ?
      `, [transactionId]);

      const item = created[0];
      res.status(201).json({
        success: true,
        message: `${type.toLowerCase() === 'expense' ? 'Expense' : 'Income'} recorded successfully.`,
        data: {
          id: item.id,
          type: item.type,
          category: item.category,
          amount: Number(item.amount),
          description: item.description,
          orderId: item.orderId,
          transactionDate: item.transactionDate,
          hasReceipt: Boolean(item.receiptImagePath),
          receiptUrl: item.receiptImagePath ? `/api/v1/expenses/${item.id}/receipt` : null,
          createdByName: item.createdByName || 'Administrator',
          createdAt: item.createdAt
        }
      });
    } catch (error) {
      if (uploadedReceiptPath) {
        fs.unlink(uploadedReceiptPath, () => {});
      }
      next(error);
    }
  }

  /**
   * Update an existing expense or income transaction
   */
  static async updateTransaction(req, res, next) {
    let uploadedReceiptPath = req.file?.path;
    try {
      const { id } = req.params;
      const { type, category, amount, description, orderId, transactionDate, removeReceipt } = req.body || {};

      const [existingRows] = await pool.query(`
        SELECT * FROM expense_transactions WHERE id = ? AND deleted_at IS NULL
      `, [id]);

      if (!existingRows.length) {
        return res.status(404).json({
          success: false,
          message: 'Transaction not found or has already been deleted.'
        });
      }

      const existing = existingRows[0];

      // Validate type if provided
      let updatedType = existing.type;
      if (type !== undefined) {
        if (!['expense', 'income'].includes(type.toLowerCase())) {
          return res.status(400).json({
            success: false,
            message: 'Transaction type must be either "expense" or "income".'
          });
        }
        updatedType = type.toLowerCase();
      }

      // Validate category if provided
      let updatedCategory = existing.category;
      if (category !== undefined) {
        if (typeof category !== 'string' || !category.trim()) {
          return res.status(400).json({
            success: false,
            message: 'Category must not be empty.'
          });
        }
        updatedCategory = category.trim();
      }

      // Validate amount if provided
      let updatedAmount = Number(existing.amount);
      if (amount !== undefined) {
        const num = Number(amount);
        if (isNaN(num) || num <= 0) {
          return res.status(400).json({
            success: false,
            message: 'Amount must be a valid positive number in PKR.'
          });
        }
        updatedAmount = num;
      }

      // Validate description if provided
      let updatedDescription = existing.description;
      if (description !== undefined) {
        if (typeof description !== 'string' || !description.trim()) {
          return res.status(400).json({
            success: false,
            message: 'Description / reason must not be empty.'
          });
        }
        updatedDescription = description.trim();
      }

      // Validate orderId if provided
      let updatedOrderId = existing.order_id;
      if (orderId !== undefined) {
        if (!orderId || !orderId.trim()) {
          updatedOrderId = null;
        } else {
          const sanitized = orderId.trim();
          const [orders] = await pool.query('SELECT id FROM orders WHERE id = ?', [sanitized]);
          if (!orders.length) {
            return res.status(400).json({
              success: false,
              message: `Related Order "${sanitized}" was not found.`
            });
          }
          updatedOrderId = sanitized;
        }
      }

      // Validate transactionDate if provided
      let updatedDate = existing.transaction_date;
      if (transactionDate !== undefined && typeof transactionDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(transactionDate.trim())) {
        updatedDate = transactionDate.trim();
      }

      // Handle receipt image replacement or removal
      let updatedReceiptPath = existing.receipt_image_path;
      if (req.file) {
        // New file uploaded -> remove old file
        if (existing.receipt_image_path) {
          const oldFile = path.resolve(privateReceiptsRoot, existing.receipt_image_path);
          fs.unlink(oldFile, () => {});
        }
        updatedReceiptPath = path.basename(req.file.path);
      } else if (removeReceipt === 'true' || removeReceipt === true) {
        if (existing.receipt_image_path) {
          const oldFile = path.resolve(privateReceiptsRoot, existing.receipt_image_path);
          fs.unlink(oldFile, () => {});
        }
        updatedReceiptPath = null;
      }

      const adminId = req.user?.id || null;

      await pool.query(`
        UPDATE expense_transactions
        SET 
          type = ?,
          category = ?,
          amount = ?,
          description = ?,
          order_id = ?,
          transaction_date = ?,
          receipt_image_path = ?,
          updated_by = ?
        WHERE id = ?
      `, [
        updatedType,
        updatedCategory,
        updatedAmount,
        updatedDescription,
        updatedOrderId,
        updatedDate,
        updatedReceiptPath,
        adminId,
        id
      ]);

      const [updatedRows] = await pool.query(`
        SELECT 
          et.id, et.type, et.category, et.amount, et.description, et.order_id AS orderId,
          DATE_FORMAT(et.transaction_date, '%Y-%m-%d') AS transactionDate,
          et.receipt_image_path AS receiptImagePath,
          et.created_at AS createdAt,
          et.updated_at AS updatedAt,
          u_creator.name AS createdByName,
          u_updater.name AS updatedByName
        FROM expense_transactions et
        LEFT JOIN users u_creator ON u_creator.id = et.created_by
        LEFT JOIN users u_updater ON u_updater.id = et.updated_by
        WHERE et.id = ?
      `, [id]);

      const item = updatedRows[0];
      res.json({
        success: true,
        message: 'Transaction updated successfully.',
        data: {
          id: item.id,
          type: item.type,
          category: item.category,
          amount: Number(item.amount),
          description: item.description,
          orderId: item.orderId,
          transactionDate: item.transactionDate,
          hasReceipt: Boolean(item.receiptImagePath),
          receiptUrl: item.receiptImagePath ? `/api/v1/expenses/${item.id}/receipt` : null,
          createdByName: item.createdByName || 'Administrator',
          updatedByName: item.updatedByName || null,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        }
      });
    } catch (error) {
      if (uploadedReceiptPath) {
        fs.unlink(uploadedReceiptPath, () => {});
      }
      next(error);
    }
  }

  /**
   * Soft-delete a transaction to preserve financial audit trail
   */
  static async deleteTransaction(req, res, next) {
    try {
      const { id } = req.params;
      const adminId = req.user?.id || null;

      const [existing] = await pool.query(`
        SELECT id, type, amount, description FROM expense_transactions WHERE id = ? AND deleted_at IS NULL
      `, [id]);

      if (!existing.length) {
        return res.status(404).json({
          success: false,
          message: 'Transaction not found or already deleted.'
        });
      }

      await pool.query(`
        UPDATE expense_transactions 
        SET deleted_at = NOW(), updated_by = ?
        WHERE id = ?
      `, [adminId, id]);

      res.json({
        success: true,
        message: 'Transaction deleted successfully from active calculations. Audit history preserved.',
        deletedId: id
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * View / download private receipt bill image
   */
  static async getReceiptImage(req, res, next) {
    try {
      const { id } = req.params;
      const [rows] = await pool.query(`
        SELECT receipt_image_path FROM expense_transactions WHERE id = ?
      `, [id]);

      if (!rows.length || !rows[0].receipt_image_path) {
        return res.status(404).json({
          success: false,
          message: 'Receipt image not found for this transaction.'
        });
      }

      const filename = rows[0].receipt_image_path;
      const filePath = path.resolve(privateReceiptsRoot, filename);
      const relativePath = path.relative(privateReceiptsRoot, filePath);

      // Security check against directory traversal
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return res.status(404).json({
          success: false,
          message: 'Receipt image not found.'
        });
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: 'Receipt file was not found on server storage.'
        });
      }

      res.setHeader('Cache-Control', 'private, no-store');
      return res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Search orders for related order autocomplete in Add/Edit Expense modal
   */
  static async searchOrders(req, res, next) {
    try {
      const q = (req.query.q || '').trim();
      let sql = `
        SELECT 
          id, customer_name AS customerName, order_status AS orderStatus,
          payment_status AS paymentStatus, total, DATE_FORMAT(created_at, '%Y-%m-%d') AS date
        FROM orders
      `;
      let params = [];

      if (q) {
        sql += ` WHERE (id LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)`;
        const pattern = `%${q}%`;
        params.push(pattern, pattern, pattern);
      }

      sql += ` ORDER BY created_at DESC LIMIT 20`;

      const [orders] = await pool.query(sql, params);
      res.json({
        success: true,
        data: orders.map(o => ({
          id: o.id,
          customerName: o.customerName,
          orderStatus: o.orderStatus,
          paymentStatus: o.paymentStatus,
          total: Number(o.total) || 0,
          date: o.date
        }))
      });
    } catch (error) {
      next(error);
    }
  }
}
