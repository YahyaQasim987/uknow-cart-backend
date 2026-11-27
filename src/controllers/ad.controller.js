import { pool } from '../config/db.js';
import { getIO } from '../config/socket.js';
import { SOCKET_EVENTS } from '../socket/events.js';

// Anti-inflation in-memory cache: Map<`${ip}:${adId}:${type}`, timestamp>
const recentTrackingEvents = new Map();
const TRACKING_DEDUPE_MS = 30 * 1000; // 30 seconds deduplication window

function isRecentDuplicate(ip, adId, type) {
  const key = `${ip}:${adId}:${type}`;
  const now = Date.now();
  const lastTime = recentTrackingEvents.get(key);

  // Clean old entries periodically
  if (recentTrackingEvents.size > 5000) {
    for (const [k, t] of recentTrackingEvents.entries()) {
      if (now - t > TRACKING_DEDUPE_MS) recentTrackingEvents.delete(k);
    }
  }

  if (lastTime && (now - lastTime) < TRACKING_DEDUPE_MS) {
    return true;
  }
  recentTrackingEvents.set(key, now);
  return false;
}

export class AdController {
  static formatAd(row) {
    if (!row) return null;

    let placements = [];
    let cityTarget = [];
    try {
      placements = typeof row.placements === 'string' ? JSON.parse(row.placements) : (row.placements || []);
    } catch (e) {
      placements = [];
    }
    try {
      cityTarget = typeof row.city_targets === 'string' ? JSON.parse(row.city_targets) : (row.city_targets || []);
    } catch (e) {
      cityTarget = [];
    }

    return {
      id: row.id,
      name: row.name,
      campaignName: row.campaign_name || row.name,
      advertiserName: row.advertiser_name || 'Atelier Luxury Partners',
      advertiserId: row.advertiser_id || undefined,
      adType: row.ad_type || 'banner',
      headline: row.headline || undefined,
      title: row.title || row.name,
      description: row.description || '',
      businessLogo: row.business_logo || undefined,
      image: row.image_url || '',
      imageUrl: row.image_url || '',
      mobileImage: row.mobile_image_url || undefined,
      videoUrl: row.video_url || undefined,
      badge: row.badge || undefined,
      ctaText: row.cta_text || 'Explore Now',
      destinationUrl: row.destination_url || '/',
      status: row.status || 'active',
      rejectionReason: row.rejection_reason || undefined,
      startDate: row.start_date ? new Date(row.start_date).toISOString() : new Date().toISOString(),
      endDate: row.end_date ? new Date(row.end_date).toISOString() : undefined,
      priority: parseInt(row.priority, 10) || 50,
      placements,
      targetType: row.target_type || 'custom_url',
      deviceTarget: row.device_target || 'all',
      pricingModel: row.pricing_model || 'cpc',
      budget: parseFloat(row.budget || 0),
      dailyBudget: row.daily_budget ? parseFloat(row.daily_budget) : undefined,
      maxImpressions: row.max_impressions === null ? undefined : parseInt(row.max_impressions, 10),
      maxClicks: row.max_clicks === null ? undefined : parseInt(row.max_clicks, 10),
      cpmRate: parseFloat(row.cpm_rate || 120),
      cpcRate: parseFloat(row.cpc_rate || 25),
      paymentStatus: row.payment_status || 'pending',
      targetProductId: row.target_product_id || undefined,
      targetCategory: row.target_category || undefined,
      targetBrand: row.target_brand || undefined,
      targetSubCategory: row.target_sub_category || undefined,
      customUrl: row.custom_url || undefined,
      cityTarget,
      impressions: parseInt(row.impressions, 10) || 0,
      clicks: parseInt(row.clicks, 10) || 0,
      spending: parseFloat(row.spending || 0),
      revenue: parseFloat(row.revenue || 0),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
    };
  }

  static async listActive(req, res, next) {
    try {
      const { placement, device = 'all' } = req.query;

      const [rows] = await pool.query(`
        SELECT * FROM store_ads 
        WHERE status = 'active' 
          AND (device_target = 'all' OR device_target = ?)
          AND start_date <= NOW()
          AND (end_date IS NULL OR end_date >= NOW())
          AND (budget = 0 OR spending < budget)
        ORDER BY priority DESC, created_at DESC
      `, [device]);

      const ads = rows
        .map(AdController.formatAd)
        .filter(ad => {
          if (!placement) return true;
          return Array.isArray(ad.placements) && ad.placements.includes(placement);
        });

      res.json({ success: true, count: ads.length, ads });
    } catch (err) {
      next(err);
    }
  }

  static async listAdmin(req, res, next) {
    try {
      const [rows] = await pool.query('SELECT * FROM store_ads ORDER BY created_at DESC');
      const ads = rows.map(AdController.formatAd);
      res.json({ success: true, count: ads.length, ads });
    } catch (err) {
      next(err);
    }
  }

  static async recordImpression(req, res, next) {
    try {
      const { id } = req.params;
      const clientIp = req.ip || req.headers['x-forwarded-for'] || 'client';

      // Anti-inflation check: Deduplicate rapid repeated hits from same IP
      if (isRecentDuplicate(clientIp, id, 'impression')) {
        return res.json({ success: true, message: 'Impression already logged recently.' });
      }

      await pool.query(`
        UPDATE store_ads 
        SET impressions = impressions + 1,
            spending = CASE 
              WHEN pricing_model = 'cpm' THEN spending + (cpm_rate / 1000)
              ELSE spending 
            END
        WHERE id = ?
      `, [id]);

      // Auto-pause if budget reached
      await pool.query(`
        UPDATE store_ads 
        SET status = 'completed'
        WHERE id = ? AND budget > 0 AND spending >= budget
      `, [id]);

      res.json({ success: true, message: 'Impression recorded' });
    } catch (err) {
      next(err);
    }
  }

  static async recordClick(req, res, next) {
    try {
      const { id } = req.params;
      const clientIp = req.ip || req.headers['x-forwarded-for'] || 'client';

      // Anti-inflation check: Deduplicate rapid repeated clicks from same IP
      if (isRecentDuplicate(clientIp, id, 'click')) {
        return res.json({ success: true, message: 'Click already logged recently.' });
      }

      await pool.query(`
        UPDATE store_ads 
        SET clicks = clicks + 1,
            spending = CASE 
              WHEN pricing_model = 'cpc' THEN spending + cpc_rate
              ELSE spending 
            END
        WHERE id = ?
      `, [id]);

      await pool.query(`
        UPDATE store_ads 
        SET status = 'completed'
        WHERE id = ? AND budget > 0 AND spending >= budget
      `, [id]);

      try {
        const io = getIO();
        io.to('admin').emit(SOCKET_EVENTS.ADS_CLICK, { adId: id, timestamp: new Date().toISOString() });
      } catch (e) {}

      res.json({ success: true, message: 'Click recorded' });
    } catch (err) {
      next(err);
    }
  }

  static async create(req, res, next) {
    try {
      const {
        name,
        campaignName,
        advertiserName = 'Atelier Luxury Partners',
        adType = 'banner',
        headline,
        title,
        description,
        businessLogo,
        image,
        imageUrl,
        mobileImage,
        videoUrl,
        badge,
        ctaText = 'Explore Now',
        destinationUrl = '/',
        status = 'active',
        priority = 80,
        placements = ['home_hero'],
        pricingModel = 'cpc',
        budget = 0,
        dailyBudget,
        maxImpressions = 50000,
        maxClicks = 2000,
        cpmRate = 120,
        cpcRate = 25,
        startDate = new Date(),
        endDate,
        startTime = '00:00',
        endTime = '23:59',
        timezone = 'Asia/Karachi',
        targetType = 'category',
        targetProductId,
        targetCategory,
        targetBrand,
        targetSubCategory,
        customUrl,
        cityTarget = ['all'],
        deviceTarget = 'all',
        paymentStatus = 'pending'
      } = req.body;

      if (typeof title !== 'string' || !title.trim() || typeof description !== 'string' || !description.trim()) {
        return res.status(400).json({ success: false, message: 'Title and description are required.' });
      }

      const id = req.body.id || `ad-${Date.now()}`;
      const finalImg = image || imageUrl || '';

      await pool.query(`
        INSERT INTO store_ads (
          id, name, campaign_name, advertiser_name, advertiser_id, ad_type,
          headline, title, description, business_logo, cta_text, image_url,
          mobile_image_url, video_url, destination_url, badge, status,
          priority, pricing_model, budget, daily_budget, cpm_rate, cpc_rate,
          max_impressions, max_clicks, payment_status, start_date, end_date,
          start_time, end_time, timezone, target_type, target_product_id,
          target_category, target_brand, target_sub_category, custom_url,
          city_targets, device_target, placements
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id, name || title, campaignName || name || title, advertiserName, req.user?.id || null, adType,
        headline || null, title, description, businessLogo || null, ctaText, finalImg,
        mobileImage || null, videoUrl || null, destinationUrl, badge || null, status,
        parseInt(priority, 10) || 50, pricingModel, parseFloat(budget) || 0,
        dailyBudget ? parseFloat(dailyBudget) : null, parseFloat(cpmRate) || 120, parseFloat(cpcRate) || 25,
        Number.isSafeInteger(Number(maxImpressions)) ? Number(maxImpressions) : null,
        Number.isSafeInteger(Number(maxClicks)) ? Number(maxClicks) : null,
        paymentStatus,
        new Date(startDate), endDate ? new Date(endDate) : null,
        startTime, endTime, timezone, targetType, targetProductId || null,
        targetCategory || null, targetBrand || null, targetSubCategory || null,
        customUrl || null, JSON.stringify(Array.isArray(cityTarget) ? cityTarget : [cityTarget]), deviceTarget,
        JSON.stringify(Array.isArray(placements) ? placements : [placements])
      ]);

      res.status(201).json({ success: true, message: 'Ad campaign registered successfully.', adId: id });
    } catch (err) {
      next(err);
    }
  }

  static async moderate(req, res, next) {
    try {
      const { id } = req.params;
      const { status, rejectionReason } = req.body;

      if (!['draft', 'pending_review', 'active', 'paused', 'rejected', 'archived', 'completed', 'approved'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid ad status' });
      }

      const [result] = await pool.query(`
        UPDATE store_ads 
        SET status = ?, rejection_reason = ? 
        WHERE id = ?
      `, [status, rejectionReason || null, id]);
      if (!result.affectedRows) return res.status(404).json({ success: false, message: `Ad "${id}" was not found.` });

      res.json({ success: true, message: `Ad campaign status updated to ${status}.` });
    } catch (err) {
      next(err);
    }
  }

  static async update(req, res, next) {
    try {
      const { id } = req.params;
      const input = req.body;
      const fields = [];
      const values = [];
      const mapping = {
        name: ['name'],
        campaignName: ['campaign_name'],
        advertiserName: ['advertiser_name'],
        adType: ['ad_type'],
        headline: ['headline'],
        title: ['title'],
        description: ['description'],
        businessLogo: ['business_logo'],
        ctaText: ['cta_text'],
        image: ['image_url'],
        imageUrl: ['image_url'],
        mobileImage: ['mobile_image_url'],
        videoUrl: ['video_url'],
        destinationUrl: ['destination_url'],
        badge: ['badge'],
        status: ['status'],
        rejectionReason: ['rejection_reason'],
        priority: ['priority'],
        pricingModel: ['pricing_model'],
        budget: ['budget'],
        dailyBudget: ['daily_budget'],
        maxImpressions: ['max_impressions'],
        maxClicks: ['max_clicks'],
        cpmRate: ['cpm_rate'],
        cpcRate: ['cpc_rate'],
        paymentStatus: ['payment_status'],
        startDate: ['start_date'],
        endDate: ['end_date'],
        startTime: ['start_time'],
        endTime: ['end_time'],
        timezone: ['timezone'],
        targetType: ['target_type'],
        targetProductId: ['target_product_id'],
        targetCategory: ['target_category'],
        targetBrand: ['target_brand'],
        targetSubCategory: ['target_sub_category'],
        customUrl: ['custom_url'],
        cityTarget: ['city_targets', value => JSON.stringify(value)],
        deviceTarget: ['device_target'],
        placements: ['placements', value => JSON.stringify(value)]
      };

      for (const [key, [column, transform]] of Object.entries(mapping)) {
        if (input[key] === undefined) continue;
        fields.push(`${column} = ?`);
        values.push(transform ? transform(input[key]) : input[key]);
      }
      if (!fields.length) {
        return res.status(400).json({ success: false, message: 'At least one ad campaign field is required.' });
      }
      values.push(id);
      const [result] = await pool.query(
        `UPDATE store_ads SET ${fields.join(', ')} WHERE id = ?`,
        values
      );
      if (!result.affectedRows) return res.status(404).json({ success: false, message: `Ad "${id}" was not found.` });
      return res.json({ success: true, message: 'Ad campaign updated successfully.' });
    } catch (err) {
      next(err);
    }
  }

  static async delete(req, res, next) {
    try {
      const [result] = await pool.query('DELETE FROM store_ads WHERE id = ?', [req.params.id]);
      if (!result.affectedRows) return res.status(404).json({ success: false, message: `Ad "${req.params.id}" was not found.` });
      return res.json({ success: true, message: 'Ad campaign deleted successfully.' });
    } catch (err) {
      next(err);
    }
  }
}
