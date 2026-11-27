// Authoritative Socket.IO Event Name Constants
export const SOCKET_EVENTS = {
  // Orders
  ORDER_NEW: 'orders:new',
  ORDER_STATUS_CHANGED: 'orders:status_changed',
  ORDER_CANCELLED: 'orders:cancelled',
  ADMIN_DATA_CHANGED: 'admin:data_changed',
  STOREFRONT_DATA_CHANGED: 'storefront:data_changed',

  // Inventory
  INVENTORY_STOCK_CHANGED: 'inventory:stock_changed',
  INVENTORY_LOW_ALERT: 'inventory:low_stock_alert',

  // Shopper Presence
  PRESENCE_JOIN: 'presence:join',
  PRESENCE_VISIBILITY: 'presence:visibility',
  PRESENCE_LEAVE: 'presence:leave',
  PRESENCE_COUNT: 'presence:count',

  // Notifications
  NOTIFICATION_NEW: 'notifications:new',

  // Ads
  ADS_IMPRESSION: 'ads:impression_recorded',
  ADS_CLICK: 'ads:click_recorded',
  ADS_STATS_UPDATED: 'ads:stats_updated'
};
