import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../config/db.js';
import { config } from '../config/env.js';
import { storeLogoRoot } from '../middlewares/upload.middleware.js';
import { getIO } from '../config/socket.js';
import { SOCKET_EVENTS } from '../socket/events.js';
import { logger } from '../utils/logger.js';

const signatures = {
  'image/jpeg': buffer => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/png': buffer => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/gif': buffer => buffer.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/) !== null,
  'image/webp': buffer => buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
};

let logoColumnChecked = false;
async function ensureLogoColumn() {
  if (logoColumnChecked) return;
  try {
    const [cols] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_settings' AND COLUMN_NAME = 'store_logo_url'"
    );
    if (cols.length === 0) {
      await pool.query("ALTER TABLE store_settings ADD COLUMN store_logo_url VARCHAR(500) NULL DEFAULT NULL AFTER brand_accent_color");
    }
    logoColumnChecked = true;
  } catch (err) {
    // If DB check fails or table doesn't exist, proceed gracefully
  }
}

const CANONICAL_SETTINGS = {
  // 1. Store Name & Brand Identity
  storeName: 'U-KNOW CART',
  storeTagline: "Pakistan's Multi-Vendor Marketplace — Every Category, Trusted Sellers, Nationwide Delivery",
  legalBusinessName: 'U-KNOW CART Pvt. Ltd.',
  taxRegistrationNumber: 'STRN-7492841-9 / NTN: 948201-1',
  storeLogoUrl: '',
  brandAccentColor: '#d97706',

  // 2. Contact Information
  supportEmail: 'qaseeem08@gmail.com',
  supportPhone: '+92 300 2232038',
  whatsappNumber: '+92 300 2232038',
  alternatePhone: '03340255740',
  complaintsEmail: 'qasimabha@bul.com.pk',
  urgentContactPerson: 'Muhammad Qasim (Director & Concierge)',

  // 3. Currency & Localization
  defaultCurrency: 'PKR',
  currencySymbol: 'PKR',
  currencyPosition: 'prefix',
  allowedCurrencies: ['PKR', 'USD', 'AED', 'EUR', 'GBP'],
  exchangeRateUSD: 278.50,
  exchangeRateAED: 75.80,
  exchangeRateEUR: 302.20,
  exchangeRateGBP: 353.40,
  orderPrefix: 'AUK-',
  timezone: 'Asia/Karachi (PKT - UTC+5)',
  weightUnit: 'kg',

  // 4. Operational Hours & Weekly Schedule
  operatingStatus: 'always_open',
  weekdayHours: '09:00 AM - 10:00 PM (PKT)',
  fridayHours: '09:00 AM - 11:00 PM (PKT)',
  fridayPrayerBreak: '01:00 PM - 02:30 PM (Jumma Prayer Pause)',
  weekendHours: '10:00 AM - 11:30 PM (PKT)',
  orderProcessingCutoff: '05:00 PM (Orders after 5 PM dispatched next business day)',
  holidayNotice: 'Online checkout remains active 24/7. Deliveries resume next working morning.',
  businessHours: 'Mon - Sun: 9:00 AM - 10:00 PM (PKT) • Online Orders 24/7',

  // 5. Address Configuration & Logistics Hubs
  storeAddress: 'Plot 42-B, Commercial Avenue, Sector Y, DHA Phase 6, Lahore, Pakistan',
  buildingFloor: 'Executive Commercial Suites, 3rd Floor',
  streetAddress: 'Plot 42-B, Commercial Avenue',
  areaDistrict: 'Sector Y, DHA Phase 6',
  city: 'Lahore',
  stateProvince: 'Punjab',
  postalCode: '54792',
  country: 'Pakistan',
  googleMapsLocationUrl: 'https://maps.google.com/?q=DHA+Phase+6+Lahore',
  warehouseAddress: 'Central Logistics Facility, Warehouse #14, Multan Road Industrial Estate, Lahore',
  returnCenterAddress: 'U-KNOW CART Quality & Returns Processing Desk, DHA Phase 6, Lahore',

  // 6. Shipping & Logistics
  standardShippingFee: config.pricing.standardShippingFee,
  freeShippingThreshold: config.pricing.freeShippingThreshold,
  enableFreeShipping: false,
  urgentShippingFee: config.pricing.urgentShippingFee,
  enableUrgentShipping: true,
  estimatedDeliveryDaysMin: 2,
  estimatedDeliveryDaysMax: 4,
  primaryCourier: 'tcs',
  allowCustomerPickup: false,
  warehouseCity: 'Lahore',

  // 7. Cash on Delivery
  enableCOD: true,
  codMaxLimit: 100000,
  enableEasyPaisa: false,
  easypaisaAccountTitle: '',
  easypaisaAccountNumber: '',
  enableJazzCash: false,
  jazzcashAccountTitle: '',
  jazzcashAccountNumber: '',

  // 8. Inventory & Order Controls
  lowStockThreshold: 5,
  outOfStockAction: 'show_badge',
  minOrderAmount: 500,
  maxOrderQuantityPerItem: 10,
  autoCancelUnpaidMinutes: 1440,
  customerCancellationHours: 36,

  // 9. Storefront Notice & Maintenance Mode
  maintenanceMode: false,
  maintenanceMessage: 'We are currently conducting scheduled vault inventory maintenance. We will be back online shortly.',
  announcementBarActive: true,
  announcementText: '⚡ Ramadan Luxury Gala: Complimentary armored insured delivery across Pakistan on orders over PKR 3,500!',
  announcementTheme: 'amber',
  announcementLink: '/shop',

  // 10. Social Media & SEO
  facebookUrl: 'https://facebook.com/uknowcart',
  instagramUrl: 'https://instagram.com/uknowcart.official',
  tiktokUrl: 'https://tiktok.com/@uknowcart',
  youtubeUrl: 'https://youtube.com/@uknowcart',
  metaTitle: "U-KNOW CART — Pakistan's Multi-Vendor Online Marketplace",
  metaDescription: 'Shop every category from trusted vendors — electronics, fashion, watches, jewellery, beauty, home and more. Secure checkout and nationwide delivery across Pakistan.'
};

export class SettingController {
  static async getSettings(req, res, next) {
    try {
      let settings = { ...CANONICAL_SETTINGS };

      try {
        const [rows] = await pool.query('SELECT * FROM store_settings WHERE id = 1');
        if (rows.length > 0) {
          const r = rows[0];
          let extra = {};
          try {
            extra = typeof r.extra_data === 'string' ? JSON.parse(r.extra_data) : (r.extra_data || {});
          } catch (e) {}

          settings = {
            ...settings,
            ...extra,
            storeName: r.store_name || settings.storeName,
            storeTagline: r.store_tagline || settings.storeTagline,
            legalBusinessName: r.legal_business_name || settings.legalBusinessName,
            taxRegistrationNumber: r.tax_registration_number || settings.taxRegistrationNumber,
            brandAccentColor: r.brand_accent_color || settings.brandAccentColor,
            storeLogoUrl: r.store_logo_url || extra.storeLogoUrl || settings.storeLogoUrl || '',
            supportEmail: r.support_email || settings.supportEmail,
            supportPhone: r.support_phone || settings.supportPhone,
            whatsappNumber: r.whatsapp_number || settings.whatsappNumber,
            alternatePhone: r.alternate_phone || settings.alternatePhone,
            complaintsEmail: r.complaints_email || settings.complaintsEmail,
            urgentContactPerson: r.urgent_contact_person || settings.urgentContactPerson,
            storeAddress: r.store_address || settings.storeAddress,
            warehouseAddress: r.warehouse_address || settings.warehouseAddress,
            warehouseCity: r.warehouse_city || settings.warehouseCity,
            standardShippingFee: parseFloat(r.standard_shipping_fee || settings.standardShippingFee),
            freeShippingThreshold: parseFloat(r.free_shipping_threshold || settings.freeShippingThreshold),
            urgentShippingFee: parseFloat(r.urgent_shipping_fee || settings.urgentShippingFee),
            enableFreeShipping: !!r.enable_free_shipping,
            enableUrgentShipping: r.enable_urgent_shipping !== undefined ? !!r.enable_urgent_shipping : true,
            primaryCourier: r.primary_courier || settings.primaryCourier,
            enableCOD: !!r.enable_cod,
            codMaxLimit: parseFloat(r.cod_max_limit || settings.codMaxLimit),
            enableEasyPaisa: !!r.enable_easypaisa,
            easypaisaAccountTitle: r.easypaisa_account_title || '',
            easypaisaAccountNumber: r.easypaisa_account_number || '',
            enableJazzCash: !!r.enable_jazzcash,
            jazzcashAccountTitle: r.jazzcash_account_title || '',
            jazzcashAccountNumber: r.jazzcash_account_number || '',
            lowStockThreshold: parseInt(r.low_stock_threshold || settings.lowStockThreshold, 10),
            minOrderAmount: parseFloat(r.min_order_amount || settings.minOrderAmount),
            customerCancellationHours: parseInt(r.customer_cancellation_hours || settings.customerCancellationHours, 10),
            maintenanceMode: !!r.maintenance_mode,
            announcementBarActive: !!r.announcement_bar_active,
            announcementText: r.announcement_text || settings.announcementText,
            announcementTheme: r.announcement_theme || settings.announcementTheme,
            announcementLink: r.announcement_link || settings.announcementLink
          };
        }
      } catch (e) {}

      for (const key of [
        'requireAdvanceForHighValue', 'advancePaymentThreshold', 'advancePaymentPercent',
        'enableCardPayments', 'enableBankTransfer', 'bankName', 'bankAccountTitle', 'bankIban', 'bankBranchCode'
      ]) {
        delete settings[key];
      }

      res.json({ success: true, settings });
    } catch (err) {
      next(err);
    }
  }

  static async updateSettings(req, res, next) {
    try {
      const updates = { ...(req.body || {}) };
      for (const key of [
        'requireAdvanceForHighValue', 'advancePaymentThreshold', 'advancePaymentPercent',
        'enableCardPayments', 'enableBankTransfer', 'bankName', 'bankAccountTitle', 'bankIban', 'bankBranchCode'
      ]) {
        delete updates[key];
      }
      const extraJson = JSON.stringify(updates);

      await pool.query(`
        INSERT INTO store_settings (
          id, store_name, store_tagline, legal_business_name, tax_registration_number,
          brand_accent_color, store_logo_url, support_email, support_phone, whatsapp_number,
          alternate_phone, complaints_email, urgent_contact_person, store_address,
          warehouse_address, warehouse_city, standard_shipping_fee, free_shipping_threshold,
          enable_free_shipping, urgent_shipping_fee, enable_urgent_shipping, primary_courier,
          enable_cod, cod_max_limit, require_advance_for_high_value, advance_payment_threshold, advance_payment_percent,
          enable_easypaisa, easypaisa_account_number, easypaisa_account_title,
          enable_jazzcash, jazzcash_account_number, jazzcash_account_title,
          enable_card_payments, low_stock_threshold, min_order_amount, customer_cancellation_hours,
          maintenance_mode, announcement_bar_active, announcement_text, announcement_theme,
          announcement_link, extra_data
        ) VALUES (
          1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        ) ON DUPLICATE KEY UPDATE
          store_name = COALESCE(VALUES(store_name), store_name),
          store_tagline = COALESCE(VALUES(store_tagline), store_tagline),
          legal_business_name = COALESCE(VALUES(legal_business_name), legal_business_name),
          tax_registration_number = COALESCE(VALUES(tax_registration_number), tax_registration_number),
          brand_accent_color = COALESCE(VALUES(brand_accent_color), brand_accent_color),
          store_logo_url = COALESCE(VALUES(store_logo_url), store_logo_url),
          support_email = COALESCE(VALUES(support_email), support_email),
          support_phone = COALESCE(VALUES(support_phone), support_phone),
          whatsapp_number = COALESCE(VALUES(whatsapp_number), whatsapp_number),
          alternate_phone = COALESCE(VALUES(alternate_phone), alternate_phone),
          complaints_email = COALESCE(VALUES(complaints_email), complaints_email),
          urgent_contact_person = COALESCE(VALUES(urgent_contact_person), urgent_contact_person),
          store_address = COALESCE(VALUES(store_address), store_address),
          warehouse_address = COALESCE(VALUES(warehouse_address), warehouse_address),
          warehouse_city = COALESCE(VALUES(warehouse_city), warehouse_city),
          standard_shipping_fee = COALESCE(VALUES(standard_shipping_fee), standard_shipping_fee),
          free_shipping_threshold = COALESCE(VALUES(free_shipping_threshold), free_shipping_threshold),
          enable_free_shipping = COALESCE(VALUES(enable_free_shipping), enable_free_shipping),
          urgent_shipping_fee = COALESCE(VALUES(urgent_shipping_fee), urgent_shipping_fee),
          enable_urgent_shipping = COALESCE(VALUES(enable_urgent_shipping), enable_urgent_shipping),
          primary_courier = COALESCE(VALUES(primary_courier), primary_courier),
          enable_cod = COALESCE(VALUES(enable_cod), enable_cod),
          cod_max_limit = COALESCE(VALUES(cod_max_limit), cod_max_limit),
          require_advance_for_high_value = FALSE,
          advance_payment_threshold = COALESCE(VALUES(advance_payment_threshold), advance_payment_threshold),
          advance_payment_percent = COALESCE(VALUES(advance_payment_percent), advance_payment_percent),
          enable_easypaisa = COALESCE(VALUES(enable_easypaisa), enable_easypaisa),
          easypaisa_account_number = COALESCE(VALUES(easypaisa_account_number), easypaisa_account_number),
          easypaisa_account_title = COALESCE(VALUES(easypaisa_account_title), easypaisa_account_title),
          enable_jazzcash = COALESCE(VALUES(enable_jazzcash), enable_jazzcash),
          jazzcash_account_number = COALESCE(VALUES(jazzcash_account_number), jazzcash_account_number),
          jazzcash_account_title = COALESCE(VALUES(jazzcash_account_title), jazzcash_account_title),
          enable_card_payments = COALESCE(VALUES(enable_card_payments), enable_card_payments),
          low_stock_threshold = COALESCE(VALUES(low_stock_threshold), low_stock_threshold),
          min_order_amount = COALESCE(VALUES(min_order_amount), min_order_amount),
          customer_cancellation_hours = COALESCE(VALUES(customer_cancellation_hours), customer_cancellation_hours),
          maintenance_mode = COALESCE(VALUES(maintenance_mode), maintenance_mode),
          announcement_bar_active = COALESCE(VALUES(announcement_bar_active), announcement_bar_active),
          announcement_text = COALESCE(VALUES(announcement_text), announcement_text),
          announcement_theme = COALESCE(VALUES(announcement_theme), announcement_theme),
          announcement_link = COALESCE(VALUES(announcement_link), announcement_link),
          extra_data = VALUES(extra_data)
      `, [
        updates.storeName || CANONICAL_SETTINGS.storeName,
        updates.storeTagline || CANONICAL_SETTINGS.storeTagline,
        updates.legalBusinessName || null,
        updates.taxRegistrationNumber || null,
        updates.brandAccentColor || '#d97706',
        updates.storeLogoUrl || null,
        updates.supportEmail || CANONICAL_SETTINGS.supportEmail,
        updates.supportPhone || CANONICAL_SETTINGS.supportPhone,
        updates.whatsappNumber || CANONICAL_SETTINGS.whatsappNumber,
        updates.alternatePhone || null,
        updates.complaintsEmail || null,
        updates.urgentContactPerson || null,
        updates.storeAddress || CANONICAL_SETTINGS.storeAddress,
        updates.warehouseAddress || null,
        updates.warehouseCity || 'Lahore',
        updates.standardShippingFee !== undefined ? parseFloat(updates.standardShippingFee) : CANONICAL_SETTINGS.standardShippingFee,
        updates.freeShippingThreshold !== undefined ? parseFloat(updates.freeShippingThreshold) : CANONICAL_SETTINGS.freeShippingThreshold,
        updates.enableFreeShipping !== undefined ? !!updates.enableFreeShipping : false,
        updates.urgentShippingFee !== undefined ? parseFloat(updates.urgentShippingFee) : CANONICAL_SETTINGS.urgentShippingFee,
        updates.enableUrgentShipping !== undefined ? !!updates.enableUrgentShipping : true,
        updates.primaryCourier || 'tcs',
        updates.enableCOD !== undefined ? !!updates.enableCOD : true,
        updates.codMaxLimit !== undefined ? parseFloat(updates.codMaxLimit) : 100000,
        false,
        0,
        0,
        updates.enableEasyPaisa !== undefined ? !!updates.enableEasyPaisa : null,
        updates.easypaisaAccountNumber || null,
        updates.easypaisaAccountTitle || null,
        updates.enableJazzCash !== undefined ? !!updates.enableJazzCash : null,
        updates.jazzcashAccountNumber || null,
        updates.jazzcashAccountTitle || null,
        false,
        updates.lowStockThreshold !== undefined ? parseInt(updates.lowStockThreshold, 10) : 5,
        updates.minOrderAmount !== undefined ? parseFloat(updates.minOrderAmount) : 500,
        updates.customerCancellationHours !== undefined ? parseInt(updates.customerCancellationHours, 10) : 36,
        updates.maintenanceMode !== undefined ? !!updates.maintenanceMode : false,
        updates.announcementBarActive !== undefined ? !!updates.announcementBarActive : true,
        updates.announcementText || null,
        updates.announcementTheme || 'amber',
        updates.announcementLink || '/shop',
        extraJson
      ]);

      res.json({ success: true, message: 'Store settings updated successfully across all categories.' });
    } catch (err) {
      next(err);
    }
  }

  static async getLogo(req, res, next) {
    try {
      await ensureLogoColumn();
      let logoUrl = null;
      let storeName = CANONICAL_SETTINGS.storeName;
      let brandAccentColor = CANONICAL_SETTINGS.brandAccentColor;
      let updatedAt = null;

      try {
        const [rows] = await pool.query('SELECT store_name, brand_accent_color, store_logo_url, updated_at, extra_data FROM store_settings WHERE id = 1');
        if (rows.length > 0) {
          const r = rows[0];
          storeName = r.store_name || storeName;
          brandAccentColor = r.brand_accent_color || brandAccentColor;
          updatedAt = r.updated_at || null;
          let extra = {};
          try {
            extra = typeof r.extra_data === 'string' ? JSON.parse(r.extra_data) : (r.extra_data || {});
          } catch (e) {}
          logoUrl = r.store_logo_url || extra.storeLogoUrl || null;
        }
      } catch (err) {}

      const relativeUrl = logoUrl && logoUrl.startsWith(config.apiPublicUrl)
        ? logoUrl.replace(config.apiPublicUrl, '')
        : (logoUrl && logoUrl.startsWith('/uploads') ? logoUrl : null);

      return res.json({
        success: true,
        storeName,
        brandAccentColor,
        logoUrl: logoUrl || null,
        relativeUrl: relativeUrl || logoUrl || null,
        hasCustomLogo: !!logoUrl,
        updatedAt
      });
    } catch (err) {
      next(err);
    }
  }

  static async getLogoFile(req, res, next) {
    try {
      await ensureLogoColumn();
      let logoUrl = null;

      try {
        const [rows] = await pool.query('SELECT store_logo_url, extra_data FROM store_settings WHERE id = 1');
        if (rows.length > 0) {
          const r = rows[0];
          let extra = {};
          try { extra = typeof r.extra_data === 'string' ? JSON.parse(r.extra_data) : (r.extra_data || {}); } catch (e) {}
          logoUrl = r.store_logo_url || extra.storeLogoUrl || null;
        }
      } catch (e) {}

      if (!logoUrl) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100" width="400" height="100">
  <rect width="100%" height="100%" fill="#111827"/>
  <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" font-family="'Cinzel', serif, sans-serif" font-weight="700" font-size="28" fill="#d97706" letter-spacing="4">U-KNOW CART</text>
</svg>`;
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.send(svg);
      }

      if (logoUrl.includes('/uploads/logo/')) {
        const filename = path.basename(logoUrl.split('?')[0]);
        const filePath = path.join(storeLogoRoot, filename);
        if (fs.existsSync(filePath)) {
          return res.sendFile(filePath);
        }
      }

      return res.redirect(logoUrl);
    } catch (err) {
      next(err);
    }
  }

  static async uploadLogo(req, res, next) {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Select a logo image file to upload (JPEG, PNG, WebP, GIF, or SVG).'
      });
    }

    try {
      await ensureLogoColumn();

      const fileHandle = await fsPromises.open(req.file.path, 'r');
      let header;
      try {
        header = Buffer.alloc(32);
        await fileHandle.read(header, 0, header.length, 0);
      } finally {
        await fileHandle.close();
      }

      const isSvg = req.file.mimetype === 'image/svg+xml' || req.file.originalname?.toLowerCase().endsWith('.svg');
      let isValidImage = false;
      if (isSvg) {
        const content = header.toString('utf8').trim().toLowerCase();
        isValidImage = content.includes('<svg') || content.startsWith('<?xml');
      } else {
        isValidImage = !!signatures[req.file.mimetype]?.(header);
      }

      if (!isValidImage) {
        try { await fsPromises.unlink(req.file.path); } catch (e) {}
        return res.status(400).json({
          success: false,
          message: 'The uploaded file content is not a valid supported image (JPEG, PNG, WebP, GIF, or SVG).'
        });
      }

      const logoUrl = `${config.apiPublicUrl}/uploads/logo/${encodeURIComponent(req.file.filename)}`;
      const relativeUrl = `/uploads/logo/${encodeURIComponent(req.file.filename)}`;

      // Remove previous logo file if on local disk
      try {
        const [existing] = await pool.query('SELECT store_logo_url FROM store_settings WHERE id = 1');
        if (existing.length > 0 && existing[0].store_logo_url) {
          const oldUrl = existing[0].store_logo_url;
          if (oldUrl.includes('/uploads/logo/')) {
            const oldFilename = path.basename(oldUrl.split('?')[0]);
            const oldPath = path.join(storeLogoRoot, oldFilename);
            if (oldPath !== req.file.path && fs.existsSync(oldPath)) {
              try { await fsPromises.unlink(oldPath); } catch (e) {}
            }
          }
        }
      } catch (e) {}

      // Save to database
      try {
        await pool.query(
          `INSERT INTO store_settings (id, store_name, store_tagline, store_address, support_email, support_phone, whatsapp_number, store_logo_url)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE store_logo_url = VALUES(store_logo_url)`,
          [
            CANONICAL_SETTINGS.storeName,
            CANONICAL_SETTINGS.storeTagline,
            CANONICAL_SETTINGS.storeAddress,
            CANONICAL_SETTINGS.supportEmail,
            CANONICAL_SETTINGS.supportPhone,
            CANONICAL_SETTINGS.whatsappNumber,
            logoUrl
          ]
        );
      } catch (dbErr) {
        try {
          const [cur] = await pool.query('SELECT extra_data FROM store_settings WHERE id = 1');
          let extra = {};
          if (cur.length > 0) {
            extra = typeof cur[0].extra_data === 'string' ? JSON.parse(cur[0].extra_data || '{}') : (cur[0].extra_data || {});
          }
          extra.storeLogoUrl = logoUrl;
          await pool.query('UPDATE store_settings SET extra_data = ? WHERE id = 1', [JSON.stringify(extra)]);
        } catch (extraErr) {
          logger.error('Failed to update extra_data with logoUrl', { error: extraErr.message });
        }
      }

      // Realtime broadcast
      try {
        const io = getIO();
        const event = {
          resource: 'settings',
          action: 'logo_updated',
          logoUrl,
          relativeUrl,
          timestamp: new Date().toISOString()
        };
        io.emit(SOCKET_EVENTS.STOREFRONT_DATA_CHANGED, event);
        io.to('admin').emit(SOCKET_EVENTS.ADMIN_DATA_CHANGED, event);
      } catch (socketErr) {
        logger.warn('Socket broadcast for logo update skipped:', socketErr.message);
      }

      return res.status(201).json({
        success: true,
        message: 'Store logo uploaded and saved successfully.',
        logoUrl,
        relativeUrl,
        filename: req.file.filename
      });
    } catch (err) {
      if (req.file?.path) {
        try { await fsPromises.unlink(req.file.path); } catch (e) {}
      }
      next(err);
    }
  }

  static async updateLogo(req, res, next) {
    try {
      await ensureLogoColumn();
      const { logoUrl } = req.body || {};
      if (!logoUrl || typeof logoUrl !== 'string' || !logoUrl.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Provide a valid logoUrl string.'
        });
      }

      const cleanUrl = logoUrl.trim();

      await pool.query(
        `INSERT INTO store_settings (id, store_name, store_tagline, store_address, support_email, support_phone, whatsapp_number, store_logo_url)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE store_logo_url = VALUES(store_logo_url)`,
        [
          CANONICAL_SETTINGS.storeName,
          CANONICAL_SETTINGS.storeTagline,
          CANONICAL_SETTINGS.storeAddress,
          CANONICAL_SETTINGS.supportEmail,
          CANONICAL_SETTINGS.supportPhone,
          CANONICAL_SETTINGS.whatsappNumber,
          cleanUrl
        ]
      );

      try {
        const io = getIO();
        const event = {
          resource: 'settings',
          action: 'logo_updated',
          logoUrl: cleanUrl,
          timestamp: new Date().toISOString()
        };
        io.emit(SOCKET_EVENTS.STOREFRONT_DATA_CHANGED, event);
        io.to('admin').emit(SOCKET_EVENTS.ADMIN_DATA_CHANGED, event);
      } catch (socketErr) {}

      res.json({
        success: true,
        message: 'Store logo URL updated successfully.',
        logoUrl: cleanUrl
      });
    } catch (err) {
      next(err);
    }
  }

  static async deleteLogo(req, res, next) {
    try {
      await ensureLogoColumn();

      try {
        const [rows] = await pool.query('SELECT store_logo_url FROM store_settings WHERE id = 1');
        if (rows.length > 0 && rows[0].store_logo_url) {
          const oldUrl = rows[0].store_logo_url;
          if (oldUrl.includes('/uploads/logo/')) {
            const oldFilename = path.basename(oldUrl.split('?')[0]);
            const oldPath = path.join(storeLogoRoot, oldFilename);
            if (fs.existsSync(oldPath)) {
              try { await fsPromises.unlink(oldPath); } catch (e) {}
            }
          }
        }
      } catch (e) {}

      await pool.query('UPDATE store_settings SET store_logo_url = NULL WHERE id = 1');

      try {
        const io = getIO();
        const event = {
          resource: 'settings',
          action: 'logo_deleted',
          logoUrl: null,
          timestamp: new Date().toISOString()
        };
        io.emit(SOCKET_EVENTS.STOREFRONT_DATA_CHANGED, event);
        io.to('admin').emit(SOCKET_EVENTS.ADMIN_DATA_CHANGED, event);
      } catch (socketErr) {}

      res.json({
        success: true,
        message: 'Store logo removed successfully. Default branding restored.'
      });
    } catch (err) {
      next(err);
    }
  }
}

export class CouponController {
  static async validate(req, res, next) {
    try {
      const { code } = req.params;
      const cleanCode = (code || '').toUpperCase().trim();

      let coupon = null;
      try {
        const [rows] = await pool.query('SELECT * FROM coupons WHERE code = ? AND is_active = TRUE', [cleanCode]);
        if (rows.length > 0) coupon = rows[0];
      } catch (e) {}

      if (!coupon && cleanCode === 'PRIVILEGE20') {
        coupon = { code: 'PRIVILEGE20', discount_percent: 20, min_order_amount: 0, is_active: 1 };
      }

      if (!coupon) {
        return res.status(404).json({ success: false, message: 'Invalid or expired promotional coupon code.' });
      }

      res.json({
        success: true,
        coupon: {
          code: coupon.code,
          discountPercent: coupon.discount_percent,
          minOrderAmount: parseFloat(coupon.min_order_amount || 0)
        }
      });
    } catch (err) {
      next(err);
    }
  }
}
