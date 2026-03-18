'use strict';

/**
 * PTT 純邏輯函數模組
 * 從 server.cjs 抽取，使用依賴注入（deps）以便單元測試
 */

/**
 * 建立全新的 pttState 物件
 */
function createPttState() {
  return {
    activeUsers: new Map(),
    sosAlerts: new Map(),
    channelUsers: new Map(),
    broadcastedTranscripts: new Set(),
    deviceConnections: new Map(),
    channelSpeakers: new Map(),
    arbiterMode: true,
    pendingSpeechRequests: new Map(),
    allowedSpeakers: new Map(),
    activePrivateCalls: new Map(),
    clientRooms: new Map(),
    roomClients: new Map()
  };
}

/**
 * 解析 PTT 二進位訊息
 * 純函數：Tag(32) + UUID(128) + Data(variable)
 */
function parsePTTMessage(buffer) {
  try {
    if (!buffer || buffer.length < 160) {
      return null;
    }
    const tag = buffer.slice(0, 32).toString('utf8').trim().replace(/\0/g, '');
    const uuid = buffer.slice(32, 160).toString('utf8').trim().replace(/\0/g, '');
    const data = buffer.slice(160).toString('utf8').trim().replace(/\0/g, '');
    return { tag, uuid, data };
  } catch (error) {
    return null;
  }
}

/**
 * 處理 PTT 群組通話「請求發言」
 * @param {string} channel
 * @param {string} uuid
 * @param {string} data
 * @param {object} deps - { pttState, sendPTTSpeechResponse, broadcastToClients }
 */
function handlePTT_SpeechStart(channel, uuid, data, deps) {
  const { pttState, sendPTTSpeechResponse, broadcastToClients } = deps;

  // ===== 組長仲裁模式 =====
  if (pttState.arbiterMode) {
    const allowedSpeakers = pttState.allowedSpeakers.get(channel) || new Set();

    if (allowedSpeakers.has(uuid)) {
      // 已被組長允許，設為當前發言者
      pttState.channelSpeakers.set(channel, uuid);
      sendPTTSpeechResponse(channel, uuid, 'ALLOW');
      broadcastToClients({
        type: 'ptt_speaker_update',
        channel: channel,
        speaker: uuid,
        action: 'start',
        timestamp: new Date().toISOString()
      });
    } else {
      // 需要組長核准 - 加入等待列表
      if (!pttState.pendingSpeechRequests.has(channel)) {
        pttState.pendingSpeechRequests.set(channel, []);
      }
      const pendingRequests = pttState.pendingSpeechRequests.get(channel);
      if (!pendingRequests.find(r => r.uuid === uuid)) {
        pendingRequests.push({
          uuid: uuid,
          timestamp: new Date().toISOString()
        });
      }
      broadcastToClients({
        type: 'ptt_speech_request',
        channel: channel,
        requester: uuid,
        pendingRequests: pendingRequests,
        timestamp: new Date().toISOString()
      });
    }
    return;
  }

  // ===== 原始搶麥模式（非仲裁模式）=====
  const currentSpeaker = pttState.channelSpeakers.get(channel);

  if (currentSpeaker && currentSpeaker !== uuid) {
    sendPTTSpeechResponse(channel, uuid, 'DENY');
    broadcastToClients({
      type: 'ptt_speech_denied',
      channel: channel,
      requester: uuid,
      reason: `${currentSpeaker} 正在發言`,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // 沒有人在使用，直接允許
  pttState.channelSpeakers.set(channel, uuid);
  sendPTTSpeechResponse(channel, uuid, 'ALLOW');
  broadcastToClients({
    type: 'ptt_speaker_update',
    channel: channel,
    speaker: uuid,
    action: 'start',
    timestamp: new Date().toISOString()
  });
}

/**
 * 處理 PTT 群組通話「結束發言」
 * @param {string} channel
 * @param {string} uuid
 * @param {string} data
 * @param {object} deps - { pttState, broadcastToClients }
 */
function handlePTT_SpeechStop(channel, uuid, data, deps) {
  const { pttState, broadcastToClients } = deps;
  const currentSpeaker = pttState.channelSpeakers.get(channel);

  if (currentSpeaker === uuid) {
    pttState.channelSpeakers.delete(channel);

    // 仲裁模式：發言結束後移除允許名單，下次需重新核准
    const allowedSpeakers = pttState.allowedSpeakers.get(channel);
    if (allowedSpeakers) {
      allowedSpeakers.delete(uuid);
    }

    // 同時從等待列表中移除（避免殘留）
    const pendingRequests = pttState.pendingSpeechRequests.get(channel);
    if (pendingRequests) {
      const idx = pendingRequests.findIndex(r => r.uuid === uuid);
      if (idx !== -1) pendingRequests.splice(idx, 1);
    }

    broadcastToClients({
      type: 'ptt_speaker_update',
      channel: channel,
      speaker: null,
      action: 'stop',
      previousSpeaker: uuid,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * 組長允許/拒絕發言請求
 * @param {string} channel
 * @param {string} targetUUID
 * @param {string} decision - 'allow' | 'deny'
 * @param {object} deps - { pttState, sendPTTSpeechResponse, broadcastToClients }
 */
function arbiterDecision(channel, targetUUID, decision, deps) {
  const { pttState, sendPTTSpeechResponse, broadcastToClients } = deps;

  if (decision === 'allow') {
    if (!pttState.allowedSpeakers.has(channel)) {
      pttState.allowedSpeakers.set(channel, new Set());
    }
    pttState.allowedSpeakers.get(channel).add(targetUUID);
    pttState.channelSpeakers.set(channel, targetUUID);
    sendPTTSpeechResponse(channel, targetUUID, 'ALLOW');
    broadcastToClients({
      type: 'ptt_speaker_update',
      channel: channel,
      speaker: targetUUID,
      action: 'allow',
      allowedBy: 'arbiter',
      timestamp: new Date().toISOString()
    });
  } else {
    sendPTTSpeechResponse(channel, targetUUID, 'DENY');
    broadcastToClients({
      type: 'ptt_speech_denied',
      channel: channel,
      requester: targetUUID,
      reason: '組長拒絕發言請求',
      timestamp: new Date().toISOString()
    });
  }

  // 從等待列表中移除
  const pendingRequests = pttState.pendingSpeechRequests.get(channel) || [];
  const updatedRequests = pendingRequests.filter(r => r.uuid !== targetUUID);
  pttState.pendingSpeechRequests.set(channel, updatedRequests);

  broadcastToClients({
    type: 'ptt_pending_requests_update',
    channel: channel,
    pendingRequests: updatedRequests,
    timestamp: new Date().toISOString()
  });
}

/**
 * 處理 PTT PRIVATE（私人/房間語音）
 * @param {string} topic - MQTT topic
 * @param {string} channel
 * @param {string} uuid
 * @param {string} tag
 * @param {Buffer} audioBuffer
 * @param {object} deps - { pttState, broadcastToClients, broadcastToRoom }
 */
function handlePTT_PRIVATE(topic, channel, uuid, tag, audioBuffer, deps) {
  const { pttState, broadcastToClients, broadcastToRoom } = deps;

  const parts = topic.split('/');
  const roomId = parts[parts.length - 1];

  // 自動建立房間
  if (!pttState.activePrivateCalls.has(roomId)) {
    const autoCall = {
      channel: channel,
      from: uuid,
      to: roomId,
      privateTopicID: roomId,
      startTime: new Date().toISOString(),
      participants: new Set([uuid])
    };
    pttState.activePrivateCalls.set(roomId, autoCall);

    broadcastToClients({
      type: 'private_call_started',
      call: {
        privateTopicID: roomId,
        channel: channel,
        from: uuid,
        to: roomId,
        startTime: autoCall.startTime
      }
    });
  }

  const audioPacket = {
    id: `private-${uuid}-${Date.now()}`,
    type: 'private',
    channel: channel,
    from: uuid,
    room: roomId,
    to: roomId,
    timestamp: new Date().toISOString(),
    audioData: audioBuffer.toString('base64'),
    tag: tag
  };

  return broadcastToRoom(roomId, {
    type: 'ptt_audio',
    packet: audioPacket
  });
}

/**
 * 處理私人通話請求 (握手)
 * @param {string} channel
 * @param {string} uuid
 * @param {string} data - "TargetUUID,PrivateTopicID"
 * @param {object} deps - { pttState, broadcastToClients, wss, WebSocket }
 */
function handlePTT_PrivateRequest(channel, uuid, data, deps) {
  const { pttState, broadcastToClients, wss, WebSocket } = deps;

  const parts = data.split(',');
  const targetUUID = parts[0]?.trim();
  const privateTopicID = parts[1]?.trim();

  if (!targetUUID || !privateTopicID) {
    return false;
  }

  const privateCall = {
    channel: channel,
    from: uuid,
    to: targetUUID,
    privateTopicID: privateTopicID,
    startTime: new Date().toISOString(),
    participants: new Set([uuid, targetUUID])
  };
  pttState.activePrivateCalls.set(privateTopicID, privateCall);

  broadcastToClients({
    type: 'private_call_started',
    call: {
      privateTopicID: privateTopicID,
      channel: channel,
      from: uuid,
      to: targetUUID,
      startTime: privateCall.startTime
    }
  });

  // 發給目標設備
  const targetWs = pttState.deviceConnections.get(targetUUID);
  if (targetWs && targetWs.readyState === WebSocket.OPEN) {
    targetWs.send(JSON.stringify({
      type: 'private_call_request',
      from: uuid,
      to: targetUUID,
      privateTopicID: privateTopicID,
      channel: channel,
      timestamp: new Date().toISOString()
    }));
  }

  return true;
}

/**
 * 網頁端客戶端加入房間
 */
function joinRoom(ws, roomId, deps) {
  const { pttState } = deps;

  if (!pttState.clientRooms.has(ws)) {
    pttState.clientRooms.set(ws, new Set());
  }
  pttState.clientRooms.get(ws).add(roomId);

  if (!pttState.roomClients.has(roomId)) {
    pttState.roomClients.set(roomId, new Set());
  }
  pttState.roomClients.get(roomId).add(ws);
}

/**
 * 網頁端客戶端離開房間
 */
function leaveRoom(ws, roomId, deps) {
  const { pttState } = deps;

  const clientRooms = pttState.clientRooms.get(ws);
  if (clientRooms) {
    clientRooms.delete(roomId);
  }

  const roomClients = pttState.roomClients.get(roomId);
  if (roomClients) {
    roomClients.delete(ws);
    if (roomClients.size === 0) {
      pttState.roomClients.delete(roomId);
    }
  }
}

/**
 * 網頁端客戶端離開所有房間
 */
function leaveAllRooms(ws, deps) {
  const { pttState } = deps;
  const rooms = pttState.clientRooms.get(ws);
  if (rooms) {
    rooms.forEach(roomId => {
      const roomClients = pttState.roomClients.get(roomId);
      if (roomClients) {
        roomClients.delete(ws);
        if (roomClients.size === 0) {
          pttState.roomClients.delete(roomId);
        }
      }
    });
    pttState.clientRooms.delete(ws);
  }
}

/**
 * 廣播訊息給指定房間的所有網頁端客戶端
 * @param {string} roomId
 * @param {object} data
 * @param {object} deps - { pttState, WebSocket }
 */
function broadcastToRoom(roomId, data, deps) {
  const { pttState, WebSocket } = deps;

  const roomClients = pttState.roomClients.get(roomId);
  if (!roomClients || roomClients.size === 0) {
    return 0;
  }

  const message = JSON.stringify(data);
  let successCount = 0;

  roomClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        successCount++;
      } catch (error) {
        // silent
      }
    }
  });

  return successCount;
}

module.exports = {
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
};
