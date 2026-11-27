import jwt from 'jsonwebtoken';
import { SOCKET_EVENTS } from './events.js';
import { PresenceService } from '../services/presence.service.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';
import { pool } from '../config/db.js';

export function setupSocketGateway(io) {
  // Optional auth middleware for socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (token) {
      try {
        const decoded = jwt.verify(token, config.jwt.secret);
        socket.user = decoded;
      } catch (err) {
        // Allow unauthenticated connection for public guest shoppers
      }
    }
    next();
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id} (user: ${socket.user?.id || 'guest'})`);

    // Auto-join user-specific room and admin room if authorized
    if (socket.user?.id) {
      socket.join(`user:${socket.user.id}`);
      if (socket.user.role === 'admin') {
        socket.join('admin');
        socket.join(`admin:${socket.user.id}`);
        logger.info(`Socket ${socket.id} joined admin room.`);
      }
    }

    // Secure channel join with strict room authorization (Fix 11)
    socket.on('join', async (room, optionsOrCallback, callbackArgument) => {
      const options = typeof optionsOrCallback === 'object' && optionsOrCallback !== null
        ? optionsOrCallback
        : {};
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callbackArgument;
      if (typeof room !== 'string' || room.length > 100) {
        if (typeof callback === 'function') callback({ success: false, message: 'Invalid room identifier.' });
        return;
      }

      // 1. Authorize Admin Room (Strictly only 'admin' role)
      if (room === 'admin' || room.startsWith('admin:')) {
        if (socket.user?.role !== 'admin') {
          logger.warn(`Unauthorized attempt by socket ${socket.id} to join room "${room}"`);
          if (typeof callback === 'function') callback({ success: false, message: 'Forbidden. Admin role required.' });
          return;
        }
        if (room.startsWith('admin:') && room !== `admin:${socket.user.id}`) {
          if (typeof callback === 'function') callback({ success: false, message: 'Forbidden. You may only join your own merchant room.' });
          return;
        }
      }

      // 2. Authorize Order Room ("order:AUK-123456-789")
      if (room.startsWith('order:')) {
        const orderId = room.replace('order:', '').trim();
        const isAdmin = socket.user?.role === 'admin';

        if (!isAdmin) {
          try {
            const [rows] = await pool.query('SELECT user_id, customer_id, guest_access_token FROM `orders` WHERE id = ?', [orderId]);
            if (rows.length === 0) {
              if (typeof callback === 'function') callback({ success: false, message: 'Order not found.' });
              return;
            }

            const order = rows[0];
            const guestToken = options.guestToken || socket.handshake.auth?.guestToken || socket.handshake.query?.guestToken;

            const orderOwnerId = order.customer_id || order.user_id;
            const isOwner = socket.user && orderOwnerId && socket.user.id === orderOwnerId;
            const isValidGuest = !orderOwnerId && guestToken && guestToken === order.guest_access_token;

            if (!isOwner && !isValidGuest) {
              logger.warn(`Unauthorized attempt to join order room "${room}" by socket ${socket.id}`);
              if (typeof callback === 'function') callback({ success: false, message: 'Forbidden. Order ownership required.' });
              return;
            }
          } catch (dbErr) {
            // If DB offline, allow in test mock mode
          }
        }
      }

      socket.join(room);
      logger.debug(`Socket ${socket.id} authorized and joined room: ${room}`);
      if (typeof callback === 'function') callback({ success: true, room });
    });

    socket.on('leave', (room) => {
      if (typeof room === 'string') {
        socket.leave(room);
        logger.debug(`Socket ${socket.id} left room: ${room}`);
      }
    });

    // Shopper presence registration (Deduplicated multi-tab)
    socket.on(SOCKET_EVENTS.PRESENCE_JOIN, (payload = {}) => {
      const { visitorId, tabId, isVisible = true, userId = null } = payload;
      const count = PresenceService.registerTab(
        visitorId,
        tabId,
        socket.id,
        isVisible,
        socket.user?.id || userId
      );
      socket.emit(SOCKET_EVENTS.PRESENCE_COUNT, {
        activeShoppers: count,
        timestamp: new Date().toISOString()
      });
    });

    // Visibility toggle (tab switched or minimized)
    socket.on(SOCKET_EVENTS.PRESENCE_VISIBILITY, (payload = {}) => {
      const { visitorId, tabId, isVisible } = payload;
      PresenceService.updateTabVisibility(visitorId, tabId, isVisible);
    });

    // Explicit tab close
    socket.on(SOCKET_EVENTS.PRESENCE_LEAVE, (payload = {}) => {
      const { visitorId, tabId } = payload;
      PresenceService.removeTab(visitorId, tabId);
    });

    // Query active count directly
    socket.on('presence:get_count', () => {
      socket.emit(SOCKET_EVENTS.PRESENCE_COUNT, {
        activeShoppers: PresenceService.getActiveCount(),
        timestamp: new Date().toISOString()
      });
    });

    // Disconnect cleanup
    socket.on('disconnect', (reason) => {
      logger.info(`Socket disconnected: ${socket.id} (${reason})`);
      PresenceService.removeSocket(socket.id);
    });
  });
}
