import { getDevice, setDevice, isDeviceOnline, listDevices, connect } from './adb.js';
import { logger } from '../lib/logger.js';

const HEARTBEAT_INTERVAL = 30_000; // 30s
const MAX_BACKOFF = 60;
const BACKOFF_STEP = 5;

/** @type {NodeJS.Timeout|null} */
let heartbeatTimer = null;

/** @type {boolean} */
let reconnecting = false;

/** @type {number} */
let attempt = 0;

/** @type {Function|null} */
let resolveReconnect = null;

/**
 * Start the heartbeat timer. Calls `onDeviceLost` when device disappears.
 */
export function startHeartbeat() {
  if (heartbeatTimer) return;

  heartbeatTimer = setInterval(async () => {
    const dev = getDevice();
    if (!dev) return;

    try {
      const devices = await listDevices();
      const target = `${dev.ip}:${dev.port}`;
      const found = devices.find((d) => d.id === target);

      if (!found || found.type !== 'device') {
        logger.warn(`Heartbeat: device ${target} is ${found?.type || 'not found'}`);
        setDevice({ ...dev, online: false });
        triggerReconnect();
      } else {
        if (!dev.online) {
          logger.info(`Heartbeat: device ${target} is back online`);
          setDevice({ ...dev, online: true });
        }
      }
    } catch (err) {
      logger.error(`Heartbeat error: ${err.message}`);
    }
  }, HEARTBEAT_INTERVAL);

  logger.info('Heartbeat started (30s interval)');
}

/**
 * Stop the heartbeat timer.
 */
export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    logger.info('Heartbeat stopped');
  }
}

/**
 * Trigger background reconnect loop if not already running.
 * Returns a promise that resolves when reconnect succeeds, or after 5s timeout.
 */
export function triggerReconnect() {
  if (reconnecting) {
    // Already reconnecting, return existing promise
    return reconnectPromise;
  }

  reconnecting = true;
  attempt = 0;

  reconnectPromise = new Promise((resolve) => {
    resolveReconnect = resolve;
    reconnectLoop();
  });

  return reconnectPromise;
}

/** @type {Promise<boolean>|null} */
let reconnectPromise = null;

async function reconnectLoop() {
  const dev = getDevice();
  if (!dev) {
    reconnecting = false;
    if (resolveReconnect) resolveReconnect(false);
    return;
  }

  while (reconnecting) {
    attempt++;
    const waitTime = Math.min(attempt * BACKOFF_STEP, MAX_BACKOFF);

    logger.info(`Reconnect attempt ${attempt}, waiting ${waitTime}s...`);
    await sleep(waitTime * 1000);

    try {
      await connect(dev.ip, dev.port);
      logger.info(`Reconnect success on attempt ${attempt}`);
      setDevice({ ...dev, online: true });
      reconnecting = false;
      attempt = 0;
      if (resolveReconnect) resolveReconnect(true);
      return;
    } catch (err) {
      logger.warn(`Reconnect attempt ${attempt} failed: ${err.message}`);
    }
  }
}

/**
 * Wait for device to come back online (used by /exec when device is offline).
 * Resolves with true if online, false after timeout.
 * @param {number} timeoutMs
 */
export async function waitForOnline(timeoutMs = 5000) {
  if (isDeviceOnline()) return true;

  triggerReconnect();

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);

    const check = setInterval(() => {
      if (isDeviceOnline()) {
        clearInterval(check);
        clearTimeout(timer);
        resolve(true);
      }
    }, 500);

    // Cleanup after timeout
    setTimeout(() => clearInterval(check), timeoutMs + 1000);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
