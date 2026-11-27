import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';
import { SOCKET_EVENTS } from '../socket/events.js';

const audienceQueries = {
  all: `
    SELECT id FROM users WHERE role = 'customer' AND status = 'active'
  `,
  vip: `
    SELECT u.id
    FROM users u
    JOIN orders o ON (o.user_id = u.id OR o.customer_id = u.id)
    WHERE u.role = 'customer' AND u.status = 'active' AND o.order_status <> 'cancelled'
    GROUP BY u.id
    HAVING SUM(o.total) >= 50000
  `,
  active_orders: `
    SELECT DISTINCT u.id
    FROM users u
    JOIN orders o ON (o.user_id = u.id OR o.customer_id = u.id)
    WHERE u.role = 'customer' AND u.status = 'active'
      AND o.order_status IN ('placed', 'confirmed', 'processing', 'courier_assigned', 'shipped')
  `,
  abandoned_cart: `
    SELECT DISTINCT u.id
    FROM users u
    JOIN carts c ON c.user_id = u.id
    JOIN cart_items ci ON ci.cart_id = c.id
    WHERE u.role = 'customer' AND u.status = 'active'
  `,
  karachi_lahore: `
    SELECT DISTINCT u.id
    FROM users u
    LEFT JOIN orders o ON (o.user_id = u.id OR o.customer_id = u.id)
    WHERE u.role = 'customer' AND u.status = 'active'
      AND (
        LOWER(COALESCE(u.city, '')) REGEXP 'karachi|lahore|islamabad'
        OR LOWER(COALESCE(o.customer_city, '')) REGEXP 'karachi|lahore|islamabad'
      )
  `
};

function formatBroadcast(row) {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    audience: row.audience,
    audienceLabel: row.audience_label,
    sentAt: row.sent_at,
    recipientsCount: Number(row.recipients_count) || 0,
    clicksCount: Number(row.clicks_count) || 0,
    clickThroughRate: row.click_through_rate || '0%',
    priority: row.priority || 'normal',
    imageUrl: row.image_url || undefined,
    actionText: row.action_text || undefined,
    actionUrl: row.action_url || undefined
  };
}

async function getRecipients(connection, audience) {
  const statement = audienceQueries[audience];
  if (!statement) {
    const error = new Error(`Unsupported broadcast audience "${audience}".`);
    error.statusCode = 400;
    throw error;
  }
  const [recipients] = await connection.query(statement);
  return recipients;
}

export async function listBroadcasts(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT * FROM broadcast_messages ORDER BY sent_at DESC');
    return res.json({ success: true, count: rows.length, data: rows.map(formatBroadcast) });
  } catch (err) {
    next(err);
  }
}

export async function getBroadcastAudienceCounts(req, res, next) {
  let connection;
  try {
    connection = await pool.getConnection();
    const counts = {};
    for (const audience of Object.keys(audienceQueries)) {
      const recipients = await getRecipients(connection, audience);
      counts[audience] = recipients.length;
    }
    return res.json({ success: true, counts });
  } catch (err) {
    next(err);
  } finally {
    connection?.release();
  }
}

export async function sendBroadcast(req, res, next) {
  let connection;
  try {
    const {
      title,
      message,
      audience = 'all',
      audienceLabel = 'Registered customers',
      priority = 'normal',
      imageUrl,
      actionText,
      actionUrl
    } = req.body;

    if (typeof title !== 'string' || !title.trim() || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Title and message are required.' });
    }
    if (!['normal', 'high', 'urgent'].includes(priority)) {
      return res.status(400).json({ success: false, message: 'Priority must be normal, high, or urgent.' });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    const recipients = await getRecipients(connection, audience);
    const id = `bc-${crypto.randomUUID()}`;
    await connection.query(
      `INSERT INTO broadcast_messages
       (id, title, message, audience, audience_label, priority, image_url, action_text, action_url, recipients_count, clicks_count, click_through_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '0%')`,
      [
        id,
        title.trim(),
        message.trim(),
        audience,
        audienceLabel,
        priority,
        imageUrl || null,
        actionText || null,
        actionUrl || null,
        recipients.length
      ]
    );

    if (recipients.length) {
      const notificationRows = recipients.map(recipient => [
        `notif-${crypto.randomUUID()}`,
        recipient.id,
        'customer',
        'broadcast',
        title.trim(),
        message.trim(),
        actionUrl || null
      ]);
      await connection.query(
        `INSERT INTO notifications (id, recipient_id, audience, type, title, message, link_url)
         VALUES ?`,
        [notificationRows]
      );
    }

    const [createdRows] = await connection.query('SELECT * FROM broadcast_messages WHERE id = ?', [id]);
    await connection.commit();
    const io = getIO();
    for (const recipient of recipients) {
      io.to(`user:${recipient.id}`).emit(SOCKET_EVENTS.NOTIFICATION_NEW, { id });
    }
    return res.status(201).json({
      success: true,
      message: `Broadcast delivered to ${recipients.length} registered customer(s).`,
      data: formatBroadcast(createdRows[0])
    });
  } catch (err) {
    if (connection) await connection.rollback();
    next(err);
  } finally {
    connection?.release();
  }
}

export async function deleteBroadcast(req, res, next) {
  try {
    const { id } = req.params;
    const [result] = await pool.query('DELETE FROM broadcast_messages WHERE id = ?', [id]);
    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: `Broadcast "${id}" was not found.` });
    }
    return res.json({ success: true, message: `Broadcast ${id} deleted.` });
  } catch (err) {
    next(err);
  }
}
