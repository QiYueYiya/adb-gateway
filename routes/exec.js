import { Router } from 'express';
import { getDevice, isDeviceOnline, shell } from '../services/adb.js';
import { waitForOnline, triggerReconnect } from '../services/keepalive.js';
import { authMiddleware } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const VALID_TYPES = ['adb', 'shell', 'su'];
const SHELL_META_RE = /[;&|`$(){}!#\n\r]/;

export function createExecRouter() {
  const router = Router();

  router.post('/exec', authMiddleware, async (req, res) => {
    const { command, type } = req.body || {};

    // Validate type
    if (!type || !VALID_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        data: null,
        error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`,
      });
    }

    // Validate command
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'command must be a non-empty string',
      });
    }

    // Check for shell metacharacters (command injection prevention)
    if (SHELL_META_RE.test(command)) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'command contains forbidden characters',
      });
    }

    // Check device online, attempt reconnect if offline
    const dev = getDevice();
    if (!dev || !isDeviceOnline()) {
      logger.info('Device offline, waiting for reconnect (5s timeout)...');
      const online = await waitForOnline(5000);
      if (!online) {
        return res.status(503).json({
          success: false,
          data: null,
          error: 'Device offline',
        });
      }
    }

    // Build the device serial
    const currentDev = getDevice();
    const deviceId = `${currentDev.ip}:${currentDev.port}`;

    try {
      let result;

      if (type === 'adb') {
        // For "adb" type, treat command as an adb-level command
        // Most adb commands can be run via shell, so we wrap it
        result = await shell(deviceId, command);
      } else if (type === 'shell') {
        result = await shell(deviceId, command);
      } else if (type === 'su') {
        result = await shell(deviceId, ['su', '-c', command]);
      }

      return res.json({ success: true, data: result, error: null });
    } catch (err) {
      logger.error(`Exec error (${type} ${command}): ${err.message}`);

      // Check if it's a connection error → trigger reconnect
      if (err.message.includes('connect') || err.message.includes('offline')) {
        triggerReconnect();
      }

      return res.status(500).json({
        success: false,
        data: null,
        error: err.message,
      });
    }
  });

  return router;
}
