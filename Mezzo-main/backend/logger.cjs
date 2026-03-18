/**
 * Mezzo Structured Logger
 *
 * Outputs JSON-formatted log lines suitable for AWS CloudWatch.
 * Respects LOG_LEVEL env var: error < warn < info < debug
 * Redacts sensitive fields (coordinates, IPs, full messages).
 */

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const currentLevel = () => {
  const env = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LOG_LEVELS[env] !== undefined ? LOG_LEVELS[env] : LOG_LEVELS.info;
};

function formatEntry(level, msg, meta) {
  const entry = {
    level,
    ts: new Date().toISOString(),
    msg,
  };
  if (meta && typeof meta === 'object') {
    Object.assign(entry, meta);
  }
  return JSON.stringify(entry);
}

const logger = {
  error(msg, meta) {
    if (currentLevel() >= LOG_LEVELS.error) {
      console.error(formatEntry('error', msg, meta));
    }
  },
  warn(msg, meta) {
    if (currentLevel() >= LOG_LEVELS.warn) {
      console.warn(formatEntry('warn', msg, meta));
    }
  },
  info(msg, meta) {
    if (currentLevel() >= LOG_LEVELS.info) {
      console.log(formatEntry('info', msg, meta));
    }
  },
  debug(msg, meta) {
    if (currentLevel() >= LOG_LEVELS.debug) {
      console.log(formatEntry('debug', msg, meta));
    }
  },
};

module.exports = logger;
