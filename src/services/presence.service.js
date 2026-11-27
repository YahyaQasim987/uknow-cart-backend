import { getIO } from '../config/socket.js';
import { SOCKET_EVENTS } from '../socket/events.js';
import { logger } from '../utils/logger.js';

export class PresenceService {
  /**
   * Structure:
   * visitors: Map<visitorId, {
   *   visitorId: string,
   *   userId?: string,
   *   tabs: Map<tabId, { socketId: string, isVisible: boolean, lastSeen: number }>,
   *   hiddenSince: number | null,
   *   expiryTimer?: NodeJS.Timeout
   * }>
   */
  static visitors = new Map();
  static HIDDEN_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

  /**
   * Register or update a connected tab
   */
  static registerTab(visitorId, tabId, socketId, isVisible = true, userId = null) {
    if (!visitorId || !tabId) return this.getActiveCount();

    let visitor = this.visitors.get(visitorId);
    if (!visitor) {
      visitor = {
        visitorId,
        userId: userId || null,
        tabs: new Map(),
        hiddenSince: null
      };
      this.visitors.set(visitorId, visitor);
    }

    if (userId && !visitor.userId) {
      visitor.userId = userId;
    }

    // Clear any pending 15-min expiry timer since visitor has an active connection
    if (visitor.expiryTimer) {
      clearTimeout(visitor.expiryTimer);
      visitor.expiryTimer = null;
    }

    visitor.tabs.set(tabId, {
      socketId,
      isVisible: !!isVisible,
      lastSeen: Date.now()
    });

    this.recalculateVisitorState(visitor);
    this.broadcastCount();
    return this.getActiveCount();
  }

  /**
   * Update visibility of a specific tab (via visibilitychange event)
   */
  static updateTabVisibility(visitorId, tabId, isVisible) {
    const visitor = this.visitors.get(visitorId);
    if (!visitor) return this.getActiveCount();

    const tab = visitor.tabs.get(tabId);
    if (tab) {
      tab.isVisible = !!isVisible;
      tab.lastSeen = Date.now();
    }

    this.recalculateVisitorState(visitor);
    this.broadcastCount();
    return this.getActiveCount();
  }

  /**
   * Handle tab / socket disconnect
   */
  static removeTab(visitorId, tabId) {
    const visitor = this.visitors.get(visitorId);
    if (!visitor) return this.getActiveCount();

    visitor.tabs.delete(tabId);

    if (visitor.tabs.size === 0) {
      // All tabs closed or disconnected
      this.scheduleVisitorExpiry(visitor);
    } else {
      this.recalculateVisitorState(visitor);
    }

    this.broadcastCount();
    return this.getActiveCount();
  }

  /**
   * Remove tab by socket ID when socket disconnects unexpectedly
   */
  static removeSocket(socketId) {
    for (const [visitorId, visitor] of this.visitors.entries()) {
      for (const [tabId, tab] of visitor.tabs.entries()) {
        if (tab.socketId === socketId) {
          visitor.tabs.delete(tabId);
          if (visitor.tabs.size === 0) {
            this.scheduleVisitorExpiry(visitor);
          } else {
            this.recalculateVisitorState(visitor);
          }
          this.broadcastCount();
          return;
        }
      }
    }
  }

  /**
   * Check if any tab is visible; if none, start 15-minute expiry countdown
   */
  static recalculateVisitorState(visitor) {
    let hasVisibleTab = false;
    for (const tab of visitor.tabs.values()) {
      if (tab.isVisible) {
        hasVisibleTab = true;
        break;
      }
    }

    if (hasVisibleTab) {
      visitor.hiddenSince = null;
      if (visitor.expiryTimer) {
        clearTimeout(visitor.expiryTimer);
        visitor.expiryTimer = null;
      }
    } else {
      // All open tabs are hidden
      if (!visitor.hiddenSince) {
        visitor.hiddenSince = Date.now();
        this.scheduleVisitorExpiry(visitor);
      }
    }
  }

  static scheduleVisitorExpiry(visitor) {
    if (visitor.expiryTimer) {
      clearTimeout(visitor.expiryTimer);
    }

    visitor.expiryTimer = setTimeout(() => {
      logger.info(`15-min hidden expiry fired for visitor session: ${visitor.visitorId}. Cleaning up.`);
      this.visitors.delete(visitor.visitorId);
      this.broadcastCount();
    }, this.HIDDEN_EXPIRY_MS);
    if (visitor.expiryTimer && typeof visitor.expiryTimer.unref === 'function') {
      visitor.expiryTimer.unref();
    }
  }

  /**
   * A visitor is actively browsing if at least one tab is open AND visible
   */
  static isVisitorActive(visitor) {
    if (visitor.tabs.size === 0) return false;
    for (const tab of visitor.tabs.values()) {
      if (tab.isVisible) return true;
    }
    return false;
  }

  static getActiveCount() {
    let active = 0;
    for (const visitor of this.visitors.values()) {
      if (this.isVisitorActive(visitor)) {
        active++;
      }
    }
    return active;
  }

  static broadcastCount() {
    const io = getIO();
    const count = this.getActiveCount();
    io.emit(SOCKET_EVENTS.PRESENCE_COUNT, {
      activeShoppers: count,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Reset store (used for test isolation)
   */
  static resetForTests() {
    for (const visitor of this.visitors.values()) {
      if (visitor.expiryTimer) {
        clearTimeout(visitor.expiryTimer);
      }
    }
    this.visitors.clear();
  }
}
