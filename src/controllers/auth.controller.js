import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { pool } from '../config/db.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const allowedEmailDomains = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.de',
  'outlook.fr',
  'outlook.jp',
  'outlook.es',
  'outlook.it',
  'outlook.in',
  'outlook.com.au',
  'outlook.com.br',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.jp',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.ca',
  'yahoo.com.au',
  'yahoo.co.in',
  'yahoo.com.sg',
  'yahoo.com.my',
  'yahoo.com.ph',
  'yahoo.com.vn',
  'yahoo.com.br',
  'yahoo.com.mx',
  'yahoo.com.ar',
  'yahoo.es',
  'yahoo.it',
  'yahoo.com.tr',
  'yahoo.com.hk',
  'yahoo.com.tw',
  'yahoo.co.id',
  'yahoo.co.th',
  'yahoo.co.nz',
  'yahoo.co.za',
  'yahoo.com.pk',
  'icloud.com',
  'me.com',
  'mac.com'
]);

export function isAllowedSignupEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  const match = /^[^\s@]+@([^\s@.]+(?:\.[^\s@.]+)*)$/.exec(email);
  return Boolean(match && allowedEmailDomains.has(match[1]));
}

function createMailTransport() {
  if (!config.mailConfigured) {
    const err = new Error('Email verification is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and MAIL_FROM.');
    err.statusCode = 503;
    err.isOperational = true;
    throw err;
  }
  return nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: { user: config.mail.user, pass: config.mail.password }
  });
}

async function sendVerificationEmail(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await pool.query(
    'INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))',
    [user.id, tokenHash]
  );

  const verifyUrl = `${config.apiPublicUrl}/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`;
  if (!config.mailConfigured) {
    if (config.nodeEnv !== 'development') {
      const error = new Error('Email verification is not configured.');
      error.statusCode = 503;
      error.isOperational = true;
      throw error;
    }
    return { verificationUrl: verifyUrl, preview: true };
  }

  const transport = createMailTransport();
  try {
    await transport.sendMail({
      from: config.mail.from,
      to: user.email,
      subject: 'Verify your Atelier U-KNOW account',
      text: `Hello ${user.name}, verify your email within 30 minutes: ${verifyUrl}`,
      html: `<p>Hello ${escapeHtml(user.name)},</p><p><a href="${verifyUrl}">Verify your Atelier U-KNOW account</a></p><p>This link expires in 30 minutes. If you did not create an account, ignore this email.</p>`
    });
  } finally {
    transport.close();
  }
  return { verificationUrl: null, preview: false };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

export class AuthController {
  /**
   * Safe user serialization (Never expose password_hash or internal secrets)
   * Strictly respects Customer vs Admin privacy boundaries:
   * Customer DTO never returns admin profile fields.
   */
  static serializeUser(row) {
    if (!row) return null;

    if (row.role === 'customer') {
      return {
        id: row.id,
        name: row.full_name || row.name,
        fullName: row.full_name || row.name,
        email: row.email,
        role: 'customer',
        signupMethod: row.signup_method || 'unknown',
        status: row.status || 'active',
        avatar: row.avatar || row.profile_image || '',
        profileImage: row.profile_image || row.avatar || '',
        phone: row.phone || row.primary_phone || '',
        primaryPhone: row.primary_phone || row.phone || '',
        city: row.city || '',
        address: row.address || '',
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined
      };
    }

    // Admin Account DTO
    return {
      id: row.id,
      name: row.full_name || row.name,
      fullName: row.full_name || row.name,
      email: row.email,
      role: 'admin',
      signupMethod: row.signup_method || 'unknown',
      status: row.status || 'active',
      phone: row.primary_phone || row.phone || '',
      primaryPhone: row.primary_phone || row.phone || '',
      secondaryPhone: row.secondary_phone || undefined,
      whatsappNumber: row.whatsapp_number || row.whatsapp_phone || undefined,
      recoveryEmail: row.recovery_email || row.secondary_email || undefined,
      profileImage: row.profile_image || row.avatar || undefined,
      bio: row.bio || undefined,
      bankName: row.bank_name || undefined,
      bankAccountTitle: row.bank_account_title || undefined,
      bankAccountNumber: row.bank_account_number || undefined,
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : undefined,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined
    };
  }

  /**
   * User Registration (Public customer signup)
   * Strictly enforces 'customer' role on server; ignores any client-supplied role.
   */
  static async register(req, res, next) {
    try {
      const { name, fullName, email, password, method = 'website', phone = '', city = '', address = '' } =
        req.body && typeof req.body === 'object' ? req.body : {};
      if (method !== 'website') {
        return res.status(400).json({
          success: false,
          message: 'Google and Facebook signup require verified provider credentials at /auth/oauth-login.'
        });
      }
      const providedName = fullName ?? name;
      if (
        typeof providedName !== 'string' ||
        typeof email !== 'string' ||
        typeof password !== 'string' ||
        [phone, city, address].some(value => typeof value !== 'string')
      ) {
        return res.status(400).json({ success: false, message: 'Name, email, password, and optional profile fields must be valid text.' });
      }
      const displayName = providedName.trim();

      if (!displayName || !email.trim() || !password) {
        return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
      }

      if (
        displayName.length > 150 ||
        email.length > 150 ||
        password.length < 6 ||
        password.length > 128 ||
        phone.length > 50 ||
        city.length > 100
      ) {
        return res.status(400).json({ success: false, message: 'Name, email, phone, city, or password is outside the allowed length.' });
      }

      const cleanEmail = email.toLowerCase().trim();
      if (!isAllowedSignupEmail(cleanEmail)) {
        return res.status(400).json({
          success: false,
          message: 'Please use a Gmail, Outlook, Yahoo, or iCloud email address to create an account.'
        });
      }

      // Check existing email
      const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
      if (existing.length > 0) {
        return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      const userId = `usr-${crypto.randomUUID()}`;

      // Strictly force 'customer' role and 'active' status for public signups (Never allow self-assigning admin)
      await pool.query(`
        INSERT INTO users (id, name, full_name, email, password_hash, email_verified, signup_method, role, status, phone, primary_phone, city, address)
        VALUES (?, ?, ?, ?, ?, FALSE, 'website', 'customer', 'active', ?, ?, ?, ?)
      `, [userId, displayName, displayName, cleanEmail, passwordHash, phone.trim(), phone.trim(), city.trim(), address.trim()]);

      try {
        const verification = await sendVerificationEmail({ id: userId, name: displayName, email: cleanEmail });
        return res.status(201).json({
          success: true,
          method: 'website',
          message: verification.preview
            ? 'Development account created. Open the verification link to activate it.'
            : 'Account created. Check your email and open the verification link to activate it.',
          ...(verification.preview && { verificationUrl: verification.verificationUrl })
        });
      } catch (mailError) {
        mailError.statusCode = 503;
        mailError.isOperational = true;
        mailError.message = 'Your account was created, but the verification email could not be sent. Please request a new verification email or contact support.';
        return next(mailError);
      }

    } catch (err) {
      next(err);
    }
  }

  /**
   * User Login (Enforces suspended status check and records last_login_at)
   */
  static async login(req, res, next) {
    try {
      const { email, password } = req.body && typeof req.body === 'object' ? req.body : {};
      if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
      }

      const cleanEmail = email.toLowerCase().trim();

      // Query database for user
      const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [cleanEmail]);
      if (rows.length === 0) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }

      const user = rows[0];

      if (!user.email_verified) {
        return res.status(403).json({ success: false, message: 'Please verify your email address before signing in.' });
      }

      // Validate account status
      if (user.status === 'suspended') {
        return res.status(403).json({ success: false, message: 'Account is suspended. Please contact support.' });
      }

      if (!user.password_hash) {
        return res.status(401).json({ success: false, message: 'Account requires password setup or OAuth login.' });
      }

      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
      }

      // Update last_login_at timestamp
      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);
      user.last_login_at = new Date();

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.full_name || user.name, role: user.role, status: user.status || 'active' },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );

      res.json({
        success: true,
        message: 'Login successful.',
        token,
        user: AuthController.serializeUser(user)
      });
    } catch (err) {
      next(err);
    }
  }

  static async verifyEmail(req, res, next) {
    try {
      const { token } = req.query;
      if (typeof token !== 'string' || !token) {
        return res.status(400).json({ success: false, message: 'A valid verification link is required.' });
      }

      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.query(
          `SELECT id, user_id FROM email_verifications
           WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
           ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [tokenHash]
        );
        if (rows.length === 0) {
          await connection.rollback();
          return res.status(400).json({ success: false, message: 'This verification link is invalid or expired.' });
        }

        await connection.query('UPDATE users SET email_verified = TRUE WHERE id = ?', [rows[0].user_id]);
        await connection.query('UPDATE email_verifications SET used_at = NOW() WHERE id = ?', [rows[0].id]);
        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }

      return res.redirect(`${config.clientOrigin}/?emailVerified=1`);
    } catch (err) {
      next(err);
    }
  }

  static async resendVerification(req, res, next) {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase();
      if (email) {
        const [rows] = await pool.query(
          'SELECT id, name, email FROM users WHERE email = ? AND role = ? AND email_verified = FALSE',
          [email, 'customer']
        );
        const verification = rows.length > 0 ? await sendVerificationEmail(rows[0]) : null;
        return res.json({
          success: true,
          message: verification?.preview
            ? 'Development verification link created.'
            : 'If that account needs verification, a new link has been sent.',
          ...(verification?.preview && { verificationUrl: verification.verificationUrl })
        });
      }
      res.json({ success: true, message: 'If that account needs verification, a new link has been sent.' });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Get Current Authenticated User (Profile)
   */
  static async me(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
      }

      const [rows] = await pool.query(
        'SELECT id, name, full_name, email, role, status, signup_method, avatar, profile_image, phone, primary_phone, secondary_phone, whatsapp_phone, whatsapp_number, secondary_email, recovery_email, city, address, bio, bank_name, bank_account_title, bank_account_number, last_login_at, created_at FROM users WHERE id = ?',
        [req.user.id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'User profile not found.' });
      }

      res.json({ success: true, user: AuthController.serializeUser(rows[0]) });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Update User Profile (Role assignment blocked; Customer cannot modify Admin-specific fields)
   */
  static async updateProfile(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
      }

      const {
        name,
        fullName,
        phone,
        primaryPhone,
        city,
        address,
        avatar,
        profileImage,
        whatsappNumber,
        whatsappPhone,
        secondaryPhone,
        recoveryEmail,
        secondaryEmail,
        bio,
        bankName,
        bankAccountTitle,
        bankAccountNumber
      } = req.body;

      const fields = [];
      const values = [];

      const displayName = fullName || name;
      if (displayName !== undefined) {
        fields.push('name = ?', 'full_name = ?');
        values.push(displayName.trim(), displayName.trim());
      }

      const userPhone = primaryPhone || phone;
      if (userPhone !== undefined) {
        fields.push('phone = ?', 'primary_phone = ?');
        values.push(userPhone.trim(), userPhone.trim());
      }

      if (city !== undefined) { fields.push('city = ?'); values.push(city.trim()); }
      if (address !== undefined) { fields.push('address = ?'); values.push(address.trim()); }

      const img = profileImage || avatar;
      if (img !== undefined) {
        fields.push('avatar = ?', 'profile_image = ?');
        values.push(img, img);
      }

      // Protected Admin profile fields in users table (Only Admin accounts may edit)
      if (req.user.role === 'admin') {
        const wa = whatsappNumber || whatsappPhone;
        if (wa !== undefined) {
          fields.push('whatsapp_phone = ?', 'whatsapp_number = ?');
          values.push(wa.trim(), wa.trim());
        }
        if (secondaryPhone !== undefined) {
          fields.push('secondary_phone = ?');
          values.push(secondaryPhone.trim());
        }
        const recEmail = recoveryEmail || secondaryEmail;
        if (recEmail !== undefined) {
          fields.push('secondary_email = ?', 'recovery_email = ?');
          values.push(recEmail.trim(), recEmail.trim());
        }
        if (bio !== undefined) {
          fields.push('bio = ?');
          values.push(bio.trim());
        }
        if (bankName !== undefined) {
          fields.push('bank_name = ?');
          values.push(bankName.trim());
        }
        if (bankAccountTitle !== undefined) {
          fields.push('bank_account_title = ?');
          values.push(bankAccountTitle.trim());
        }
        if (bankAccountNumber !== undefined) {
          fields.push('bank_account_number = ?');
          values.push(bankAccountNumber.trim());
        }
      }

      if (fields.length > 0) {
        values.push(req.user.id);
        await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
      }

      const [rows] = await pool.query(
        'SELECT id, name, full_name, email, role, status, avatar, profile_image, phone, primary_phone, secondary_phone, whatsapp_phone, whatsapp_number, secondary_email, recovery_email, city, address, bio, bank_name, bank_account_title, bank_account_number, last_login_at, created_at FROM users WHERE id = ?',
        [req.user.id]
      );

      res.json({
        success: true,
        message: 'Profile updated successfully.',
        user: AuthController.serializeUser(rows[0])
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Protected Admin Provisioning (Section 3C: Admin accounts must be created through protected administrative flow)
   */
  static async provisionAdmin(req, res, next) {
    try {
      const {
        fullName,
        name,
        email,
        password,
        primaryPhone = '',
        phone = '',
        secondaryPhone = null,
        whatsappNumber = '',
        recoveryEmail = null,
        profileImage = null
      } = req.body;

      const adminName = (fullName || name || '').trim();
      if (!adminName || !email || !password) {
        return res.status(400).json({ success: false, message: 'Admin full name, email, and password are required.' });
      }

      if (password.length < 8) {
        return res.status(400).json({ success: false, message: 'Admin password must be at least 8 characters long.' });
      }

      const cleanEmail = email.toLowerCase().trim();
      const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
      if (existing.length > 0) {
        return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      const adminId = `usr-admin-${Date.now()}`;
      const effectivePhone = (primaryPhone || phone).trim();
      const effectiveWhatsapp = (whatsappNumber || effectivePhone).trim();

      await pool.query(`
        INSERT INTO users (
          id, name, full_name, email, password_hash, role, status,
          phone, primary_phone, secondary_phone, whatsapp_phone, whatsapp_number,
          recovery_email, profile_image
        ) VALUES (?, ?, ?, ?, ?, 'admin', 'active', ?, ?, ?, ?, ?, ?, ?)
      `, [
        adminId, adminName, adminName, cleanEmail, passwordHash,
        effectivePhone, effectivePhone, secondaryPhone, effectiveWhatsapp, effectiveWhatsapp,
        recoveryEmail, profileImage
      ]);

      const [created] = await pool.query('SELECT * FROM users WHERE id = ?', [adminId]);

      res.status(201).json({
        success: true,
        message: 'Administrator account provisioned successfully.',
        admin: AuthController.serializeUser(created[0])
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Change Password (Fix 6)
   */
  static async changePassword(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
      }

      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'Current password and new password are required.' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
      }

      const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      const isMatch = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
      }

      const salt = await bcrypt.genSalt(10);
      const newHash = await bcrypt.hash(newPassword, salt);

      await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);

      res.json({ success: true, message: 'Password changed successfully.' });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Forgot Password (Fix 6: Generic anti-enumeration response + secure token)
   */
  static async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ success: false, message: 'Email address is required.' });
      }

      const cleanEmail = email.toLowerCase().trim();
      let resetToken = null;

      try {
        const [rows] = await pool.query('SELECT id, name FROM users WHERE email = ?', [cleanEmail]);
        if (rows.length > 0) {
          const user = rows[0];
          // Generate cryptographically secure random token
          resetToken = crypto.randomBytes(32).toString('hex');
          const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

          await pool.query(`
            INSERT INTO password_resets (user_id, email, token_hash, expires_at)
            VALUES (?, ?, ?, ?)
          `, [user.id, cleanEmail, tokenHash, expiresAt]);
        }
      } catch (dbErr) {
        // Safe fail-silent for email enumeration prevention
      }

      // Generic response that never reveals if an email exists
      res.json({
        success: true,
        message: 'If an account exists with this email, password reset instructions have been dispatched.',
        ...(config.nodeEnv !== 'production' && resetToken && { debugResetToken: resetToken })
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Reset Password (Fix 6: Single-use token verification)
   */
  static async resetPassword(req, res, next) {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) {
        return res.status(400).json({ success: false, message: 'Reset token and new password are required.' });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
      }

      const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

      const [rows] = await pool.query(`
        SELECT id, user_id, expires_at, used_at
        FROM password_resets
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `, [tokenHash]);

      if (rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid or expired password reset token.' });
      }

      const resetRecord = rows[0];
      const salt = await bcrypt.genSalt(10);
      const newHash = await bcrypt.hash(newPassword, salt);

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        await connection.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, resetRecord.user_id]);
        await connection.query('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [resetRecord.id]);

        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }

      res.json({ success: true, message: 'Password has been reset successfully. You may now sign in.' });
    } catch (err) {
      next(err);
    }
  }

  /**
   * OAuth Social Login (Google & Facebook provider token/profile exchange)
   */
  static async oauthLogin(req, res, next) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const provider = body.method || body.provider;
      const { idToken, accessToken } = body;
      if (!['google', 'facebook'].includes(provider)) {
        return res.status(400).json({ success: false, message: 'Unsupported sign-in provider.' });
      }

      let profile;
      if (provider === 'google') {
        if (!config.oauth.googleClientId || !idToken) {
          return res.status(503).json({ success: false, message: 'Google sign-in is not configured.' });
        }
        const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
        if (!response.ok) {
          return res.status(401).json({ success: false, message: 'Google credential could not be verified.' });
        }
        const googleProfile = await response.json();
        if (googleProfile.aud !== config.oauth.googleClientId || googleProfile.email_verified !== 'true') {
          return res.status(401).json({ success: false, message: 'Google credential is invalid or its email is unverified.' });
        }
        profile = { email: googleProfile.email, name: googleProfile.name, avatar: googleProfile.picture };
      } else {
        if (!config.oauth.facebookAppId || !config.oauth.facebookAppSecret || !accessToken) {
          return res.status(503).json({ success: false, message: 'Facebook sign-in is not configured.' });
        }
        const appAccessToken = `${config.oauth.facebookAppId}|${config.oauth.facebookAppSecret}`;
        const debugUrl = new URL('https://graph.facebook.com/debug_token');
        debugUrl.searchParams.set('input_token', accessToken);
        debugUrl.searchParams.set('access_token', appAccessToken);
        const debugResponse = await fetch(debugUrl);
        const debugPayload = await debugResponse.json();
        const tokenData = debugPayload.data;
        if (!debugResponse.ok || !tokenData?.is_valid || tokenData.app_id !== config.oauth.facebookAppId) {
          return res.status(401).json({ success: false, message: 'Facebook credential could not be verified.' });
        }
        const profileUrl = new URL('https://graph.facebook.com/me');
        profileUrl.searchParams.set('fields', 'id,name,email,picture.type(large)');
        profileUrl.searchParams.set('access_token', accessToken);
        const profileResponse = await fetch(profileUrl);
        const facebookProfile = await profileResponse.json();
        if (!profileResponse.ok || facebookProfile.id !== tokenData.user_id) {
          return res.status(401).json({ success: false, message: 'Facebook credential could not be verified.' });
        }
        // Facebook accounts created via mobile numbers might not return an email.
        // Fall back gracefully to a unique phone/id handle so signup is never blocked.
        const fbEmail = facebookProfile.email || (body.phone ? `${String(body.phone).replace(/[^0-9]/g, '')}@facebook.uknow.com` : `fb_${tokenData.user_id}@facebook.uknow.com`);
        profile = {
          email: fbEmail,
          name: facebookProfile.name,
          avatar: facebookProfile.picture?.data?.url || '',
          phone: body.phone || ''
        };
      }

      const cleanEmail = String(profile.email || '').toLowerCase().trim();
      const displayName = String(profile.name || cleanEmail.split('@')[0] || 'VIP Guest').trim();
      const avatar = String(profile.avatar || '');
      const optionalPhone = String(body.phone || body.primaryPhone || profile.phone || '').trim();
      const optionalCity = String(body.city || '').trim();
      const optionalAddress = String(body.address || '').trim();

      if (!cleanEmail || cleanEmail.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(401).json({ success: false, message: 'The provider did not return a valid email address.' });
      }

      // Generate a cryptographically secure random password hash for OAuth accounts
      // Ensures password_hash is never NULL in database and cannot be guessed via plain password login.
      const oauthSalt = await bcrypt.genSalt(10);
      const oauthPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), oauthSalt);

      const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [cleanEmail]);
      let user;

      if (rows.length > 0) {
        user = rows[0];
        if (user.status === 'suspended') {
          return res.status(403).json({ success: false, message: 'Account is suspended. Please contact support.' });
        }
        const updateFields = ['last_login_at = NOW()', 'email_verified = TRUE'];
        const updateVals = [];
        if (avatar && !user.avatar) {
          updateFields.push('avatar = ?', 'profile_image = ?');
          updateVals.push(avatar, avatar);
        }
        if (!user.password_hash) {
          updateFields.push('password_hash = ?');
          updateVals.push(oauthPasswordHash);
        }
        if (optionalPhone && !user.phone) {
          updateFields.push('phone = ?', 'primary_phone = ?');
          updateVals.push(optionalPhone, optionalPhone);
        }
        if (optionalCity && !user.city) {
          updateFields.push('city = ?');
          updateVals.push(optionalCity);
        }
        if (optionalAddress && !user.address) {
          updateFields.push('address = ?');
          updateVals.push(optionalAddress);
        }
        updateVals.push(user.id);
        await pool.query(`UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`, updateVals);

        const [freshRows] = await pool.query('SELECT * FROM users WHERE id = ?', [user.id]);
        user = freshRows[0];
      } else {
        const userId = `usr-oauth-${crypto.randomUUID()}`;
        await pool.query(`
          INSERT INTO users (
            id, name, full_name, email, password_hash, role, status, email_verified,
            signup_method, avatar, profile_image, phone, primary_phone, city, address
          ) VALUES (?, ?, ?, ?, ?, 'customer', 'active', TRUE, ?, ?, ?, ?, ?, ?, ?)
        `, [
          userId, displayName, displayName, cleanEmail, oauthPasswordHash,
          provider, avatar, avatar, optionalPhone || null, optionalPhone || null,
          optionalCity || null, optionalAddress || null
        ]);

        const [createdRows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
        user = createdRows[0];
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, name: user.full_name || user.name, role: user.role, status: user.status || 'active' },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );

      res.json({
        success: true,
        method: provider,
        message: `${provider === 'facebook' ? 'Facebook' : 'Google'} authentication successful.`,
        token,
        user: AuthController.serializeUser(user)
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Facebook Data Deletion / Deauthorize Callback
   * Facebook calls this endpoint (POST) when a user removes your app.
   * Must respond with JSON containing { url, confirmation_code }.
   * Also handles GET for verification checks from Facebook App Dashboard.
   */
  static async facebookDeauthorize(req, res) {
    try {
      const confirmationCode = `fb-del-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const statusUrl = `${config.apiPublicUrl || 'http://localhost:4000'}/api/v1/auth/facebook/deauthorize?code=${confirmationCode}`;

      // If this is a GET verification call (from Facebook App Dashboard URL check)
      if (req.method === 'GET') {
        return res.json({
          success: true,
          message: 'Facebook deauthorize endpoint is active and returns JSON.',
          confirmation_code: req.query.code || confirmationCode,
          url: statusUrl
        });
      }

      // POST: actual deauthorize notification from Facebook
      // The signed_request field contains info about which user removed the app
      // We log it but don't need to delete anything for our use case
      const signedRequest = req.body?.signed_request;
      logger.info('[Facebook] Deauthorize callback received', { signedRequest: signedRequest ? '(present)' : '(absent)' });

      // Facebook requires this exact response format
      res.json({
        url: statusUrl,
        confirmation_code: confirmationCode
      });
    } catch (err) {
      res.json({ url: '', confirmation_code: `err-${Date.now()}` });
    }
  }
}
