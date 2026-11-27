import { pool } from '../config/db.js';

function notificationScope(user) {
  const audience = user.role === 'admin' ? 'admin' : 'customer';
  return { audience, userId: user.id };
}

export async function listNotifications(req, res, next) {
  try {
    const scope = notificationScope(req.user);
    const [rows] = await pool.query(
      `SELECT id, title, message, type, audience, order_id, link_url, is_read, created_at
       FROM notifications
       WHERE recipient_id = ? AND audience IN (?, 'all')
       ORDER BY created_at DESC
       LIMIT 100`,
      [scope.userId, scope.audience]
    );
    return res.json({
      success: true,
      notifications: rows.map(row => ({
        id: row.id,
        title: row.title,
        message: row.message,
        type: row.type,
        audience: row.audience,
        orderId: row.order_id || undefined,
        linkUrl: row.link_url || undefined,
        read: Boolean(row.is_read),
        timestamp: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
      }))
    });
  } catch (error) {
    next(error);
  }
}

export async function markNotificationRead(req, res, next) {
  try {
    const { audience, userId } = notificationScope(req.user);
    const [rows] = await pool.query(
      "SELECT id FROM notifications WHERE id = ? AND recipient_id = ? AND audience IN (?, 'all')",
      [req.params.id, userId, audience]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }
    await pool.query(
      "UPDATE notifications SET is_read = TRUE WHERE id = ? AND recipient_id = ? AND audience IN (?, 'all')",
      [req.params.id, userId, audience]
    );
    return res.json({ success: true, message: 'Notification marked as read.' });
  } catch (error) {
    next(error);
  }
}

export async function markAllNotificationsRead(req, res, next) {
  try {
    const { audience, userId } = notificationScope(req.user);
    await pool.query(
      "UPDATE notifications SET is_read = TRUE WHERE recipient_id = ? AND audience IN (?, 'all') AND is_read = FALSE",
      [userId, audience]
    );
    return res.json({ success: true, message: 'Notifications marked as read.' });
  } catch (error) {
    next(error);
  }
}

export async function deleteNotification(req, res, next) {
  try {
    const { audience, userId } = notificationScope(req.user);
    const [result] = await pool.query(
      "DELETE FROM notifications WHERE id = ? AND recipient_id = ? AND audience IN (?, 'all')",
      [req.params.id, userId, audience]
    );
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }
    return res.json({ success: true, message: 'Notification deleted.' });
  } catch (error) {
    next(error);
  }
}

export async function clearNotifications(req, res, next) {
  try {
    const { audience, userId } = notificationScope(req.user);
    await pool.query(
      "DELETE FROM notifications WHERE recipient_id = ? AND audience IN (?, 'all')",
      [userId, audience]
    );
    return res.json({ success: true, message: 'Notifications cleared.' });
  } catch (error) {
    next(error);
  }
}
