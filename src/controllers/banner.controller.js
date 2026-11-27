import { executeQuery as query } from '../config/db.js';

const DEFAULT_CAROUSEL_SETTINGS = {
  autoPlay: true,
  slideDuration: 6500,
  showArrows: true,
  showIndicators: true
};

const hasInlineMedia = body => !!body && [
  body.image, body.desktopImage, body.desktop_image, body.tabletImage, body.tablet_image,
  body.mobileImage, body.mobile_image, body.mobileImageUrl
].some(value => typeof value === 'string' && /^(blob|data):/i.test(value));

function formatBannerRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    internalName: row.internal_name,
    theme: row.theme || 'dark',
    eyebrow: row.eyebrow,
    categoryLabel: row.category_label,
    title: row.title,
    subtitle: row.subtitle,
    image: row.image || row.desktop_image || '',
    desktopImage: row.desktop_image || row.image || null,
    tabletImage: row.tablet_image || row.desktop_image || row.image || null,
    mobileImage: row.mobile_image || row.mobile_image_url || row.image || null,
    mobileImageUrl: row.mobile_image || row.mobile_image_url || null,
    overlayOpacity: row.overlay_opacity !== null ? Number(row.overlay_opacity) : 45,
    buttonText: row.button_text || 'Explore Collection',
    badge: row.badge,
    linkType: row.link_type || 'category',
    targetProductId: row.target_product_id,
    targetCategory: row.target_category,
    targetSubCategory: row.target_sub_category,
    customUrl: row.custom_url,
    price: row.price !== null ? Number(row.price) : null,
    originalPrice: row.original_price !== null ? Number(row.original_price) : null,
    accentLabel: row.accent_label,
    displayOrder: row.display_order || 1,
    order: row.display_order || 1,
    active: Boolean(row.active)
  };
}

function formatPromoRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    internalName: row.internal_name,
    tag: row.tag,
    title: row.title,
    description: row.description,
    image: row.image || '',
    mobileImage: row.mobile_image_url || undefined,
    mobileImageUrl: row.mobile_image_url,
    overlayOpacity: row.overlay_opacity !== null ? Number(row.overlay_opacity) : 35,
    linkType: row.link_type || 'category',
    targetProductId: row.target_product_id,
    targetCategory: row.target_category,
    targetSubCategory: row.target_sub_category,
    customUrl: row.custom_url,
    actionText: row.action_text || 'Explore Collection',
    badge: row.badge,
    displayOrder: row.display_order || 1,
    order: row.display_order || 1,
    active: Boolean(row.active)
  };
}

function formatTrustRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    icon: row.icon,
    title: row.title,
    subtitle: row.subtitle,
    displayOrder: row.display_order || 1,
    active: Boolean(row.active)
  };
}

export async function getStorefrontBanners(req, res, next) {
  try {
    const [heroRows, promoRows, trustRows, settingsRows] = await Promise.all([
      query('SELECT * FROM hero_banners WHERE active = TRUE ORDER BY display_order ASC'),
      query('SELECT * FROM promo_cards WHERE active = TRUE ORDER BY display_order ASC'),
      query('SELECT * FROM trust_indicators WHERE active = TRUE ORDER BY display_order ASC'),
      query('SELECT * FROM carousel_settings WHERE id = ? LIMIT 1', ['default'])
    ]);
    const settingsRow = settingsRows[0];
    const carouselSettings = settingsRow ? {
      autoPlay: Boolean(settingsRow.auto_play),
      slideDuration: Number(settingsRow.slide_duration) || DEFAULT_CAROUSEL_SETTINGS.slideDuration,
      showArrows: Boolean(settingsRow.show_arrows),
      showIndicators: Boolean(settingsRow.show_indicators)
    } : DEFAULT_CAROUSEL_SETTINGS;

    return res.json({
      success: true,
      data: {
        heroBanners: heroRows.map(formatBannerRow),
        promoCards: promoRows.map(formatPromoRow),
        trustIndicators: trustRows.map(formatTrustRow),
        carouselSettings
      }
    });
  } catch (err) {
    next(err);
  }
}

// Hero Banners CRUD
export async function listHeroBanners(req, res, next) {
  try {
    const rows = await query('SELECT * FROM hero_banners ORDER BY display_order ASC');
    const items = rows.map(formatBannerRow);
    res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    next(err);
  }
}

export async function createHeroBanner(req, res, next) {
  try {
    const b = req.body;
    if (hasInlineMedia(b)) {
      return res.status(400).json({ success: false, message: 'Banner images must be uploaded as files; inline preview data cannot be saved.' });
    }
    const id = b.id || `slide-${Date.now()}`;
    const desktopImage = b.desktopImage || b.desktop_image || b.image || null;
    const tabletImage = b.tabletImage || b.tablet_image || null;
    const mobileImage = b.mobileImage || b.mobile_image || b.mobileImageUrl || null;
    const legacyImage = b.image || desktopImage;

    await query(
      `INSERT INTO hero_banners 
       (id, internal_name, theme, eyebrow, category_label, title, subtitle, image, desktop_image, tablet_image, mobile_image, mobile_image_url, 
        overlay_opacity, button_text, badge, link_type, target_product_id, target_category, target_sub_category, 
        custom_url, price, original_price, accent_label, display_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, b.internalName || null, b.theme || 'dark', b.eyebrow || '', b.categoryLabel || null,
        b.title || 'Untitled Slide', b.subtitle || null, legacyImage, desktopImage, tabletImage, mobileImage, mobileImage,
        b.overlayOpacity ?? 45, b.buttonText || 'Explore Collection', b.badge || null,
        b.linkType || 'category', b.targetProductId || null, b.targetCategory || null,
        b.targetSubCategory || null, b.customUrl || null, b.price ?? null, b.originalPrice ?? null,
        b.accentLabel || null, b.displayOrder || b.order || 1, b.active !== false
      ]
    );
    const [created] = await query('SELECT * FROM hero_banners WHERE id = ?', [id]);
    res.status(201).json({ success: true, data: formatBannerRow(created) });
  } catch (err) {
    next(err);
  }
}

export async function updateHeroBanner(req, res, next) {
  try {
    const { id } = req.params;
    const b = req.body;
    if (hasInlineMedia(b)) {
      return res.status(400).json({ success: false, message: 'Banner images must be uploaded as files; inline preview data cannot be saved.' });
    }
    const desktopImage = b.desktopImage !== undefined ? b.desktopImage : b.desktop_image;
    const tabletImage = b.tabletImage !== undefined ? b.tabletImage : b.tablet_image;
    const mobileImage = b.mobileImage !== undefined ? b.mobileImage : (b.mobile_image !== undefined ? b.mobile_image : b.mobileImageUrl);
    const legacyImage = b.image !== undefined ? b.image : desktopImage;

    await query(
      `UPDATE hero_banners SET
        internal_name = COALESCE(?, internal_name),
        theme = COALESCE(?, theme),
        eyebrow = COALESCE(?, eyebrow),
        category_label = COALESCE(?, category_label),
        title = COALESCE(?, title),
        subtitle = COALESCE(?, subtitle),
        image = COALESCE(?, image),
        desktop_image = COALESCE(?, desktop_image),
        tablet_image = COALESCE(?, tablet_image),
        mobile_image = COALESCE(?, mobile_image),
        mobile_image_url = COALESCE(?, mobile_image_url),
        overlay_opacity = COALESCE(?, overlay_opacity),
        button_text = COALESCE(?, button_text),
        badge = COALESCE(?, badge),
        link_type = COALESCE(?, link_type),
        target_product_id = COALESCE(?, target_product_id),
        target_category = COALESCE(?, target_category),
        target_sub_category = COALESCE(?, target_sub_category),
        custom_url = COALESCE(?, custom_url),
        price = COALESCE(?, price),
        original_price = COALESCE(?, original_price),
        accent_label = COALESCE(?, accent_label),
        display_order = COALESCE(?, display_order),
        active = COALESCE(?, active)
       WHERE id = ?`,
      [
        b.internalName ?? null, b.theme ?? null, b.eyebrow ?? null, b.categoryLabel ?? null,
        b.title ?? null, b.subtitle ?? null, legacyImage ?? null, desktopImage ?? null,
        tabletImage ?? null, mobileImage ?? null, mobileImage ?? null,
        b.overlayOpacity ?? null, b.buttonText ?? null, b.badge ?? null, b.linkType ?? null,
        b.targetProductId ?? null, b.targetCategory ?? null, b.targetSubCategory ?? null,
        b.customUrl ?? null, b.price ?? null, b.originalPrice ?? null, b.accentLabel ?? null,
        b.displayOrder ?? b.order ?? null, b.active ?? null, id
      ]
    );
    const [updated] = await query('SELECT * FROM hero_banners WHERE id = ?', [id]);
    res.json({ success: true, data: formatBannerRow(updated) });
  } catch (err) {
    next(err);
  }
}

export async function deleteHeroBanner(req, res, next) {
  try {
    const { id } = req.params;
    await query('DELETE FROM hero_banners WHERE id = ?', [id]);
    res.json({ success: true, message: `Hero banner ${id} deleted` });
  } catch (err) {
    next(err);
  }
}

// Promo Cards CRUD
export async function listPromoCards(req, res, next) {
  try {
    const rows = await query('SELECT * FROM promo_cards ORDER BY display_order ASC');
    const items = rows.map(formatPromoRow);
    res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    next(err);
  }
}

export async function createPromoCard(req, res, next) {
  try {
    const b = req.body;
    if (hasInlineMedia(b)) {
      return res.status(400).json({ success: false, message: 'Promo images must be uploaded as files; inline preview data cannot be saved.' });
    }
    const id = b.id || `promo-${Date.now()}`;
    await query(
      `INSERT INTO promo_cards
       (id, internal_name, tag, title, description, image, mobile_image_url, overlay_opacity,
        link_type, target_product_id, target_category, target_sub_category, custom_url,
        action_text, badge, display_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, b.internalName || null, b.tag || '', b.title || 'Untitled Promo', b.description || null,
        b.image || null, b.mobileImageUrl || null, b.overlayOpacity ?? 35, b.linkType || 'category',
        b.targetProductId || null, b.targetCategory || null, b.targetSubCategory || null,
        b.customUrl || null, b.actionText || 'Explore Collection', b.badge || null,
        b.displayOrder || b.order || 1, b.active !== false
      ]
    );
    const [created] = await query('SELECT * FROM promo_cards WHERE id = ?', [id]);
    res.status(201).json({ success: true, data: formatPromoRow(created) });
  } catch (err) {
    next(err);
  }
}

export async function updatePromoCard(req, res, next) {
  try {
    const { id } = req.params;
    const b = req.body;
    if (hasInlineMedia(b)) {
      return res.status(400).json({ success: false, message: 'Promo images must be uploaded as files; inline preview data cannot be saved.' });
    }
    await query(
      `UPDATE promo_cards SET
        internal_name = COALESCE(?, internal_name),
        tag = COALESCE(?, tag),
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        image = COALESCE(?, image),
        mobile_image_url = COALESCE(?, mobile_image_url),
        overlay_opacity = COALESCE(?, overlay_opacity),
        link_type = COALESCE(?, link_type),
        target_product_id = COALESCE(?, target_product_id),
        target_category = COALESCE(?, target_category),
        target_sub_category = COALESCE(?, target_sub_category),
        custom_url = COALESCE(?, custom_url),
        action_text = COALESCE(?, action_text),
        badge = COALESCE(?, badge),
        display_order = COALESCE(?, display_order),
        active = COALESCE(?, active)
       WHERE id = ?`,
      [
        b.internalName ?? null, b.tag ?? null, b.title ?? null, b.description ?? null,
        b.image ?? null, b.mobileImageUrl ?? null, b.overlayOpacity ?? null, b.linkType ?? null,
        b.targetProductId ?? null, b.targetCategory ?? null, b.targetSubCategory ?? null,
        b.customUrl ?? null, b.actionText ?? null, b.badge ?? null,
        b.displayOrder ?? b.order ?? null, b.active ?? null, id
      ]
    );
    const [updated] = await query('SELECT * FROM promo_cards WHERE id = ?', [id]);
    res.json({ success: true, data: formatPromoRow(updated) });
  } catch (err) {
    next(err);
  }
}

export async function deletePromoCard(req, res, next) {
  try {
    const { id } = req.params;
    await query('DELETE FROM promo_cards WHERE id = ?', [id]);
    res.json({ success: true, message: `Promo card ${id} deleted` });
  } catch (err) {
    next(err);
  }
}

// Trust indicator management
export async function listTrustIndicators(req, res, next) {
  try {
    const rows = await query('SELECT * FROM trust_indicators ORDER BY display_order ASC');
    const items = rows.map(formatTrustRow);
    res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    next(err);
  }
}

export async function createTrustIndicator(req, res, next) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const icon = typeof body.icon === 'string' ? body.icon.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!icon || !title) {
      return res.status(400).json({ success: false, message: 'Trust indicator icon and title are required.' });
    }

    const id = body.id || `trust-${Date.now()}`;
    await query(
      `INSERT INTO trust_indicators (id, icon, title, subtitle, display_order, active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, icon, title, body.subtitle || null, body.displayOrder || body.order || 1, body.active !== false]
    );
    const [created] = await query('SELECT * FROM trust_indicators WHERE id = ?', [id]);
    res.status(201).json({ success: true, data: formatTrustRow(created) });
  } catch (err) {
    next(err);
  }
}

export async function updateTrustIndicator(req, res, next) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    await query(
      `UPDATE trust_indicators SET
        icon = COALESCE(?, icon),
        title = COALESCE(?, title),
        subtitle = COALESCE(?, subtitle),
        display_order = COALESCE(?, display_order),
        active = COALESCE(?, active)
       WHERE id = ?`,
      [
        body.icon ?? null, body.title ?? null, body.subtitle ?? null,
        body.displayOrder ?? body.order ?? null, body.active ?? null, req.params.id
      ]
    );
    const [updated] = await query('SELECT * FROM trust_indicators WHERE id = ?', [req.params.id]);
    if (!updated) return res.status(404).json({ success: false, message: `Trust indicator "${req.params.id}" not found.` });
    res.json({ success: true, data: formatTrustRow(updated) });
  } catch (err) {
    next(err);
  }
}

export async function deleteTrustIndicator(req, res, next) {
  try {
    const [existing] = await query('SELECT id FROM trust_indicators WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ success: false, message: `Trust indicator "${req.params.id}" not found.` });
    await query('DELETE FROM trust_indicators WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: `Trust indicator ${req.params.id} deleted.` });
  } catch (err) {
    next(err);
  }
}

// Carousel Settings
export async function getCarouselSettings(req, res, next) {
  try {
    const [row] = await query('SELECT * FROM carousel_settings WHERE id = ? LIMIT 1', ['default']);
    if (!row) return res.json({ success: true, data: DEFAULT_CAROUSEL_SETTINGS });
    res.json({
      success: true,
      data: {
        autoPlay: Boolean(row.auto_play),
        slideDuration: Number(row.slide_duration),
        showArrows: Boolean(row.show_arrows),
        showIndicators: Boolean(row.show_indicators)
      }
    });
  } catch (err) {
    next(err);
  }
}

export async function updateCarouselSettings(req, res, next) {
  try {
    const { autoPlay, slideDuration, showArrows, showIndicators } = req.body;
    await query(
      `INSERT INTO carousel_settings (id, auto_play, slide_duration, show_arrows, show_indicators)
       VALUES ('default', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        auto_play = VALUES(auto_play),
        slide_duration = VALUES(slide_duration),
        show_arrows = VALUES(show_arrows),
        show_indicators = VALUES(show_indicators)`,
      [autoPlay !== false, Number(slideDuration) || 6500, showArrows !== false, showIndicators !== false]
    );
    res.json({
      success: true,
      data: {
        autoPlay: autoPlay !== false,
        slideDuration: Number(slideDuration) || 6500,
        showArrows: showArrows !== false,
        showIndicators: showIndicators !== false
      }
    });
  } catch (err) {
    next(err);
  }
}
