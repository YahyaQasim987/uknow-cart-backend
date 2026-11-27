import { executeQuery as query } from '../config/db.js';

export async function getBlacklistedCities(req, res, next) {
  try {
    const rows = await query('SELECT * FROM fraud_blacklist ORDER BY added_at DESC');
    const cities = rows.map(row => ({
      id: row.id,
      city: row.city,
      reason: row.reason,
      fraudCount: Number(row.fraud_count) || 0,
      totalOrders: Number(row.total_orders) || 0,
      isHighRisk: Boolean(row.is_high_risk),
      addedAt: row.added_at
    }));
    return res.json({ success: true, count: cities.length, data: cities });
  } catch (err) {
    next(err);
  }
}

export async function addBlacklistedCity(req, res, next) {
  try {
    const { city, reason } = req.body;
    if (typeof city !== 'string' || !city.trim()) {
      return res.status(400).json({ success: false, message: 'City name is required.' });
    }
    if (reason !== undefined && typeof reason !== 'string') {
      return res.status(400).json({ success: false, message: 'Blacklist reason must be text.' });
    }
    const cleanCity = city.trim();
    const cleanReason = reason?.trim() || 'Manual admin restriction due to fraud risk';
    const id = `fraud-${cleanCity.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    await query(
      `INSERT INTO fraud_blacklist (id, city, reason, fraud_count, total_orders, is_high_risk)
       VALUES (?, ?, ?, 1, 1, TRUE)
       ON DUPLICATE KEY UPDATE reason = VALUES(reason), is_high_risk = TRUE`,
      [id, cleanCity, cleanReason]
    );
    const rows = await query('SELECT * FROM fraud_blacklist WHERE LOWER(city) = LOWER(?)', [cleanCity]);
    const row = rows[0];
    return res.status(201).json({
      success: true,
      data: {
        id: row.id,
        city: row.city,
        reason: row.reason,
        fraudCount: Number(row.fraud_count) || 0,
        totalOrders: Number(row.total_orders) || 0,
        isHighRisk: Boolean(row.is_high_risk),
        addedAt: row.added_at
      }
    });
  } catch (err) {
    next(err);
  }
}

export async function removeBlacklistedCity(req, res, next) {
  try {
    const { city } = req.params;
    const result = await query('DELETE FROM fraud_blacklist WHERE LOWER(city) = LOWER(?)', [city]);
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: `City "${city}" is not on the blacklist.` });
    }
    return res.json({ success: true, message: `City "${city}" removed from blacklist.` });
  } catch (err) {
    next(err);
  }
}

export async function checkFraudRisk(req, res, next) {
  try {
    const { city, phone } = req.body;
    if (city !== undefined && typeof city !== 'string') {
      return res.status(400).json({ success: false, message: 'City must be text.' });
    }
    if (phone !== undefined && typeof phone !== 'string') {
      return res.status(400).json({ success: false, message: 'Phone must be text.' });
    }
    if (!city?.trim() && !phone?.trim()) {
      return res.json({ success: true, isAllowed: true, riskLevel: 'low' });
    }

    if (city?.trim()) {
      const rows = await query(
        `SELECT city, reason FROM fraud_blacklist
         WHERE LOWER(?) LIKE CONCAT('%', LOWER(city), '%')
            OR LOWER(city) LIKE CONCAT('%', LOWER(?), '%')
         LIMIT 1`,
        [city.trim(), city.trim()]
      );
      if (rows.length) {
        return res.json({
          success: true,
          isAllowed: false,
          riskLevel: 'high',
          reason: rows[0].reason || 'City is flagged in the fraud blacklist.'
        });
      }
    }

    return res.json({ success: true, isAllowed: true, riskLevel: 'low' });
  } catch (err) {
    next(err);
  }
}
