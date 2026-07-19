import { logger } from '../lib/logger.js';

const API_KEY = process.env.ADB_API_KEY || 'default-adb-key-2026';

if (!process.env.ADB_API_KEY) {
  logger.warn('ADB_API_KEY not set, using default key. Set it in .env for production.');
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    logger.warn(`Auth failed: missing or malformed token from ${req.ip}`);
    return res.status(401).json({ success: false, data: null, error: 'Unauthorized' });
  }

  const token = header.slice(7);

  if (token !== API_KEY) {
    logger.warn(`Auth failed: invalid token from ${req.ip}`);
    return res.status(401).json({ success: false, data: null, error: 'Unauthorized' });
  }

  logger.info(`Auth passed for ${req.ip}`);
  next();
}
