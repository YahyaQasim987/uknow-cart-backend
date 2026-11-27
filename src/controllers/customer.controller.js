import { executeQuery as query } from '../config/db.js';

function determineVipTier(spend) {
  if (spend >= 200000) return 'Royal Patron';
  if (spend >= 80000) return 'High VIP';
  return 'Verified Client';
}

export async function listCustomers(req, res, next) {
  try {
    const rows = await query(`
      SELECT
        u.id,
        COALESCE(NULLIF(u.full_name, ''), u.name) AS name,
        u.email,
        COALESCE(NULLIF(u.primary_phone, ''), NULLIF(u.phone, ''), '') AS phone,
        COALESCE(NULLIF(u.city, ''), '') AS city,
        COUNT(o.id) AS orderCount,
        COALESCE(SUM(o.total), 0) AS totalSpend
      FROM users u
      LEFT JOIN orders o
        ON (o.user_id = u.id OR o.customer_id = u.id)
        AND o.order_status <> 'cancelled'
      WHERE u.role = 'customer' AND u.status = 'active'
      GROUP BY u.id, u.full_name, u.name, u.email, u.primary_phone, u.phone, u.city
      ORDER BY totalSpend DESC, name ASC
    `);
    const customers = rows.map(row => {
      const spend = Number(row.totalSpend) || 0;
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        city: row.city,
        orderCount: Number(row.orderCount) || 0,
        totalSpend: spend,
        vipTier: determineVipTier(spend)
      };
    });

    return res.json({ success: true, count: customers.length, data: customers });
  } catch (err) {
    next(err);
  }
}
