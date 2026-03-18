/**
 * Tests for backend/gps-batcher.cjs
 */

const GPSBatcher = require('../gps-batcher.cjs');

// Mock db module
function makeMockDb() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('GPSBatcher', () => {
  test('constructor initializes with defaults', () => {
    const db = makeMockDb();
    const batcher = new GPSBatcher(db);
    expect(batcher.buffer).toEqual([]);
    expect(batcher.flushIntervalMs).toBe(5000);
    expect(batcher.maxBatchSize).toBe(200);
  });

  test('constructor accepts custom options', () => {
    const db = makeMockDb();
    const batcher = new GPSBatcher(db, {
      flushIntervalMs: 1000,
      maxBatchSize: 50,
    });
    expect(batcher.flushIntervalMs).toBe(1000);
    expect(batcher.maxBatchSize).toBe(50);
  });

  test('add pushes items to buffer', () => {
    const db = makeMockDb();
    const batcher = new GPSBatcher(db);

    batcher.add('device-1', 25.033, 121.564, 0, 'CH1');
    batcher.add('device-2', 25.034, 121.565, 10, 'CH2');

    expect(batcher.buffer.length).toBe(2);
    expect(batcher.buffer[0].deviceId).toBe('device-1');
    expect(batcher.buffer[1].lat).toBe(25.034);
  });

  test('flush sends batch INSERT to db', async () => {
    const db = makeMockDb();
    const batcher = new GPSBatcher(db);

    batcher.add('d1', 25.0, 121.0, 0, 'CH1');
    batcher.add('d2', 25.1, 121.1, 5, 'CH2');

    await batcher.flush();

    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO device_positions');
    expect(sql).toContain('$1');
    expect(sql).toContain('$10'); // 2 rows * 5 params each
    expect(params).toHaveLength(10);
    expect(params[0]).toBe('d1');
    expect(params[5]).toBe('d2');
  });

  test('flush does nothing when buffer is empty', async () => {
    const db = makeMockDb();
    const batcher = new GPSBatcher(db);

    await batcher.flush();
    expect(db.query).not.toHaveBeenCalled();
  });

  test('flush clears the buffer after success', async () => {
    const db = makeMockDb();
    const batcher = new GPSBatcher(db);

    batcher.add('d1', 25.0, 121.0, 0, 'CH1');
    await batcher.flush();

    expect(batcher.buffer.length).toBe(0);
  });

  test('flush re-adds items on error', async () => {
    const db = makeMockDb();
    db.query.mockRejectedValue(new Error('DB connection failed'));
    const batcher = new GPSBatcher(db);

    batcher.add('d1', 25.0, 121.0, 0, 'CH1');
    batcher.add('d2', 25.1, 121.1, 0, 'CH2');

    await batcher.flush();

    // Items should be re-added to buffer for retry
    expect(batcher.buffer.length).toBe(2);
    expect(batcher.buffer[0].deviceId).toBe('d1');
  });

  test('auto-flush when maxBatchSize reached', async () => {
    // Use real timers for this test since auto-flush is fire-and-forget async
    jest.useRealTimers();

    const db = makeMockDb();
    const batcher = new GPSBatcher(db, { maxBatchSize: 3 });

    // Add items - the third triggers flush internally
    batcher.add('d1', 25.0, 121.0, 0, 'CH1');
    batcher.add('d2', 25.1, 121.1, 0, 'CH1');
    batcher.add('d3', 25.2, 121.2, 0, 'CH1'); // triggers flush

    // Wait a tick for the async flush to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(db.query).toHaveBeenCalled();

    // Restore fake timers for other tests
    jest.useFakeTimers();
  });

  test('start creates periodic timer', () => {
    const db = makeMockDb();
    const batcher = new GPSBatcher(db, { flushIntervalMs: 2000 });

    batcher.start();
    expect(batcher.timer).not.toBeNull();

    batcher.add('d1', 25.0, 121.0, 0, 'CH1');

    // Advance time to trigger flush
    jest.advanceTimersByTime(2000);

    // Timer should have called flush (which calls db.query)
    // Note: flush is async, but timer fires sync
    expect(batcher.timer).not.toBeNull();

    // Clean up
    batcher.stop();
  });

  test('stop clears timer and flushes remaining', async () => {
    const db = makeMockDb();
    const batcher = new GPSBatcher(db, { flushIntervalMs: 5000 });

    batcher.start();
    batcher.add('d1', 25.0, 121.0, 0, 'CH1');

    await batcher.stop();

    expect(batcher.timer).toBeNull();
    expect(db.query).toHaveBeenCalled();
    expect(batcher.buffer.length).toBe(0);
  });

  test('stop is idempotent when no timer', async () => {
    const db = makeMockDb();
    const batcher = new GPSBatcher(db);

    // Stop without start
    await batcher.stop();
    expect(batcher.timer).toBeNull();
  });

  test('add handles null channel and alt', () => {
    const db = makeMockDb();
    const batcher = new GPSBatcher(db);

    batcher.add('d1', 25.0, 121.0, null, null);

    expect(batcher.buffer[0].alt).toBe(0);
    expect(batcher.buffer[0].channel).toBeNull();
  });
});
