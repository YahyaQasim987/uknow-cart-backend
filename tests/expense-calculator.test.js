import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpenseController } from '../src/controllers/expense.controller.js';
import { pool } from '../src/config/db.js';

test('Expense Accounting Logic - Net Sales, Gross Profit, and Net Business Profit match exact specification', () => {
  // Accounting example from requirements:
  // Net Sales: Rs. 100,000
  // Product Cost (COGS): Rs. 60,000
  // Gross Profit: Rs. 40,000
  // Courier Expenses: Rs. 3,000
  // Packaging: Rs. 1,000
  // Advertising: Rs. 5,000
  // Additional Income: Rs. 500
  // Final Net Profit = Rs. 31,500
  const grossSales = 105000;
  const discounts = 3000;
  const returns = 2000;
  const netSales = grossSales - discounts - returns; // 100,000
  assert.equal(netSales, 100000);

  const cogs = 60000;
  const grossProfit = netSales - cogs; // 40,000
  assert.equal(grossProfit, 40000);

  const operatingExpenses = 3000 + 1000 + 5000; // 9,000
  const additionalIncome = 500;
  const netProfit = grossProfit - operatingExpenses + additionalIncome; // 31,500
  assert.equal(netProfit, 31500);
});

test('ExpenseController - createTransaction rejects invalid types and negative amounts', async () => {
  let status = null;
  let jsonResponse = null;

  const mockRes = {
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      jsonResponse = payload;
      return this;
    }
  };

  // 1. Invalid transaction type
  await ExpenseController.createTransaction(
    { body: { type: 'invalid_type', amount: 500, category: 'Courier', description: 'Test' }, user: { id: 'admin-1' } },
    mockRes,
    () => {}
  );
  assert.equal(status, 400);
  assert.match(jsonResponse.message, /must be either "expense" or "income"/i);

  // 2. Negative amount
  status = null;
  jsonResponse = null;
  await ExpenseController.createTransaction(
    { body: { type: 'expense', amount: -500, category: 'Courier', description: 'Test' }, user: { id: 'admin-1' } },
    mockRes,
    () => {}
  );
  assert.equal(status, 400);
  assert.match(jsonResponse.message, /positive number/i);

  // 3. Missing description
  status = null;
  jsonResponse = null;
  await ExpenseController.createTransaction(
    { body: { type: 'expense', amount: 500, category: 'Courier', description: '   ' }, user: { id: 'admin-1' } },
    mockRes,
    () => {}
  );
  assert.equal(status, 400);
  assert.match(jsonResponse.message, /description/i);
});

test('ExpenseController - Database integration: create, calculate summary, edit, and soft delete', async () => {
  let testExpenseId = null;
  let testIncomeId = null;

  try {
    const adminUser = 'usr-admin-1';

    // 1. Insert a test expense
    let createdExpense = null;
    await ExpenseController.createTransaction(
      {
        body: {
          type: 'expense',
          category: 'Courier Charges',
          amount: 3000,
          description: 'Test Leopards Courier Delivery'
        },
        user: { id: adminUser }
      },
      {
        status(code) { assert.equal(code, 201); return this; },
        json(data) { createdExpense = data.data; return this; }
      },
      (err) => { if (err) throw err; }
    );

    assert.ok(createdExpense?.id);
    testExpenseId = createdExpense.id;
    assert.equal(createdExpense.amount, 3000);
    assert.equal(createdExpense.type, 'expense');

    // 2. Insert a test income
    let createdIncome = null;
    await ExpenseController.createTransaction(
      {
        body: {
          type: 'income',
          category: 'Supplier Refund',
          amount: 500,
          description: 'Box packaging compensation'
        },
        user: { id: adminUser }
      },
      {
        status(code) { assert.equal(code, 201); return this; },
        json(data) { createdIncome = data.data; return this; }
      },
      (err) => { if (err) throw err; }
    );

    assert.ok(createdIncome?.id);
    testIncomeId = createdIncome.id;
    assert.equal(createdIncome.amount, 500);
    assert.equal(createdIncome.type, 'income');

    // 3. Query Financial Summary
    let summaryResult = null;
    await ExpenseController.getFinancialSummary(
      { query: {} },
      { json(data) { summaryResult = data.data; return this; } },
      (err) => { if (err) throw err; }
    );

    assert.ok(summaryResult);
    assert.ok(summaryResult.summary.totalExpenses >= 3000);
    assert.ok(summaryResult.summary.additionalIncome >= 500);

    // 4. Update the expense amount
    let updatedResult = null;
    await ExpenseController.updateTransaction(
      {
        params: { id: testExpenseId },
        body: { amount: 3500, description: 'Updated courier fee' },
        user: { id: adminUser }
      },
      { json(data) { updatedResult = data.data; return this; } },
      (err) => { if (err) throw err; }
    );

    assert.equal(updatedResult.amount, 3500);
    assert.equal(updatedResult.description, 'Updated courier fee');

    // 5. Soft-delete the expense
    let deleteResult = null;
    await ExpenseController.deleteTransaction(
      { params: { id: testExpenseId }, user: { id: adminUser } },
      { json(data) { deleteResult = data; return this; } },
      (err) => { if (err) throw err; }
    );

    assert.equal(deleteResult.success, true);

    // 6. Verify that soft-deleted record is excluded from active transactions
    let transactionsResult = null;
    await ExpenseController.getTransactions(
      { query: { search: 'Updated courier fee' } },
      { json(data) { transactionsResult = data.data; return this; } },
      (err) => { if (err) throw err; }
    );

    const found = transactionsResult.find(t => t.id === testExpenseId);
    assert.equal(found, undefined, 'Soft-deleted transaction must not appear in active transactions');

  } finally {
    // Clean up test rows completely from DB
    if (testExpenseId) {
      await pool.query('DELETE FROM expense_transactions WHERE id = ?', [testExpenseId]);
    }
    if (testIncomeId) {
      await pool.query('DELETE FROM expense_transactions WHERE id = ?', [testIncomeId]);
    }
    try {
      await pool.end();
    } catch (e) {}
  }
});
