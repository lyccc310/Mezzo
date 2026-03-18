/**
 * Mezzo Redis Client Module
 *
 * Provides a singleton ioredis client.
 * If REDIS_URL is not set, exports null so the app can fall back to in-memory.
 */

const logger = require('./logger.cjs');

const REDIS_URL = process.env.REDIS_URL;

let redis = null;

if (REDIS_URL) {
  const Redis = require('ioredis');

  redis = new Redis(REDIS_URL, {
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      logger.debug('Redis retry', { attempt: times, delayMs: delay });
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redis.on('connect', () => logger.info('Redis connected'));
  redis.on('ready', () => logger.info('Redis ready'));
  redis.on('error', (err) => logger.error('Redis error', { error: err.message }));
  redis.on('reconnecting', () => logger.info('Redis reconnecting'));
  redis.on('close', () => logger.warn('Redis connection closed'));
} else {
  logger.warn('REDIS_URL not set -- Redis features disabled');
}

module.exports = redis;
