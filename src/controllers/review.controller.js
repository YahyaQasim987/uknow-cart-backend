import fs from 'node:fs/promises';
import { config } from '../config/env.js';
import { pool } from '../config/db.js';
import { logger } from '../utils/logger.js';

async function removeUploadedVideo(file) {
  if (!file) return;
  try {
    await fs.unlink(file.path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function hasValidVideoSignature(mimetype, header) {
  if (mimetype === 'video/webm') {
    return header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  }
  return ['video/mp4', 'video/quicktime'].includes(mimetype) &&
    header.subarray(4, 8).toString('ascii') === 'ftyp';
}

export class ReviewController {
  static formatReview(row) {
    if (!row) return null;
    const dateStr = row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString();

    return {
      id: row.id,
      productId: row.product_id,
      productName: row.product_name || undefined,
      userId: row.user_id || undefined,
      userName: row.user_name,
      userCity: row.user_city || 'Pakistan',
      rating: parseInt(row.rating, 10) || 5,
      comment: row.comment,
      date: dateStr,
      verifiedPurchase: !!row.verified_purchase,
      videoUrl: row.video_url || undefined,
      videoThumbnail: row.video_thumbnail || undefined,
      videoDuration: row.video_duration ? parseInt(row.video_duration, 10) : undefined,
      status: row.status || 'pending',
      // Backward-compatible properties
      product_id: row.product_id,
      user_name: row.user_name,
      user_city: row.user_city,
      verified_purchase: !!row.verified_purchase,
      video_url: row.video_url,
      video_duration: row.video_duration,
      created_at: dateStr
    };
  }

  /**
   * Public list of approved reviews for a product
   */
  static async listForProduct(req, res, next) {
    try {
      const { productId } = req.params;
      const [rows] = await pool.query(`
        SELECT id, product_id, product_name, user_id, user_name, user_city, rating, comment, verified_purchase, video_url, video_thumbnail, video_duration, status, created_at
        FROM reviews
        WHERE product_id = ? AND status = 'approved'
        ORDER BY created_at DESC
      `, [productId]);

      const reviews = rows.map(ReviewController.formatReview);
      res.json({ success: true, count: reviews.length, reviews });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Admin list of all reviews across statuses (pending, approved, rejected)
   */
  static async listAllAdmin(req, res, next) {
    try {
      const { status } = req.query;
      let sql = 'SELECT * FROM reviews WHERE 1=1';
      const params = [];

      if (status && status !== 'all') {
        sql += ' AND status = ?';
        params.push(status);
      }

      sql += ' ORDER BY created_at DESC LIMIT 100';

      const [rows] = await pool.query(sql, params);
      const reviews = rows.map(ReviewController.formatReview);
      res.json({ success: true, count: reviews.length, reviews });
    } catch (err) {
      next(err);
    }
  }

  /** Submit a verified buyer's video review for moderation. */
  static async submit(req, res, next) {
    let reviewSaved = false;
    try {
      const {
        productId,
        productName = '',
        rating,
        comment,
        videoThumbnail = '',
        videoDuration,
        userCity = 'Pakistan'
      } = req.body;

      const userId = req.user?.id;
      if (!userId) {
        await removeUploadedVideo(req.file);
        return res.status(401).json({
          success: false,
          message: 'Authentication required. Only verified buyers can submit a review.'
        });
      }

      const userName = req.user?.name || req.user?.full_name || req.body.userName;

      if (!productId || !rating || !comment || !userName) {
        await removeUploadedVideo(req.file);
        return res.status(400).json({
          success: false,
          message: 'Product ID, rating, comment, and your verified name are required.'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Upload a video review. Text-only reviews are not accepted.'
        });
      }

      const fileHandle = await fs.open(req.file.path, 'r');
      let header;
      try {
        header = Buffer.alloc(12);
        await fileHandle.read(header, 0, header.length, 0);
      } finally {
        await fileHandle.close();
      }
      if (!hasValidVideoSignature(req.file.mimetype, header)) {
        await removeUploadedVideo(req.file);
        return res.status(400).json({
          success: false,
          message: 'The uploaded file is not a valid MP4, WebM, or MOV video.'
        });
      }

      const duration = parseFloat(videoDuration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 30.5) {
        await removeUploadedVideo(req.file);
        return res.status(400).json({
          success: false,
          message: 'Review video duration must be greater than 0 and no longer than 30.5 seconds.'
        });
      }

      const [orderRows] = await pool.query(`
        SELECT o.id 
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        WHERE (o.user_id = ? OR o.customer_id = ?)
          AND oi.product_id = ? 
          AND o.order_status = 'delivered'
        LIMIT 1
      `, [userId, userId, productId]);

      if (orderRows.length === 0) {
        await removeUploadedVideo(req.file);
        return res.status(403).json({
          success: false,
          message: 'Review rejected. Only verified buyers who have received delivery of this item can submit a review.'
        });
      }

      const [existingReviews] = await pool.query(
        'SELECT id FROM reviews WHERE user_id = ? AND product_id = ?',
        [userId, productId]
      );
      if (existingReviews.length > 0) {
        await removeUploadedVideo(req.file);
        return res.status(409).json({
          success: false,
          message: 'You have already submitted a verified video review for this masterpiece.'
        });
      }

      const id = `rev-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
      const status = 'pending';
      const videoUrl = `${config.apiPublicUrl}/uploads/reviews/${encodeURIComponent(req.file.filename)}`;

      await pool.query(`
        INSERT INTO reviews (
          id, product_id, product_name, user_id, user_name, user_city,
          rating, comment, verified_purchase, video_url, video_thumbnail,
          video_duration, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?, ?)
      `, [
        id, productId, productName || null, userId, userName, userCity,
        Math.min(5, Math.max(1, parseInt(rating, 10))), comment.trim(),
        videoUrl, videoThumbnail || null, Math.round(duration), status
      ]);
      reviewSaved = true;

      res.status(201).json({
        success: true,
        message: 'Your 30-second verified unboxing review has been submitted for curator moderation.',
        review: ReviewController.formatReview({
          id,
          product_id: productId,
          product_name: productName,
          user_id: userId,
          user_name: userName,
          user_city: userCity,
          rating: parseInt(rating, 10),
          comment,
          verified_purchase: true,
          video_url: videoUrl,
          video_thumbnail: videoThumbnail,
          video_duration: Math.round(duration),
          status,
          created_at: new Date().toISOString()
        })
      });
    } catch (err) {
      if (!reviewSaved) {
        try {
          await removeUploadedVideo(req.file);
        } catch (cleanupError) {
          logger.error(`Failed to remove an unsubmitted review video: ${cleanupError.message}`);
          return next(cleanupError);
        }
      }
      next(err);
    }
  }

  /**
   * Admin Moderate Review Status
   */
  static async moderate(req, res, next) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid moderation status. Must be approved, rejected, or pending.' });
      }

      const [result] = await pool.query('UPDATE reviews SET status = ? WHERE id = ?', [status, id]);
      if (result.affectedRows === 0) {
        return res.status(404).json({ success: false, message: `Review "${id}" not found.` });
      }

      res.json({ success: true, message: `Review status updated to ${status}.` });
    } catch (err) {
      next(err);
    }
  }
}
