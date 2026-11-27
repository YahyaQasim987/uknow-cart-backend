import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { OrderService } from './order.service.js';

/**
 * Courier integration engine.
 *
 * Every provider (Trax today, plus any additional courier later) is driven by a
 * row in `courier_providers`. The adapter itself is provider-agnostic: booking,
 * tracking, cancellation and label retrieval are plain HTTP calls whose URL,
 * method, auth header and JSON payload template live in that row. Adding a
 * second courier therefore needs an API key + endpoint paths from the admin
 * panel, not a code change.
 */

const REQUEST_TIMEOUT_MS = 20000;

const COURIER_TABLES_DDL = [
  `CREATE TABLE IF NOT EXISTS \`courier_providers\` (
    \`id\` VARCHAR(50) NOT NULL,
    \`provider_key\` VARCHAR(50) NOT NULL,
    \`display_name\` VARCHAR(120) NOT NULL,
    \`is_enabled\` BOOLEAN NOT NULL DEFAULT FALSE,
    \`is_default\` BOOLEAN NOT NULL DEFAULT FALSE,
    \`api_base_url\` VARCHAR(255) NULL,
    \`api_key\` VARCHAR(500) NULL,
    \`auth_header\` VARCHAR(80) NOT NULL DEFAULT 'Authorization',
    \`auth_scheme\` VARCHAR(40) NOT NULL DEFAULT 'Bearer',
    \`book_method\` VARCHAR(10) NOT NULL DEFAULT 'POST',
    \`book_path\` VARCHAR(255) NOT NULL,
    \`track_method\` VARCHAR(10) NOT NULL DEFAULT 'GET',
    \`track_path\` VARCHAR(255) NOT NULL,
    \`cancel_method\` VARCHAR(10) NOT NULL DEFAULT 'POST',
    \`cancel_path\` VARCHAR(255) NULL,
    \`label_path\` VARCHAR(255) NULL,
    \`pickup_address_id\` VARCHAR(120) NULL,
    \`service_code\` VARCHAR(80) NULL,
    \`default_weight_kg\` DECIMAL(6, 2) NOT NULL DEFAULT 0.50,
    \`tracking_field\` VARCHAR(120) NULL,
    \`status_field\` VARCHAR(120) NULL,
    \`events_field\` VARCHAR(120) NULL,
    \`label_field\` VARCHAR(120) NULL,
    \`extra_headers\` TEXT NULL,
    \`payload_template\` TEXT NULL,
    \`notes\` TEXT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE INDEX \`uk_courier_provider_key\` (\`provider_key\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS \`order_shipments\` (
    \`id\` VARCHAR(50) NOT NULL,
    \`order_id\` VARCHAR(50) NOT NULL,
    \`provider_key\` VARCHAR(50) NOT NULL,
    \`provider_name\` VARCHAR(120) NOT NULL,
    \`tracking_number\` VARCHAR(100) NULL,
    \`shipment_status\` VARCHAR(60) NOT NULL DEFAULT 'booked',
    \`raw_status\` VARCHAR(120) NULL,
    \`label_url\` VARCHAR(1000) NULL,
    \`request_payload\` LONGTEXT NULL,
    \`last_response\` LONGTEXT NULL,
    \`events\` LONGTEXT NULL,
    \`booked_by\` VARCHAR(80) NULL,
    \`booked_at\` TIMESTAMP NULL,
    \`last_synced_at\` TIMESTAMP NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    INDEX \`idx_shipment_order\` (\`order_id\`),
    INDEX \`idx_shipment_tracking\` (\`tracking_number\`),
    INDEX \`idx_shipment_provider\` (\`provider_key\`),
    CONSTRAINT \`fk_shipment_order\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

/**
 * Trax (Sonic) booking payload. Values are injected as JSON, so placeholders
 * must NOT be wrapped in quotes. Every path/field below is editable in the
 * admin panel once Trax confirms the exact contract for the account.
 */
const TRAX_PAYLOAD_TEMPLATE = `{
  "pickup_address_id": {{pickupAddressId}},
  "order_reference": {{orderId}},
  "consignee": {
    "name": {{customerName}},
    "phone": {{customerPhone}},
    "email": {{customerEmail}},
    "city": {{customerCity}},
    "address": {{customerAddress}},
    "postal_code": {{postalCode}}
  },
  "items": {{itemsJson}},
  "pieces": {{itemCount}},
  "weight": {{weight}},
  "amount": {{orderTotal}},
  "cod_amount": {{codAmount}},
  "payment_method": {{paymentType}},
  "service_type": {{serviceCode}},
  "remarks": {{note}}
}`;

const SECOND_COURIER_TEMPLATE = `{
  "order_id": {{orderId}},
  "customer_name": {{customerName}},
  "customer_phone": {{customerPhone}},
  "customer_city": {{customerCity}},
  "customer_address": {{customerAddress}},
  "items": {{itemsJson}},
  "amount": {{orderTotal}},
  "cod_amount": {{codAmount}},
  "payment_type": {{paymentType}},
  "weight": {{weight}}
}`;

const DEFAULT_PROVIDERS = [
  {
    providerKey: 'trax',
    displayName: 'Trax Logistics',
    enabled: false,
    isDefault: true,
    apiBaseUrl: 'https://sonic.pk/api/v1',
    authHeader: 'Authorization',
    authScheme: 'Bearer',
    bookMethod: 'POST',
    bookPath: '/book',
    trackMethod: 'GET',
    trackPath: '/track/{{trackingNumber}}',
    cancelMethod: 'POST',
    cancelPath: '/cancel',
    labelPath: '/label/{{trackingNumber}}',
    trackingField: 'data.tracking_number',
    statusField: 'data.status',
    eventsField: 'data.events',
    labelField: 'data.label_url',
    payloadTemplate: TRAX_PAYLOAD_TEMPLATE,
    notes: 'Paste the Trax (Sonic) API key from Sonic → Profile → API Key. Confirm the booking/tracking path with Trax onboarding if your account uses different endpoints.'
  },
  {
    providerKey: 'second_courier',
    displayName: 'Second Courier',
    enabled: false,
    isDefault: false,
    apiBaseUrl: '',
    authHeader: 'Authorization',
    authScheme: 'Bearer',
    bookMethod: 'POST',
    bookPath: '/orders',
    trackMethod: 'GET',
    trackPath: '/orders/{{trackingNumber}}',
    cancelMethod: 'POST',
    cancelPath: '/orders/{{trackingNumber}}/cancel',
    labelPath: '/orders/{{trackingNumber}}/label',
    trackingField: 'tracking_number',
    statusField: 'status',
    eventsField: 'events',
    labelField: 'label_url',
    payloadTemplate: SECOND_COURIER_TEMPLATE,
    notes: 'Reserved for the next courier. Paste its base URL, API key and endpoint paths; no code change is needed.'
  }
];

const TRACKING_FIELD_CANDIDATES = [
  'tracking_number', 'trackingNumber', 'cn', 'cn_number', 'awb', 'tracking_no',
  'data.tracking_number', 'data.trackingNumber', 'data.cn', 'data.cn_number',
  'data.awb', 'data.tracking_no', 'data.order.tracking_number', 'data.data.tracking_number',
  'data.shipment.tracking_number', 'result.tracking_number', 'data'
];

const STATUS_FIELD_CANDIDATES = [
  'status', 'data.status', 'shipment_status', 'data.shipment_status', 'state',
  'data.state', 'data.order.status', 'data.data.status', 'result.status'
];

const EVENTS_FIELD_CANDIDATES = [
  'events', 'tracking_history', 'checkpoints', 'status_history', 'history',
  'data.events', 'data.tracking_history', 'data.checkpoints', 'data.status_history',
  'data.history', 'data.data', 'data.track_history'
];

const LABEL_FIELD_CANDIDATES = [
  'label_url', 'labelUrl', 'print_url', 'printUrl', 'label',
  'data.label_url', 'data.labelUrl', 'data.print_url', 'data.label'
];

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function slugKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

function pickPath(source, path) {
  if (!path || source === null || source === undefined) return undefined;
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current = source;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function pickFirst(source, candidates) {
  for (const path of candidates) {
    if (!path) continue;
    const value = pickPath(source, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stringifyForStorage(value) {
  if (value === undefined || value === null) return null;
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 60000 ? `${text.slice(0, 60000)}…` : text;
  } catch {
    return null;
  }
}

function mapProviderRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    providerKey: row.provider_key,
    displayName: row.display_name,
    enabled: Boolean(row.is_enabled),
    isDefault: Boolean(row.is_default),
    apiBaseUrl: row.api_base_url || '',
    apiKey: row.api_key || '',
    authHeader: row.auth_header || 'Authorization',
    authScheme: row.auth_scheme ?? 'Bearer',
    bookMethod: (row.book_method || 'POST').toUpperCase(),
    bookPath: row.book_path || '',
    trackMethod: (row.track_method || 'GET').toUpperCase(),
    trackPath: row.track_path || '',
    cancelMethod: (row.cancel_method || 'POST').toUpperCase(),
    cancelPath: row.cancel_path || '',
    labelPath: row.label_path || '',
    pickupAddressId: row.pickup_address_id || '',
    serviceCode: row.service_code || '',
    defaultWeightKg: Number(row.default_weight_kg || 0.5),
    trackingField: row.tracking_field || '',
    statusField: row.status_field || '',
    eventsField: row.events_field || '',
    labelField: row.label_field || '',
    extraHeaders: row.extra_headers || '',
    payloadTemplate: row.payload_template || '',
    notes: row.notes || '',
    configured: Boolean(row.api_base_url && row.api_key && row.book_path)
  };
}

function publicProvider(provider) {
  if (!provider) return null;
  const { apiKey, extraHeaders, ...rest } = provider;
  return {
    ...rest,
    apiKeySet: Boolean(apiKey),
    apiKeyPreview: apiKey ? `••••••${apiKey.slice(-4)}` : '',
    hasExtraHeaders: Boolean(extraHeaders)
  };
}

export function mapCourierStatus(rawStatus) {
  const text = String(rawStatus || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!text) return null;
  if (/(delivered|delivery successful|shipment delivered|dor)/.test(text)) return 'delivered';
  if (/(out for delivery|with rider|on the way to|dispatched for delivery|ofd)/.test(text)) return 'out_for_delivery';
  if (/(return delivered|returned to shipper|rts|returned|return)/.test(text)) return 'returned';
  if (/(cancel|cancelled|canceled|void)/.test(text)) return 'cancelled';
  if (/(fail|exception|hold|attempted|undelivered|lost|damage)/.test(text)) return 'exception';
  if (/(pick ?up|picked|collected|received at origin)/.test(text)) return 'picked';
  if (/(pending|created|new|booked|awaiting|accepted)/.test(text)) return 'pending';
  if (/(in ?transit|transit|dispatched|shipped|forwarded|arrived at)/.test(text)) return 'in_transit';
  return 'in_transit';
}

const STATUS_LABELS = {
  pending: 'Booking created',
  picked: 'Parcel picked up',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  returned: 'Returned to sender',
  cancelled: 'Cancelled',
  exception: 'Delivery exception'
};

function normalizeEvents(rawEvents) {
  if (!Array.isArray(rawEvents)) return [];
  return rawEvents
    .map((event, index) => {
      if (!event || typeof event !== 'object') return null;
      const description = pickFirst(event, [
        'description', 'message', 'remarks', 'activity', 'status', 'detail', 'event'
      ]);
      const timestamp = pickFirst(event, [
        'timestamp', 'datetime', 'date_time', 'date', 'created_at', 'time', 'updated_at'
      ]);
      const location = pickFirst(event, ['location', 'city', 'hub', 'place']);
      return {
        index,
        status: mapCourierStatus(description) || 'unknown',
        rawStatus: description ? String(description) : '',
        description: description ? String(description) : '',
        location: location ? String(location) : '',
        timestamp: timestamp ? String(timestamp) : ''
      };
    })
    .filter(Boolean);
}

function renderTemplate(template, values) {
  if (!template) return '{}';
  return template.replace(/"?\{\{\s*([a-zA-Z0-9_]+)\s*\}\}"?/g, (match, key) => {
    if (!(key in values)) return match;
    const value = values[key];
    if (value === undefined || value === null) return 'null';
    return JSON.stringify(value);
  });
}

export class CourierService {
  static async ensureSchema() {
    for (const statement of COURIER_TABLES_DDL) {
      await pool.query(statement);
    }
    await this.seedDefaults();
  }

  static async seedDefaults() {
    const [rows] = await pool.query('SELECT COUNT(*) AS total FROM `courier_providers`');
    if (Number(rows[0]?.total || 0) > 0) return;
    for (const provider of DEFAULT_PROVIDERS) {
      await this.insertProvider(provider);
    }
  }

  static async insertProvider(provider) {
    await pool.query(
      `INSERT IGNORE INTO \`courier_providers\`
        (\`id\`, \`provider_key\`, \`display_name\`, \`is_enabled\`, \`is_default\`, \`api_base_url\`,
         \`api_key\`, \`auth_header\`, \`auth_scheme\`, \`book_method\`, \`book_path\`,
         \`track_method\`, \`track_path\`, \`cancel_method\`, \`cancel_path\`, \`label_path\`,
         \`pickup_address_id\`, \`service_code\`, \`default_weight_kg\`, \`tracking_field\`,
         \`status_field\`, \`events_field\`, \`label_field\`, \`extra_headers\`, \`payload_template\`, \`notes\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId('cour'), provider.providerKey, provider.displayName,
        provider.enabled ? 1 : 0, provider.isDefault ? 1 : 0,
        provider.apiBaseUrl || '', provider.apiKey || '',
        provider.authHeader || 'Authorization', provider.authScheme ?? 'Bearer',
        provider.bookMethod || 'POST', provider.bookPath || '',
        provider.trackMethod || 'GET', provider.trackPath || '',
        provider.cancelMethod || 'POST', provider.cancelPath || '',
        provider.labelPath || '', provider.pickupAddressId || '',
        provider.serviceCode || '', provider.defaultWeightKg ?? 0.5,
        provider.trackingField || '', provider.statusField || '',
        provider.eventsField || '', provider.labelField || '',
        provider.extraHeaders || '', provider.payloadTemplate || '', provider.notes || ''
      ]
    );
  }

  static async listProviders() {
    let [rows] = await pool.query('SELECT * FROM `courier_providers` ORDER BY `is_default` DESC, `created_at` ASC');
    if (rows.length === 0) {
      await this.seedDefaults();
      [rows] = await pool.query('SELECT * FROM `courier_providers` ORDER BY `is_default` DESC, `created_at` ASC');
    }
    return rows.map(row => publicProvider(mapProviderRow(row)));
  }

  static async getProvider(providerKey) {
    if (!providerKey) {
      const [rows] = await pool.query('SELECT * FROM `courier_providers` ORDER BY `is_default` DESC, `created_at` ASC LIMIT 1');
      if (rows.length === 0) {
        const error = new Error('No courier provider is configured yet.');
        error.statusCode = 404;
        throw error;
      }
      return mapProviderRow(rows[0]);
    }
    const [rows] = await pool.query('SELECT * FROM `courier_providers` WHERE `provider_key` = ?', [providerKey]);
    if (rows.length === 0) {
      const error = new Error(`Courier provider "${providerKey}" was not found.`);
      error.statusCode = 404;
      throw error;
    }
    return mapProviderRow(rows[0]);
  }

  static async createProvider(payload = {}) {
    const providerKey = slugKey(payload.providerKey || payload.displayName);
    if (!providerKey) {
      const error = new Error('A provider key or display name is required.');
      error.statusCode = 400;
      throw error;
    }
    const [existing] = await pool.query('SELECT id FROM `courier_providers` WHERE `provider_key` = ?', [providerKey]);
    if (existing.length > 0) {
      const error = new Error(`Courier provider "${providerKey}" already exists.`);
      error.statusCode = 409;
      throw error;
    }
    const [countRows] = await pool.query('SELECT COUNT(*) AS total FROM `courier_providers`');
    await this.insertProvider({
      providerKey,
      displayName: payload.displayName || providerKey,
      enabled: Boolean(payload.enabled),
      isDefault: Number(countRows[0]?.total || 0) === 0,
      apiBaseUrl: payload.apiBaseUrl || '',
      apiKey: payload.apiKey || '',
      authHeader: payload.authHeader || 'Authorization',
      authScheme: payload.authScheme ?? 'Bearer',
      bookMethod: payload.bookMethod || 'POST',
      bookPath: payload.bookPath || '/orders',
      trackMethod: payload.trackMethod || 'GET',
      trackPath: payload.trackPath || '/orders/{{trackingNumber}}',
      cancelMethod: payload.cancelMethod || 'POST',
      cancelPath: payload.cancelPath || '',
      labelPath: payload.labelPath || '',
      trackingField: payload.trackingField || 'tracking_number',
      statusField: payload.statusField || 'status',
      eventsField: payload.eventsField || 'events',
      labelField: payload.labelField || 'label_url',
      payloadTemplate: payload.payloadTemplate || SECOND_COURIER_TEMPLATE,
      notes: payload.notes || ''
    });
    return this.getProvider(providerKey);
  }

  static async updateProvider(providerKey, payload = {}) {
    const current = await this.getProvider(providerKey);
    const next = {
      displayName: payload.displayName ?? current.displayName,
      enabled: payload.enabled === undefined ? current.enabled : Boolean(payload.enabled),
      isDefault: payload.isDefault === undefined ? current.isDefault : Boolean(payload.isDefault),
      apiBaseUrl: payload.apiBaseUrl ?? current.apiBaseUrl,
      apiKey: payload.apiKey ? payload.apiKey : current.apiKey,
      authHeader: payload.authHeader ?? current.authHeader,
      authScheme: payload.authScheme ?? current.authScheme,
      bookMethod: payload.bookMethod ?? current.bookMethod,
      bookPath: payload.bookPath ?? current.bookPath,
      trackMethod: payload.trackMethod ?? current.trackMethod,
      trackPath: payload.trackPath ?? current.trackPath,
      cancelMethod: payload.cancelMethod ?? current.cancelMethod,
      cancelPath: payload.cancelPath ?? current.cancelPath,
      labelPath: payload.labelPath ?? current.labelPath,
      pickupAddressId: payload.pickupAddressId ?? current.pickupAddressId,
      serviceCode: payload.serviceCode ?? current.serviceCode,
      defaultWeightKg: payload.defaultWeightKg ?? current.defaultWeightKg,
      trackingField: payload.trackingField ?? current.trackingField,
      statusField: payload.statusField ?? current.statusField,
      eventsField: payload.eventsField ?? current.eventsField,
      labelField: payload.labelField ?? current.labelField,
      extraHeaders: payload.extraHeaders ?? current.extraHeaders,
      payloadTemplate: payload.payloadTemplate ?? current.payloadTemplate,
      notes: payload.notes ?? current.notes
    };

    await pool.query(
      `UPDATE \`courier_providers\` SET
        \`display_name\` = ?, \`is_enabled\` = ?, \`is_default\` = ?, \`api_base_url\` = ?,
        \`api_key\` = ?, \`auth_header\` = ?, \`auth_scheme\` = ?, \`book_method\` = ?,
        \`book_path\` = ?, \`track_method\` = ?, \`track_path\` = ?, \`cancel_method\` = ?,
        \`cancel_path\` = ?, \`label_path\` = ?, \`pickup_address_id\` = ?, \`service_code\` = ?,
        \`default_weight_kg\` = ?, \`tracking_field\` = ?, \`status_field\` = ?, \`events_field\` = ?,
        \`label_field\` = ?, \`extra_headers\` = ?, \`payload_template\` = ?, \`notes\` = ?
       WHERE \`provider_key\` = ?`,
      [
        next.displayName, next.enabled ? 1 : 0, next.isDefault ? 1 : 0, next.apiBaseUrl,
        next.apiKey, next.authHeader, next.authScheme, next.bookMethod,
        next.bookPath, next.trackMethod, next.trackPath, next.cancelMethod,
        next.cancelPath, next.labelPath, next.pickupAddressId, next.serviceCode,
        Number(next.defaultWeightKg) || 0.5, next.trackingField, next.statusField, next.eventsField,
        next.labelField, next.extraHeaders, next.payloadTemplate, next.notes,
        providerKey
      ]
    );

    if (next.isDefault) {
      await pool.query('UPDATE `courier_providers` SET `is_default` = FALSE WHERE `provider_key` <> ?', [providerKey]);
    }

    return this.getProvider(providerKey);
  }

  static async deleteProvider(providerKey) {
    const provider = await this.getProvider(providerKey);
    if (provider.isDefault) {
      const error = new Error('The default courier cannot be deleted. Set another courier as default first.');
      error.statusCode = 400;
      throw error;
    }
    await pool.query('DELETE FROM `courier_providers` WHERE `provider_key` = ?', [providerKey]);
    return { providerKey, deleted: true };
  }

  static buildValues(order, provider) {
    const items = Array.isArray(order.items) ? order.items : [];
    const itemCount = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) || 1;
    const weight = Math.max(0.1, Number((itemCount * (Number(provider.defaultWeightKg) || 0.5)).toFixed(2)));
    const isCod = (order.paymentMethod || 'cod') === 'cod';
    const codAmount = isCod ? Number(order.total || 0) : Number(order.codRemainingDue || 0);
    const itemsJson = items.map(item => ({
      name: item.productName || item.variantName || 'Item',
      sku: item.variantId || item.productId || null,
      quantity: Number(item.quantity) || 1,
      price: Number(item.price) || 0
    }));

    return {
      orderId: order.id,
      orderReference: order.id,
      orderDate: order.createdAt || new Date().toISOString(),
      customerName: order.customer?.name || order.customerName || '',
      customerPhone: order.customer?.phone || order.customerPhone || '',
      customerEmail: order.customer?.email || order.customerEmail || '',
      customerCity: order.customer?.city || order.customerCity || '',
      customerAddress: order.customer?.address || order.customerAddress || '',
      postalCode: order.customer?.postalCode || '',
      paymentMethod: order.paymentMethod || 'cod',
      paymentType: isCod ? 'COD' : 'Prepaid',
      codAmount,
      orderTotal: Number(order.total || 0),
      subtotal: Number(order.subtotal || 0),
      shipping: Number(order.shipping || 0),
      itemCount,
      weight,
      itemsJson,
      note: order.notes || '',
      pickupAddressId: provider.pickupAddressId || '',
      serviceCode: provider.serviceCode || '',
      trackingNumber: order.trackingNumber || '',
      storeName: 'U-KNOW CART'
    };
  }

  static buildShipmentPayload(order, provider) {
    const template = provider.payloadTemplate || TRAX_PAYLOAD_TEMPLATE;
    const rendered = renderTemplate(template, this.buildValues(order, provider));
    try {
      return JSON.parse(rendered);
    } catch (err) {
      const error = new Error(`The ${provider.displayName} payload template is not valid JSON: ${err.message}`);
      error.statusCode = 400;
      throw error;
    }
  }

  static buildHeaders(provider) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (provider.apiKey) {
      headers[provider.authHeader || 'Authorization'] = provider.authScheme
        ? `${provider.authScheme} ${provider.apiKey}`
        : provider.apiKey;
    }
    const extra = parseJson(provider.extraHeaders);
    if (extra && typeof extra === 'object') {
      Object.assign(headers, extra);
    }
    return headers;
  }

  static buildUrl(provider, path, order = null, trackingNumber = '') {
    const base = String(provider.apiBaseUrl || '').replace(/\/+$/, '');
    let target = String(path || '');
    if (!/^https?:\/\//i.test(target)) {
      if (!base) {
        const error = new Error(`${provider.displayName} API base URL is not configured.`);
        error.statusCode = 400;
        throw error;
      }
      if (!target.startsWith('/')) target = `/${target}`;
      target = `${base}${target}`;
    }
    const replacements = {
      trackingNumber: trackingNumber || order?.trackingNumber || '',
      orderId: order?.id || ''
    };
    return target.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
      const value = replacements[key];
      if (value === undefined || value === '') return match;
      return encodeURIComponent(String(value));
    });
  }

  static async send(provider, method, url, body) {
    const options = {
      method: String(method || 'GET').toUpperCase(),
      headers: this.buildHeaders(provider),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    };
    if (body !== undefined && options.method !== 'GET' && options.method !== 'HEAD') {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';
    return {
      ok: response.ok,
      httpStatus: response.status,
      contentType,
      text,
      json: parseJson(text)
    };
  }

  static ensureConfigured(provider) {
    if (!provider) {
      const error = new Error('Courier provider not found.');
      error.statusCode = 404;
      throw error;
    }
    if (!provider.enabled) {
      const error = new Error(`${provider.displayName} integration is disabled. Enable it in Admin → Couriers.`);
      error.statusCode = 503;
      throw error;
    }
    const missing = [];
    if (!provider.apiBaseUrl) missing.push('API base URL');
    if (!provider.apiKey) missing.push('API key');
    if (!provider.bookPath) missing.push('booking path');
    if (missing.length > 0) {
      const error = new Error(`${provider.displayName} is missing: ${missing.join(', ')}. Add them in Admin → Couriers.`);
      error.statusCode = 503;
      throw error;
    }
  }

  static providerError(provider, result, action) {
    const message = pickFirst(result.json || {}, ['message', 'error', 'detail', 'data.message', 'errors.0.message'])
      || (result.text || '').slice(0, 300)
      || 'No response body';
    const error = new Error(`${provider.displayName} ${action} failed (HTTP ${result.httpStatus}): ${message}`);
    error.statusCode = 502;
    error.providerResponse = result.json || result.text;
    return error;
  }

  static async latestShipment(orderId) {
    const [rows] = await pool.query(
      'SELECT * FROM `order_shipments` WHERE `order_id` = ? ORDER BY `created_at` DESC LIMIT 1',
      [orderId]
    );
    return rows[0] ? this.formatShipment(rows[0]) : null;
  }

  static formatShipment(row) {
    if (!row) return null;
    return {
      id: row.id,
      orderId: row.order_id,
      providerKey: row.provider_key,
      providerName: row.provider_name,
      trackingNumber: row.tracking_number || '',
      status: row.shipment_status || 'booked',
      rawStatus: row.raw_status || '',
      labelUrl: row.label_url || '',
      events: parseJson(row.events) || [],
      bookedAt: row.booked_at ? new Date(row.booked_at).toISOString() : null,
      lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null
    };
  }

  static async saveShipment({ orderId, provider, trackingNumber, status, rawStatus, labelUrl, requestPayload, response, events, bookedBy }) {
    const existing = await this.latestShipment(orderId);
    const values = [
      provider.providerKey,
      provider.displayName,
      trackingNumber || '',
      status || 'booked',
      rawStatus || '',
      labelUrl || '',
      stringifyForStorage(requestPayload),
      stringifyForStorage(response),
      stringifyForStorage(events || [])
    ];
    if (existing && existing.providerKey === provider.providerKey) {
      await pool.query(
        `UPDATE \`order_shipments\` SET
          \`provider_name\` = ?, \`tracking_number\` = ?, \`shipment_status\` = ?, \`raw_status\` = ?,
          \`label_url\` = COALESCE(NULLIF(?, ''), \`label_url\`), \`request_payload\` = ?,
          \`last_response\` = ?, \`events\` = ?, \`last_synced_at\` = NOW()
         WHERE \`id\` = ?`,
        values.slice(1).concat(existing.id)
      );
      return this.latestShipment(orderId);
    }
    await pool.query(
      `INSERT INTO \`order_shipments\`
        (\`id\`, \`order_id\`, \`provider_key\`, \`provider_name\`, \`tracking_number\`, \`shipment_status\`,
         \`raw_status\`, \`label_url\`, \`request_payload\`, \`last_response\`, \`events\`, \`booked_by\`,
         \`booked_at\`, \`last_synced_at\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [newId('shp'), orderId, ...values, bookedBy || 'Store Administrator']
    );
    return this.latestShipment(orderId);
  }

  static async previewShipment(orderId, providerKey) {
    const order = await OrderService.getOrderById(orderId);
    if (!order) {
      const error = new Error(`Order "${orderId}" not found.`);
      error.statusCode = 404;
      throw error;
    }
    const provider = await this.getProvider(providerKey);
    return {
      provider: publicProvider(provider),
      url: this.buildUrl(provider, provider.bookPath, order),
      method: provider.bookMethod,
      payload: this.buildShipmentPayload(order, provider)
    };
  }

  static async bookShipment({ orderId, providerKey, actor = 'Store Administrator' }) {
    const order = await OrderService.getOrderById(orderId);
    if (!order) {
      const error = new Error(`Order "${orderId}" not found.`);
      error.statusCode = 404;
      throw error;
    }
    if (!['placed', 'confirmed', 'processing', 'courier_assigned'].includes(order.orderStatus)) {
      const error = new Error(`Cannot book a courier for an order in "${order.orderStatus}" status.`);
      error.statusCode = 400;
      throw error;
    }

    const provider = await this.getProvider(providerKey);
    this.ensureConfigured(provider);

    const payload = this.buildShipmentPayload(order, provider);
    const url = this.buildUrl(provider, provider.bookPath, order);
    const result = await this.send(provider, provider.bookMethod, url, payload);
    if (!result.ok) throw this.providerError(provider, result, 'booking');

    const body = result.json || {};
    const trackingNumber = pickFirst(body, [provider.trackingField, ...TRACKING_FIELD_CANDIDATES]);
    if (!trackingNumber || typeof trackingNumber !== 'string') {
      const error = new Error(
        `${provider.displayName} accepted the booking but returned no tracking number. Set the correct tracking field in Admin → Couriers. Response: ${(result.text || '').slice(0, 300)}`
      );
      error.statusCode = 502;
      throw error;
    }

    const rawStatus = pickFirst(body, [provider.statusField, ...STATUS_FIELD_CANDIDATES]);
    const normalizedStatus = mapCourierStatus(rawStatus) || 'pending';
    const labelUrl = pickFirst(body, [provider.labelField, ...LABEL_FIELD_CANDIDATES]) || '';
    const events = normalizeEvents(pickFirst(body, [provider.eventsField, ...EVENTS_FIELD_CANDIDATES]));

    const assignment = await OrderService.assignCourier(
      orderId,
      provider.displayName,
      trackingNumber,
      `Booked with ${provider.displayName} API — ${STATUS_LABELS[normalizedStatus] || normalizedStatus}`
    );

    const shipment = await this.saveShipment({
      orderId,
      provider,
      trackingNumber,
      status: normalizedStatus,
      rawStatus,
      labelUrl: typeof labelUrl === 'string' ? labelUrl : '',
      requestPayload: payload,
      response: body,
      events,
      bookedBy: actor
    });

    return { shipment, assignment };
  }

  static async trackShipment({ orderId, providerKey }) {
    const shipment = await this.latestShipment(orderId);
    const provider = await this.getProvider(providerKey || shipment?.providerKey);
    if (!provider.enabled) {
      const error = new Error(`${provider.displayName} integration is disabled.`);
      error.statusCode = 503;
      throw error;
    }

    const order = await OrderService.getOrderById(orderId);
    if (!order) {
      const error = new Error(`Order "${orderId}" not found.`);
      error.statusCode = 404;
      throw error;
    }
    const trackingNumber = shipment?.trackingNumber || order.trackingNumber;
    if (!trackingNumber) {
      const error = new Error('This order has no tracking number yet. Book the shipment first.');
      error.statusCode = 400;
      throw error;
    }

    const url = this.buildUrl(provider, provider.trackPath, order, trackingNumber);
    const result = await this.send(provider, provider.trackMethod, url);
    if (!result.ok) throw this.providerError(provider, result, 'tracking');

    const body = result.json || {};
    const rawStatus = pickFirst(body, [provider.statusField, ...STATUS_FIELD_CANDIDATES]) || '';
    const normalizedStatus = mapCourierStatus(rawStatus) || shipment?.status || 'in_transit';
    const events = normalizeEvents(pickFirst(body, [provider.eventsField, ...EVENTS_FIELD_CANDIDATES]));
    const labelUrl = pickFirst(body, [provider.labelField, ...LABEL_FIELD_CANDIDATES]) || '';

    const saved = await this.saveShipment({
      orderId,
      provider,
      trackingNumber,
      status: normalizedStatus,
      rawStatus,
      labelUrl: typeof labelUrl === 'string' ? labelUrl : '',
      requestPayload: null,
      response: body,
      events
    });

    const note = `${provider.displayName}: ${rawStatus || STATUS_LABELS[normalizedStatus] || normalizedStatus}`;
    let orderStatus = order.orderStatus;
    let orderSyncError = null;
    try {
      const targetStatus = normalizedStatus === 'delivered'
        ? 'delivered'
        : ['picked', 'in_transit', 'out_for_delivery'].includes(normalizedStatus)
          ? 'shipped'
          : normalizedStatus === 'returned'
            ? 'returned'
            : null;
      if (targetStatus && targetStatus !== order.orderStatus) {
        const transitions = OrderService.VALID_TRANSITIONS?.[order.orderStatus] || [];
        if (transitions.includes(targetStatus)) {
          await OrderService.updateOrderStatus(orderId, targetStatus, 'Courier Sync', 'system', note);
          orderStatus = targetStatus;
        }
      }
      if (orderStatus === order.orderStatus) {
        await pool.query('UPDATE `orders` SET `courier_status_note` = ? WHERE `id` = ?', [note.slice(0, 255), orderId]);
      }
    } catch (err) {
      orderSyncError = err.message;
      logger.warn('Courier tracking fetched but the order status could not be synced.', { orderId, message: err.message });
      try {
        await pool.query('UPDATE `orders` SET `courier_status_note` = ? WHERE `id` = ?', [note.slice(0, 255), orderId]);
      } catch { /* note update is best-effort */ }
    }

    return {
      shipment: saved,
      tracking: {
        providerKey: provider.providerKey,
        providerName: provider.displayName,
        trackingNumber,
        rawStatus,
        status: normalizedStatus,
        statusLabel: STATUS_LABELS[normalizedStatus] || rawStatus || normalizedStatus,
        events,
        labelUrl: saved?.labelUrl || ''
      },
      orderStatus,
      orderSyncError
    };
  }

  static async cancelShipment({ orderId, reason = 'Cancelled by store admin' }) {
    const shipment = await this.latestShipment(orderId);
    if (!shipment) {
      const error = new Error('No courier shipment was booked for this order.');
      error.statusCode = 404;
      throw error;
    }
    const provider = await this.getProvider(shipment.providerKey);
    if (!provider.enabled) {
      const error = new Error(`${provider.displayName} integration is disabled.`);
      error.statusCode = 503;
      throw error;
    }
    if (!provider.cancelPath) {
      const error = new Error(`${provider.displayName} has no cancellation endpoint configured. Cancel it in the courier portal.`);
      error.statusCode = 400;
      throw error;
    }

    const order = await OrderService.getOrderById(orderId);
    const url = this.buildUrl(provider, provider.cancelPath, order, shipment.trackingNumber);
    const result = await this.send(provider, provider.cancelMethod, url, { reason, tracking_number: shipment.trackingNumber });
    if (!result.ok) throw this.providerError(provider, result, 'cancellation');

    await pool.query(
      "UPDATE `order_shipments` SET `shipment_status` = 'cancelled', `last_response` = ?, `last_synced_at` = NOW() WHERE `id` = ?",
      [stringifyForStorage(result.json || result.text), shipment.id]
    );
    await pool.query('UPDATE `orders` SET `courier_status_note` = ? WHERE `id` = ?', [
      `${provider.displayName}: booking cancelled`.slice(0, 255),
      orderId
    ]);
    return { shipment: await this.latestShipment(orderId), providerResponse: result.json || result.text };
  }

  static async getLabel({ orderId }) {
    const shipment = await this.latestShipment(orderId);
    if (!shipment) {
      const error = new Error('No courier shipment was booked for this order.');
      error.statusCode = 404;
      throw error;
    }
    if (shipment.labelUrl) {
      return { labelUrl: shipment.labelUrl, source: 'stored' };
    }
    const provider = await this.getProvider(shipment.providerKey);
    if (!provider.enabled || !provider.labelPath) {
      const error = new Error(`${provider.displayName} label retrieval is not configured.`);
      error.statusCode = 400;
      throw error;
    }
    const order = await OrderService.getOrderById(orderId);
    const url = this.buildUrl(provider, provider.labelPath, order, shipment.trackingNumber);
    const result = await this.send(provider, 'GET', url);
    if (!result.ok) throw this.providerError(provider, result, 'label retrieval');
    if (/application\/pdf/i.test(result.contentType)) {
      return {
        pdfBase64: Buffer.from(result.text, 'binary').toString('base64'),
        contentType: 'application/pdf',
        source: 'provider'
      };
    }
    const labelUrl = pickFirst(result.json || {}, [provider.labelField, ...LABEL_FIELD_CANDIDATES]) || '';
    if (!labelUrl || typeof labelUrl !== 'string') {
      const error = new Error(`${provider.displayName} returned no label URL. Check the label field in Admin → Couriers.`);
      error.statusCode = 502;
      throw error;
    }
    await pool.query('UPDATE `order_shipments` SET `label_url` = ? WHERE `id` = ?', [labelUrl, shipment.id]);
    return { labelUrl, source: 'provider' };
  }

  static async testProvider(providerKey) {
    const provider = await this.getProvider(providerKey);
    if (!provider.apiBaseUrl) {
      const error = new Error(`${provider.displayName} has no API base URL yet.`);
      error.statusCode = 400;
      throw error;
    }
    const url = this.buildUrl(provider, '/');
    const startedAt = Date.now();
    try {
      const result = await this.send(provider, 'GET', url);
      return {
        reachable: true,
        httpStatus: result.httpStatus,
        durationMs: Date.now() - startedAt,
        apiKeySet: Boolean(provider.apiKey),
        note: result.ok
          ? 'Courier API answered successfully.'
          : `Courier API is reachable but rejected the request (HTTP ${result.httpStatus}). Check the API key and auth header.`
      };
    } catch (err) {
      return {
        reachable: false,
        httpStatus: 0,
        durationMs: Date.now() - startedAt,
        apiKeySet: Boolean(provider.apiKey),
        note: `Courier API could not be reached: ${err.message}`
      };
    }
  }
}
