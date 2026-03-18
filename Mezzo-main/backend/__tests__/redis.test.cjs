/**
 * Tests for backend/ptt-state-redis.cjs
 *
 * Tests RedisBackedMap, RedisBackedSet, and createRedisPttState
 * using mock Redis clients.
 */

const {
  RedisBackedMap,
  RedisBackedSet,
  RedisBackedMapOfSets,
  createRedisPttState,
} = require('../ptt-state-redis.cjs');

// Mock Redis client
function makeMockRedis() {
  return {
    hset: jest.fn().mockResolvedValue(1),
    hdel: jest.fn().mockResolvedValue(1),
    hgetall: jest.fn().mockResolvedValue({}),
    del: jest.fn().mockResolvedValue(1),
    sadd: jest.fn().mockResolvedValue(1),
    srem: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  };
}

describe('RedisBackedMap', () => {
  let redis;
  let map;

  beforeEach(() => {
    redis = makeMockRedis();
    map = new RedisBackedMap('test:map', redis);
  });

  test('get returns undefined for missing key', () => {
    expect(map.get('foo')).toBeUndefined();
  });

  test('set stores value in local cache', () => {
    map.set('key1', { name: 'Alice' });
    expect(map.get('key1')).toEqual({ name: 'Alice' });
    expect(map.has('key1')).toBe(true);
    expect(map.size).toBe(1);
  });

  test('set writes through to Redis', () => {
    map.set('key1', { name: 'Alice' });
    expect(redis.hset).toHaveBeenCalledWith(
      'test:map',
      'key1',
      JSON.stringify({ name: 'Alice' })
    );
  });

  test('delete removes from cache and Redis', () => {
    map.set('key1', 'val');
    const result = map.delete('key1');
    expect(result).toBe(true);
    expect(map.has('key1')).toBe(false);
    expect(redis.hdel).toHaveBeenCalledWith('test:map', 'key1');
  });

  test('delete returns false for missing key', () => {
    expect(map.delete('nonexistent')).toBe(false);
  });

  test('clear empties cache and deletes Redis key', () => {
    map.set('a', 1);
    map.set('b', 2);
    map.clear();
    expect(map.size).toBe(0);
    expect(redis.del).toHaveBeenCalledWith('test:map');
  });

  test('keys/values/entries iterate correctly', () => {
    map.set('x', 10);
    map.set('y', 20);
    expect([...map.keys()]).toEqual(['x', 'y']);
    expect([...map.values()]).toEqual([10, 20]);
    expect([...map.entries()]).toEqual([['x', 10], ['y', 20]]);
  });

  test('forEach works', () => {
    map.set('a', 1);
    map.set('b', 2);
    const results = [];
    map.forEach((val, key) => results.push([key, val]));
    expect(results).toEqual([['a', 1], ['b', 2]]);
  });

  test('hydrate loads data from Redis', async () => {
    redis.hgetall.mockResolvedValue({
      user1: JSON.stringify({ name: 'Bob' }),
      user2: JSON.stringify({ name: 'Carol' }),
    });

    await map.hydrate();
    expect(map.size).toBe(2);
    expect(map.get('user1')).toEqual({ name: 'Bob' });
    expect(map.get('user2')).toEqual({ name: 'Carol' });
  });

  test('works with null redis (pure in-memory)', () => {
    const memMap = new RedisBackedMap('test:mem', null);
    memMap.set('a', 1);
    expect(memMap.get('a')).toBe(1);
    memMap.delete('a');
    expect(memMap.has('a')).toBe(false);
  });
});

describe('RedisBackedSet', () => {
  let redis;
  let set;

  beforeEach(() => {
    redis = makeMockRedis();
    set = new RedisBackedSet('test:set', redis);
  });

  test('add stores value', () => {
    set.add('item1');
    expect(set.has('item1')).toBe(true);
    expect(set.size).toBe(1);
  });

  test('add writes to Redis', () => {
    set.add('item1');
    expect(redis.sadd).toHaveBeenCalledWith('test:set', 'item1');
  });

  test('delete removes value', () => {
    set.add('item1');
    const had = set.delete('item1');
    expect(had).toBe(true);
    expect(set.has('item1')).toBe(false);
    expect(redis.srem).toHaveBeenCalledWith('test:set', 'item1');
  });

  test('clear empties set', () => {
    set.add('a');
    set.add('b');
    set.clear();
    expect(set.size).toBe(0);
    expect(redis.del).toHaveBeenCalledWith('test:set');
  });

  test('hydrate loads from Redis', async () => {
    redis.smembers.mockResolvedValue(['x', 'y', 'z']);
    await set.hydrate();
    expect(set.size).toBe(3);
    expect(set.has('x')).toBe(true);
    expect(set.has('z')).toBe(true);
  });
});

describe('RedisBackedMapOfSets', () => {
  let redis;
  let mos;

  beforeEach(() => {
    redis = makeMockRedis();
    mos = new RedisBackedMapOfSets('test:mos', redis);
  });

  test('addToSet creates set if not exists', () => {
    mos.addToSet('channel1', 'user1');
    expect(mos.has('channel1')).toBe(true);
    expect(mos.get('channel1').has('user1')).toBe(true);
  });

  test('addToSet writes to Redis', () => {
    mos.addToSet('channel1', 'user1');
    expect(redis.sadd).toHaveBeenCalledWith('test:mos:channel1', 'user1');
  });

  test('removeFromSet removes value', () => {
    mos.addToSet('ch', 'u1');
    mos.addToSet('ch', 'u2');
    mos.removeFromSet('ch', 'u1');
    expect(mos.get('ch').has('u1')).toBe(false);
    expect(mos.get('ch').has('u2')).toBe(true);
  });

  test('removeFromSet cleans up empty sets', () => {
    mos.addToSet('ch', 'u1');
    mos.removeFromSet('ch', 'u1');
    expect(mos.has('ch')).toBe(false);
  });

  test('delete removes entire set', () => {
    mos.addToSet('ch', 'u1');
    mos.delete('ch');
    expect(mos.has('ch')).toBe(false);
    expect(redis.del).toHaveBeenCalledWith('test:mos:ch');
  });
});

describe('createRedisPttState', () => {
  test('creates state with all expected properties', () => {
    const state = createRedisPttState(null);
    expect(state.activeUsers).toBeDefined();
    expect(state.sosAlerts).toBeDefined();
    expect(state.channelUsers).toBeDefined();
    expect(state.broadcastedTranscripts).toBeDefined();
    expect(state.deviceConnections).toBeDefined();
    expect(state.channelSpeakers).toBeDefined();
    expect(state.arbiterMode).toBe(false);
    expect(state.pendingSpeechRequests).toBeDefined();
    expect(state.allowedSpeakers).toBeDefined();
    expect(state.activePrivateCalls).toBeDefined();
    expect(state.clientRooms).toBeDefined();
    expect(state.roomClients).toBeDefined();
  });

  test('deviceConnections is a plain Map (not Redis-backed)', () => {
    const state = createRedisPttState(null);
    expect(state.deviceConnections).toBeInstanceOf(Map);
    // Should NOT have hydrate method
    expect(state.deviceConnections.hydrate).toBeUndefined();
  });

  test('clientRooms and roomClients are plain Maps', () => {
    const state = createRedisPttState(null);
    expect(state.clientRooms).toBeInstanceOf(Map);
    expect(state.roomClients).toBeInstanceOf(Map);
  });

  test('hydrate method exists', () => {
    const state = createRedisPttState(null);
    expect(typeof state.hydrate).toBe('function');
  });

  test('hydrate completes without redis', async () => {
    const state = createRedisPttState(null);
    await expect(state.hydrate()).resolves.toBeUndefined();
  });

  test('state is compatible with ptt-logic.cjs operations', () => {
    const state = createRedisPttState(null);

    // Simulate typical ptt-logic.cjs operations
    state.activeUsers.set('uuid-1', { lastSeen: Date.now(), channel: 'CH1' });
    expect(state.activeUsers.get('uuid-1').channel).toBe('CH1');
    expect(state.activeUsers.size).toBe(1);

    state.channelSpeakers.set('CH1', 'uuid-1');
    expect(state.channelSpeakers.get('CH1')).toBe('uuid-1');

    state.sosAlerts.set('SOS-1', { id: 'SOS-1', deviceId: 'uuid-1' });
    expect(state.sosAlerts.has('SOS-1')).toBe(true);

    state.broadcastedTranscripts.add('key-1');
    expect(state.broadcastedTranscripts.has('key-1')).toBe(true);

    // Clean up
    state.activeUsers.delete('uuid-1');
    expect(state.activeUsers.size).toBe(0);
  });
});
