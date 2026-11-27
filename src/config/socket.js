import { Server } from 'socket.io';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

let ioInstance = null;

export function initSocketServer(httpServer) {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: [
        ...config.allowedOrigins,
        'http://localhost:3000',
        'https://localhost:3000',
        'http://127.0.0.1:3000',
        'https://127.0.0.1:3000'
      ],
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 20000,
    pingInterval: 25000
  });

  logger.info('Socket.IO real-time server attached to HTTP listener.');
  return ioInstance;
}

export function getIO() {
  if (!ioInstance) {
    logger.warn('Socket.IO accessed before initialization. Falling back to dummy emitter for tests.');
    return {
      to: () => ({ emit: () => {} }),
      emit: () => {}
    };
  }
  return ioInstance;
}
