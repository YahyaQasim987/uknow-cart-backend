const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const configuredLevel = process.env.LOG_LEVEL || 'warn';
const minimumLevel = levels[configuredLevel] ?? levels.warn;
const timestamp = () => new Date().toISOString();

export const logger = {
  access: (msg, ...args) => console.log(`[API] ${timestamp()} - ${msg}`, ...args),
  info: (msg, ...args) => {
    if (minimumLevel >= levels.info) console.log(`[INFO] ${timestamp()} - ${msg}`, ...args);
  },
  warn: (msg, ...args) => {
    if (minimumLevel >= levels.warn) console.warn(`[WARN] ${timestamp()} - ${msg}`, ...args);
  },
  error: (msg, ...args) => console.error(`[ERROR] ${timestamp()} - ${msg}`, ...args),
  debug: (msg, ...args) => {
    if (minimumLevel >= levels.debug) console.log(`[DEBUG] ${timestamp()} - ${msg}`, ...args);
  }
};
