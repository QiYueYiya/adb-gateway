const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

const LOG_LEVEL = levels[process.env.LOG_LEVEL?.toUpperCase()] ?? levels.INFO;

function timestamp() {
  return new Date().toISOString();
}

function log(level, ...args) {
  if (levels[level] >= LOG_LEVEL) {
    console.log(`[${timestamp()}] [${level}]`, ...args);
  }
}

export const logger = {
  debug: (...args) => log('DEBUG', ...args),
  info: (...args) => log('INFO', ...args),
  warn: (...args) => log('WARN', ...args),
  error: (...args) => log('ERROR', ...args),
};
