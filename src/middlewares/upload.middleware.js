import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';

const uploadsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');
export const storeLogoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads/logo');
export const privatePaymentProofsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../private-uploads/payment-proofs');
export const privateReceiptsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../private-uploads/receipts');
const acceptedTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/svg+xml', '.svg']
]);
const acceptedVideoTypes = new Map([
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov']
]);

export function getUploadStorageSegment(entity, id) {
  const prefixByEntity = {
    products: 'product-',
    categories: 'category-',
    subcategories: 'subcategory-',
    brands: 'brand-',
    refunds: 'refund-',
    banners: ''
  };
  const prefix = prefixByEntity[entity];
  if (prefix === undefined) throw new Error('Unsupported image upload destination.');
  const normalizedId = id.replace(/^(product|category|subcategory|brand)-/, '');
  return entity === 'banners' ? normalizedId : `${prefix}${normalizedId}`;
}

function getUploadPath(req) {
  if (req.params.productId && req.params.variantId) {
    const validIds = /^[a-zA-Z0-9_-]{1,100}$/;
    if (!validIds.test(req.params.productId) || !validIds.test(req.params.variantId)) {
      const error = new Error('Unsupported variant image upload destination.');
      error.statusCode = 400;
      error.isOperational = true;
      throw error;
    }
    const productSegment = getUploadStorageSegment('products', req.params.productId);
    const variantId = req.params.variantId.replace(/^var-/, '');
    return path.join(uploadsRoot, 'products', productSegment, `variant-${variantId}`);
  }

  const { entity, id, variant } = req.params;
  const validIds = /^[a-zA-Z0-9_-]{1,100}$/;
  const allowedVariants = {
    products: ['image', 'desktop', 'tablet', 'mobile'],
    categories: ['image'],
    subcategories: ['image'],
    brands: ['image'],
    refunds: ['receipt'],
    banners: ['image', 'desktop', 'tablet', 'mobile'],
    'promo-cards': ['image', 'mobile']
  };

  if (!validIds.test(id || '') || !allowedVariants[entity]?.includes(variant)) {
    const error = new Error('Unsupported image upload destination.');
    error.statusCode = 400;
    error.isOperational = true;
    throw error;
  }

  if (entity === 'promo-cards') {
    return path.join(uploadsRoot, 'banners', `promo-${id}`);
  }
  return path.join(uploadsRoot, entity, getUploadStorageSegment(entity, id));
}

const storage = multer.diskStorage({
  destination(req, file, callback) {
    try {
      const directory = getUploadPath(req);
      fs.mkdirSync(directory, { recursive: true });
      callback(null, directory);
    } catch (error) {
      callback(error);
    }
  },
  filename(req, file, callback) {
    const extension = acceptedTypes.get(file.mimetype);
    const name = req.params.productId
      ? `image-${crypto.randomUUID()}${extension}`
      : req.params.entity === 'banners'
      ? `${req.params.variant}${extension}`
      : `${req.params.variant}-${crypto.randomUUID()}${extension}`;
    callback(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (!acceptedTypes.has(file.mimetype)) {
      const error = new Error('Only JPEG, PNG, WebP, or GIF images up to 10 MB are allowed.');
      error.statusCode = 400;
      error.isOperational = true;
      return callback(error);
    }
    try {
      getUploadPath(req);
      callback(null, true);
    } catch (error) {
      callback(error);
    }
  }
});

export const uploadSingleImage = (req, res, next) => {
  upload.single('image')(req, res, error => {
    if (error) {
      if (error instanceof multer.MulterError) {
        error.statusCode = 400;
        error.isOperational = true;
        if (error.code === 'LIMIT_FILE_SIZE') error.message = 'Image must be no larger than 10 MB.';
      }
      return next(error);
    }
    next();
  });
};

const reviewVideoUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      const directory = path.join(uploadsRoot, 'reviews');
      try {
        fs.mkdirSync(directory, { recursive: true });
        callback(null, directory);
      } catch (error) {
        callback(error);
      }
    },
    filename(req, file, callback) {
      callback(null, `${crypto.randomUUID()}${acceptedVideoTypes.get(file.mimetype)}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (!acceptedVideoTypes.has(file.mimetype)) {
      const error = new Error('Only MP4, WebM, or MOV review videos up to 50 MB are allowed.');
      error.statusCode = 400;
      error.isOperational = true;
      return callback(error);
    }
    callback(null, true);
  }
});

export const uploadReviewVideo = (req, res, next) => {
  reviewVideoUpload.single('video')(req, res, error => {
    if (error) {
      if (error instanceof multer.MulterError) {
        error.statusCode = 400;
        error.isOperational = true;
        if (error.code === 'LIMIT_FILE_SIZE') error.message = 'Review video must be no larger than 50 MB.';
      }
      return next(error);
    }
    next();
  });
};

const paymentProofUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      try {
        fs.mkdirSync(privatePaymentProofsRoot, { recursive: true });
        callback(null, privatePaymentProofsRoot);
      } catch (error) {
        callback(error);
      }
    },
    filename(req, file, callback) {
      callback(null, `${crypto.randomUUID()}${acceptedTypes.get(file.mimetype)}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Payment proof must be a JPG, JPEG, PNG, or WEBP image up to 5 MB.');
      error.statusCode = 400;
      error.isOperational = true;
      return callback(error);
    }
    callback(null, true);
  }
});

export const uploadPaymentProof = (req, res, next) => {
  paymentProofUpload.single('image')(req, res, error => {
    if (error) {
      if (error instanceof multer.MulterError) {
        error.statusCode = 400;
        error.isOperational = true;
        if (error.code === 'LIMIT_FILE_SIZE') error.message = 'Payment proof image must be no larger than 5 MB.';
        if (error.code === 'LIMIT_FILE_COUNT') error.message = 'Exactly one payment proof image is allowed.';
      }
      return next(error);
    }
    next();
  });
};

const expenseReceiptUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      try {
        fs.mkdirSync(privateReceiptsRoot, { recursive: true });
        callback(null, privateReceiptsRoot);
      } catch (error) {
        callback(error);
      }
    },
    filename(req, file, callback) {
      const ext = acceptedTypes.get(file.mimetype) || (file.mimetype === 'application/pdf' ? '.pdf' : '.jpg');
      callback(null, `receipt-${crypto.randomUUID()}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'].includes(file.mimetype)) {
      const error = new Error('Receipt must be a JPG, PNG, WebP, GIF image or PDF up to 10 MB.');
      error.statusCode = 400;
      error.isOperational = true;
      return callback(error);
    }
    callback(null, true);
  }
});

export const uploadExpenseReceipt = (req, res, next) => {
  expenseReceiptUpload.single('receipt')(req, res, error => {
    if (error) {
      if (error instanceof multer.MulterError) {
        error.statusCode = 400;
        error.isOperational = true;
        if (error.code === 'LIMIT_FILE_SIZE') error.message = 'Receipt must be no larger than 10 MB.';
        if (error.code === 'LIMIT_FILE_COUNT') error.message = 'Only one receipt file is allowed per transaction.';
      }
      return next(error);
    }
    next();
  });
};

const logoStorage = multer.diskStorage({
  destination(req, file, callback) {
    try {
      fs.mkdirSync(storeLogoRoot, { recursive: true });
      callback(null, storeLogoRoot);
    } catch (error) {
      callback(error);
    }
  },
  filename(req, file, callback) {
    const ext = acceptedTypes.get(file.mimetype) || (file.mimetype === 'image/svg+xml' ? '.svg' : path.extname(file.originalname) || '.png');
    callback(null, `store-logo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});

const logoMulter = multer({
  storage: logoStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (!allowed.includes(file.mimetype) && !/\.(jpe?g|png|webp|gif|svg)$/i.test(file.originalname || '')) {
      const error = new Error('Logo must be a JPG, PNG, WebP, GIF, or SVG image up to 10 MB.');
      error.statusCode = 400;
      error.isOperational = true;
      return callback(error);
    }
    callback(null, true);
  }
});

const logoUploadFields = logoMulter.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]);

export const uploadStoreLogo = (req, res, next) => {
  logoUploadFields(req, res, error => {
    if (error) {
      if (error instanceof multer.MulterError) {
        error.statusCode = 400;
        error.isOperational = true;
        if (error.code === 'LIMIT_FILE_SIZE') error.message = 'Logo image must be no larger than 10 MB.';
        if (error.code === 'LIMIT_FILE_COUNT') error.message = 'Only one logo image file can be uploaded at a time.';
      }
      return next(error);
    }
    const uploaded = req.files?.logo?.[0] || req.files?.image?.[0] || req.files?.file?.[0];
    if (uploaded) {
      req.file = uploaded;
    }
    next();
  });
};

export { uploadsRoot };
