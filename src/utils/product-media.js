import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../config/db.js';
import { config } from '../config/env.js';
import { logger } from './logger.js';
import { uploadsRoot } from '../middlewares/upload.middleware.js';

const escapeLike = value => value.replace(/[\\%_]/g, '\\$&');

function getPublicOrigin() {
  try {
    return new URL(config.apiPublicUrl).origin;
  } catch {
    return '';
  }
}

/**
 * Returns a stable comparison key for media URLs so relative `/uploads/...`
 * paths (rewritten for HTTPS dev proxy) match stored `${apiPublicUrl}/uploads/...`
 * URLs, while external URLs are preserved verbatim.
 */
export function toCanonicalMediaKey(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/uploads/')) {
    return trimmed.split('?')[0];
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      const publicOrigin = getPublicOrigin();
      if ((isLocalHost || (publicOrigin && parsed.origin === publicOrigin)) && parsed.pathname.startsWith('/uploads/')) {
        return parsed.pathname;
      }
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/** Extracts the `/uploads/...` path portion from a local upload URL, if present. */
function extractUploadSuffix(url) {
  if (typeof url !== 'string') return null;
  const markerIndex = url.indexOf('/uploads/');
  if (markerIndex < 0) return null;
  const suffix = url.slice(markerIndex).split('?')[0];
  return suffix.length > '/uploads/'.length ? suffix : null;
}

/** Filesystem folder used by multer for one product's gallery, variant and banner files. */
export function getProductUploadDirectory(productId) {
  const normalizedId = String(productId ?? '').replace(/^(product|category|subcategory|brand)-/, '');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(normalizedId)) return null;
  return path.join(uploadsRoot, 'products', `product-${normalizedId}`);
}

/** Removes the whole product upload folder (gallery + variants + banners). */
export async function removeProductUploads(productId) {
  const directory = getProductUploadDirectory(productId);
  if (!directory) return;
  const productsRoot = path.resolve(uploadsRoot, 'products');
  const target = path.resolve(directory);
  if (!target.startsWith(productsRoot + path.sep)) return;
  await fs.rm(target, { recursive: true, force: true });
}

/** Resolves a public `/uploads/...` URL to a file inside the uploads root. */
export function resolveUploadedFilePath(url) {
  if (typeof url !== 'string') return null;
  const marker = '/uploads/';
  const markerIndex = url.indexOf(marker);
  if (markerIndex < 0) return null;
  let relativePath;
  try {
    relativePath = decodeURIComponent(url.slice(markerIndex + marker.length).split('?')[0]);
  } catch {
    return null;
  }
  if (!relativePath) return null;
  const root = path.resolve(uploadsRoot);
  const target = path.resolve(root, relativePath);
  if (!target.startsWith(root + path.sep)) return null;
  return target;
}

/** Removes one uploaded file referenced by a public `/uploads/...` URL. */
export async function removeUploadedFileByUrl(url) {
  const target = resolveUploadedFilePath(url);
  if (!target) return;
  await fs.unlink(target).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}

/**
 * Deletes a file only when no database row still points at it. Product images
 * may be shared by a gallery, a banner, a variant or even a promotion, so a
 * simple "removed from this form" check is not enough.
 */
export async function isUploadedFileReferenced(url, executor = pool) {
  if (!resolveUploadedFilePath(url)) return false;
  const uploadSuffix = extractUploadSuffix(url);
  if (!uploadSuffix) return false;
  // Match both exact URLs and any origin prefix (e.g. `http://localhost:4100/uploads/...`
  // vs relative `/uploads/...`). LIKE is conservative for JSON arrays too.
  const exactSuffixPattern = `%${escapeLike(uploadSuffix)}`;
  const jsonContainsPattern = `%${escapeLike(uploadSuffix)}%`;
  const anyMatch = columns => ({
    sql: `SELECT 1 FROM ${columns.table} WHERE ${columns.cols.map(col => `${col} = ? OR ${col} LIKE ?`).join(' OR ')}`,
    params: columns.cols.flatMap(() => [url, exactSuffixPattern])
  });
  const checks = [
    anyMatch({ table: 'product_images', cols: ['image_url'] }),
    {
      sql: 'SELECT 1 FROM product_variants WHERE image_url = ? OR image_url LIKE ? OR images LIKE ?',
      params: [url, exactSuffixPattern, jsonContainsPattern]
    },
    anyMatch({
      table: 'products',
      cols: [
        'banner_image', 'banner_desktop_image', 'banner_tablet_image',
        'banner_mobile_image', 'hover_image', 'video_url', 'hover_video_url'
      ]
    }),
    anyMatch({
      table: 'hero_banners',
      cols: ['image', 'desktop_image', 'tablet_image', 'mobile_image', 'mobile_image_url']
    }),
    anyMatch({ table: 'promo_cards', cols: ['image', 'mobile_image_url'] }),
    anyMatch({ table: 'categories', cols: ['image_url'] }),
    anyMatch({ table: 'sub_categories', cols: ['image_url'] }),
    anyMatch({ table: 'brands', cols: ['image_url'] }),
    anyMatch({ table: 'store_ads', cols: ['image_url', 'mobile_image_url'] }),
    anyMatch({ table: 'broadcast_messages', cols: ['image_url'] }),
    anyMatch({ table: 'order_items', cols: ['image_url'] })
  ];
  try {
    const [rows] = await executor.query(
      `${checks.map(check => check.sql).join('\nUNION ALL ')} LIMIT 1`,
      checks.flatMap(check => check.params)
    );
    return rows.length > 0;
  } catch (error) {
    // Keeping an unreferenced file is safer than deleting a live one when a
    // legacy installation is missing one of the optional media tables.
    logger.warn('Could not verify uploaded-file references; keeping the file.', {
      url,
      message: error.message
    });
    return true;
  }
}

/** Deletes each local file that is no longer referenced anywhere in the database. */
export async function removeUploadedFilesIfUnreferenced(urls, executor = pool) {
  const unique = [...new Set((Array.isArray(urls) ? urls : []).filter(Boolean))];
  const removed = [];
  for (const url of unique) {
    if (await isUploadedFileReferenced(url, executor)) continue;
    await removeUploadedFileByUrl(url);
    removed.push(url);
  }
  return removed;
}
