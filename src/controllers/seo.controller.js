import { pool } from '../config/db.js';

export class SeoController {
  static formatSeoEntity(row) {
    if (!row) return null;
    let related = [];
    try {
      related = typeof row.related_keywords === 'string' ? JSON.parse(row.related_keywords) : (row.related_keywords || []);
    } catch (e) {}

    return {
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      name: row.name || row.seo_title,
      seoTitle: row.seo_title,
      metaDescription: row.meta_description,
      preferredSlug: row.preferred_slug || '',
      canonicalUrl: row.canonical_url,
      h1Heading: row.h1_heading || undefined,
      mainPageDescription: row.main_page_description || undefined,
      targetKeyword: row.target_keyword || undefined,
      relatedKeywords: related,
      searchIntent: row.search_intent || 'transactional',
      ogTitle: row.og_title || row.seo_title,
      ogDescription: row.og_description || row.meta_description,
      ogImage: row.og_image || undefined,
      twitterCard: row.twitter_card || 'summary_large_image',
      robotsIndex: !!row.robots_index,
      robotsFollow: !!row.robots_follow,
      isPublished: !!row.is_published,
      seoNotes: row.seo_notes || undefined,
      seoScore: parseInt(row.seo_score, 10) || 0,
      lastModified: row.last_modified ? new Date(row.last_modified).toISOString() : new Date().toISOString()
    };
  }

  static async listAdminRedirects(req, res, next) {
    try {
      const [rows] = await pool.query('SELECT * FROM seo_redirects ORDER BY created_at DESC');
      const redirects = rows.map(SeoController.formatRedirect);
      res.json({ success: true, count: redirects.length, redirects });
    } catch (err) {
      next(err);
    }
  }

  static formatRedirect(row) {
    if (!row) return null;
    return {
      id: row.id,
      sourceUrl: row.source_url,
      destinationUrl: row.destination_url,
      statusCode: parseInt(row.status_code, 10) || 301,
      reason: row.reason || undefined,
      isActive: !!row.is_active,
      hitsCount: parseInt(row.hits_count, 10) || 0,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
    };
  }

  static async listEntities(req, res, next) {
    try {
      const [rows] = await pool.query('SELECT * FROM seo_entities WHERE is_published = TRUE');
      const entities = rows.map(SeoController.formatSeoEntity);
      res.json({ success: true, count: entities.length, entities });
    } catch (err) {
      next(err);
    }
  }

  static async listAdminEntities(req, res, next) {
    try {
      const [rows] = await pool.query('SELECT * FROM seo_entities ORDER BY entity_type, name');
      const entities = rows.map(SeoController.formatSeoEntity);
      res.json({ success: true, count: entities.length, entities });
    } catch (err) {
      next(err);
    }
  }

  static async getEntity(req, res, next) {
    try {
      const { type, id } = req.query;
      if (!type || !id) {
        return res.status(400).json({ success: false, message: 'type and id query params required.' });
      }

      const [rows] = await pool.query(
        'SELECT * FROM seo_entities WHERE entity_type = ? AND entity_id = ?',
        [type, id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'SEO entity metadata not found.' });
      }

      res.json({ success: true, entity: SeoController.formatSeoEntity(rows[0]) });
    } catch (err) {
      next(err);
    }
  }

  static async updateEntity(req, res, next) {
    try {
      const input = req.body;
      const id = String(input.id || req.params.id || '').trim();
      const entityType = input.entityType;
      const entityId = String(input.entityId || '').trim();
      const name = String(input.name || '').trim();
      const seoTitle = String(input.seoTitle || '').trim();
      const metaDescription = String(input.metaDescription || '').trim();
      const preferredSlug = String(input.preferredSlug || '').trim();
      const canonicalUrl = String(input.canonicalUrl || '').trim();
      if (!id || !entityType || !entityId || !name || !seoTitle || !metaDescription || !preferredSlug || !canonicalUrl) {
        return res.status(400).json({ success: false, message: 'Complete SEO entity fields are required.' });
      }

      const relatedKeywords = Array.isArray(input.relatedKeywords) ? JSON.stringify(input.relatedKeywords) : null;
      await pool.query(`
        INSERT INTO seo_entities (
          id, entity_type, entity_id, name, seo_title, meta_description, preferred_slug,
          canonical_url, h1_heading, main_page_description, target_keyword, related_keywords,
          search_intent, og_title, og_description, og_image, twitter_card, robots_index,
          robots_follow, is_published, seo_notes, seo_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name), seo_title = VALUES(seo_title), meta_description = VALUES(meta_description),
          preferred_slug = VALUES(preferred_slug), canonical_url = VALUES(canonical_url),
          h1_heading = VALUES(h1_heading), main_page_description = VALUES(main_page_description),
          target_keyword = VALUES(target_keyword), related_keywords = VALUES(related_keywords),
          search_intent = VALUES(search_intent), og_title = VALUES(og_title),
          og_description = VALUES(og_description), og_image = VALUES(og_image),
          twitter_card = VALUES(twitter_card), robots_index = VALUES(robots_index),
          robots_follow = VALUES(robots_follow), is_published = VALUES(is_published),
          seo_notes = VALUES(seo_notes), seo_score = VALUES(seo_score)
      `, [
        id, entityType, entityId, name, seoTitle, metaDescription, preferredSlug, canonicalUrl,
        input.h1Heading || null, input.mainPageDescription || null, input.targetKeyword || null,
        relatedKeywords, input.searchIntent || 'transactional', input.ogTitle || null,
        input.ogDescription || null, input.ogImage || null, input.twitterCard || 'summary_large_image',
        input.robotsIndex !== false, input.robotsFollow !== false, input.isPublished !== false,
        input.seoNotes || null, Math.min(100, Math.max(0, Number(input.seoScore) || 0))
      ]);

      res.json({ success: true, message: 'SEO metadata saved.' });
    } catch (err) {
      next(err);
    }
  }

  static async listImageAlts(req, res, next) {
    try {
      const [rows] = await pool.query(`
        SELECT
          catalog.id, catalog.entity_type, catalog.entity_id, catalog.entity_name,
          catalog.image_url, COALESCE(saved.alt_text, catalog.default_alt_text, '') AS alt_text,
          COALESCE(saved.image_title, catalog.default_title) AS image_title,
          COALESCE(saved.file_name, catalog.file_name) AS file_name,
          saved.dimensions, COALESCE(saved.is_decorative, FALSE) AS is_decorative,
          COALESCE(saved.updated_at, catalog.updated_at, NOW()) AS updated_at
        FROM (
          SELECT CONCAT('product-image-', pi.id) AS id, 'product' AS entity_type,
            p.id AS entity_id, p.name AS entity_name, pi.image_url,
            p.image_alt_text AS default_alt_text, p.name AS default_title,
            SUBSTRING_INDEX(SUBSTRING_INDEX(pi.image_url, '?', 1), '/', -1) AS file_name,
            pi.created_at AS updated_at
          FROM product_images pi
          INNER JOIN products p ON p.id = pi.product_id
          UNION ALL
          SELECT CONCAT('category-image-', c.id), 'category', c.id, c.name, c.image_url,
            c.name, c.name, SUBSTRING_INDEX(SUBSTRING_INDEX(c.image_url, '?', 1), '/', -1), c.created_at
          FROM categories c WHERE c.image_url IS NOT NULL AND c.image_url <> ''
          UNION ALL
          SELECT CONCAT('subcategory-image-', sc.id), 'sub_category',
            CAST(sc.id AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci,
            sc.name, sc.image_url, sc.name, sc.name,
            SUBSTRING_INDEX(SUBSTRING_INDEX(sc.image_url, '?', 1), '/', -1), sc.created_at
          FROM sub_categories sc WHERE sc.image_url IS NOT NULL AND sc.image_url <> ''
          UNION ALL
          SELECT CONCAT('brand-image-', b.id), 'brand', CAST(b.id AS CHAR), b.name, b.image_url,
            b.name, b.name, SUBSTRING_INDEX(SUBSTRING_INDEX(b.image_url, '?', 1), '/', -1), b.created_at
          FROM brands b WHERE b.image_url IS NOT NULL AND b.image_url <> ''
          UNION ALL
          SELECT CONCAT('banner-image-', hb.id), 'banner', hb.id,
            COALESCE(hb.internal_name, hb.title), hb.image, hb.title, hb.title,
            SUBSTRING_INDEX(SUBSTRING_INDEX(hb.image, '?', 1), '/', -1), hb.updated_at
          FROM hero_banners hb WHERE hb.image IS NOT NULL AND hb.image <> ''
          UNION ALL
          SELECT CONCAT('banner-desktop-', hb.id), 'banner', hb.id,
            COALESCE(hb.internal_name, hb.title), hb.desktop_image, hb.title, hb.title,
            SUBSTRING_INDEX(SUBSTRING_INDEX(hb.desktop_image, '?', 1), '/', -1), hb.updated_at
          FROM hero_banners hb WHERE hb.desktop_image IS NOT NULL AND hb.desktop_image <> ''
          UNION ALL
          SELECT CONCAT('banner-tablet-', hb.id), 'banner', hb.id,
            COALESCE(hb.internal_name, hb.title), hb.tablet_image, hb.title, hb.title,
            SUBSTRING_INDEX(SUBSTRING_INDEX(hb.tablet_image, '?', 1), '/', -1), hb.updated_at
          FROM hero_banners hb WHERE hb.tablet_image IS NOT NULL AND hb.tablet_image <> ''
          UNION ALL
          SELECT CONCAT('banner-mobile-', hb.id), 'banner', hb.id,
            COALESCE(hb.internal_name, hb.title), COALESCE(hb.mobile_image, hb.mobile_image_url),
            hb.title, hb.title,
            SUBSTRING_INDEX(SUBSTRING_INDEX(COALESCE(hb.mobile_image, hb.mobile_image_url), '?', 1), '/', -1), hb.updated_at
          FROM hero_banners hb
          WHERE COALESCE(hb.mobile_image, hb.mobile_image_url) IS NOT NULL
            AND COALESCE(hb.mobile_image, hb.mobile_image_url) <> ''
          UNION ALL
          SELECT CONCAT('promo-image-', pc.id), 'banner', pc.id,
            COALESCE(pc.internal_name, pc.title), pc.image, pc.title, pc.title,
            SUBSTRING_INDEX(SUBSTRING_INDEX(pc.image, '?', 1), '/', -1), pc.updated_at
          FROM promo_cards pc WHERE pc.image IS NOT NULL AND pc.image <> ''
          UNION ALL
          SELECT CONCAT('promo-mobile-', pc.id), 'banner', pc.id,
            COALESCE(pc.internal_name, pc.title), pc.mobile_image_url, pc.title, pc.title,
            SUBSTRING_INDEX(SUBSTRING_INDEX(pc.mobile_image_url, '?', 1), '/', -1), pc.updated_at
          FROM promo_cards pc WHERE pc.mobile_image_url IS NOT NULL AND pc.mobile_image_url <> ''
        ) catalog
        LEFT JOIN seo_image_alts saved ON saved.id = catalog.id
        ORDER BY updated_at DESC
      `);
      const items = rows.map(row => ({
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        entityName: row.entity_name,
        imageUrl: row.image_url,
        altText: row.alt_text,
        imageTitle: row.image_title || undefined,
        fileName: row.file_name || '',
        dimensions: row.dimensions || undefined,
        isDecorative: !!row.is_decorative,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
      }));
      res.json({ success: true, count: items.length, items });
    } catch (err) {
      next(err);
    }
  }

  static async saveImageAlt(req, res, next) {
    try {
      const input = req.body;
      const id = String(req.params.id || '').trim();
      const allowedTypes = ['product', 'category', 'sub_category', 'brand', 'page', 'banner'];
      if (!id || !allowedTypes.includes(input.entityType) || !input.entityId || !input.entityName || !input.imageUrl) {
        return res.status(400).json({ success: false, message: 'Image SEO identity and image URL are required.' });
      }
      await pool.query(`
        INSERT INTO seo_image_alts (
          id, entity_type, entity_id, entity_name, image_url, alt_text,
          image_title, file_name, dimensions, is_decorative
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          entity_type = VALUES(entity_type), entity_id = VALUES(entity_id),
          entity_name = VALUES(entity_name), image_url = VALUES(image_url),
          alt_text = VALUES(alt_text), image_title = VALUES(image_title),
          file_name = VALUES(file_name), dimensions = VALUES(dimensions),
          is_decorative = VALUES(is_decorative)
      `, [
        id, input.entityType, String(input.entityId), String(input.entityName),
        String(input.imageUrl), String(input.altText || ''), input.imageTitle || null,
        input.fileName || null, input.dimensions || null, Boolean(input.isDecorative)
      ]);
      res.json({ success: true, message: 'Image SEO metadata saved.' });
    } catch (err) {
      next(err);
    }
  }

  static async getRobotsConfig(req, res, next) {
    try {
      const [rows] = await pool.query('SELECT * FROM seo_robots_config WHERE id = 1');
      const row = rows[0];
      const config = row ? {
        content: row.content,
        sitemapUrl: row.sitemap_url || '',
        disallowedPaths: typeof row.disallowed_paths === 'string' ? JSON.parse(row.disallowed_paths) : (row.disallowed_paths || []),
        allowedPaths: typeof row.allowed_paths === 'string' ? JSON.parse(row.allowed_paths) : (row.allowed_paths || []),
        lastUpdated: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString()
      } : {
        content: 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /checkout\nDisallow: /api/\n\nSitemap: https://uknowcart.com.pk/sitemap.xml',
        sitemapUrl: 'https://uknowcart.com.pk/sitemap.xml',
        disallowedPaths: ['/admin', '/checkout', '/api/'],
        allowedPaths: ['/'],
        lastUpdated: new Date().toISOString()
      };
      res.json({ success: true, config });
    } catch (err) {
      next(err);
    }
  }

  static async updateRobotsConfig(req, res, next) {
    try {
      const { content, sitemapUrl = '', disallowedPaths = [], allowedPaths = [] } = req.body;
      if (typeof content !== 'string' || !Array.isArray(disallowedPaths) || !Array.isArray(allowedPaths)) {
        return res.status(400).json({ success: false, message: 'Valid robots content and path lists are required.' });
      }
      await pool.query(`
        INSERT INTO seo_robots_config (id, content, sitemap_url, disallowed_paths, allowed_paths)
        VALUES (1, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE content = VALUES(content), sitemap_url = VALUES(sitemap_url),
          disallowed_paths = VALUES(disallowed_paths), allowed_paths = VALUES(allowed_paths)
      `, [content, sitemapUrl || null, JSON.stringify(disallowedPaths), JSON.stringify(allowedPaths)]);
      res.json({ success: true, message: 'Robots configuration saved.' });
    } catch (err) {
      next(err);
    }
  }

  static async listAuditIssues(req, res, next) {
    try {
      const [rows] = await pool.query('SELECT * FROM seo_audit_issues ORDER BY created_at DESC');
      const issues = rows.map(row => ({
        id: row.id,
        severity: row.severity,
        category: row.category,
        pageUrl: row.page_url,
        title: row.title,
        description: row.description,
        recommendation: row.recommendation,
        autoFixable: !!row.auto_fixable,
        isResolved: !!row.is_resolved,
        dismissed: !!row.dismissed
      }));
      res.json({ success: true, count: issues.length, issues });
    } catch (err) {
      next(err);
    }
  }

  static async updateAuditIssue(req, res, next) {
    try {
      const { isResolved, dismissed } = req.body;
      if (typeof isResolved !== 'boolean' && typeof dismissed !== 'boolean') {
        return res.status(400).json({ success: false, message: 'isResolved or dismissed must be provided as a boolean.' });
      }
      await pool.query(
        'UPDATE seo_audit_issues SET is_resolved = COALESCE(?, is_resolved), dismissed = COALESCE(?, dismissed) WHERE id = ?',
        [typeof isResolved === 'boolean' ? isResolved : null, typeof dismissed === 'boolean' ? dismissed : null, req.params.id]
      );
      const [rows] = await pool.query('SELECT id FROM seo_audit_issues WHERE id = ?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'SEO audit issue not found.' });
      res.json({ success: true, message: 'SEO audit issue updated.' });
    } catch (err) {
      next(err);
    }
  }

  static async listKeywords(req, res, next) {
    try {
      const [rows] = await pool.query('SELECT * FROM seo_keywords ORDER BY added_at DESC');
      const keywords = rows.map(row => ({
        id: row.id,
        keyword: row.keyword,
        searchIntent: row.search_intent,
        targetPageUrl: row.target_page_url,
        targetEntityType: row.target_entity_type || '',
        targetEntityId: row.target_entity_id || '',
        notes: row.notes || '',
        status: row.status,
        addedAt: row.added_at ? new Date(row.added_at).toISOString() : new Date().toISOString()
      }));
      res.json({ success: true, count: keywords.length, keywords });
    } catch (err) {
      next(err);
    }
  }

  static async createKeyword(req, res, next) {
    try {
      const { keyword, searchIntent = 'commercial', targetPageUrl, targetEntityType, targetEntityId, notes = '', status = 'planned' } = req.body;
      const validIntents = ['transactional', 'commercial', 'informational', 'navigational'];
      const validStatuses = ['ranking', 'in_progress', 'planned'];
      if (typeof keyword !== 'string' || !keyword.trim() || typeof targetPageUrl !== 'string' || !targetPageUrl.trim() ||
          !validIntents.includes(searchIntent) || !validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'Valid keyword, target URL, intent, and status are required.' });
      }
      const id = String(req.body.id || `kw-${Date.now()}`);
      await pool.query(`
        INSERT INTO seo_keywords (id, keyword, search_intent, target_page_url, target_entity_type, target_entity_id, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, keyword.trim(), searchIntent, targetPageUrl.trim(), targetEntityType || null, targetEntityId || null, notes || null, status]);
      res.status(201).json({ success: true, keywordId: id, message: 'SEO keyword added.' });
    } catch (err) {
      next(err);
    }
  }

  static async deleteKeyword(req, res, next) {
    try {
      const [result] = await pool.query('DELETE FROM seo_keywords WHERE id = ?', [req.params.id]);
      if (!result.affectedRows) return res.status(404).json({ success: false, message: 'SEO keyword not found.' });
      res.json({ success: true, message: 'SEO keyword deleted.' });
    } catch (err) {
      next(err);
    }
  }

  static async updateRedirect(req, res, next) {
    try {
      const { isActive } = req.body;
      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ success: false, message: 'isActive must be a boolean.' });
      }
      const [result] = await pool.query('UPDATE seo_redirects SET is_active = ? WHERE id = ?', [isActive, req.params.id]);
      if (!result.affectedRows) return res.status(404).json({ success: false, message: 'SEO redirect not found.' });
      res.json({ success: true, message: 'SEO redirect updated.' });
    } catch (err) {
      next(err);
    }
  }

  static async listRedirects(req, res, next) {
    try {
      const [rows] = await pool.query('SELECT * FROM seo_redirects WHERE is_active = TRUE');
      const redirects = rows.map(SeoController.formatRedirect);
      res.json({ success: true, count: redirects.length, redirects });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Create 301/302 Redirect with Loop Prevention (Fix 10)
   */
  static async createRedirect(req, res, next) {
    try {
      const { sourceUrl, destinationUrl, statusCode = 301, reason = '' } = req.body;
      if (!sourceUrl || !destinationUrl) {
        return res.status(400).json({ success: false, message: 'sourceUrl and destinationUrl are required.' });
      }

      const cleanSource = sourceUrl.trim();
      const cleanDest = destinationUrl.trim();

      // Loop Prevention Rule 1: Source cannot equal Destination
      if (cleanSource === cleanDest) {
        return res.status(400).json({
          success: false,
          message: 'Circular redirect detected: sourceUrl cannot be identical to destinationUrl.'
        });
      }

      // Loop Prevention Rule 2: Check if reverse redirect already exists (e.g., Dest -> Source)
      const [reverse] = await pool.query(
        'SELECT id FROM seo_redirects WHERE source_url = ? AND destination_url = ? AND is_active = TRUE',
        [cleanDest, cleanSource]
      );
      if (reverse.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Circular redirect loop detected: Reverse redirect "${cleanDest}" -> "${cleanSource}" already exists.`
        });
      }

      const [existing] = await pool.query('SELECT id FROM seo_redirects WHERE source_url = ?', [cleanSource]);
      const id = existing[0]?.id || req.body.id || `redir-${Date.now()}`;
      await pool.query(`
        INSERT INTO seo_redirects (id, source_url, destination_url, status_code, reason, is_active)
        VALUES (?, ?, ?, ?, ?, TRUE)
        ON DUPLICATE KEY UPDATE destination_url = VALUES(destination_url), status_code = VALUES(status_code), reason = VALUES(reason), is_active = TRUE
      `, [id, cleanSource, cleanDest, parseInt(statusCode, 10) || 301, reason]);

      res.status(201).json({ success: true, message: 'Redirect successfully registered.', redirectId: id });
    } catch (err) {
      next(err);
    }
  }

  static async deleteRedirect(req, res, next) {
    try {
      const { id } = req.params;
      await pool.query('DELETE FROM seo_redirects WHERE id = ?', [id]);
      res.json({ success: true, message: 'Redirect deleted.' });
    } catch (err) {
      next(err);
    }
  }

  static async getRobots(req, res, next) {
    try {
      const [rows] = await pool.query('SELECT content FROM seo_robots_config WHERE id = 1');
      const robotsTxt = rows[0]?.content || `User-agent: *
Allow: /
Allow: /shop
Allow: /category/
Allow: /products/
Disallow: /admin
Disallow: /checkout
Disallow: /api/

Sitemap: https://uknowcart.com.pk/api/v1/seo/sitemap`;

      res.header('Content-Type', 'text/plain');
      res.send(robotsTxt);
    } catch (err) {
      next(err);
    }
  }

  /**
   * XML Sitemap Generation
   */
  static async getSitemap(req, res, next) {
    try {
      const baseUrl = 'https://uknowcart.com.pk';
      const [products] = await pool.query('SELECT id, name, url_slug, updated_at FROM products WHERE show_on_home = TRUE AND archived_at IS NULL LIMIT 1000');
      const [categories] = await pool.query('SELECT id FROM categories WHERE is_active = TRUE');

      const xmlUrls = [
        `  <url><loc>${baseUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
        `  <url><loc>${baseUrl}/shop</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`,
        ...categories.map(c => `  <url><loc>${baseUrl}/category/${c.id}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`),
        ...products.map(p => {
          const slug = p.url_slug || `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-i${p.id}.html`;
          const lastMod = p.updated_at ? new Date(p.updated_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
          return `  <url><loc>${baseUrl}/products/${slug}</loc><lastmod>${lastMod}</lastmod><changefreq>weekly</changefreq><priority>0.85</priority></url>`;
        })
      ];

      const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${xmlUrls.join('\n')}
</urlset>`;

      res.header('Content-Type', 'application/xml');
      res.send(sitemapXml);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Structured Data / Schema.org JSON-LD Generation (Fix 10)
   */
  static async getJsonLd(req, res, next) {
    try {
      const { productId } = req.params;
      const [rows] = await pool.query('SELECT * FROM products WHERE id = ? OR url_slug = ?', [productId, productId]);

      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Product not found for JSON-LD generation.' });
      }

      const p = rows[0];
      const [images] = await pool.query('SELECT image_url FROM product_images WHERE product_id = ? ORDER BY display_order ASC', [p.id]);

      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.name,
        image: images.map(img => img.image_url),
        description: p.description,
        sku: p.sku,
        mpn: p.mpn || p.sku,
        gtin: p.gtin || undefined,
        brand: {
          '@type': 'Brand',
          name: p.brand || 'Maison Noir'
        },
        offers: {
          '@type': 'Offer',
          url: `https://uknowcart.com.pk/products/${p.url_slug || p.id}`,
          priceCurrency: 'PKR',
          price: parseFloat(p.price),
          availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          itemCondition: 'https://schema.org/NewCondition',
          seller: {
            '@type': 'Organization',
            name: 'U-KNOW CART'
          }
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: parseFloat(p.rating || 5.0),
          reviewCount: parseInt(p.reviews_count || 12, 10)
        }
      };

      res.json({ success: true, jsonLd });
    } catch (err) {
      next(err);
    }
  }
}
