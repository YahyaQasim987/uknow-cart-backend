import bcrypt from 'bcryptjs';
import { pool, testConnection } from '../src/config/db.js';
import { logger } from '../src/utils/logger.js';

export async function provisionAdmin(emailParam, passwordParam, nameParam) {
  const email = (emailParam || process.env.ADMIN_EMAIL || 'admin@uknow.com').toLowerCase().trim();
  const password = passwordParam || process.env.ADMIN_PASSWORD || 'AdminPassword123!';
  const name = (nameParam || process.env.ADMIN_NAME || 'U-Know Store Administrator').trim();

  // Validate email
  if (!email || !email.includes('@') || !email.includes('.')) {
    throw new Error('Invalid admin email format provided');
  }

  // Validate password complexity (at least 8 chars)
  if (!password || password.length < 8) {
    throw new Error('Admin password must be at least 8 characters long');
  }

  logger.info(`Starting secure admin provisioning for: ${email}...`);
  const isConnected = await testConnection();
  if (!isConnected) {
    logger.warn('MySQL unavailable. Cannot provision admin to live database.');
    return { success: false, reason: 'Database connection offline' };
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);
  const adminId = 'usr-admin-1';

  try {
    await pool.query(`
      INSERT INTO \`users\` (
        \`id\`, \`name\`, \`full_name\`, \`email\`, \`password_hash\`, \`role\`, \`status\`,
        \`phone\`, \`primary_phone\`, \`whatsapp_phone\`, \`whatsapp_number\`, \`city\`
      )
      VALUES (?, ?, ?, ?, ?, 'admin', 'active', '+92 300 1234567', '+92 300 1234567', '+92 300 1234567', '+92 300 1234567', 'Lahore')
      ON DUPLICATE KEY UPDATE
        \`name\` = VALUES(\`name\`),
        \`full_name\` = VALUES(\`full_name\`),
        \`password_hash\` = VALUES(\`password_hash\`),
        \`role\` = 'admin',
        \`status\` = 'active';
    `, [adminId, name, name, email, passwordHash]);

    logger.info(`✓ Successfully provisioned administrator: ${email} (ID: ${adminId})`);
    return { success: true, email, role: 'admin' };
  } catch (err) {
    logger.error('Failed to provision admin:', err.message);
    throw err;
  }
}

if (process.argv[1]?.endsWith('provision-admin.js')) {
  const email = process.argv[2];
  const password = process.argv[3];
  provisionAdmin(email, password)
    .then(r => {
      logger.info('Provisioning completed', { success: r.success, email: r.email, role: r.role });
      process.exit(0);
    })
    .catch(err => {
      logger.error('Provisioning error:', err.message);
      process.exit(1);
    });
}
