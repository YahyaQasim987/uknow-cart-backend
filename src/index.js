import http from 'http';
import { app } from './app.js';
import { config } from './config/env.js';
import { initSocketServer } from './config/socket.js';
import { setupSocketGateway } from './socket/gateway.js';
import { logger } from './utils/logger.js';
import { pool } from './config/db.js';
import { OrderService } from './services/order.service.js';
import { PaymentPolicyService } from './services/payment-policy.service.js';
import { ProductMaintenanceService } from './services/product-maintenance.service.js';
import { ProductImageService } from './services/product-image.service.js';
import { CourierService } from './services/courier.service.js';

const server = http.createServer(app);
let advanceExpiryTimer;
let productArchiveTimer;
let orphanSweepTimer;

// Initialize Socket.IO and Gateway
const io = initSocketServer(server);
setupSocketGateway(io);

// Ensure additive delivery/advance-policy columns exist before serving traffic.
void PaymentPolicyService.ensureSchema().catch(error => {
  logger.warn(`Payment policy schema check skipped: ${error.message}`);
});
// Courier integration tables must exist before the admin opens a shipment.
void CourierService.ensureSchema().catch(error => {
  logger.warn(`Courier schema check skipped: ${error.message}`);
});
void ProductImageService.ensureSchema()
  .then(() => ProductImageService.backfillChecksums())
  .catch(error => {
    logger.warn(`Product image checksum schema check skipped: ${error.message}`);
  });

// Start Server Listener
server.listen(config.port, () => {
  logger.info(`=======================================================`);
  logger.info(`🚀 U-KNOW CART Express & Socket.IO Backend Server`);
  logger.info(`🌐 Listening on port ${config.port} (${config.env})`);
  logger.info(`📡 Real-time gateway active via Socket.IO`);
  logger.info(`🏥 Health check: http://localhost:${config.port}/api/health`);
  logger.info(`🛍️  API Endpoints: http://localhost:${config.port}/api/v1/...`);
  logger.info(`=======================================================`);
  const expireUnpaidAdvanceOrders = async () => {
    try {
      const count = await OrderService.expireUnpaidAdvanceOrders();
      if (count > 0) logger.info(`Expired ${count} unpaid advance-payment order(s).`);
    } catch (error) {
      logger.error('Failed to expire unpaid advance-payment orders.', { message: error.message });
    }
  };
  void expireUnpaidAdvanceOrders();
  advanceExpiryTimer = setInterval(expireUnpaidAdvanceOrders, 5 * 60 * 1000);
  advanceExpiryTimer.unref();

  const archiveExpiredProducts = async () => {
    try {
      await ProductMaintenanceService.archiveExpiredProducts();
    } catch (error) {
      logger.error('Failed to archive expired products.', { message: error.message });
    }
  };
  void archiveExpiredProducts();
  productArchiveTimer = setInterval(archiveExpiredProducts, 6 * 60 * 60 * 1000);
  productArchiveTimer.unref();

  const sweepOrphanUploads = async () => {
    try {
      await ProductMaintenanceService.sweepOrphanUploads();
    } catch (error) {
      logger.error('Failed to sweep orphan product uploads.', { message: error.message });
    }
  };
  void sweepOrphanUploads();
  orphanSweepTimer = setInterval(sweepOrphanUploads, 24 * 60 * 60 * 1000);
  orphanSweepTimer.unref();
});

// Graceful Shutdown Handlers
function shutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  if (advanceExpiryTimer) clearInterval(advanceExpiryTimer);
  if (productArchiveTimer) clearInterval(productArchiveTimer);
  if (orphanSweepTimer) clearInterval(orphanSweepTimer);
  server.close(async () => {
    logger.info('HTTP & Socket.IO server closed.');
    try {
      await pool.end();
      logger.info('MySQL connection pool closed.');
    } catch (err) {
      logger.warn(`Notice while ending pool: ${err.message}`);
    }
    process.exit(0);
  });

  // Force shutdown after 10 seconds timeout
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.on('error', error => {
  logger.error(`Backend server failed to listen on port ${config.port}: ${error.message}`);
  process.exitCode = 1;
});

export { server, io };
