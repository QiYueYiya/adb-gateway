import { logger } from '../lib/logger.js';

/**
 * HTTP 请求日志中间件 — 响应完成后输出一条完整日志
 */
export function requestLogger(req, res, next) {
  const start = Date.now();
  const { method, originalUrl } = req;

  // 真实客户端 IP（trust proxy 已启用，req.ip 取 X-Forwarded-For 最左值）
  const clientIp = req.ip?.replace('::ffff:', '') || 'unknown';
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded ? `${clientIp} (via ${forwarded})` : clientIp;

  // 请求体
  let bodyStr = '';
  if (req.body && Object.keys(req.body).length > 0) {
    bodyStr = ` | Body: ${JSON.stringify(req.body)}`;
  }

  // 响应完成后记录（/health 正常时静默）
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (originalUrl === '/health' && res.statusCode < 400) return;
    const logFn = res.statusCode >= 400 ? logger.warn : logger.info;
    logFn(
      `${method} ${originalUrl} | ${res.statusCode} | ${duration}ms | IP: ${ip}${bodyStr}`
    );
  });

  next();
}
