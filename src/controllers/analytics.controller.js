import { executeQuery as query } from '../config/db.js';

async function getCategoryPerformance(periodDays = null) {
  const dateFilter = periodDays ? ' AND COALESCE(o.delivered_at, o.created_at) >= DATE_SUB(NOW(), INTERVAL ? DAY)' : '';
  const params = periodDays ? [periodDays] : [];
  return query(`
    SELECT
      COALESCE(c.name, 'Uncategorized') AS category,
      SUM(oi.quantity) AS units,
      SUM(oi.price * oi.quantity) AS sales,
      SUM((oi.price - COALESCE(oi.cost_price, v.cost_price, p.cost_price, oi.price * 0.65)) * oi.quantity) AS profit
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN product_variants v ON v.id = oi.variant_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE o.order_status = 'delivered'${dateFilter}
    GROUP BY COALESCE(c.name, 'Uncategorized')
    ORDER BY sales DESC
    LIMIT 10
  `, params);
}

function getPeriodDays(period) {
  const match = /^(\d+)(d|m|y)$/.exec(period || '30d');
  if (!match) {
    const error = new Error('Analytics period must use days, months, or years (for example 30d).');
    error.statusCode = 400;
    throw error;
  }

  const amount = Number(match[1]);
  const multiplier = match[2] === 'd' ? 1 : match[2] === 'm' ? 30 : 365;
  const days = amount * multiplier;
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    const error = new Error('Analytics period must be between 1 day and 10 years.');
    error.statusCode = 400;
    throw error;
  }
  return days;
}

export async function getOverview(req, res, next) {
  try {
    const [[totals], [profitRow], monthlySales, categoryRows, cityRows] = await Promise.all([
      query(`
      SELECT COUNT(*) AS orderCount,
             COALESCE(SUM(CASE WHEN order_status = 'delivered' THEN total ELSE 0 END), 0) AS revenue,
             COALESCE(SUM(CASE WHEN order_status = 'delivered' THEN 1 ELSE 0 END), 0) AS deliveredCount
      FROM orders
      WHERE order_status <> 'cancelled'
    `),
      query(`
        SELECT COALESCE(SUM(
          (oi.price - COALESCE(oi.cost_price, v.cost_price, p.cost_price, oi.price * 0.65)) * oi.quantity
        ), 0) AS profit
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN product_variants v ON v.id = oi.variant_id
        WHERE o.order_status = 'delivered'
      `),
      query(`
        SELECT DATE_FORMAT(recognized_at, '%b %Y') AS month,
               SUM(total) AS sales, SUM(profit) AS profit, COUNT(*) AS orders
        FROM (
          SELECT o.id, o.total, COALESCE(o.delivered_at, o.created_at) AS recognized_at,
                 COALESCE((
                   SELECT SUM((oi.price - COALESCE(oi.cost_price, v.cost_price, p.cost_price, oi.price * 0.65)) * oi.quantity)
                   FROM order_items oi
                   LEFT JOIN products p ON p.id = oi.product_id
                   LEFT JOIN product_variants v ON v.id = oi.variant_id
                   WHERE oi.order_id = o.id
                 ), 0) AS profit
          FROM orders o
          WHERE o.order_status = 'delivered'
            AND COALESCE(o.delivered_at, o.created_at) >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
        ) delivered_orders
        GROUP BY YEAR(recognized_at), MONTH(recognized_at), DATE_FORMAT(recognized_at, '%b %Y')
        ORDER BY YEAR(recognized_at), MONTH(recognized_at)
      `),
      getCategoryPerformance(),
      query(`
        SELECT customer_city AS city,
               COUNT(*) AS totalOrders,
               SUM(CASE WHEN order_status = 'delivered' THEN 1 ELSE 0 END) AS deliveredOrders,
               SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END) AS fraudOrders,
               SUM(CASE WHEN order_status = 'delivered' THEN total ELSE 0 END) AS totalRevenue
        FROM orders
        GROUP BY customer_city
        ORDER BY totalOrders DESC
        LIMIT 10
      `)
    ]);

    const totalOrders = Number(totals.orderCount) || 0;
    const totalRevenue = Number(totals.revenue) || 0;
    const totalProfit = Number(profitRow.profit) || 0;
    const deliveredCount = Number(totals.deliveredCount) || 0;
    const cityStats = cityRows.map(city => {
      const orders = Number(city.totalOrders) || 0;
      const fraudOrders = Number(city.fraudOrders) || 0;
      return {
        city: city.city,
        totalOrders: orders,
        deliveredOrders: Number(city.deliveredOrders) || 0,
        fraudOrders,
        totalRevenue: Number(city.totalRevenue) || 0,
        riskLevel: fraudOrders > 2 || fraudOrders / (orders || 1) > 0.3
          ? 'high'
          : fraudOrders > 0 ? 'medium' : 'low'
      };
    });

    return res.json({
      success: true,
      data: {
        totalOrders,
        totalRevenue,
        totalProfit,
        deliveredOrders: deliveredCount,
        averageOrderValue: deliveredCount ? Math.round(totalRevenue / deliveredCount) : 0,
        monthlySales: monthlySales.map(item => ({
          month: item.month,
          sales: Number(item.sales) || 0,
          profit: Number(item.profit) || 0,
          orders: Number(item.orders) || 0
        })),
        categoryPerformance: categoryRows.map(item => ({
          category: item.category,
          units: Number(item.units) || 0,
          sales: Number(item.sales) || 0
        })),
        cityStats
      }
    });
  } catch (err) {
    next(err);
  }
}

export async function getSalesAnalytics(req, res, next) {
  try {
    const periodDays = getPeriodDays(req.query.period);
    const groupFormat = periodDays <= 90 ? '%Y-%m-%d' : '%Y-%m';
    const labelFormat = periodDays <= 90 ? '%b %e' : '%b %Y';
    const [salesRows, categoryRows] = await Promise.all([
      query(`
        SELECT DATE_FORMAT(recognized_at, '${groupFormat}') AS period,
               DATE_FORMAT(recognized_at, '${labelFormat}') AS label,
               SUM(total) AS sales, SUM(profit) AS profit, COUNT(*) AS orders
        FROM (
          SELECT o.id, o.total, COALESCE(o.delivered_at, o.created_at) AS recognized_at,
                 COALESCE((
                   SELECT SUM((oi.price - COALESCE(oi.cost_price, v.cost_price, p.cost_price, oi.price * 0.65)) * oi.quantity)
                   FROM order_items oi
                   LEFT JOIN products p ON p.id = oi.product_id
                   LEFT JOIN product_variants v ON v.id = oi.variant_id
                   WHERE oi.order_id = o.id
                 ), 0) AS profit
          FROM orders o
          WHERE o.order_status = 'delivered'
            AND COALESCE(o.delivered_at, o.created_at) >= DATE_SUB(NOW(), INTERVAL ? DAY)
        ) delivered_orders
        GROUP BY period, label
        ORDER BY period
      `, [periodDays]),
      getCategoryPerformance(periodDays)
    ]);

    return res.json({
      success: true,
      data: {
        monthlySalesPoints: salesRows.map(item => ({
          label: item.label,
          value: Number(item.sales) || 0,
          profit: Number(item.profit) || 0,
          secondaryValue: Number(item.orders) || 0,
          hint: `${Number(item.orders) || 0} delivered orders`
        })),
        categoryBarItems: categoryRows.map(item => ({
          label: item.category,
          value: Number(item.units) || 0,
          sublabel: `Rs. ${(Number(item.sales) || 0).toLocaleString()} sales`
        }))
      }
    });
  } catch (err) {
    next(err);
  }
}
