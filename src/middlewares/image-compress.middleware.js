import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { logger } from '../utils/logger.js';

/**
 * Lossless-quality image optimizer for every multer image upload.
 *
 * - Resizes oversized photos to a 1600px bounding box (no upscaling).
 * - Re-encodes JPEG / PNG / WebP with quality-preserving settings so the
 *   picture still looks sharp while the payload shrinks dramatically.
 * - Animated GIFs, SVGs and PDFs are left untouched.
 * - Compression failure never blocks the upload; the original file is kept.
 */
const OPTIMIZABLE_TYPES = new Map([
  ['image/jpeg', 'jpeg'],
  ['image/jpg', 'jpeg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

const MAX_DIMENSION = Number(process.env.UPLOAD_IMAGE_MAX_DIMENSION || 1600);

async function optimizeFile(file) {
  if (!file?.path || !OPTIMIZABLE_TYPES.has(file.mimetype)) return;
  const format = OPTIMIZABLE_TYPES.get(file.mimetype);
  const temporaryPath = path.join(
    path.dirname(file.path),
    `.${path.basename(file.path)}.${Date.now()}.opt`
  );

  try {
    const pipeline = sharp(file.path, { failOn: 'none', animated: false })
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true
      });

    if (format === 'jpeg') {
      pipeline.jpeg({ quality: 85, mozjpeg: true, progressive: true, chromaSubsampling: '4:4:4' });
    } else if (format === 'png') {
      pipeline.png({ compressionLevel: 9, palette: true, quality: 90, effort: 7 });
    } else {
      pipeline.webp({ quality: 85, effort: 4 });
    }

    await pipeline.toFile(temporaryPath);

    const [originalStats, optimizedStats] = await Promise.all([
      fs.stat(file.path),
      fs.stat(temporaryPath)
    ]);

    // Keep the original only if optimization made the file larger.
    if (optimizedStats.size > 0 && optimizedStats.size < originalStats.size) {
      await fs.rename(temporaryPath, file.path);
      file.size = optimizedStats.size;
      file.compressed = true;
      logger.info(`Optimized upload ${path.basename(file.path)}: ${originalStats.size} → ${optimizedStats.size} bytes.`);
    } else {
      await fs.unlink(temporaryPath).catch(() => {});
      file.compressed = false;
    }
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    file.compressed = false;
    logger.warn(`Image optimization skipped for ${file?.filename || 'upload'}: ${error.message}`);
  }
}

export const optimizeUploadedImages = async (req, res, next) => {
  try {
    const files = [];
    if (req.file) files.push(req.file);
    if (req.files) {
      if (Array.isArray(req.files)) {
        files.push(...req.files);
      } else {
        for (const group of Object.values(req.files)) {
          if (Array.isArray(group)) files.push(...group);
        }
      }
    }
    // Sequential processing keeps CPU spikes predictable for large galleries.
    for (const file of files) {
      await optimizeFile(file);
    }
    next();
  } catch (error) {
    next(error);
  }
};
