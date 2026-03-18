/**
 * Tests for backend/db.cjs
 *
 * Tests the database module behavior with and without DATABASE_URL.
 */

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe('db.cjs', () => {
  describe('when DATABASE_URL is NOT set', () => {
    let db;

    beforeEach(() => {
      delete process.env.DATABASE_URL;
      db = require('../db.cjs');
    });

    test('pool is null', () => {
      expect(db.pool).toBeNull();
    });

    test('query returns stub result', async () => {
      const result = await db.query('SELECT 1');
      expect(result).toEqual({ rows: [], rowCount: 0 });
    });

    test('query does not throw', async () => {
      await expect(
        db.query('INSERT INTO foo VALUES ($1)', ['bar'])
      ).resolves.toEqual({ rows: [], rowCount: 0 });
    });

    test('initSchema does not throw when no pool', async () => {
      await expect(db.initSchema()).resolves.toBeUndefined();
    });
  });

  describe('when DATABASE_URL is set', () => {
    let db;

    beforeEach(() => {
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
      db = require('../db.cjs');
    });

    afterEach(async () => {
      // Clean up pool to avoid open handles
      if (db.pool) {
        try { await db.pool.end(); } catch { /* ignore */ }
      }
    });

    test('pool is not null', () => {
      expect(db.pool).not.toBeNull();
    });

    test('pool has expected config', () => {
      expect(db.pool.options.max).toBe(20);
      expect(db.pool.options.idleTimeoutMillis).toBe(30000);
    });

    test('query function is exported', () => {
      expect(typeof db.query).toBe('function');
    });

    test('initSchema function is exported', () => {
      expect(typeof db.initSchema).toBe('function');
    });
  });
});
