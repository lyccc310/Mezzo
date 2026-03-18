'use strict';

const {
  createPttState,
  parsePTTMessage,
  handlePTT_SpeechStart,
  handlePTT_SpeechStop,
  arbiterDecision,
  handlePTT_PRIVATE,
  handlePTT_PrivateRequest,
  joinRoom,
  leaveRoom,
  leaveAllRooms,
  broadcastToRoom
} = require('../ptt-logic.cjs');

// ===== 測試工具 =====

/** 建立 mock deps 物件 */
function makeDeps(overrides = {}) {
  const pttState = overrides.pttState || createPttState();
  return {
    pttState,
    sendPTTSpeechResponse: jest.fn(),
    broadcastToClients: jest.fn(),
    broadcastToRoom: jest.fn().mockReturnValue(1),
    wss: { clients: new Set() },
    WebSocket: { OPEN: 1, CLOSED: 3 },
    ...overrides
  };
}

/** 建立模擬 PTT 二進位 buffer */
function makeBuffer(tag, uuid, data) {
  const tagBuf = Buffer.alloc(32);
  tagBuf.write(tag || '', 0, 'utf8');
  const uuidBuf = Buffer.alloc(128);
  uuidBuf.write(uuid || '', 0, 'utf8');
  const dataBuf = data != null ? Buffer.from(data, 'utf8') : Buffer.alloc(0);
  return Buffer.concat([tagBuf, uuidBuf, dataBuf]);
}

/** 建立模擬 WebSocket */
function makeWs(readyState) {
  return {
    readyState: readyState != null ? readyState : 1,
    send: jest.fn(),
    _id: Math.random().toString(36).slice(2)
  };
}

// ================================================================
// A. parsePTTMessage（6 個案例）
// ================================================================
describe('A. parsePTTMessage', () => {
  test('A1: 正常 buffer 解析 (tag + uuid + data)', () => {
    const buf = makeBuffer('SPEECH_START', 'device-001', 'hello');
    const result = parsePTTMessage(buf);
    expect(result).toEqual({
      tag: 'SPEECH_START',
      uuid: 'device-001',
      data: 'hello'
    });
  });

  test('A2: buffer < 160 bytes → null', () => {
    const buf = Buffer.alloc(100);
    expect(parsePTTMessage(buf)).toBeNull();
  });

  test('A3: buffer = 160 bytes（無 data）', () => {
    const buf = makeBuffer('SOS', 'device-002', '');
    expect(buf.length).toBe(160);
    const result = parsePTTMessage(buf);
    expect(result.tag).toBe('SOS');
    expect(result.uuid).toBe('device-002');
    expect(result.data).toBe('');
  });

  test('A4: 清除 null bytes', () => {
    const tagBuf = Buffer.alloc(32);
    tagBuf.write('GPS', 0, 'utf8');
    const uuidBuf = Buffer.alloc(128);
    uuidBuf.write('dev\0\0\0ice', 0, 'utf8');
    const dataBuf = Buffer.from('lat\0,lon', 'utf8');
    const buf = Buffer.concat([tagBuf, uuidBuf, dataBuf]);
    const result = parsePTTMessage(buf);
    expect(result.uuid).toBe('device');
    expect(result.data).toBe('lat,lon');
  });

  test('A5: 長 tag (PTT_MSG_TYPE_SPEECH_START)', () => {
    const buf = makeBuffer('PTT_MSG_TYPE_SPEECH_START', 'bwc-123', 'channel1');
    const result = parsePTTMessage(buf);
    expect(result.tag).toBe('PTT_MSG_TYPE_SPEECH_START');
  });

  test('A6: null/undefined input → null', () => {
    expect(parsePTTMessage(null)).toBeNull();
    expect(parsePTTMessage(undefined)).toBeNull();
  });
});

// ================================================================
// B. handlePTT_SpeechStart — 群組通話仲裁（6 個案例）
// ================================================================
describe('B. handlePTT_SpeechStart', () => {
  test('B1: 仲裁模式 + 已核准 → 直接 ALLOW', () => {
    const deps = makeDeps();
    deps.pttState.arbiterMode = true;
    deps.pttState.allowedSpeakers.set('ch1', new Set(['dev-A']));

    handlePTT_SpeechStart('ch1', 'dev-A', '', deps);

    expect(deps.pttState.channelSpeakers.get('ch1')).toBe('dev-A');
    expect(deps.sendPTTSpeechResponse).toHaveBeenCalledWith('ch1', 'dev-A', 'ALLOW');
    expect(deps.broadcastToClients).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ptt_speaker_update', action: 'start' })
    );
  });

  test('B2: 仲裁模式 + 未核准 → 加入 pending', () => {
    const deps = makeDeps();
    deps.pttState.arbiterMode = true;

    handlePTT_SpeechStart('ch1', 'dev-B', '', deps);

    const pending = deps.pttState.pendingSpeechRequests.get('ch1');
    expect(pending).toHaveLength(1);
    expect(pending[0].uuid).toBe('dev-B');
    expect(deps.sendPTTSpeechResponse).not.toHaveBeenCalled();
    expect(deps.broadcastToClients).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ptt_speech_request', requester: 'dev-B' })
    );
  });

  test('B3: 重複 pending 不重複加入', () => {
    const deps = makeDeps();
    deps.pttState.arbiterMode = true;

    handlePTT_SpeechStart('ch1', 'dev-C', '', deps);
    handlePTT_SpeechStart('ch1', 'dev-C', '', deps);

    const pending = deps.pttState.pendingSpeechRequests.get('ch1');
    expect(pending).toHaveLength(1);
  });

  test('B4: 非仲裁模式 → 直接 ALLOW', () => {
    const deps = makeDeps();
    deps.pttState.arbiterMode = false;

    handlePTT_SpeechStart('ch1', 'dev-D', '', deps);

    expect(deps.pttState.channelSpeakers.get('ch1')).toBe('dev-D');
    expect(deps.sendPTTSpeechResponse).toHaveBeenCalledWith('ch1', 'dev-D', 'ALLOW');
  });

  test('B5: 非仲裁模式 + 頻道忙碌 → DENY', () => {
    const deps = makeDeps();
    deps.pttState.arbiterMode = false;
    deps.pttState.channelSpeakers.set('ch1', 'dev-X');

    handlePTT_SpeechStart('ch1', 'dev-E', '', deps);

    expect(deps.sendPTTSpeechResponse).toHaveBeenCalledWith('ch1', 'dev-E', 'DENY');
    expect(deps.pttState.channelSpeakers.get('ch1')).toBe('dev-X'); // 未改變
  });

  test('B6: 同一發言者重新請求 → ALLOW', () => {
    const deps = makeDeps();
    deps.pttState.arbiterMode = false;
    deps.pttState.channelSpeakers.set('ch1', 'dev-F');

    handlePTT_SpeechStart('ch1', 'dev-F', '', deps);

    expect(deps.sendPTTSpeechResponse).toHaveBeenCalledWith('ch1', 'dev-F', 'ALLOW');
    expect(deps.pttState.channelSpeakers.get('ch1')).toBe('dev-F');
  });
});

// ================================================================
// C. handlePTT_SpeechStop（4 個案例）
// ================================================================
describe('C. handlePTT_SpeechStop', () => {
  test('C1: 當前發言者停止 → 清除 channelSpeakers + allowedSpeakers', () => {
    const deps = makeDeps();
    deps.pttState.channelSpeakers.set('ch1', 'dev-A');
    deps.pttState.allowedSpeakers.set('ch1', new Set(['dev-A']));

    handlePTT_SpeechStop('ch1', 'dev-A', '', deps);

    expect(deps.pttState.channelSpeakers.has('ch1')).toBe(false);
    expect(deps.pttState.allowedSpeakers.get('ch1').has('dev-A')).toBe(false);
    expect(deps.broadcastToClients).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ptt_speaker_update', action: 'stop', previousSpeaker: 'dev-A' })
    );
  });

  test('C2: 停止時清除 pending 殘留', () => {
    const deps = makeDeps();
    deps.pttState.channelSpeakers.set('ch1', 'dev-B');
    deps.pttState.pendingSpeechRequests.set('ch1', [
      { uuid: 'dev-B', timestamp: '2024-01-01' },
      { uuid: 'dev-C', timestamp: '2024-01-01' }
    ]);

    handlePTT_SpeechStop('ch1', 'dev-B', '', deps);

    const pending = deps.pttState.pendingSpeechRequests.get('ch1');
    expect(pending).toHaveLength(1);
    expect(pending[0].uuid).toBe('dev-C');
  });

  test('C3: 非當前發言者停止 → 無變更', () => {
    const deps = makeDeps();
    deps.pttState.channelSpeakers.set('ch1', 'dev-A');

    handlePTT_SpeechStop('ch1', 'dev-B', '', deps);

    expect(deps.pttState.channelSpeakers.get('ch1')).toBe('dev-A');
    expect(deps.broadcastToClients).not.toHaveBeenCalled();
  });

  test('C4: 空頻道停止 → 不報錯', () => {
    const deps = makeDeps();
    expect(() => handlePTT_SpeechStop('ch1', 'dev-A', '', deps)).not.toThrow();
    expect(deps.broadcastToClients).not.toHaveBeenCalled();
  });
});

// ================================================================
// D. arbiterDecision — 仲裁控制（4 個案例）
// ================================================================
describe('D. arbiterDecision', () => {
  test('D1: allow → 加入 allowed + 設為 speaker', () => {
    const deps = makeDeps();
    deps.pttState.pendingSpeechRequests.set('ch1', [{ uuid: 'dev-A', timestamp: '' }]);

    arbiterDecision('ch1', 'dev-A', 'allow', deps);

    expect(deps.pttState.allowedSpeakers.get('ch1').has('dev-A')).toBe(true);
    expect(deps.pttState.channelSpeakers.get('ch1')).toBe('dev-A');
    expect(deps.sendPTTSpeechResponse).toHaveBeenCalledWith('ch1', 'dev-A', 'ALLOW');
  });

  test('D2: deny → 發送 DENY + 不加入 allowed', () => {
    const deps = makeDeps();
    deps.pttState.pendingSpeechRequests.set('ch1', [{ uuid: 'dev-B', timestamp: '' }]);

    arbiterDecision('ch1', 'dev-B', 'deny', deps);

    expect(deps.pttState.allowedSpeakers.has('ch1')).toBe(false);
    expect(deps.sendPTTSpeechResponse).toHaveBeenCalledWith('ch1', 'dev-B', 'DENY');
  });

  test('D3: allow → 從 pending 移除', () => {
    const deps = makeDeps();
    deps.pttState.pendingSpeechRequests.set('ch1', [
      { uuid: 'dev-A', timestamp: '' },
      { uuid: 'dev-B', timestamp: '' }
    ]);

    arbiterDecision('ch1', 'dev-A', 'allow', deps);

    const pending = deps.pttState.pendingSpeechRequests.get('ch1');
    expect(pending).toHaveLength(1);
    expect(pending[0].uuid).toBe('dev-B');
  });

  test('D4: deny → 從 pending 移除', () => {
    const deps = makeDeps();
    deps.pttState.pendingSpeechRequests.set('ch1', [
      { uuid: 'dev-A', timestamp: '' },
      { uuid: 'dev-B', timestamp: '' }
    ]);

    arbiterDecision('ch1', 'dev-B', 'deny', deps);

    const pending = deps.pttState.pendingSpeechRequests.get('ch1');
    expect(pending).toHaveLength(1);
    expect(pending[0].uuid).toBe('dev-A');
  });
});

// ================================================================
// E. 完整仲裁流程（整合測試，2 個案例）
// ================================================================
describe('E. 完整仲裁流程', () => {
  test('E1: SpeechStart → pending → allow → SpeechStop → cleanup', () => {
    const deps = makeDeps();
    deps.pttState.arbiterMode = true;

    // Step 1: 請求發言 → pending
    handlePTT_SpeechStart('ch1', 'dev-A', '', deps);
    expect(deps.pttState.pendingSpeechRequests.get('ch1')).toHaveLength(1);
    expect(deps.pttState.channelSpeakers.has('ch1')).toBe(false);

    // Step 2: 組長允許 → speaker
    arbiterDecision('ch1', 'dev-A', 'allow', deps);
    expect(deps.pttState.channelSpeakers.get('ch1')).toBe('dev-A');
    expect(deps.pttState.allowedSpeakers.get('ch1').has('dev-A')).toBe(true);
    expect(deps.pttState.pendingSpeechRequests.get('ch1')).toHaveLength(0);

    // Step 3: 結束發言 → cleanup
    handlePTT_SpeechStop('ch1', 'dev-A', '', deps);
    expect(deps.pttState.channelSpeakers.has('ch1')).toBe(false);
    expect(deps.pttState.allowedSpeakers.get('ch1').has('dev-A')).toBe(false);
  });

  test('E2: SpeechStart → pending → deny → 未設 speaker', () => {
    const deps = makeDeps();
    deps.pttState.arbiterMode = true;

    handlePTT_SpeechStart('ch1', 'dev-B', '', deps);
    expect(deps.pttState.pendingSpeechRequests.get('ch1')).toHaveLength(1);

    arbiterDecision('ch1', 'dev-B', 'deny', deps);
    expect(deps.pttState.channelSpeakers.has('ch1')).toBe(false);
    expect(deps.pttState.pendingSpeechRequests.get('ch1')).toHaveLength(0);
  });
});

// ================================================================
// F. handlePTT_PRIVATE — 私人通話音訊（4 個案例）
// ================================================================
describe('F. handlePTT_PRIVATE', () => {
  test('F1: 房間不存在 → 自動建立 + 通知前端', () => {
    const deps = makeDeps();
    const audio = Buffer.from('audio-data');

    handlePTT_PRIVATE('/WJI/PTT/CH1/PRIVATE/user_7357', 'CH1', 'bwc-001', 'PRIVATE_AUDIO', audio, deps);

    expect(deps.pttState.activePrivateCalls.has('user_7357')).toBe(true);
    expect(deps.broadcastToClients).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'private_call_started' })
    );
    expect(deps.broadcastToRoom).toHaveBeenCalled();
  });

  test('F2: 房間已存在 → 不重建', () => {
    const deps = makeDeps();
    deps.pttState.activePrivateCalls.set('user_7357', { channel: 'CH1', from: 'bwc-001' });
    const audio = Buffer.from('audio-data');

    handlePTT_PRIVATE('/WJI/PTT/CH1/PRIVATE/user_7357', 'CH1', 'bwc-001', 'PRIVATE_AUDIO', audio, deps);

    // broadcastToClients 只被 broadcastToRoom 的 mock 呼叫，不應有 private_call_started
    expect(deps.broadcastToClients).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'private_call_started' })
    );
  });

  test('F3: topic 解析 roomId', () => {
    const deps = makeDeps();
    const audio = Buffer.from('x');

    handlePTT_PRIVATE('/WJI/PTT/CHANNEL0001/PRIVATE/room_abc', 'CHANNEL0001', 'dev-1', 'TAG', audio, deps);

    expect(deps.pttState.activePrivateCalls.has('room_abc')).toBe(true);
  });

  test('F4: 音訊 base64 編碼正確', () => {
    const deps = makeDeps();
    const raw = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"

    handlePTT_PRIVATE('/WJI/PTT/CH1/PRIVATE/r1', 'CH1', 'u1', 'T', raw, deps);

    const call = deps.broadcastToRoom.mock.calls[0];
    const packet = call[1].packet;
    expect(packet.audioData).toBe(raw.toString('base64'));
    expect(Buffer.from(packet.audioData, 'base64').toString()).toBe('Hello');
  });
});

// ================================================================
// G. handlePTT_PrivateRequest — 私人通話請求（5 個案例）
// ================================================================
describe('G. handlePTT_PrivateRequest', () => {
  test('G1: 有效 data → 建立房間 + 廣播', () => {
    const deps = makeDeps();

    const result = handlePTT_PrivateRequest('CH1', 'bwc-001', 'target-002,room_123', deps);

    expect(result).toBe(true);
    expect(deps.pttState.activePrivateCalls.has('room_123')).toBe(true);
    const call = deps.pttState.activePrivateCalls.get('room_123');
    expect(call.from).toBe('bwc-001');
    expect(call.to).toBe('target-002');
    expect(deps.broadcastToClients).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'private_call_started' })
    );
  });

  test('G2: 無效 data（無逗號）→ 不建房', () => {
    const deps = makeDeps();

    const result = handlePTT_PrivateRequest('CH1', 'bwc-001', 'invalid-data', deps);

    expect(result).toBe(false);
    expect(deps.pttState.activePrivateCalls.size).toBe(0);
  });

  test('G3: 空 data → 不建房', () => {
    const deps = makeDeps();

    const result = handlePTT_PrivateRequest('CH1', 'bwc-001', '', deps);

    expect(result).toBe(false);
    expect(deps.pttState.activePrivateCalls.size).toBe(0);
  });

  test('G4: 目標設備已連線 → 轉發請求', () => {
    const deps = makeDeps();
    const targetWs = makeWs(1); // OPEN
    deps.pttState.deviceConnections.set('target-X', targetWs);

    handlePTT_PrivateRequest('CH1', 'bwc-001', 'target-X,room_456', deps);

    expect(targetWs.send).toHaveBeenCalled();
    const msg = JSON.parse(targetWs.send.mock.calls[0][0]);
    expect(msg.type).toBe('private_call_request');
    expect(msg.from).toBe('bwc-001');
  });

  test('G5: 目標設備未連線 → 不報錯', () => {
    const deps = makeDeps();
    // no device in deviceConnections
    expect(() => {
      handlePTT_PrivateRequest('CH1', 'bwc-001', 'offline-dev,room_789', deps);
    }).not.toThrow();
    expect(deps.pttState.activePrivateCalls.has('room_789')).toBe(true);
  });
});

// ================================================================
// H. 房間管理（10 個案例）
// ================================================================
describe('H. 房間管理', () => {
  test('H1: joinRoom 雙向索引正確', () => {
    const deps = makeDeps();
    const ws = makeWs();

    joinRoom(ws, 'room1', deps);

    expect(deps.pttState.clientRooms.get(ws).has('room1')).toBe(true);
    expect(deps.pttState.roomClients.get('room1').has(ws)).toBe(true);
  });

  test('H2: 加入多個房間累計', () => {
    const deps = makeDeps();
    const ws = makeWs();

    joinRoom(ws, 'room1', deps);
    joinRoom(ws, 'room2', deps);
    joinRoom(ws, 'room3', deps);

    expect(deps.pttState.clientRooms.get(ws).size).toBe(3);
    expect(deps.pttState.roomClients.get('room1').has(ws)).toBe(true);
    expect(deps.pttState.roomClients.get('room2').has(ws)).toBe(true);
    expect(deps.pttState.roomClients.get('room3').has(ws)).toBe(true);
  });

  test('H3: leaveRoom 移除特定房間', () => {
    const deps = makeDeps();
    const ws = makeWs();

    joinRoom(ws, 'room1', deps);
    joinRoom(ws, 'room2', deps);
    leaveRoom(ws, 'room1', deps);

    expect(deps.pttState.clientRooms.get(ws).has('room1')).toBe(false);
    expect(deps.pttState.clientRooms.get(ws).has('room2')).toBe(true);
  });

  test('H4: 最後一人離開 → 房間清除', () => {
    const deps = makeDeps();
    const ws = makeWs();

    joinRoom(ws, 'room1', deps);
    leaveRoom(ws, 'room1', deps);

    expect(deps.pttState.roomClients.has('room1')).toBe(false);
  });

  test('H5: 其他人在房間 → 房間保留', () => {
    const deps = makeDeps();
    const ws1 = makeWs();
    const ws2 = makeWs();

    joinRoom(ws1, 'room1', deps);
    joinRoom(ws2, 'room1', deps);
    leaveRoom(ws1, 'room1', deps);

    expect(deps.pttState.roomClients.has('room1')).toBe(true);
    expect(deps.pttState.roomClients.get('room1').size).toBe(1);
    expect(deps.pttState.roomClients.get('room1').has(ws2)).toBe(true);
  });

  test('H6: leaveAllRooms 清除所有', () => {
    const deps = makeDeps();
    const ws = makeWs();

    joinRoom(ws, 'room1', deps);
    joinRoom(ws, 'room2', deps);
    joinRoom(ws, 'room3', deps);
    leaveAllRooms(ws, deps);

    expect(deps.pttState.clientRooms.has(ws)).toBe(false);
    expect(deps.pttState.roomClients.has('room1')).toBe(false);
    expect(deps.pttState.roomClients.has('room2')).toBe(false);
    expect(deps.pttState.roomClients.has('room3')).toBe(false);
  });

  test('H7: leaveAllRooms 無房間不報錯', () => {
    const deps = makeDeps();
    const ws = makeWs();
    expect(() => leaveAllRooms(ws, deps)).not.toThrow();
  });

  test('H8: broadcastToRoom 傳送到所有 OPEN client', () => {
    const deps = makeDeps();
    const ws1 = makeWs(1); // OPEN
    const ws2 = makeWs(1); // OPEN

    joinRoom(ws1, 'room1', deps);
    joinRoom(ws2, 'room1', deps);

    const count = broadcastToRoom('room1', { type: 'test' }, deps);

    expect(count).toBe(2);
    expect(ws1.send).toHaveBeenCalled();
    expect(ws2.send).toHaveBeenCalled();
    const msg = JSON.parse(ws1.send.mock.calls[0][0]);
    expect(msg.type).toBe('test');
  });

  test('H9: broadcastToRoom 跳過 CLOSED client', () => {
    const deps = makeDeps();
    const wsOpen = makeWs(1);   // OPEN
    const wsClosed = makeWs(3); // CLOSED

    joinRoom(wsOpen, 'room1', deps);
    joinRoom(wsClosed, 'room1', deps);

    const count = broadcastToRoom('room1', { type: 'test' }, deps);

    expect(count).toBe(1);
    expect(wsOpen.send).toHaveBeenCalled();
    expect(wsClosed.send).not.toHaveBeenCalled();
  });

  test('H10: broadcastToRoom 空房間 → return 0', () => {
    const deps = makeDeps();
    const count = broadcastToRoom('nonexistent', { type: 'test' }, deps);
    expect(count).toBe(0);
  });
});
