import AdbDefault from '@devicefarmer/adbkit';
const { Adb } = AdbDefault;
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../lib/logger.js';

const execAsync = promisify(exec);

const PAIR_TIMEOUT = parseInt(process.env.ADB_PAIR_TIMEOUT || '60000', 10);
const COMMAND_TIMEOUT = parseInt(process.env.ADB_COMMAND_TIMEOUT || '30000', 10);

/** @type {import('@devicefarmer/adbkit').Client} */
let client = null;

/** @type {{ ip: string, port: number, online: boolean }} */
let device = null;

export function getAdbClient() {
  return client;
}

export function getDevice() {
  return device;
}

export function setDevice(d) {
  device = d;
}

export function isDeviceOnline() {
  return device?.online === true;
}

/**
 * Initialize the adbkit client (connects to local ADB server on 127.0.0.1:5037)
 */
export function initClient() {
  client = Adb.createClient();
  logger.info('adbkit client created (127.0.0.1:5037)');
  return client;
}

/**
 * Connect to a device via TCP. Returns the device id on success.
 */
export async function connect(ip, port = 5555) {
  const id = await client.connect(ip, port);
  logger.info(`adbkit connect success: ${id}`);
  return id;
}

/**
 * Disconnect from a device.
 */
export async function disconnect(ip, port = 5555) {
  try {
    const id = await client.disconnect(ip, port);
    logger.info(`adbkit disconnect: ${id}`);
    return id;
  } catch (err) {
    logger.debug(`adbkit disconnect (ignored): ${err.message}`);
    return null;
  }
}

/**
 * List connected devices. Returns array of { id, type }.
 */
export async function listDevices() {
  return client.listDevices();
}

/**
 * Run a shell command on the device and return stdout as string.
 * @param {string} deviceId - e.g. "192.168.1.10:5555"
 * @param {string|string[]} command
 * @returns {Promise<string>}
 */
export async function shell(deviceId, command) {
  const deviceClient = client.getDevice(deviceId);
  const stream = await deviceClient.shell(command);
  const output = await Adb.util.readAll(stream);
  return output.toString('utf-8');
}

/**
 * Switch device ADB daemon to TCP mode on the given port.
 * @param {string} deviceId
 * @param {number} port
 * @returns {Promise<number>}
 */
export async function tcpip(deviceId, port = 5555) {
  const deviceClient = client.getDevice(deviceId);
  const result = await deviceClient.tcpip(port);
  logger.info(`tcpip mode enabled on port ${result}`);
  return result;
}

/**
 * Execute `adb pair` via child_process (adbkit has no pair API).
 * @param {string} ip
 * @param {number} pairPort
 * @param {string} pairCode
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function pair(ip, pairPort, pairCode) {
  const cmd = `adb pair ${ip}:${pairPort} ${pairCode}`;
  logger.info(`Executing: adb pair ${ip}:${pairPort} ******`);

  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: PAIR_TIMEOUT });
    logger.info(`pair stdout: ${stdout.trim()}`);
    if (stderr) logger.warn(`pair stderr: ${stderr.trim()}`);
    return { success: true, message: stdout.trim() };
  } catch (err) {
    logger.error(`pair failed: ${err.message}`);
    return { success: false, message: err.stderr?.trim() || err.message };
  }
}
