/**
 * Mezzo GPS Batch Writer
 *
 * Accumulates GPS position updates and flushes them to the
 * device_positions table in periodic batches to avoid per-update writes.
 */

const logger = require('./logger.cjs');

class GPSBatcher {
  /**
   * @param {object} db - Database module with query() method
   * @param {object} opts
   * @param {number} opts.flushIntervalMs - Milliseconds between auto-flushes (default 5000)
   * @param {number} opts.maxBatchSize - Max buffered items before forced flush (default 200)
   */
  constructor(db, { flushIntervalMs = 5000, maxBatchSize = 200 } = {}) {
    this.db = db;
    this.buffer = [];
    this.flushIntervalMs = flushIntervalMs;
    this.maxBatchSize = maxBatchSize;
    this.timer = null;
    this._flushing = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.flushIntervalMs);
    logger.info('GPS batcher started', {
      intervalMs: this.flushIntervalMs,
      maxBatch: this.maxBatchSize,
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this.flush();
  }

  /**
   * Add a GPS position to the buffer.
   */
  add(deviceId, lat, lng, alt, channel) {
    this.buffer.push({
      deviceId,
      lat,
      lng,
      alt: alt || 0,
      channel: channel || null,
      recordedAt: new Date(),
    });

    if (this.buffer.length >= this.maxBatchSize) {
      this.flush();
    }
  }

  /**
   * Flush all buffered positions to the database.
   */
  async flush() {
    if (this.buffer.length === 0 || this._flushing) return;
    this._flushing = true;

    const batch = this.buffer.splice(0);
    const values = [];
    const params = [];

    batch.forEach((item, i) => {
      const offset = i * 5;
      values.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`
      );
      params.push(item.deviceId, item.lat, item.lng, item.alt, item.channel);
    });

    const sql = `INSERT INTO device_positions (device_id, lat, lng, alt, channel) VALUES ${values.join(', ')}`;

    try {
      await this.db.query(sql, params);
      logger.debug('GPS batch flushed', { count: batch.length });
    } catch (err) {
      logger.error('GPS batch flush error', {
        error: err.message,
        count: batch.length,
      });
      // Re-add failed items to front of buffer for retry
      this.buffer.unshift(...batch);
    } finally {
      this._flushing = false;
    }
  }
}

module.exports = GPSBatcher;
