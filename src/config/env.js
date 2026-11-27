import dotenv from 'dotenv';
dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || (nodeEnv === 'production' ? '' : 'super-secret-atelier-uknow-jwt-key-change-in-production');
const serverPort = parseInt(process.env.BACKEND_PORT || (process.env.PORT && process.env.PORT !== '8080' && process.env.PORT !== '3000' ? process.env.PORT : '4000'), 10);
const apiPublicUrl = process.env.API_PUBLIC_URL || `http://localhost:${serverPort}`;

if (nodeEnv === 'production' && (!jwtSecret || jwtSecret.includes('super-secret-atelier-uknow-jwt-key'))) {
  throw new Error('FATAL SECURITY CONFIGURATION: In production, JWT_SECRET must be explicitly provided and cannot use the development placeholder.');
}
if (nodeEnv === 'production' && new URL(apiPublicUrl).protocol !== 'https:') {
  throw new Error('FATAL MEDIA CONFIGURATION: API_PUBLIC_URL must use HTTPS in production to prevent mixed-content media URLs.');
}

const rawOrigins = process.env.ALLOWED_ORIGINS || process.env.CLIENT_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000';
const allowedOrigins = rawOrigins
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

export const config = {
  port: serverPort,
  nodeEnv,
  env: nodeEnv,
  clientOrigin: allowedOrigins[0] || 'http://localhost:3000',
  allowedOrigins,
  apiPublicUrl,

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'uknow_store',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
    queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '0', 10),
    waitForConnections: process.env.DB_WAIT_FOR_CONNECTIONS !== 'false',
    // TiDB Cloud / managed MySQL requires TLS. Provide the CA bundle path
    // (relative to the backend folder) to verify the server certificate.
    sslCa: process.env.DB_SSL_CA || process.env.DB_SSL_CA_PATH || '',
    sslRejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
  },

  jwt: {
    secret: jwtSecret || 'super-secret-atelier-uknow-jwt-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  mail: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || ''
  },
  mailConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && (process.env.MAIL_FROM || process.env.SMTP_USER)),
  oauth: {
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    facebookAppId: process.env.FACEBOOK_APP_ID || '',
    facebookAppSecret: process.env.FACEBOOK_APP_SECRET || ''
  },
  // Alias for backward-compatibility
  jwtSecret: jwtSecret || 'super-secret-atelier-uknow-jwt-key-change-in-production',

  pricing: {
    standardShippingFee: parseFloat(process.env.DEFAULT_STANDARD_SHIPPING_FEE || '350'),
    freeShippingThreshold: parseFloat(process.env.DEFAULT_FREE_SHIPPING_THRESHOLD || '999999999'),
    urgentShippingFee: parseFloat(process.env.DEFAULT_URGENT_SHIPPING_FEE || '600')
  },

  expiry: {
    presenceHiddenMinutes: parseInt(process.env.PRESENCE_HIDDEN_EXPIRY_MINUTES || '15', 10)
  }
};
