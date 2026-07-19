import 'dotenv/config';
import express from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { logger } from './lib/logger.js';
import { initClient, connect, disconnect, setDevice, getDevice } from './services/adb.js';
import { startHeartbeat, stopHeartbeat } from './services/keepalive.js';
import { createHealthRouter } from './routes/health.js';
import { createPairRouter } from './routes/pair.js';
import { createExecRouter } from './routes/exec.js';
import { requestLogger } from './middleware/requestLogger.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const DEVICE_JSON_PATH = path.resolve('device.json');
const CONNECT_RETRIES = 3;
const CONNECT_INTERVAL = 2000;

// Track pair router for removal
let pairRouterInstance = null;

async function readDeviceConfig() {
  try {
    const raw = await readFile(DEVICE_JSON_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (data.ip && data.port) {
      logger.info(`Loaded device config: ${data.ip}:${data.port}`);
      return data;
    }
    logger.warn('device.json missing ip or port fields');
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.info('device.json not found');
    } else {
      logger.warn(`Failed to read device.json: ${err.message}`);
    }
    return null;
  }
}

async function tryReconnect(ip, port) {
  for (let i = 1; i <= CONNECT_RETRIES; i++) {
    logger.info(`Connect attempt ${i}/${CONNECT_RETRIES}: ${ip}:${port}`);
    try {
      await connect(ip, port);
      logger.info(`Connected to ${ip}:${port} on attempt ${i}`);
      return true;
    } catch (err) {
      logger.warn(`Attempt ${i} failed: ${err.message}`);
      if (i < CONNECT_RETRIES) {
        await new Promise((r) => setTimeout(r, CONNECT_INTERVAL));
      }
    }
  }
  return false;
}

function mountPairRoutes(app) {
  pairRouterInstance = createPairRouter(() => {
    // onDestroyed callback — called after successful pairing
    logger.info('Pair routes destroyed, /pair now returns 404');
  });
  app.use(pairRouterInstance.router);
}

async function main() {
  // 1. Create adbkit client
  initClient();

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use(requestLogger);

  // Always mount health route
  app.use(createHealthRouter());

  // Always mount exec route
  app.use(createExecRouter());

  // 2. Read device.json and attempt reconnect
  const config = await readDeviceConfig();

  if (config) {
    setDevice({ ip: config.ip, port: config.port, online: false });

    const connected = await tryReconnect(config.ip, config.port);

    if (connected) {
      setDevice({ ip: config.ip, port: config.port, online: true });
      logger.info('Device reconnected, /pair route will NOT be opened');
      startHeartbeat();
    } else {
      logger.warn('All reconnect attempts failed, opening /pair route');
      mountPairRoutes(app);
    }
  } else {
    logger.info('No device config, opening /pair route');
    mountPairRoutes(app);
  }

  // 3. Start HTTP server
  const server = app.listen(PORT, () => {
    logger.info(`ADB Gateway listening on port ${PORT}`);
  });

  // 4. Graceful shutdown
  async function shutdown(signal) {
    logger.info(`Received ${signal}, shutting down...`);
    stopHeartbeat();

    const dev = getDevice();
    if (dev) {
      await disconnect(dev.ip, dev.port);
    }

    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit after 5s
    setTimeout(() => process.exit(1), 5000);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (err) => {
    logger.error(`Unhandled rejection: ${err}`);
  });

  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`);
    process.exit(1);
  });
}

main().catch((err) => {
  logger.error(`Startup failed: ${err.message}`);
  process.exit(1);
});
