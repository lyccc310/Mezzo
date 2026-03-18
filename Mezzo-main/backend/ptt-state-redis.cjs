/**
 * Mezzo Redis-backed PTT State Adapter
 *
 * Provides Map-compatible and Set-compatible wrappers that use
 * an in-memory cache for synchronous reads and write-through to Redis.
 *
 * This allows ptt-logic.cjs to remain unchanged -- it calls
 * .get(), .set(), .has(), .delete() synchronously, and Redis
 * persistence happens asynchronously in the background.
 *
 * If redis is null (not configured), falls back to plain in-memory.
 */

const logger = require('./logger.cjs');

/**
 * A Map-like object backed by a Redis Hash.
 * Values are serialized as JSON strings.
 */
class RedisBackedMap {
  constructor(redisKey, redis) {
    this.cache = new Map();
    this.redis = redis;
    this.redisKey = redisKey;
  }

  get(key) {
    return this.cache.get(key);
  }

  has(key) {
    return this.cache.has(key);
  }

  set(key, value) {
    this.cache.set(key, value);
    if (this.redis) {
      this.redis
        .hset(this.redisKey, key, JSON.stringify(value))
        .catch((err) =>
          logger.error('Redis hset error', { key: this.redisKey, field: key, error: err.message })
        );
    }
    return this;
  }

  delete(key) {
    const had = this.cache.delete(key);
    if (this.redis) {
      this.redis
        .hdel(this.redisKey, key)
        .catch((err) =>
          logger.error('Redis hdel error', { key: this.redisKey, field: key, error: err.message })
        );
    }
    return had;
  }

  get size() {
    return this.cache.size;
  }

  keys() {
    return this.cache.keys();
  }

  values() {
    return this.cache.values();
  }

  entries() {
    return this.cache.entries();
  }

  forEach(fn) {
    this.cache.forEach(fn);
  }

  [Symbol.iterator]() {
    return this.cache[Symbol.iterator]();
  }

  clear() {
    this.cache.clear();
    if (this.redis) {
      this.redis
        .del(this.redisKey)
        .catch((err) =>
          logger.error('Redis del error', { key: this.redisKey, error: err.message })
        );
    }
  }

  /**
   * Load all data from Redis into the local cache.
   */
  async hydrate() {
    if (!this.redis) return;
    try {
      const data = await this.redis.hgetall(this.redisKey);
      for (const [k, v] of Object.entries(data)) {
        try {
          this.cache.set(k, JSON.parse(v));
        } catch {
          this.cache.set(k, v);
        }
      }
      logger.debug('RedisBackedMap hydrated', {
        key: this.redisKey,
        entries: this.cache.size,
      });
    } catch (err) {
      logger.error('RedisBackedMap hydrate error', {
        key: this.redisKey,
        error: err.message,
      });
    }
  }
}

/**
 * A Set-like object backed by a Redis Set.
 */
class RedisBackedSet {
  constructor(redisKey, redis) {
    this.cache = new Set();
    this.redis = redis;
    this.redisKey = redisKey;
  }

  has(value) {
    return this.cache.has(value);
  }

  add(value) {
    this.cache.add(value);
    if (this.redis) {
      this.redis
        .sadd(this.redisKey, value)
        .catch((err) =>
          logger.error('Redis sadd error', { key: this.redisKey, error: err.message })
        );
    }
    return this;
  }

  delete(value) {
    const had = this.cache.delete(value);
    if (this.redis) {
      this.redis
        .srem(this.redisKey, value)
        .catch((err) =>
          logger.error('Redis srem error', { key: this.redisKey, error: err.message })
        );
    }
    return had;
  }

  get size() {
    return this.cache.size;
  }

  keys() {
    return this.cache.keys();
  }

  values() {
    return this.cache.values();
  }

  forEach(fn) {
    this.cache.forEach(fn);
  }

  [Symbol.iterator]() {
    return this.cache[Symbol.iterator]();
  }

  clear() {
    this.cache.clear();
    if (this.redis) {
      this.redis
        .del(this.redisKey)
        .catch((err) =>
          logger.error('Redis del error', { key: this.redisKey, error: err.message })
        );
    }
  }

  async hydrate() {
    if (!this.redis) return;
    try {
      const members = await this.redis.smembers(this.redisKey);
      for (const m of members) {
        this.cache.add(m);
      }
      logger.debug('RedisBackedSet hydrated', {
        key: this.redisKey,
        members: this.cache.size,
      });
    } catch (err) {
      logger.error('RedisBackedSet hydrate error', {
        key: this.redisKey,
        error: err.message,
      });
    }
  }
}

/**
 * A Map whose values are Sets (channel -> Set<uuid>).
 * Backed by per-channel Redis Sets.
 */
class RedisBackedMapOfSets {
  constructor(redisKeyPrefix, redis) {
    this.cache = new Map();
    this.redis = redis;
    this.redisKeyPrefix = redisKeyPrefix;
  }

  _getRedisKey(mapKey) {
    return `${this.redisKeyPrefix}:${mapKey}`;
  }

  get(key) {
    return this.cache.get(key);
  }

  has(key) {
    return this.cache.has(key);
  }

  /**
   * Set a value (must be a Set).
   */
  set(key, value) {
    this.cache.set(key, value);
    // Full sync: delete old key and re-add all members
    if (this.redis && value instanceof Set && value.size > 0) {
      const rk = this._getRedisKey(key);
      this.redis
        .del(rk)
        .then(() => {
          const members = [...value];
          if (members.length > 0) {
            return this.redis.sadd(rk, ...members);
          }
        })
        .catch((err) =>
          logger.error('Redis MapOfSets set error', { key: rk, error: err.message })
        );
    }
    return this;
  }

  delete(key) {
    const had = this.cache.delete(key);
    if (this.redis) {
      this.redis
        .del(this._getRedisKey(key))
        .catch((err) =>
          logger.error('Redis MapOfSets del error', {
            key: this._getRedisKey(key),
            error: err.message,
          })
        );
    }
    return had;
  }

  get size() {
    return this.cache.size;
  }

  keys() {
    return this.cache.keys();
  }

  values() {
    return this.cache.values();
  }

  entries() {
    return this.cache.entries();
  }

  forEach(fn) {
    this.cache.forEach(fn);
  }

  [Symbol.iterator]() {
    return this.cache[Symbol.iterator]();
  }

  /**
   * Get-or-create a Set for the given key, then add a value to it.
   */
  addToSet(mapKey, value) {
    if (!this.cache.has(mapKey)) {
      this.cache.set(mapKey, new Set());
    }
    this.cache.get(mapKey).add(value);
    if (this.redis) {
      this.redis
        .sadd(this._getRedisKey(mapKey), value)
        .catch((err) =>
          logger.error('Redis MapOfSets sadd error', {
            key: this._getRedisKey(mapKey),
            error: err.message,
          })
        );
    }
  }

  /**
   * Remove a value from the Set at mapKey.
   */
  removeFromSet(mapKey, value) {
    const s = this.cache.get(mapKey);
    if (s) {
      s.delete(value);
      if (s.size === 0) this.cache.delete(mapKey);
    }
    if (this.redis) {
      this.redis
        .srem(this._getRedisKey(mapKey), value)
        .catch((err) =>
          logger.error('Redis MapOfSets srem error', {
            key: this._getRedisKey(mapKey),
            error: err.message,
          })
        );
    }
  }

  async hydrate() {
    // Cannot easily enumerate Redis keys by prefix without SCAN.
    // For now, hydrate is a no-op for MapOfSets -- the in-memory
    // cache rebuilds as devices connect.
    logger.debug('RedisBackedMapOfSets hydrate (no-op)', {
      prefix: this.redisKeyPrefix,
    });
  }
}

/**
 * Create a full pttState object backed by Redis.
 * The returned object has the same shape as the in-memory pttState
 * created by createPttState() in ptt-logic.cjs.
 *
 * clientRooms and roomClients are always plain in-memory Maps
 * because they hold WebSocket object references.
 */
function createRedisPttState(redis) {
  const PREFIX = 'mezzo:ptt';

  return {
    activeUsers: new RedisBackedMap(`${PREFIX}:activeUsers`, redis),
    sosAlerts: new RedisBackedMap(`${PREFIX}:sosAlerts`, redis),
    channelUsers: new RedisBackedMapOfSets(`${PREFIX}:channelUsers`, redis),
    broadcastedTranscripts: new RedisBackedSet(`${PREFIX}:broadcastedTranscripts`, redis),
    deviceConnections: new Map(), // WebSocket refs -- always in-memory
    channelSpeakers: new RedisBackedMap(`${PREFIX}:channelSpeakers`, redis),
    arbiterMode: false, // Simple boolean, synced manually
    pendingSpeechRequests: new RedisBackedMap(`${PREFIX}:pendingSpeech`, redis),
    allowedSpeakers: new RedisBackedMapOfSets(`${PREFIX}:allowedSpeakers`, redis),
    activePrivateCalls: new RedisBackedMap(`${PREFIX}:privateCalls`, redis),
    clientRooms: new Map(),   // WebSocket refs -- always in-memory
    roomClients: new Map(),   // WebSocket refs -- always in-memory

    /**
     * Hydrate all Redis-backed structures from Redis.
     */
    async hydrate() {
      const hydratable = [
        this.activeUsers,
        this.sosAlerts,
        this.channelUsers,
        this.channelSpeakers,
        this.pendingSpeechRequests,
        this.allowedSpeakers,
        this.activePrivateCalls,
        this.broadcastedTranscripts,
      ];
      await Promise.all(hydratable.map((h) => h.hydrate()));

      // Hydrate arbiterMode from Redis
      if (redis) {
        try {
          const val = await redis.get(`${PREFIX}:arbiterMode`);
          if (val !== null) {
            this.arbiterMode = val === 'true';
          }
        } catch (err) {
          logger.error('Redis arbiterMode hydrate error', { error: err.message });
        }
      }

      logger.info('PTT state hydrated from Redis');
    },
  };
}

module.exports = {
  RedisBackedMap,
  RedisBackedSet,
  RedisBackedMapOfSets,
  createRedisPttState,
};
