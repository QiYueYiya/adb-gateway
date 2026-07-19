import { Router } from 'express';
import { getDevice } from '../services/adb.js';

const startTime = Date.now();

export function createHealthRouter() {
  const router = Router();

  router.get('/health', (req, res) => {
    const dev = getDevice();
    res.json({
      status: 'ok',
      device: dev ? { ip: dev.ip, port: dev.port, online: dev.online } : null,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  return router;
}
