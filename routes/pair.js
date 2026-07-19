import { Router } from 'express';
import { pair, connect, disconnect, tcpip, setDevice, listDevices } from '../services/adb.js';
import { logger } from '../lib/logger.js';
import { startHeartbeat } from '../services/keepalive.js';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const IP_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const DEVICE_JSON_PATH = path.resolve('device.json');

/**
 * Create the /pair router. The returned object includes:
 * - router: Express Router
 * - destroy(): function to disable the routes
 *
 * @param {Function} onDestroyed - callback when pair routes are destroyed
 */
export function createPairRouter(onDestroyed) {
  let active = true;
  const router = Router();

  // GET /pair — HTML page
  router.get('/pair', (req, res) => {
    if (!active) return res.status(404).end();

    res.send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ADB 配对</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #f0f2f5; }
    .card { background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); width: 360px; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; text-align: center; }
    label { display: block; margin-bottom: 0.3rem; font-size: 0.9rem; color: #555; }
    input { width: 100%; padding: 0.6rem; border: 1px solid #d9d9d9; border-radius: 6px; margin-bottom: 1rem; font-size: 1rem; }
    button { width: 100%; padding: 0.7rem; background: #1677ff; color: #fff; border: none; border-radius: 6px; font-size: 1rem; cursor: pointer; }
    button:disabled { background: #ccc; }
    .msg { margin-top: 1rem; padding: 0.6rem; border-radius: 6px; text-align: center; font-size: 0.9rem; display: none; }
    .ok { background: #f6ffed; border: 1px solid #b7eb8f; color: #52c41a; }
    .err { background: #fff2f0; border: 1px solid #ffccc7; color: #ff4d4f; }
  </style>
</head>
<body>
  <div class="card">
    <h1>ADB 无线配对</h1>
    <label>IP 地址</label>
    <input id="ip" type="text" placeholder="192.168.1.100">
    <label>配对端口</label>
    <input id="pairPort" type="number" placeholder="37000">
    <label>6 位配对码</label>
    <input id="pairCode" type="password" maxlength="6" placeholder="123456">
    <button id="btn" onclick="doPair()">连接</button>
    <div id="msg" class="msg"></div>
  </div>
  <script>
    async function doPair() {
      const ip = document.getElementById('ip').value.trim();
      const pairPort = document.getElementById('pairPort').value.trim();
      const pairCode = document.getElementById('pairCode').value.trim();
      const btn = document.getElementById('btn');
      const msg = document.getElementById('msg');

      if (!ip || !pairPort || !pairCode) {
        msg.className = 'msg err'; msg.textContent = '请填写所有字段'; msg.style.display = 'block';
        return;
      }

      btn.disabled = true; btn.textContent = '连接中...';
      msg.style.display = 'none';

      try {
        const res = await fetch('/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ip, pairPort: Number(pairPort), pairCode }),
        });
        const data = await res.json();
        if (data.success) {
          msg.className = 'msg ok'; msg.textContent = data.message;
        } else {
          msg.className = 'msg err'; msg.textContent = data.message;
        }
      } catch (e) {
        msg.className = 'msg err'; msg.textContent = '请求失败: ' + e.message;
      } finally {
        msg.style.display = 'block';
        btn.disabled = false; btn.textContent = '连接';
      }
    }
  </script>
</body>
</html>`);
  });

  // POST /pair — pairing logic
  router.post('/pair', async (req, res) => {
    if (!active) return res.status(404).end();

    const { ip, pairPort, pairCode } = req.body || {};

    // Input validation
    if (!ip || !IP_RE.test(ip)) {
      return res.status(400).json({ success: false, message: 'IP 地址格式无效' });
    }
    if (!Number.isInteger(pairPort) || pairPort < 1 || pairPort > 65535) {
      return res.status(400).json({ success: false, message: '配对端口必须是 1-65535 的整数' });
    }
    if (!pairCode || !/^\d{6}$/.test(pairCode)) {
      return res.status(400).json({ success: false, message: '配对码必须是 6 位数字' });
    }

    try {
      // Step 1: adb pair (via child_process, adbkit has no pair API)
      logger.info(`Pair step 1: adb pair ${ip}:${pairPort}`);
      const pairResult = await pair(ip, pairPort, pairCode);
      if (!pairResult.success) {
        return res.status(500).json({ success: false, message: `配对失败: ${pairResult.message}` });
      }

      // Step 2: switch to TCP mode
      logger.info('Pair step 2: tcpip 5555');
      // We need a device reference — after pair, the device should be visible via USB-like connection
      // But since we're doing wireless pair, we need to connect first to get a device handle
      // Actually after `adb pair`, the device appears in adb devices temporarily
      // We need to find it and call tcpip on it
      const devices = await listDevices();
      const pairedDevice = devices.find((d) => d.id.startsWith(ip) && d.type === 'device');

      if (!pairedDevice) {
        // Try connecting directly — sometimes pair success doesn't show device immediately
        logger.info('Device not found after pair, attempting direct connect...');
        await connect(ip, 5555);
      } else {
        await tcpip(pairedDevice.id, 5555);
      }

      // Step 3: disconnect old + connect on port 5555
      logger.info('Pair step 3: disconnect + connect on 5555');
      await disconnect(ip, 5555);
      await connect(ip, 5555);

      // Step 4: persist to device.json
      logger.info('Pair step 4: persist device.json');
      const deviceData = { ip, port: 5555 };
      await writeFile(DEVICE_JSON_PATH, JSON.stringify(deviceData, null, 2));

      // Update global device state
      setDevice({ ip, port: 5555, online: true });

      // Step 5: return success
      logger.info('Pair step 5: success');
      res.json({ success: true, message: '连接成功' });

      // Step 6: destroy routes
      logger.info('Pair step 6: destroying /pair routes');
      active = false;
      if (onDestroyed) onDestroyed();

      // Start heartbeat now that device is connected
      startHeartbeat();

    } catch (err) {
      logger.error(`Pair error: ${err.message}`);
      res.status(500).json({ success: false, message: `配对异常: ${err.message}` });
    }
  });

  return { router };
}
