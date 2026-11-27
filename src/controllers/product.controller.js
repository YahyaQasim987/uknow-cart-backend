import { pool } from '../config/db.js';
import {
  ensureSkuTables,
  generateProductSku,
  generateVariantSku,
  isMissingSku,
  isValidSku,
  normalizeSku,
  releaseSku,
  reserveSku,
  skuError,
  SKU_MAX_LENGTH
} from '../services/sku.service.js';

import {
  removeProductUploads,
  removeUploadedFileByUrl,
  removeUploadedFilesIfUnreferenced,
  toCanonicalMediaKey
} from '../utils/product-media.js';
import { ProductImageService } from '../services/product-image.service.js';
import { logger } from '../utils/logger.js';

const isInlineMedia = value => typeof value === 'string' && /^(blob|data):/i.test(value);

const operationalBadRequest = message => Object.assign(new Error(message), {
  statusCode: 400,
  isOperational: true
});

/** Trims, drops inline previews and de-duplicates gallery URLs before saving. */
const normalizeGalleryImages = images => [...new Set(
  (Array.isArray(images) ? images : [])
    .filter(image => typeof image === 'string' && image.trim() && !isInlineMedia(image))
    .map(image => image.trim())
)];

export class ProductController {
  /**
   * Helper to format a database product and its related child rows into 100% frontend Product interface
   */
  static formatProduct(p, variants = [], images = [], cities = []) {
    const pVariants = variants.filter(v => v.product_id === p.id);
    const pImages = images.filter(img => img.product_id === p.id).map(img => img.image_url);
    const pCities = cities.filter(c => c.product_id === p.id).map(c => c.city_name);

    let parsedTags = [];
    try {
      parsedTags = typeof p.tags === 'string' ? JSON.parse(p.tags) : (p.tags || []);
    } catch (e) {
      parsedTags = [];
    }

    const price = parseFloat(p.price);
    const costPrice = p.cost_price ? parseFloat(p.cost_price) : Math.round(price * 0.65);
    const originalPrice = p.original_price ? parseFloat(p.original_price) : price;
    const discountValue = p.discount_value ? parseFloat(p.discount_value) : 0;
    const stock = parseInt(p.stock, 10) || 0;
    const reservedStock = parseInt(p.reserved_stock, 10) || 0;
    const availableStock = Math.max(0, stock - reservedStock);

    const formattedVariants = pVariants.map(v => {
      let vImages = [];
      try {
        vImages = typeof v.images === 'string' ? JSON.parse(v.images) : (v.images || []);
      } catch (e) {}

      let vAllowedCities = [];
      try {
        vAllowedCities = typeof v.allowed_cities === 'string' ? JSON.parse(v.allowed_cities) : (v.allowed_cities || []);
      } catch (e) {}

      const vPrice = parseFloat(v.price);
      const vStock = parseInt(v.stock, 10) || 0;
      const vReserved = parseInt(v.reserved_stock, 10) || 0;

      return {
        id: v.id,
        name: v.name,
        subtitle: v.subtitle || '',
        sku: v.sku,
        barcode: v.barcode || undefined,
        variantType: v.variant_type || 'Option',
        variantCode: v.variant_code || undefined,
        isActive: v.is_active !== undefined ? !!v.is_active : true,
        isFullVariant: !!v.is_full_variant,
        price: vPrice,
        costPrice: v.cost_price ? parseFloat(v.cost_price) : undefined,
        originalPrice: v.original_price ? parseFloat(v.original_price) : vPrice,
        discountType: v.discount_type || 'percentage',
        discountValue: v.discount_value ? parseFloat(v.discount_value) : 0,
        stock: vStock,
        reservedStock: vReserved,
        availableStock: Math.max(0, vStock - vReserved),
        color: v.color || undefined,
        size: v.size || undefined,
        image: v.image_url || undefined,
        images: vImages.length > 0 ? vImages : (v.image_url ? [v.image_url] : []),
        videoUrl: v.video_url || undefined,
        description: v.description || undefined,
        brand: v.brand || p.brand || undefined,
        subCategory: v.sub_category || p.sub_category || undefined,
        luxuryTier: v.luxury_tier || p.luxury_tier || 'Luxury',
        deliveryDays: v.delivery_days ? parseInt(v.delivery_days, 10) : (p.delivery_days || 3),
        deliveryTimelineNote: v.delivery_timeline_note || p.delivery_timeline_note || undefined,
        deliveryCharges: v.delivery_charges !== null && v.delivery_charges !== undefined
          ? parseFloat(v.delivery_charges)
          : (p.delivery_charges !== null && p.delivery_charges !== undefined ? parseFloat(p.delivery_charges) : null),
        deliveryAdvanceRequired: !!p.delivery_advance_required,
        deliveryAdvanceType: p.delivery_advance_type || 'percentage',
        deliveryAdvanceValue: p.delivery_advance_value !== null && p.delivery_advance_value !== undefined
          ? parseFloat(p.delivery_advance_value)
          : undefined,
        urgentDeliveryAdvanceRequired: !!p.urgent_delivery_advance_required,
        urgentDeliveryAdvanceType: p.urgent_delivery_advance_type || 'percentage',
        urgentDeliveryAdvanceValue: p.urgent_delivery_advance_value !== null && p.urgent_delivery_advance_value !== undefined
          ? parseFloat(p.urgent_delivery_advance_value)
          : undefined,
        advancePaymentRequired: !!p.advance_payment_required,
        paymentPolicy: p.payment_policy || 'cod',
        advancePaymentType: p.advance_payment_type || 'percentage',
        advancePaymentAmount: p.advance_payment_amount !== null && p.advance_payment_amount !== undefined
          ? parseFloat(p.advance_payment_amount)
          : undefined,
        advancePaymentPercent: p.advance_payment_percent ? parseInt(p.advance_payment_percent, 10) : undefined,
        advancePaymentValue: v.advance_payment_value
          ? parseFloat(v.advance_payment_value)
          : (p.advance_payment_value
              ? parseFloat(p.advance_payment_value)
              : (p.advance_payment_type === 'percentage'
                  ? (p.advance_payment_percent ? parseInt(p.advance_payment_percent, 10) : undefined)
                  : (p.advance_payment_amount ? parseFloat(p.advance_payment_amount) : undefined))),
        cityRestrictionMode: v.city_restriction_mode || p.city_restriction_mode || 'all',
        allowedCities: vAllowedCities.length > 0 ? vAllowedCities : pCities,
        standaloneInCatalog: v.standalone_in_catalog !== undefined ? !!v.standalone_in_catalog : true,
        badge: v.badge || undefined,
        expiresAt: v.expires_at || undefined
      };
    });

    return {
      id: p.id,
      name: p.name,
      subtitle: p.subtitle || p.name,
      category: p.category_id,
      subCategory: p.sub_category || undefined,
      brand: p.brand || undefined,
      luxuryTier: p.luxury_tier || 'Luxury',
      price,
      costPrice,
      originalPrice,
      discountType: p.discount_type || 'percentage',
      discountValue,
      rating: Number.isFinite(Number(p.rating)) ? Number(p.rating) : 0,
      reviewsCount: parseInt(p.reviews_count, 10) || 0,
      reviewCount: parseInt(p.reviews_count, 10) || 0,
      description: p.description || '',
      stock,
      reservedStock,
      availableStock,
      sku: p.sku,
      // Fix 8: Comprehensive product catalog fields & identifiers
      gtin: p.gtin || undefined,
      mpn: p.mpn || undefined,
      modelNumber: p.model_number || undefined,
      warranty: p.warranty || undefined,
      // Multi-admin ownership and authorized merchant contacts
      adminId: p.admin_id || p.owner_id || undefined,
      ownerId: p.admin_id || p.owner_id || undefined,
      ownerName: p.effective_owner_name || p.owner_name || undefined,
      ownerPhone: p.effective_owner_phone || p.owner_phone || undefined,
      ownerWhatsapp: p.effective_owner_whatsapp || p.owner_whatsapp || undefined,
      ownerBankName: p.owner_bank_name || undefined,
      ownerBankAccountTitle: p.owner_bank_account_title || undefined,
      ownerBankAccountNumber: p.owner_bank_account_number || undefined,
      // Dedicated SEO & Social overrides
      seoTitle: p.seo_title || undefined,
      metaDescription: p.meta_description || undefined,
      urlSlug: p.url_slug || undefined,
      imageAltText: p.image_alt_text || undefined,
      tags: parsedTags,
      badge: p.badge || undefined,
      featured: !!p.featured,
      isFeatured: !!p.featured,
      showOnHome: p.show_on_home !== undefined ? !!p.show_on_home : true,
      isNew: !!p.is_new,
      images: pImages,
      videoUrl: p.video_url || undefined,
      hoverVideoUrl: p.hover_video_url || undefined,
      hoverImage: p.hover_image || undefined,
      hoverMediaType: p.hover_video_url ? 'video' : (p.hover_image ? 'image' : 'auto'),
      deliveryDays: parseInt(p.delivery_days, 10) || 3,
      deliveryTimelineNote: p.delivery_timeline_note || undefined,
      deliveryCharges: p.delivery_charges !== null && p.delivery_charges !== undefined ? parseFloat(p.delivery_charges) : null,
      deliveryChargeIsCustom: p.delivery_charges !== null && p.delivery_charges !== undefined && parseFloat(p.delivery_charges) > 0,
      showInCarousel: !!p.show_in_carousel,
      deliveryAdvanceRequired: !!p.delivery_advance_required,
      deliveryAdvanceType: p.delivery_advance_type || 'percentage',
      deliveryAdvanceValue: p.delivery_advance_value !== null && p.delivery_advance_value !== undefined
        ? parseFloat(p.delivery_advance_value)
        : undefined,
      urgentDeliveryAdvanceRequired: !!p.urgent_delivery_advance_required,
      urgentDeliveryAdvanceType: p.urgent_delivery_advance_type || 'percentage',
      urgentDeliveryAdvanceValue: p.urgent_delivery_advance_value !== null && p.urgent_delivery_advance_value !== undefined
        ? parseFloat(p.urgent_delivery_advance_value)
        : undefined,
      paymentPolicy: p.payment_policy || 'cod',
      advancePaymentRequired: !!p.advance_payment_required,
      advancePaymentType: p.advance_payment_type || 'percentage',
      advancePaymentAmount: p.advance_payment_amount !== null && p.advance_payment_amount !== undefined
        ? parseFloat(p.advance_payment_amount)
        : undefined,
      advancePaymentPercent: p.advance_payment_percent ? parseInt(p.advance_payment_percent, 10) : undefined,
      advancePaymentValue: p.advance_payment_value !== null && p.advance_payment_value !== undefined
        ? parseFloat(p.advance_payment_value)
        : (p.advance_payment_type === 'percentage'
          ? (p.advance_payment_percent ? parseInt(p.advance_payment_percent, 10) : undefined)
          : (p.advance_payment_amount ? parseFloat(p.advance_payment_amount) : undefined)),
      cityRestrictionMode: p.city_restriction_mode || 'all',
      allowedCities: pCities,
      expiresAt: p.expires_at || undefined,
      archivedAt: p.archived_at || undefined,
      archivedBy: p.archived_by || undefined,
      archiveReason: p.archive_reason || undefined,
      showOnBanner: !!p.show_on_banner,
      bannerImage: p.banner_image || undefined,
      bannerDesktopImage: p.banner_desktop_image || p.banner_image || undefined,
      bannerTabletImage: p.banner_tablet_image || p.banner_image || undefined,
      bannerMobileImage: p.banner_mobile_image || p.banner_image || undefined,
      bannerTitle: p.banner_title || undefined,
      bannerSubtitle: p.banner_subtitle || undefined,
      bannerEyebrow: p.banner_eyebrow || undefined,
      bannerBadge: p.banner_badge || undefined,
      categoryDescription: p.category_description || undefined,
      subCategoryDescription: p.sub_category_description || undefined,
      variantsMode: p.variants_mode || (formattedVariants.length > 0 ? 'short' : 'none'),
      variants: formattedVariants
    };
  }

  static async list(req, res, next) {
    try {
      const {
        category,
        subCategory,
        brand,
        tier,
        minPrice,
        maxPrice,
        search,
        city,
        featured,
        showOnHome,
        showOnBanner,
        carousel,
        showInCarousel,
        stockStatus,
        archived,
        includeArchived,
        ownerId,
        sortBy = 'relevance',
        page = 1,
        limit = 50
      } = req.query;
      const isAdmin = req.user?.role === 'admin';

      let sql = `
        SELECT p.*,
               COALESCE(p.owner_phone, u.primary_phone, u.phone) AS effective_owner_phone,
               COALESCE(p.owner_whatsapp, u.whatsapp_number, u.whatsapp_phone, u.primary_phone, u.phone) AS effective_owner_whatsapp,
               COALESCE(p.owner_name, u.full_name, u.name) AS effective_owner_name,
               COALESCE(u.bank_name, '') AS owner_bank_name,
               COALESCE(u.bank_account_title, '') AS owner_bank_account_title,
               COALESCE(u.bank_account_number, '') AS owner_bank_account_number
        FROM products p
        LEFT JOIN users u ON u.id = COALESCE(p.admin_id, p.owner_id)
        WHERE 1=1
      `;
      const params = [];

      // Expired products disappear from the storefront automatically, but the
      // admin product manager still sees them so they can be renewed. Archived
      // products are hidden from everyone unless an admin explicitly asks for
      // the archive (or asks for active + archived together).
      if (!isAdmin) {
        sql += ' AND p.archived_at IS NULL AND (p.expires_at IS NULL OR p.expires_at > NOW())';
      } else if (String(archived) === 'true') {
        sql += ' AND p.archived_at IS NOT NULL';
      } else if (String(includeArchived) !== 'true') {
        sql += ' AND p.archived_at IS NULL';
      }

      if (category && category !== 'all') {
        sql += ' AND p.category_id = ?';
        params.push(category);
      }
      if (subCategory && subCategory !== 'all') {
        sql += ' AND p.sub_category = ?';
        params.push(subCategory);
      }
      if (brand && brand !== 'all') {
        sql += ' AND p.brand = ?';
        params.push(brand);
      }
      if (tier && tier !== 'all') {
        sql += ' AND p.luxury_tier = ?';
        params.push(tier);
      }
      if (ownerId) {
        sql += ' AND (p.admin_id = ? OR p.owner_id = ?)';
        params.push(ownerId, ownerId);
      }
      if (minPrice) {
        sql += ' AND p.price >= ?';
        params.push(parseFloat(minPrice));
      }
      if (maxPrice) {
        sql += ' AND p.price <= ?';
        params.push(parseFloat(maxPrice));
      }
      if (search) {
        sql += ' AND (p.name LIKE ? OR p.subtitle LIKE ? OR p.description LIKE ? OR p.sku LIKE ? OR p.brand LIKE ? OR p.gtin LIKE ? OR p.model_number LIKE ?)';
        const term = `%${search}%`;
        params.push(term, term, term, term, term, term, term);
      }
      if (featured === 'true') {
        sql += ' AND p.featured = TRUE';
      }
      if (showOnHome === 'true') {
        sql += ' AND p.show_on_home = TRUE';
      }
      if (showOnBanner === 'true') {
        sql += ' AND p.show_on_banner = TRUE';
      } else if (showOnBanner === 'false') {
        sql += ' AND p.show_on_banner = FALSE';
      }
      if (carousel === 'true' || showInCarousel === 'true') {
        sql += ' AND p.show_in_carousel = TRUE';
      }
      if (stockStatus === 'in-stock') {
        sql += ' AND (p.stock - p.reserved_stock) > 5';
      } else if (stockStatus === 'low-stock') {
        sql += ' AND (p.stock - p.reserved_stock) > 0 AND (p.stock - p.reserved_stock) <= 5';
      } else if (stockStatus === 'out-of-stock') {
        sql += ' AND (p.stock - p.reserved_stock) <= 0';
      }

      const countSql = sql.replace(/SELECT p\.\*[\s\S]*?FROM products p/i, 'SELECT COUNT(*) AS total FROM products p');
      const countParams = [...params];

      // Sorting
      if (sortBy === 'price-asc') {
        sql += ' ORDER BY p.price ASC';
      } else if (sortBy === 'price-desc') {
        sql += ' ORDER BY p.price DESC';
      } else if (sortBy === 'name-asc') {
        sql += ' ORDER BY p.name ASC';
      } else if (sortBy === 'stock-desc') {
        sql += ' ORDER BY p.stock DESC';
      } else {
        sql += ' ORDER BY p.created_at DESC';
      }

      sql += ' LIMIT ? OFFSET ?';
      const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const parsedPage = Math.max(1, parseInt(page, 10) || 1);
      const offset = (parsedPage - 1) * parsedLimit;
      params.push(parsedLimit, offset);

      const [rows] = await pool.query(sql, params);
      const [[{ total }]] = await pool.query(countSql, countParams);
      let summary = null;
      let filterOptions = null;
      if (isAdmin) {
        const [[summaryRow], [facetRows]] = await Promise.all([
          pool.query(`
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(show_on_banner = TRUE), 0) AS banner,
                   COALESCE(SUM(stock > 0 AND stock <= 5), 0) AS low_stock,
                   COALESCE(SUM(stock <= 0), 0) AS out_of_stock
            FROM products
            WHERE archived_at IS NULL
          `),
          pool.query(`
            SELECT DISTINCT category_id, brand, sub_category
            FROM products
            WHERE archived_at IS NULL
          `)
        ]);
        summary = {
          total: Number(summaryRow.total) || 0,
          banner: Number(summaryRow.banner) || 0,
          lowStock: Number(summaryRow.low_stock) || 0,
          outOfStock: Number(summaryRow.out_of_stock) || 0
        };
        filterOptions = {
          categories: [...new Set(facetRows.map(row => row.category_id).filter(Boolean))].sort(),
          brands: [...new Set(facetRows.map(row => row.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
          subCategories: [...new Set(facetRows.map(row => row.sub_category).filter(Boolean))].sort((a, b) => a.localeCompare(b))
        };
      }

      // Fetch child rows only for this page. Scanning every variant, image and
      // city row for each 12-product request becomes costly as the catalog grows.
      let variants = [];
      let images = [];
      let allowedCities = [];
      if (rows.length > 0) {
        const ids = rows.map(row => row.id);
        const placeholders = ids.map(() => '?').join(', ');
        const variantSql = `SELECT * FROM product_variants WHERE product_id IN (${placeholders})`
          + (req.user?.role === 'admin' ? '' : ' AND is_active = TRUE');
        [variants] = await pool.query(variantSql, ids);
        [images] = await pool.query(
          `SELECT * FROM product_images WHERE product_id IN (${placeholders}) ORDER BY display_order ASC`,
          ids
        );
        [allowedCities] = await pool.query(
          `SELECT * FROM product_allowed_cities WHERE product_id IN (${placeholders})`,
          ids
        );
      }

      const products = rows.map(p => ProductController.formatProduct(p, variants, images, allowedCities));

      res.json({
        success: true,
        count: products.length,
        total: Number(total),
        page: parsedPage,
        limit: parsedLimit,
        pages: Math.ceil(Number(total) / parsedLimit),
        products,
        ...(summary && { summary }),
        ...(filterOptions && { filterOptions })
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Lightweight catalog counters for storefront navigation and loading skeletons.
   * Keeps mega-menu, category chips, and initial section skeleton counts exact
   * before heavy product payloads finish loading.
   */
  static async facets(req, res, next) {
    try {
      const activeWhere = 'archived_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())';
      const [[categories], [brands], [brandCategories], [productRows], [bannerRows]] = await Promise.all([
        pool.query(`SELECT category_id AS id, COUNT(*) AS count FROM products WHERE ${activeWhere} GROUP BY category_id`),
        pool.query(`SELECT brand AS name, COUNT(*) AS count FROM products WHERE ${activeWhere} AND brand IS NOT NULL AND brand <> '' GROUP BY brand ORDER BY count DESC`),
        pool.query(`SELECT brand, category_id AS category, COUNT(*) AS count FROM products WHERE ${activeWhere} AND brand IS NOT NULL AND brand <> '' GROUP BY brand, category_id`),
        pool.query(`
          SELECT
            COUNT(*) AS shopTotal,
            COALESCE(SUM(show_on_home = TRUE), 0) AS homeCount,
            COALESCE(SUM(show_in_carousel = TRUE), 0) AS carouselCount,
            COALESCE(SUM(
              show_on_banner = TRUE
              AND (
                COALESCE(banner_desktop_image, '') <> ''
                OR COALESCE(banner_image, '') <> ''
                OR EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = products.id)
              )
              AND NOT EXISTS (
                SELECT 1 FROM hero_banners hb
                WHERE hb.active = TRUE AND hb.link_type = 'product' AND hb.target_product_id = products.id
              )
            ), 0) AS bannerProductCount
          FROM products
          WHERE ${activeWhere}
        `),
        pool.query(`
          SELECT
            (SELECT COUNT(*) FROM hero_banners WHERE active = TRUE AND (COALESCE(image, '') <> '' OR COALESCE(desktop_image, '') <> '' OR link_type = 'product')) AS heroBannerCount,
            (SELECT COUNT(*) FROM promo_cards WHERE active = TRUE AND COALESCE(image, '') <> '') AS promoCardCount,
            (SELECT COUNT(*) FROM trust_indicators WHERE active = TRUE) AS trustCount
        `)
      ]);

      const prodCounts = productRows[0] || {};
      const bannerCounts = bannerRows[0] || {};

      res.json({
        success: true,
        categories: categories.map(row => ({ id: row.id, count: Number(row.count) || 0 })),
        brands: brands.map(row => ({ name: row.name, count: Number(row.count) || 0 })),
        brandCategories: brandCategories.map(row => ({
          brand: row.brand,
          category: row.category,
          count: Number(row.count) || 0
        })),
        storefrontCounts: {
          shopTotal: Number(prodCounts.shopTotal) || 0,
          homeCount: Math.min(24, Number(prodCounts.homeCount) || 0),
          carouselCount: Math.min(9, Number(prodCounts.carouselCount) || 0),
          bannerProductCount: Number(prodCounts.bannerProductCount) || 0,
          heroBannerCount: Number(bannerCounts.heroBannerCount) || 0,
          promoCardCount: Number(bannerCounts.promoCardCount) || 0,
          trustCount: Number(bannerCounts.trustCount) || 0
        }
      });
    } catch (err) {
      next(err);
    }
  }

  static async getFormattedProduct(id, executor = pool, includeInactiveVariants = false) {
    const [rows] = await executor.query(`
      SELECT p.*,
             COALESCE(p.owner_phone, u.primary_phone, u.phone) AS effective_owner_phone,
             COALESCE(p.owner_whatsapp, u.whatsapp_number, u.whatsapp_phone, u.primary_phone, u.phone) AS effective_owner_whatsapp,
             COALESCE(p.owner_name, u.full_name, u.name) AS effective_owner_name,
             COALESCE(u.bank_name, '') AS owner_bank_name,
             COALESCE(u.bank_account_title, '') AS owner_bank_account_title,
             COALESCE(u.bank_account_number, '') AS owner_bank_account_number
      FROM products p
      LEFT JOIN users u ON u.id = COALESCE(p.admin_id, p.owner_id)
      WHERE p.id = ? OR p.url_slug = ?
    `, [id, id]);
    if (rows.length === 0) return null;

    const productRow = rows[0];
    const [[variants], [images], [allowedCities]] = await Promise.all([
      executor.query(
        `SELECT * FROM product_variants WHERE product_id = ?${includeInactiveVariants ? '' : ' AND is_active = TRUE'}`,
        [productRow.id]
      ),
      executor.query('SELECT * FROM product_images WHERE product_id = ? ORDER BY display_order ASC', [productRow.id]),
      executor.query('SELECT * FROM product_allowed_cities WHERE product_id = ?', [productRow.id])
    ]);
    return ProductController.formatProduct(productRow, variants, images, allowedCities);
  }

  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const isAdmin = req.user?.role === 'admin';
      const product = await ProductController.getFormattedProduct(id, pool, isAdmin);
      if (!product || (!isAdmin && product.archivedAt)) {
        return res.status(404).json({ success: false, message: `Product "${id}" not found.` });
      }
      res.json({ success: true, product });
    } catch (err) {
      next(err);
    }
  }

  static async create(req, res, next) {
    let connection = null;
    try {
      const {
        name,
        subtitle,
        category,
        subCategory,
        brand = 'Maison Noir',
        luxuryTier = 'Luxury',
        price,
        originalPrice,
        costPrice,
        discountType = 'percentage',
        discountValue = 0,
        stock = 0,
        sku,
        description = '',
        images = [],
        videoUrl,
        hoverVideoUrl,
        hoverImage,
        deliveryDays = 3,
        deliveryTimelineNote,
        deliveryCharges = null,
        delivery_charges = null,
        showInCarousel = false,
        deliveryAdvanceRequired = false,
        deliveryAdvanceType = 'percentage',
        deliveryAdvanceValue = null,
        urgentDeliveryAdvanceRequired = false,
        urgentDeliveryAdvanceType = 'percentage',
        urgentDeliveryAdvanceValue = null,
        paymentPolicy = 'cod',
        advancePaymentRequired = false,
        advancePaymentType = 'percentage',
        advancePaymentAmount,
        advancePaymentPercent,
        advancePaymentValue,
        cityRestrictionMode = 'all',
        allowedCities = [],
        expiresAt,
        showOnHome = true,
        featured = false,
        isNew = false,
        badge,
        tags = [],
        showOnBanner = false,
        bannerImage,
        bannerDesktopImage,
        bannerTabletImage,
        bannerMobileImage,
        bannerTitle,
        bannerSubtitle,
        bannerEyebrow,
        bannerBadge,
        categoryDescription,
        subCategoryDescription,
        variantsMode = 'none',
        variants = [],
        // Fix 8 Fields
        gtin,
        mpn,
        modelNumber,
        warranty,
        seoTitle,
        metaDescription,
        urlSlug,
        imageAltText
      } = req.body;

      const productMedia = [
        ...(Array.isArray(images) ? images : []),
        videoUrl, hoverVideoUrl, hoverImage,
        bannerImage, bannerDesktopImage, bannerTabletImage, bannerMobileImage
      ];
      const variantHasInlineMedia = Array.isArray(variants) && variants.some(variant =>
        isInlineMedia(variant.image) || isInlineMedia(variant.imageUrl) || isInlineMedia(variant.videoUrl) ||
        (Array.isArray(variant.images) && variant.images.some(isInlineMedia))
      );
      if (productMedia.some(isInlineMedia) || variantHasInlineMedia) {
        return res.status(400).json({ success: false, message: 'Product media must be uploaded as files; inline preview data cannot be saved.' });
      }

      if (
        typeof name !== 'string' || !name.trim() ||
        typeof category !== 'string' || !category.trim() ||
        price === undefined || price === null || price === '' || !Number.isFinite(Number(price)) || Number(price) < 0
      ) {
        return res.status(400).json({ success: false, message: 'Name, price, and category are required.' });
      }

      const id = req.body.id || `prod-${Date.now()}`;
      const finalOriginal = originalPrice ? parseFloat(originalPrice) : parseFloat(price);
      const finalCost = costPrice ? parseFloat(costPrice) : Math.round(parseFloat(price) * 0.65);
      const rawDeliveryCharges = deliveryCharges ?? delivery_charges;
      const parsedDeliveryCharges = rawDeliveryCharges !== null && rawDeliveryCharges !== undefined && rawDeliveryCharges !== ''
        ? parseFloat(rawDeliveryCharges)
        : null;
      const effectiveDeliveryCharges = Number.isFinite(parsedDeliveryCharges) && parsedDeliveryCharges > 0
        ? parsedDeliveryCharges
        : null;

      // Delivery advance is separate money from the product advance. Zero/empty
      // values disable the rule; a percentage is capped at 100%.
      const normalizeDeliveryAdvance = (required, type, value, label) => {
        if (!required) return { required: false, type: 'percentage', value: null };
        const normalizedType = type === 'fixed' ? 'fixed' : 'percentage';
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue <= 0) {
          throw Object.assign(new Error(`${label} needs a positive advance value.`), { statusCode: 400, isOperational: true });
        }
        if (normalizedType === 'percentage' && numericValue > 100) {
          throw Object.assign(new Error(`${label} percentage cannot exceed 100%.`), { statusCode: 400, isOperational: true });
        }
        return { required: true, type: normalizedType, value: Math.round(numericValue * 100) / 100 };
      };
      const standardDeliveryAdvance = normalizeDeliveryAdvance(
        deliveryAdvanceRequired,
        deliveryAdvanceType,
        deliveryAdvanceValue,
        'Standard delivery advance'
      );
      const urgentDeliveryAdvance = normalizeDeliveryAdvance(
        urgentDeliveryAdvanceRequired,
        urgentDeliveryAdvanceType,
        urgentDeliveryAdvanceValue,
        'Urgent delivery advance'
      );
      const advType = (advancePaymentType === 'fixed') ? 'fixed' : 'percentage';
      let computedAdvanceAmount = null;
      let computedAdvancePercent = null;
      let computedAdvanceValue = null;

      if (advancePaymentRequired) {
        const rawVal = advancePaymentValue ?? (advType === 'percentage' ? advancePaymentPercent : advancePaymentAmount);
        const numVal = Number(rawVal);
        if (!Number.isFinite(numVal) || numVal <= 0) {
          return res.status(400).json({
            success: false,
            message: advType === 'percentage'
              ? 'Advance payment percentage must be a positive percentage.'
              : 'A positive advance payment amount in PKR is required.'
          });
        }
        if (advType === 'percentage') {
          if (numVal > 100) {
            return res.status(400).json({ success: false, message: 'Advance payment percentage cannot exceed 100%.' });
          }
          computedAdvancePercent = Math.round(numVal);
          computedAdvanceValue = numVal;
          computedAdvanceAmount = Math.round(parseFloat(price) * (numVal / 100) * 100) / 100;
        } else {
          computedAdvanceAmount = Math.round(numVal * 100) / 100;
          computedAdvanceValue = numVal;
          computedAdvancePercent = Math.min(100, Math.round((numVal / parseFloat(price)) * 100));
        }
      }

      // Section 5: Set product ownership strictly from verified authenticated Admin on the server
      const adminId = req.user?.id;
      if (!adminId || req.user?.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Forbidden. Only administrators can create products.' });
      }

      const [adminRows] = await pool.query(`
        SELECT id, COALESCE(full_name, name) AS owner_name,
               COALESCE(primary_phone, phone) AS owner_phone,
               COALESCE(whatsapp_number, whatsapp_phone, primary_phone, phone) AS owner_whatsapp
        FROM users
        WHERE id = ? AND role = 'admin' AND status = 'active'
      `, [adminId]);
      if (!adminRows.length) {
        return res.status(403).json({ success: false, message: 'The authenticated administrator profile is unavailable.' });
      }
      const ownerName = adminRows[0].owner_name;
      const ownerPhone = adminRows[0].owner_phone || null;
      const ownerWhatsapp = adminRows[0].owner_whatsapp || null;

      const effectiveBannerImage = bannerImage || bannerDesktopImage || null;
      const effectiveDesktopBanner = bannerDesktopImage || bannerImage || null;
      const effectiveTabletBanner = bannerTabletImage || bannerImage || null;
      const effectiveMobileBanner = bannerMobileImage || bannerImage || null;

      // SKU infrastructure DDL must run before the transaction starts.
      await ensureSkuTables();

      connection = await pool.getConnection();
      await connection.beginTransaction();

      // Ensure category exists so foreign key fk_prod_category doesn't reject the product
      const normalizedCat = category.toLowerCase().trim();

      // ---- Global SKU resolution -------------------------------------------------
      // An empty SKU is generated; a supplied SKU is normalized and validated.
      // Both paths claim the value in sku_registry inside this transaction, so a
      // product SKU can never collide with another product or a variant SKU.
      const requestedSku = isMissingSku(sku) ? '' : normalizeSku(sku);
      let finalSku;
      if (!requestedSku) {
        finalSku = await generateProductSku(connection, {
          category: normalizedCat,
          brand,
          productName: name
        });
      } else {
        if (!isValidSku(requestedSku)) {
          throw skuError(`SKU "${sku}" is invalid. Use A-Z, 0-9 and hyphens only (maximum ${SKU_MAX_LENGTH} characters).`);
        }
        finalSku = requestedSku;
      }
      await reserveSku(connection, { sku: finalSku, entityType: 'product', entityId: id });
      const [existingCat] = await connection.query('SELECT id FROM categories WHERE id = ?', [normalizedCat]);
      if (existingCat.length === 0) {
        const catName = category.charAt(0).toUpperCase() + category.slice(1);
        await connection.query(
          'INSERT INTO categories (id, name, description, is_active) VALUES (?, ?, ?, TRUE)',
          [normalizedCat, catName, categoryDescription || `${catName} Department`]
        );
      }

      if (subCategory && subCategory.trim()) {
        const subName = subCategory.trim();
        const [existingSub] = await connection.query(
          'SELECT id FROM sub_categories WHERE category_id = ? AND name = ?',
          [normalizedCat, subName]
        );
        if (existingSub.length === 0) {
          await connection.query(
            'INSERT INTO sub_categories (category_id, name, description, is_active) VALUES (?, ?, ?, TRUE)',
            [normalizedCat, subName, subCategoryDescription || `${subName} Collection`]
          );
        }
      }

      if (brand && brand.trim() && brand !== 'all') {
        const brandName = brand.trim();
        const [existingBrand] = await connection.query(
          'SELECT id FROM brands WHERE name = ?',
          [brandName]
        );
        if (existingBrand.length === 0) {
          await connection.query(
            'INSERT INTO brands (name, is_featured) VALUES (?, TRUE)',
            [brandName]
          );
        }
      }

      const productValues = [
        id, name.trim(), subtitle || name.trim(), normalizedCat, subCategory || null, brand, luxuryTier,
        parseFloat(price), finalOriginal, finalCost, discountType, parseFloat(discountValue || 0),
        parseInt(stock, 10) || 0, finalSku, gtin || null, mpn || null, modelNumber || null, warranty || null,
        Array.isArray(tags) ? JSON.stringify(tags) : JSON.stringify([]), badge || null, description,
        videoUrl || null, hoverVideoUrl || null, hoverImage || null,
        parseInt(deliveryDays, 10) || 3, deliveryTimelineNote || null, effectiveDeliveryCharges, !!showInCarousel,
        standardDeliveryAdvance.required, standardDeliveryAdvance.type, standardDeliveryAdvance.value,
        urgentDeliveryAdvance.required, urgentDeliveryAdvance.type, urgentDeliveryAdvance.value,
        paymentPolicy, !!advancePaymentRequired,
        advancePaymentRequired ? advType : 'percentage',
        advancePaymentRequired ? computedAdvanceAmount : null,
        advancePaymentRequired ? computedAdvancePercent : null,
        advancePaymentRequired ? computedAdvanceValue : null,
        cityRestrictionMode, expiresAt ? new Date(expiresAt) : null, !!showOnHome, !!featured, !!isNew,
        !!showOnBanner, effectiveBannerImage, effectiveDesktopBanner, effectiveTabletBanner, effectiveMobileBanner,
        bannerTitle || null, bannerSubtitle || null,
        bannerEyebrow || null, bannerBadge || null, categoryDescription || null, subCategoryDescription || null,
        seoTitle || null, metaDescription || null,
        urlSlug || null, imageAltText || null
      ];
      const productColumns = `
        id, name, subtitle, category_id, sub_category, brand, luxury_tier,
        price, original_price, cost_price, discount_type, discount_value,
        stock, sku, gtin, mpn, model_number, warranty, tags, badge, description,
        video_url, hover_video_url, hover_image, delivery_days, delivery_timeline_note,
        delivery_charges, show_in_carousel,
        delivery_advance_required, delivery_advance_type, delivery_advance_value,
        urgent_delivery_advance_required, urgent_delivery_advance_type, urgent_delivery_advance_value,
        payment_policy, advance_payment_required, advance_payment_type,
        advance_payment_amount, advance_payment_percent, advance_payment_value,
        city_restriction_mode, expires_at, show_on_home, featured, is_new,
        show_on_banner, banner_image, banner_desktop_image, banner_tablet_image, banner_mobile_image,
        banner_title, banner_subtitle, banner_eyebrow, banner_badge,
        category_description, sub_category_description, seo_title, meta_description,
        url_slug, image_alt_text, admin_id, owner_id, owner_name, owner_phone, owner_whatsapp
      `;
      const ownershipValues = [adminId, adminId, ownerName, ownerPhone, ownerWhatsapp];
      productValues.push(...ownershipValues);
      await connection.query(
        `INSERT INTO products (${productColumns}) VALUES (${productValues.map(() => '?').join(', ')})`,
        productValues
      );

      // Gallery URLs live only in product_images; products never stores them.
      const galleryImages = normalizeGalleryImages(images);
      if (galleryImages.length > 0) {
        const seenChecksums = new Set();
        let displayOrder = 0;
        for (const imageUrl of galleryImages) {
          const checksum = await ProductImageService.checksumForUrl(imageUrl);
          if (checksum && seenChecksums.has(checksum)) continue;
          if (checksum) seenChecksums.add(checksum);
          await connection.query(
            'INSERT INTO product_images (product_id, image_url, image_checksum, display_order) VALUES (?, ?, ?, ?)',
            [id, imageUrl, checksum, displayOrder++]
          );
        }
      }

      // Insert allowed cities
      if (Array.isArray(allowedCities) && allowedCities.length > 0 && cityRestrictionMode === 'restricted') {
        for (const city of allowedCities) {
          await connection.query(
            'INSERT IGNORE INTO product_allowed_cities (product_id, city_name) VALUES (?, ?)',
            [id, city]
          );
        }
      }

      // Insert variants
      if (Array.isArray(variants) && variants.length > 0 && variantsMode !== 'none') {
        for (const v of variants) {
          const vId = v.id || `var-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
          const variantImages = Array.isArray(v.images)
            ? v.images.filter(image => typeof image === 'string' && !/^(blob|data):/i.test(image))
            : [];
          // Each inline variant gets its own globally unique SKU as well.
          let variantSku;
          if (isMissingSku(v.sku)) {
            variantSku = await generateVariantSku(connection, {
              parentSku: finalSku,
              variantCode: v.variantCode,
              color: v.color,
              size: v.size,
              variantName: v.name,
              variantType: v.variantType
            });
          } else {
            variantSku = normalizeSku(v.sku);
            if (!isValidSku(variantSku)) {
              throw skuError(`Variant SKU "${v.sku}" is invalid. Use A-Z, 0-9 and hyphens only (maximum ${SKU_MAX_LENGTH} characters).`);
            }
          }
          await reserveSku(connection, { sku: variantSku, entityType: 'variant', entityId: vId });
          const primaryImage = [v.image, v.imageUrl].find(
            image => typeof image === 'string' && !/^(blob|data):/i.test(image)
          ) || null;
          const variantColumns = [
            'id', 'product_id', 'name', 'subtitle', 'sku', 'barcode', 'variant_type', 'variant_code',
            'is_active', 'is_full_variant', 'price', 'cost_price', 'original_price', 'discount_type',
            'discount_value', 'stock', 'color', 'size', 'image_url', 'video_url', 'description',
            'images', 'brand', 'sub_category', 'luxury_tier', 'delivery_days', 'delivery_timeline_note',
            'advance_payment_required', 'advance_payment_type', 'advance_payment_amount',
            'advance_payment_percent', 'advance_payment_value', 'city_restriction_mode',
            'allowed_cities', 'standalone_in_catalog', 'badge', 'expires_at'
          ];
          const variantValues = [
            vId, id, v.name, v.subtitle || null, variantSku, v.barcode || null,
            v.variantType || 'Option', v.variantCode || null, v.isActive !== false, !!v.isFullVariant,
            v.price !== undefined && v.price !== null ? parseFloat(v.price) : parseFloat(price),
            v.costPrice !== undefined && v.costPrice !== null ? parseFloat(v.costPrice) : finalCost,
            v.originalPrice !== undefined && v.originalPrice !== null ? parseFloat(v.originalPrice) : finalOriginal,
            v.discountType || 'percentage', parseFloat(v.discountValue || 0),
            v.stock !== undefined && v.stock !== null ? parseInt(v.stock, 10) : 5,
            v.color || null, v.size || null, primaryImage,
            typeof v.videoUrl === 'string' && !/^(blob|data):/i.test(v.videoUrl) ? v.videoUrl : null,
            v.description || null, JSON.stringify(variantImages), v.brand || brand,
            v.subCategory || subCategory || null, v.luxuryTier || luxuryTier,
            parseInt(v.deliveryDays, 10) || deliveryDays, v.deliveryTimelineNote || null,
            v.advancePaymentRequired !== undefined ? !!v.advancePaymentRequired : !!advancePaymentRequired,
            v.advancePaymentType || advancePaymentType,
            v.advancePaymentAmount !== undefined && v.advancePaymentAmount !== null ? parseFloat(v.advancePaymentAmount) : null,
            v.advancePaymentPercent !== undefined && v.advancePaymentPercent !== null ? parseInt(v.advancePaymentPercent, 10) : null,
            v.advancePaymentValue !== undefined && v.advancePaymentValue !== null ? parseFloat(v.advancePaymentValue) : null,
            v.cityRestrictionMode || cityRestrictionMode,
            JSON.stringify(Array.isArray(v.allowedCities) ? v.allowedCities : allowedCities),
            v.standaloneInCatalog !== undefined ? !!v.standaloneInCatalog : true,
            v.badge || null, v.expiresAt ? new Date(v.expiresAt) : null
          ];
          await connection.query(
            `INSERT INTO product_variants (${variantColumns.join(', ')}) VALUES (${variantValues.map(() => '?').join(', ')})`,
            variantValues
          );
        }
      }

      await connection.commit();
      const product = await ProductController.getFormattedProduct(id, pool, true);

      res.status(201).json({
        success: true,
        message: 'Luxury product created successfully.',
        product
      });
    } catch (err) {
      if (connection) await connection.rollback();
      next(err);
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * Synchronizes `product_images` with the submitted gallery list inside an active
   * transaction. Matches local upload paths across origin rewrites (e.g. relative
   * `/uploads/...` vs `${apiPublicUrl}/uploads/...`) and deletes removed rows
   * before inserting new ones so `uq_prod_img_checksum` is never violated while
   * rows added concurrently after `oldGallery` remain untouched.
   */
  static async syncProductGallery(connection, productId, oldGallery, incomingImages) {
    const galleryImages = normalizeGalleryImages(incomingImages);
    const oldByKey = new Map();
    for (const row of oldGallery) {
      const key = toCanonicalMediaKey(row.image_url);
      if (key && !oldByKey.has(key)) oldByKey.set(key, row);
    }

    const keptIds = new Set();
    const seenChecksums = new Set();
    const planned = [];
    let displayOrder = 0;

    for (const imageUrl of galleryImages) {
      const key = toCanonicalMediaKey(imageUrl);
      let previous = oldByKey.get(key);
      if (previous && keptIds.has(previous.id)) previous = undefined;

      const checksum = previous?.image_checksum || await ProductImageService.checksumForUrl(imageUrl);
      if (checksum && seenChecksums.has(checksum)) continue;
      if (checksum) seenChecksums.add(checksum);

      if (previous) {
        keptIds.add(previous.id);
        planned.push({ type: 'keep', row: previous, checksum, displayOrder });
      } else {
        planned.push({ type: 'insert', imageUrl, checksum, displayOrder });
      }
      displayOrder += 1;
    }

    const removableIds = oldGallery
      .filter(row => !keptIds.has(row.id))
      .map(row => row.id);
    if (removableIds.length > 0) {
      await connection.query(
        `DELETE FROM product_images WHERE product_id = ? AND id IN (${removableIds.map(() => '?').join(', ')})`,
        [productId, ...removableIds]
      );
    }

    for (const item of planned) {
      if (item.type === 'keep') {
        const needsOrderUpdate = Number(item.row.display_order) !== item.displayOrder;
        const needsChecksumBackfill = !item.row.image_checksum && item.checksum;
        if (needsOrderUpdate || needsChecksumBackfill) {
          await connection.query(
            'UPDATE product_images SET display_order = ?, image_checksum = COALESCE(image_checksum, ?) WHERE id = ?',
            [item.displayOrder, item.checksum || null, item.row.id]
          );
        }
      } else {
        try {
          await connection.query(
            'INSERT INTO product_images (product_id, image_url, image_checksum, display_order) VALUES (?, ?, ?, ?)',
            [productId, item.imageUrl, item.checksum, item.displayOrder]
          );
        } catch (insertError) {
          if (insertError.code !== 'ER_DUP_ENTRY' || !item.checksum) throw insertError;
          const existingImg = await ProductImageService.findDuplicate(productId, item.checksum, connection);
          if (!existingImg) throw insertError;
          await connection.query(
            'UPDATE product_images SET display_order = ? WHERE id = ?',
            [item.displayOrder, existingImg.id]
          );
        }
      }
    }
  }

  /** Identifies local or external media URLs no longer referenced after a product update. */
  static collectRemovedMediaUrls(existingRow, updatedRow, oldGallery, incomingImages) {
    const nextGalleryKeys = Array.isArray(incomingImages)
      ? new Set(normalizeGalleryImages(incomingImages).map(toCanonicalMediaKey))
      : new Set(oldGallery.map(row => toCanonicalMediaKey(row.image_url)));
    const nextMediaKeys = new Set([
      updatedRow.banner_image,
      updatedRow.banner_desktop_image,
      updatedRow.banner_tablet_image,
      updatedRow.banner_mobile_image,
      updatedRow.hover_image
    ].filter(Boolean).map(toCanonicalMediaKey));

    return [
      ...oldGallery
        .filter(row => !nextGalleryKeys.has(toCanonicalMediaKey(row.image_url)))
        .map(row => row.image_url),
      ...[
        existingRow.banner_image,
        existingRow.banner_desktop_image,
        existingRow.banner_tablet_image,
        existingRow.banner_mobile_image,
        existingRow.hover_image
      ].filter(url => url && !nextMediaKeys.has(toCanonicalMediaKey(url)))
    ];
  }

  static async update(req, res, next) {
    let connection = null;
    try {
      const { id } = req.params;
      const updates = req.body;

      const updateMedia = [
        ...(Array.isArray(updates.images) ? updates.images : []),
        updates.videoUrl, updates.hoverVideoUrl, updates.hoverImage,
        updates.bannerImage, updates.bannerDesktopImage, updates.bannerTabletImage, updates.bannerMobileImage
      ];
      if (updateMedia.some(isInlineMedia)) {
        return res.status(400).json({ success: false, message: 'Product media must be uploaded as files; inline preview data cannot be saved.' });
      }

      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Forbidden. Admin role required to update products.' });
      }

      // Ownership authorization check. Banner values are captured here so a
      // replaced image can be removed after the new row is safely committed.
      const [existing] = await pool.query(
        `SELECT admin_id, owner_id, sku, price,
                advance_payment_required, advance_payment_type, advance_payment_amount,
                advance_payment_percent, advance_payment_value,
                delivery_advance_required, delivery_advance_type, delivery_advance_value,
                urgent_delivery_advance_required, urgent_delivery_advance_type,
                urgent_delivery_advance_value,
                banner_image, banner_desktop_image, banner_tablet_image,
                banner_mobile_image, hover_image
         FROM products WHERE id = ?`,
        [id]
      );
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: `Product "${id}" not found.` });
      }

      const productOwner = existing[0].admin_id || existing[0].owner_id;
      // Section 5: An Admin must not edit another Admin's product
      if (productOwner && productOwner !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Forbidden. You do not own this product and cannot modify another administrator\'s product.' });
      }

      const [oldGallery] = await pool.query(
        'SELECT id, image_url, image_checksum, display_order FROM product_images WHERE product_id = ? ORDER BY display_order ASC',
        [id]
      );

      // DDL must stay outside the transaction (MySQL implicitly commits on DDL).
      if (updates.sku !== undefined) await ensureSkuTables();

      connection = await pool.getConnection();
      await connection.beginTransaction();

      const fields = [];
      const values = [];

      // Explicit SKU change only: existing SKUs are never regenerated silently.
      if (updates.sku !== undefined) {
        const requestedSku = normalizeSku(updates.sku);
        if (!requestedSku) {
          throw skuError('SKU cannot be emptied. Use the Generate SKU action to create a new globally unique SKU.');
        }
        if (!isValidSku(requestedSku)) {
          throw skuError(`SKU "${updates.sku}" is invalid. Use A-Z, 0-9 and hyphens only (maximum ${SKU_MAX_LENGTH} characters).`);
        }
        const currentSku = existing[0].sku || '';
        if (currentSku === requestedSku) {
          // Unchanged: never touch the existing SKU.
        } else if (currentSku && currentSku.toUpperCase() === requestedSku) {
          // Case-only change: the registry key is case-insensitive, so only the
          // stored value changes and no uniqueness claim is moved.
          fields.push('sku = ?');
          values.push(requestedSku);
        } else {
          await reserveSku(connection, { sku: requestedSku, entityType: 'product', entityId: id });
          await releaseSku(connection, currentSku);
          fields.push('sku = ?');
          values.push(requestedSku);
        }
      }

      if (updates.clearDiscount === true) {
        fields.push('original_price = NULL', "discount_type = 'percentage'", 'discount_value = 0');
      }
      const parseRequiredNonNegative = (raw, label) => {
        const num = Number(raw);
        if (raw === null || raw === '' || !Number.isFinite(num) || num < 0) {
          throw operationalBadRequest(`${label} must be a valid non-negative number.`);
        }
        return num;
      };
      const parseNullableNonNegative = (raw, label) => {
        if (raw === null || raw === '') return null;
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0) {
          throw operationalBadRequest(`${label} must be a valid non-negative number.`);
        }
        return num;
      };

      if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
      if (updates.subtitle !== undefined) { fields.push('subtitle = ?'); values.push(updates.subtitle); }
      if (updates.price !== undefined) { fields.push('price = ?'); values.push(parseRequiredNonNegative(updates.price, 'Price')); }
      if (updates.originalPrice !== undefined) { fields.push('original_price = ?'); values.push(parseNullableNonNegative(updates.originalPrice, 'Original price')); }
      if (updates.costPrice !== undefined) { fields.push('cost_price = ?'); values.push(parseNullableNonNegative(updates.costPrice, 'Cost price')); }
      if (updates.stock !== undefined) {
        const stockVal = parseInt(updates.stock, 10);
        if (!Number.isFinite(stockVal) || stockVal < 0) {
          throw operationalBadRequest('Stock must be a valid non-negative integer.');
        }
        fields.push('stock = ?');
        values.push(stockVal);
      }
      if (updates.category !== undefined) {
        const normCat = updates.category.toLowerCase().trim();
        const [existingCat] = await connection.query('SELECT id FROM categories WHERE id = ?', [normCat]);
        if (existingCat.length === 0) {
          const catName = normCat.charAt(0).toUpperCase() + normCat.slice(1);
          await connection.query('INSERT INTO categories (id, name, is_active) VALUES (?, ?, TRUE)', [normCat, catName]);
        }
        fields.push('category_id = ?');
        values.push(normCat);
      }
      if (updates.subCategory !== undefined) { fields.push('sub_category = ?'); values.push(updates.subCategory); }
      if (updates.brand !== undefined) { fields.push('brand = ?'); values.push(updates.brand); }
      if (updates.luxuryTier !== undefined) { fields.push('luxury_tier = ?'); values.push(updates.luxuryTier); }
      if (updates.discountType !== undefined) { fields.push('discount_type = ?'); values.push(updates.discountType); }
      if (updates.discountValue !== undefined) {
        const dVal = updates.discountValue === null || updates.discountValue === ''
          ? 0
          : parseRequiredNonNegative(updates.discountValue, 'Discount value');
        fields.push('discount_value = ?');
        values.push(dVal);
      }
      if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
      if (updates.deliveryDays !== undefined) {
        const dDays = parseInt(updates.deliveryDays, 10);
        if (!Number.isFinite(dDays) || dDays < 1) {
          throw operationalBadRequest('Delivery days must be at least 1.');
        }
        fields.push('delivery_days = ?');
        values.push(dDays);
      }
      if (updates.deliveryTimelineNote !== undefined) { fields.push('delivery_timeline_note = ?'); values.push(updates.deliveryTimelineNote); }
      if (updates.deliveryCharges !== undefined || updates.delivery_charges !== undefined) {
        const dVal = updates.deliveryCharges !== undefined ? updates.deliveryCharges : updates.delivery_charges;
        const parsed = dVal !== null && dVal !== undefined && dVal !== '' ? parseFloat(dVal) : NaN;
        // A zero/empty custom fee means "standard Rs. 350"; delivery is never free.
        fields.push('delivery_charges = ?');
        values.push(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
      }
      if (updates.showInCarousel !== undefined) { fields.push('show_in_carousel = ?'); values.push(!!updates.showInCarousel); }
      if (updates.deliveryAdvanceRequired !== undefined) {
        if (updates.deliveryAdvanceRequired) {
          const type = updates.deliveryAdvanceType === 'fixed' ? 'fixed' : 'percentage';
          const value = Number(updates.deliveryAdvanceValue);
          if (!Number.isFinite(value) || value <= 0) {
            throw operationalBadRequest('Standard delivery advance needs a positive value.');
          }
          if (type === 'percentage' && value > 100) {
            throw operationalBadRequest('Standard delivery advance percentage cannot exceed 100%.');
          }
          fields.push('delivery_advance_required = TRUE', 'delivery_advance_type = ?', 'delivery_advance_value = ?');
          values.push(type, Math.round(value * 100) / 100);
        } else {
          fields.push('delivery_advance_required = FALSE', "delivery_advance_type = 'percentage'", 'delivery_advance_value = NULL');
        }
      } else if (existing[0].delivery_advance_required && (updates.deliveryAdvanceType !== undefined || updates.deliveryAdvanceValue !== undefined)) {
        const type = (updates.deliveryAdvanceType || existing[0].delivery_advance_type || 'percentage') === 'fixed' ? 'fixed' : 'percentage';
        const value = Number(updates.deliveryAdvanceValue ?? existing[0].delivery_advance_value);
        if (Number.isFinite(value) && value > 0 && !(type === 'percentage' && value > 100)) {
          fields.push('delivery_advance_type = ?', 'delivery_advance_value = ?');
          values.push(type, Math.round(value * 100) / 100);
        }
      }
      if (updates.urgentDeliveryAdvanceRequired !== undefined) {
        if (updates.urgentDeliveryAdvanceRequired) {
          const type = updates.urgentDeliveryAdvanceType === 'fixed' ? 'fixed' : 'percentage';
          const value = Number(updates.urgentDeliveryAdvanceValue);
          if (!Number.isFinite(value) || value <= 0) {
            throw operationalBadRequest('Urgent delivery advance needs a positive value.');
          }
          if (type === 'percentage' && value > 100) {
            throw operationalBadRequest('Urgent delivery advance percentage cannot exceed 100%.');
          }
          fields.push('urgent_delivery_advance_required = TRUE', 'urgent_delivery_advance_type = ?', 'urgent_delivery_advance_value = ?');
          values.push(type, Math.round(value * 100) / 100);
        } else {
          fields.push('urgent_delivery_advance_required = FALSE', "urgent_delivery_advance_type = 'percentage'", 'urgent_delivery_advance_value = NULL');
        }
      } else if (existing[0].urgent_delivery_advance_required && (updates.urgentDeliveryAdvanceType !== undefined || updates.urgentDeliveryAdvanceValue !== undefined)) {
        const type = (updates.urgentDeliveryAdvanceType || existing[0].urgent_delivery_advance_type || 'percentage') === 'fixed' ? 'fixed' : 'percentage';
        const value = Number(updates.urgentDeliveryAdvanceValue ?? existing[0].urgent_delivery_advance_value);
        if (Number.isFinite(value) && value > 0 && !(type === 'percentage' && value > 100)) {
          fields.push('urgent_delivery_advance_type = ?', 'urgent_delivery_advance_value = ?');
          values.push(type, Math.round(value * 100) / 100);
        }
      }
      if (updates.paymentPolicy !== undefined) { fields.push('payment_policy = ?'); values.push(updates.paymentPolicy); }
      if (updates.advancePaymentRequired !== undefined) {
        fields.push('advance_payment_required = ?');
        values.push(!!updates.advancePaymentRequired);

        if (updates.advancePaymentRequired === true) {
          const advType = (updates.advancePaymentType || existing[0].advance_payment_type || 'percentage') === 'fixed' ? 'fixed' : 'percentage';
          const targetPrice = updates.price !== undefined ? parseFloat(updates.price) : parseFloat(existing[0].price || 0);
          const rawVal = updates.advancePaymentValue ?? (advType === 'percentage' ? updates.advancePaymentPercent : updates.advancePaymentAmount) ?? existing[0].advance_payment_value ?? 20;
          const numVal = Number(rawVal);
          if (!Number.isFinite(numVal) || numVal <= 0) {
            throw operationalBadRequest(
              advType === 'percentage'
                ? 'Advance payment percentage must be a positive percentage.'
                : 'A positive advance payment amount in PKR is required.'
            );
          }
          if (advType === 'percentage' && numVal > 100) {
            throw operationalBadRequest('Advance payment percentage cannot exceed 100%.');
          }

          const computedAmount = advType === 'percentage'
            ? Math.round(targetPrice * (numVal / 100) * 100) / 100
            : Math.round(numVal * 100) / 100;
          const computedPercent = advType === 'percentage'
            ? Math.round(numVal)
            : Math.min(100, Math.round((numVal / (targetPrice || 1)) * 100));

          fields.push('advance_payment_type = ?', 'advance_payment_amount = ?', 'advance_payment_percent = ?', 'advance_payment_value = ?');
          values.push(advType, computedAmount, computedPercent, numVal);
        } else {
          fields.push('advance_payment_type = ?', 'advance_payment_amount = NULL', 'advance_payment_percent = NULL', 'advance_payment_value = NULL');
          values.push('percentage');
        }
      } else if (existing[0].advance_payment_required && (updates.advancePaymentType !== undefined || updates.advancePaymentValue !== undefined || updates.advancePaymentAmount !== undefined || updates.price !== undefined)) {
        const advType = (updates.advancePaymentType || existing[0].advance_payment_type || 'percentage') === 'fixed' ? 'fixed' : 'percentage';
        const targetPrice = updates.price !== undefined ? parseFloat(updates.price) : parseFloat(existing[0].price || 0);
        const rawVal = updates.advancePaymentValue ?? (advType === 'percentage' ? updates.advancePaymentPercent : updates.advancePaymentAmount) ?? existing[0].advance_payment_value ?? 20;
        const numVal = Number(rawVal);
        if (Number.isFinite(numVal) && numVal > 0) {
          const computedAmount = advType === 'percentage'
            ? Math.round(targetPrice * (Math.min(numVal, 100) / 100) * 100) / 100
            : Math.round(numVal * 100) / 100;
          const computedPercent = advType === 'percentage'
            ? Math.round(numVal)
            : Math.min(100, Math.round((numVal / (targetPrice || 1)) * 100));
          fields.push('advance_payment_type = ?', 'advance_payment_amount = ?', 'advance_payment_percent = ?', 'advance_payment_value = ?');
          values.push(advType, computedAmount, computedPercent, numVal);
        }
      }
      if (updates.cityRestrictionMode !== undefined) { fields.push('city_restriction_mode = ?'); values.push(updates.cityRestrictionMode); }
      if (updates.showOnHome !== undefined) { fields.push('show_on_home = ?'); values.push(!!updates.showOnHome); }
      if (updates.featured !== undefined) { fields.push('featured = ?'); values.push(!!updates.featured); }
      if (updates.isNew !== undefined) { fields.push('is_new = ?'); values.push(!!updates.isNew); }
      if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(Array.isArray(updates.tags) ? updates.tags : [])); }
      if (updates.badge !== undefined) { fields.push('badge = ?'); values.push(updates.badge || null); }
      if (updates.videoUrl !== undefined) { fields.push('video_url = ?'); values.push(updates.videoUrl || null); }
      if (updates.hoverVideoUrl !== undefined) { fields.push('hover_video_url = ?'); values.push(updates.hoverVideoUrl || null); }
      if (updates.hoverImage !== undefined) { fields.push('hover_image = ?'); values.push(updates.hoverImage || null); }
      if (updates.showOnBanner !== undefined) { fields.push('show_on_banner = ?'); values.push(!!updates.showOnBanner); }
      if (updates.bannerImage !== undefined) { fields.push('banner_image = ?'); values.push(updates.bannerImage); }
      if (updates.bannerDesktopImage !== undefined) {
        fields.push('banner_desktop_image = ?');
        values.push(updates.bannerDesktopImage);
        if (updates.bannerImage === undefined) {
          fields.push('banner_image = COALESCE(banner_image, ?)');
          values.push(updates.bannerDesktopImage);
        }
      }
      if (updates.bannerTabletImage !== undefined) { fields.push('banner_tablet_image = ?'); values.push(updates.bannerTabletImage); }
      if (updates.bannerMobileImage !== undefined) { fields.push('banner_mobile_image = ?'); values.push(updates.bannerMobileImage); }
      if (updates.bannerTitle !== undefined) { fields.push('banner_title = ?'); values.push(updates.bannerTitle); }
      if (updates.bannerSubtitle !== undefined) { fields.push('banner_subtitle = ?'); values.push(updates.bannerSubtitle); }
      if (updates.bannerEyebrow !== undefined) { fields.push('banner_eyebrow = ?'); values.push(updates.bannerEyebrow); }
      if (updates.bannerBadge !== undefined) { fields.push('banner_badge = ?'); values.push(updates.bannerBadge); }
      if (updates.variantsMode !== undefined) { fields.push('variants_mode = ?'); values.push(updates.variantsMode); }
      // Fix 8 Fields
      if (updates.gtin !== undefined) { fields.push('gtin = ?'); values.push(updates.gtin); }
      if (updates.mpn !== undefined) { fields.push('mpn = ?'); values.push(updates.mpn); }
      if (updates.modelNumber !== undefined) { fields.push('model_number = ?'); values.push(updates.modelNumber); }
      if (updates.warranty !== undefined) { fields.push('warranty = ?'); values.push(updates.warranty); }
      if (updates.seoTitle !== undefined) { fields.push('seo_title = ?'); values.push(updates.seoTitle); }
      if (updates.metaDescription !== undefined) { fields.push('meta_description = ?'); values.push(updates.metaDescription); }
      if (updates.urlSlug !== undefined) { fields.push('url_slug = ?'); values.push(updates.urlSlug); }
      if (updates.imageAltText !== undefined) { fields.push('image_alt_text = ?'); values.push(updates.imageAltText); }
      if (updates.categoryDescription !== undefined) { fields.push('category_description = ?'); values.push(updates.categoryDescription || null); }
      if (updates.subCategoryDescription !== undefined) { fields.push('sub_category_description = ?'); values.push(updates.subCategoryDescription || null); }
      if (updates.expiresAt !== undefined) { fields.push('expires_at = ?'); values.push(updates.expiresAt ? new Date(updates.expiresAt) : null); }

      if (fields.length > 0) {
        values.push(id);
        await connection.query(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, values);
      }

      if (Array.isArray(updates.images)) {
        await ProductController.syncProductGallery(connection, id, oldGallery, updates.images);
      }

      // Replace allowed cities if provided
      if (Array.isArray(updates.allowedCities) || updates.cityRestrictionMode === 'all') {
        await connection.query('DELETE FROM product_allowed_cities WHERE product_id = ?', [id]);
        if (updates.cityRestrictionMode !== 'all' && Array.isArray(updates.allowedCities)) {
          for (const city of updates.allowedCities) {
            await connection.query('INSERT IGNORE INTO product_allowed_cities (product_id, city_name) VALUES (?, ?)', [id, city]);
          }
        }
      }

      await connection.commit();

      // Disk cleanup happens after the database commit. A file is only removed
      // when no other product, variant, banner or promotion references it.
      const [updatedMediaRows] = await pool.query(
        `SELECT banner_image, banner_desktop_image, banner_tablet_image,
                banner_mobile_image, hover_image
         FROM products WHERE id = ?`,
        [id]
      );
      if (updatedMediaRows.length) {
        const removedUrls = ProductController.collectRemovedMediaUrls(
          existing[0],
          updatedMediaRows[0],
          oldGallery,
          updates.images
        );
        await removeUploadedFilesIfUnreferenced(removedUrls).catch(error => {
          logger.warn('Product saved, but removed media cleanup failed.', {
            productId: id,
            message: error.message
          });
        });
      }

      const product = await ProductController.getFormattedProduct(id, pool, true);
      res.json({ success: true, message: `Product "${id}" updated successfully.`, product });
    } catch (err) {
      if (connection) await connection.rollback();
      next(err);
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * DELETE archives a product. Nothing is removed from disk or the database,
   * so an accidental delete can be restored and historical orders keep their
   * product/media references.
   */
  static async delete(req, res, next) {
    try {
      const { id } = req.params;

      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Forbidden. Admin role required to archive products.' });
      }

      const [existing] = await pool.query(
        'SELECT admin_id, owner_id, archived_at FROM products WHERE id = ?',
        [id]
      );
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: `Product "${id}" not found.` });
      }

      const productOwner = existing[0].admin_id || existing[0].owner_id;
      if (productOwner && productOwner !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Forbidden. You do not own this product and cannot archive another administrator\'s product.' });
      }

      const reason = typeof req.body?.reason === 'string'
        ? req.body.reason.trim().slice(0, 255)
        : 'Archived by admin';
      await pool.query(
        `UPDATE products
         SET archived_at = COALESCE(archived_at, NOW()),
             archived_by = COALESCE(archived_by, ?),
             archive_reason = COALESCE(archive_reason, ?),
             show_on_home = FALSE,
             show_in_carousel = FALSE,
             show_on_banner = FALSE,
             featured = FALSE
         WHERE id = ?`,
        [req.user.id, reason || 'Archived by admin', id]
      );
      res.json({
        success: true,
        archived: true,
        message: `Product "${id}" archived. It can be restored from the Archived filter.`
      });
    } catch (err) {
      next(err);
    }
  }

  static async restore(req, res, next) {
    try {
      const { id } = req.params;
      const [existing] = await pool.query(
        'SELECT admin_id, owner_id, archived_at FROM products WHERE id = ?',
        [id]
      );
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: `Product "${id}" not found.` });
      }
      const productOwner = existing[0].admin_id || existing[0].owner_id;
      if (productOwner && productOwner !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Forbidden. You do not own this product.' });
      }
      await pool.query(
        `UPDATE products
         SET archived_at = NULL, archived_by = NULL, archive_reason = NULL
         WHERE id = ?`,
        [id]
      );
      const product = await ProductController.getFormattedProduct(id, pool, true);
      res.json({ success: true, message: `Product "${id}" restored.`, product });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Permanent purge is deliberately a separate route with an explicit
   * confirmation. It is only allowed for archived products.
   */
  static async purge(req, res, next) {
    let connection = null;
    try {
      const { id } = req.params;
      const confirmation = String(req.body?.confirmation ?? req.query.confirm ?? '').trim();
      if (confirmation.toUpperCase() !== 'DELETE') {
        return res.status(400).json({
          success: false,
          message: 'Permanent deletion requires the DELETE confirmation.'
        });
      }

      const [existing] = await pool.query(
        'SELECT admin_id, owner_id, sku, archived_at FROM products WHERE id = ?',
        [id]
      );
      if (existing.length === 0) {
        return res.status(404).json({ success: false, message: `Product "${id}" not found.` });
      }
      const productOwner = existing[0].admin_id || existing[0].owner_id;
      if (productOwner && productOwner !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Forbidden. You do not own this product.' });
      }
      if (!existing[0].archived_at) {
        return res.status(409).json({ success: false, message: 'Archive the product before permanently deleting it.' });
      }

      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [variants] = await connection.query(
        'SELECT sku FROM product_variants WHERE product_id = ? FOR UPDATE',
        [id]
      );
      const [gallery] = await connection.query(
        'SELECT image_url FROM product_images WHERE product_id = ?',
        [id]
      );
      await connection.query('DELETE FROM products WHERE id = ?', [id]);
      await releaseSku(connection, existing[0].sku);
      for (const variant of variants) {
        await releaseSku(connection, variant.sku);
      }
      await connection.commit();

      await Promise.allSettled([
        removeProductUploads(id),
        ...gallery.map(image => removeUploadedFileByUrl(image.image_url))
      ]);
      res.json({ success: true, message: `Product "${id}" permanently deleted.` });
    } catch (err) {
      if (connection) await connection.rollback();
      next(err);
    } finally {
      if (connection) connection.release();
    }
  }

  /**
   * POST /api/v1/products/generate-sku
   * Returns the next globally unique SKU without creating anything.
   * Body: { category, brand, productName } for products or
   *       { parentProductId, variantCode, variantName, color, size } for variants.
   */
  static async generateSku(req, res, next) {
    let connection = null;
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Forbidden. Admin role required to generate SKUs.' });
      }

      await ensureSkuTables();
      connection = await pool.getConnection();
      await connection.beginTransaction();

      let sku;
      if (body.parentProductId) {
        const [parents] = await connection.query('SELECT sku FROM products WHERE id = ? FOR UPDATE', [body.parentProductId]);
        if (parents.length === 0) {
          await connection.rollback();
          return res.status(404).json({ success: false, message: `Parent product "${body.parentProductId}" not found.` });
        }
        sku = await generateVariantSku(connection, {
          parentSku: parents[0].sku,
          variantCode: body.variantCode,
          variantName: body.variantName,
          color: body.color,
          size: body.size,
          variantType: body.variantType
        });
      } else {
        sku = await generateProductSku(connection, {
          category: body.category,
          brand: body.brand,
          productName: body.productName
        });
      }

      await connection.commit();
      res.json({ success: true, sku });
    } catch (err) {
      if (connection) {
        try { await connection.rollback(); } catch (rollbackError) { /* already rolled back */ }
      }
      next(err);
    } finally {
      if (connection) connection.release();
    }
  }
}
