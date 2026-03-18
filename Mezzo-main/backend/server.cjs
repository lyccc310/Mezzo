/**
 * Mezzo 後端主伺服器
 * =====================
 * 功能：
 * - PTT 語音通訊系統（執法儀語音對講）
 * - 設備位置追蹤與管理
 * - WebSocket 即時訊息推送
 * - MQTT 訊息橋接
 *
 * 服務埠號：
 * - HTTP API: configurable via HTTP_PORT env
 * - WebSocket: configurable via WS_PORT env
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const xml2js = require('xml2js');
const path = require('path');
const fs = require('fs');
const tls = require('tls');
const net = require('net');
const logger = require('./logger.cjs');
const { requireAuth, verifyWsToken } = require('./auth.cjs');
const db = require('./db.cjs');
const redis = require('./redis.cjs');
const { createRedisPttState } = require('./ptt-state-redis.cjs');
const GPSBatcher = require('./gps-batcher.cjs');
const pttLogic = require('./ptt-logic.cjs');

const app = express();

// ==================== 伺服器埠號配置 ====================
const HTTP_PORT = parseInt(process.env.HTTP_PORT) || 4000;
const WS_PORT = parseInt(process.env.WS_PORT) || 4001;
const HOST = process.env.HOST || '0.0.0.0';

// ==================== 系統配置 ====================

const SERVER_URL = process.env.SERVER_URL || '192.168.254.1';
const PUBLIC_URL = `http://${SERVER_URL}:${HTTP_PORT}`;

// TAK Server 配置
const TAK_CONFIG = {
  enabled: process.env.TAK_ENABLED === 'true',
  host: process.env.TAK_HOST || SERVER_URL,
  port: parseInt(process.env.TAK_PORT) || 8087,
  useTLS: process.env.TAK_USE_TLS === 'true',
  reconnectInterval: parseInt(process.env.TAK_RECONNECT_INTERVAL) || 5000,
  heartbeatInterval: parseInt(process.env.TAK_HEARTBEAT_INTERVAL) || 30000
};

// ==================== 舊版 MQTT 配置（已移除） ====================
// 注意：原有的 mezzo/* topics 已被 PTT MQTT 取代
// - mezzo/camera/gps → /WJI/PTT/{Channel}/GPS
// - mezzo/camera/control → 未使用
// - mezzo/camera/status → 未使用
// - mezzo/cot/message → TAK 已停用
// - mezzo/device/+/status → 未使用

// ==================== PTT MQTT 配置（執法儀專用） ====================
// 注意：此 Broker 專門用於執法儀 PTT 語音系統
const PTT_MQTT_CONFIG = {
  broker: process.env.MQTT_BROKER_URL || 'mqtt://118.163.141.80:1688',
  topics: {
    ALL: '/WJI/PTT/#'
  },
  options: {
    clientId: `${process.env.MQTT_CLIENT_PREFIX || 'mezzo-ptt-bridge'}-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000
  }
};

// ==================== BWC 執法儀影像串流配置 ====================
const BWC_STREAM_HOST = process.env.BWC_STREAM_HOST || '118.163.141.80';
const BWC_STREAM_PORT = process.env.BWC_STREAM_PORT || '80';
const BWC_STREAM_AUTH = process.env.BWC_STREAM_AUTH || 'QWRtaW46MTIzNA==';
const BWC_STREAM_CONFIG = {
  defaultStreamUrl: `http://${BWC_STREAM_HOST}:${BWC_STREAM_PORT}/mjpeg_stream.cgi?Auth=${BWC_STREAM_AUTH}&ch=0`,
  getStreamUrl: (uuid, channelIndex = 0) => {
    return `http://${BWC_STREAM_HOST}:${BWC_STREAM_PORT}/mjpeg_stream.cgi?Auth=${BWC_STREAM_AUTH}&ch=${channelIndex}`;
  }
};

// ==================== RTSP 影像串流配置 ====================
const STREAM_CONFIG = {
  enabled: process.env.STREAM_ENABLED !== 'false',
  outputDir: path.join(__dirname, 'streams'),
  ffmpegOptions: {
    rtspTransport: 'tcp',
    videoCodec: 'copy',
    audioCodec: 'aac',
    hlsTime: 2,
    hlsListSize: 5,
    hlsFlags: 'delete_segments+append_list'
  },
  maxStreams: parseInt(process.env.STREAM_MAX) || 10,
  streamTimeout: parseInt(process.env.STREAM_TIMEOUT) || 300000
};

// ==================== 資料儲存（記憶體） ====================

// 設備與群組管理
const connectedDevices = new Map();  // 設備 ID → 設備物件（位置、狀態、群組等）
const deviceGroups = new Map();      // 群組名稱 → Set<設備 ID>

// TAK Server 相關
const cotMessages = [];  // CoT 訊息歷史

// 影像串流管理
const rtspStreams = new Map();    // 串流 ID → 串流設定
const rtspProcesses = new Map();  // 串流 ID → FFmpeg 進程
const streamActivity = new Map(); // 串流 ID → 最後活動時間

// 訊息系統
const messages = [];  // 訊息歷史（最多保留 100 則）

// ==================== PTT 狀態管理 ====================
// Redis-backed state: in-memory cache + write-through to Redis.
// Falls back to pure in-memory if REDIS_URL is not set.
const pttState = createRedisPttState(redis);

// GPS batch writer for device_positions table
const gpsBatcher = new GPSBatcher(db, {
  flushIntervalMs: parseInt(process.env.GPS_BATCH_INTERVAL) || 5000,
  maxBatchSize: parseInt(process.env.GPS_BATCH_SIZE) || 200,
});

// Initialize database schema and hydrate Redis state
(async () => {
  try {
    await db.initSchema();
    await pttState.hydrate();
    gpsBatcher.start();
  } catch (err) {
    logger.error('Startup initialization error', { error: err.message });
  }
})();

// ==================== 初始化 ====================

// 確保影像串流輸出目錄存在
if (STREAM_CONFIG.enabled && !fs.existsSync(STREAM_CONFIG.outputDir)) {
  fs.mkdirSync(STREAM_CONFIG.outputDir, { recursive: true });
 logger.info('Created streams directory:', STREAM_CONFIG.outputDir);
}
const streamsPath = path.resolve(__dirname, 'streams');
// ==================== TAK Client（支援 SSL）====================

class TAKClient {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.connected = false;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.messageQueue = [];
  }

  connect() {
 logger.info(`Connecting to TAK Server: ${this.config.host}:${this.config.port} (TLS: ${this.config.useTLS})`);

    const connectionOptions = {
      host: this.config.host,
      port: this.config.port,
      rejectUnauthorized: false
    };

    if (this.config.useTLS) {
      this.socket = tls.connect(connectionOptions);
    } else {
      this.socket = net.createConnection(connectionOptions);
    }

    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.socket.on('connect', () => {
 logger.info('Connected to TAK Server');
      this.connected = true;
      this.clearReconnectTimer();
      this.startHeartbeat();
      this.flushMessageQueue();
    });

    this.socket.on('secureConnect', () => {
 logger.info('TLS connection established');
      this.connected = true;
    });

    this.socket.on('data', (data) => {
      const message = data.toString();
      if (!message.includes('<ping') && !message.includes('<pong')) {
 logger.info('TAK Server:', message.substring(0, 100) + '...');
      }
      this.handleTakMessage(message);
    });

    this.socket.on('error', (error) => {
 logger.error('TAK Server error:', error.message);
      this.connected = false;
    });

    this.socket.on('close', () => {
 logger.info('TAK Server disconnected');
      this.connected = false;
      this.stopHeartbeat();
      this.reconnect();
    });

    this.socket.on('timeout', () => {
 logger.warn('⏱ TAK Server timeout');
      this.socket.destroy();
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.connected) {
        this.sendRaw('<?xml version="1.0"?><ping/>');
      }
    }, this.config.heartbeatInterval);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  reconnect() {
    if (this.reconnectTimer) return;

 logger.info(`⏳ Reconnecting to TAK Server in ${this.config.reconnectInterval / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.config.reconnectInterval);
  }

  sendCoT(cotXml) {
    if (!this.connected || !this.socket) {
 logger.warn('TAK Server not connected, queuing message');
      this.messageQueue.push(cotXml);
      if (this.messageQueue.length > 100) {
        this.messageQueue.shift();
      }
      return false;
    }

    return this.sendRaw(cotXml);
  }

  sendRaw(message) {
    try {
      // 📝 舊寫法: this.socket.write(message + '\n');
      
      // 🛡️ 保險寫法: 強制轉成 UTF-8 Buffer 再發送
      // 這樣就算沒寫 XML header，資料流本身也保證是 UTF-8
      const buffer = Buffer.from(message + '\n', 'utf8');
      this.socket.write(buffer);

      if (!message.includes('<ping')) {
        logger.debug('Sent message to TAK Server');
      }
      return true;
    } catch (error) {
 logger.error('Failed to send to TAK:', error.message);
      this.connected = false;
      return false;
    }
  }

  flushMessageQueue() {
    if (this.messageQueue.length === 0) return;

 logger.info(`Flushing ${this.messageQueue.length} queued messages`);
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.sendRaw(message);
    }
  }

  handleTakMessage(message) {
    try {
      // 過濾 ping/pong 訊息
      if (message.includes('<ping') || message.includes('<pong')) {
        return;
      }

      // 清理訊息
      const cleanedMessage = message
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();

      if (cleanedMessage.length < 10 || !cleanedMessage.includes('<?xml')) {
        return;
      }

      const parser = new xml2js.Parser({
        explicitArray: false,
        mergeAttrs: false,
        trim: true,
        normalize: true,
        normalizeTags: false
      });

      parser.parseString(cleanedMessage, (err, result) => {
        if (err) {
 logger.error('TAK message parse error:', err.message);
          return;
        }

        if (!result || !result.event) {
          return;
        }

        const event = result.event;
 logger.info('Received CoT from TAK Server:', event.$.uid);

        // 提取設備資訊
        const uid = event.$.uid;
        const type = event.$.type || 'unknown';
        const point = event.point?.$;

        if (!point || !point.lat || !point.lon) {
 logger.warn('CoT missing position data');
          return;
        }

        const lat = parseFloat(point.lat);
        const lng = parseFloat(point.lon);
        const alt = parseFloat(point.hae || point.alt || 0);

        if (isNaN(lat) || isNaN(lng)) {
 logger.warn('Invalid coordinates in CoT');
          return;
        }

        // 提取詳細資訊
        const detail = event.detail || {};
        const contact = detail.contact || {};
        const callsign = contact.$.callsign || contact.callsign || uid;

        // ===== 提取群組資訊 (ATAK) =====
        let group = '未分組';
        let role = null;

        if (detail.__group) {
          const groupData = detail.__group.$ || detail.__group;
          group = groupData.name || group;
          role = groupData.role || null;
        }

        // 判斷設備類型
        let deviceType = 'unknown';
        if (type.includes('a-f')) deviceType = 'friendly';
        else if (type.includes('a-h')) deviceType = 'hostile';
        else if (type.includes('a-n')) deviceType = 'neutral';
        else if (type.includes('a-u')) deviceType = 'unknown';
        else if (type.includes('b-m-p-s-p')) deviceType = 'camera';

        // 建立或更新設備
        const device = {
          id: uid,
          type: deviceType,
          position: { lat, lng, alt },
          callsign: callsign,
          status: 'active',
          priority: 3,  // 預設優先級
          group: group,  // ← 群組資訊
          role: role,    // ← 角色資訊 (ATAK)
          lastUpdate: new Date().toISOString(),
          source: 'tak_server',
          cotType: type
        };

        // 儲存設備
        connectedDevices.set(uid, device);

        // 更新群組索引
        updateGroupIndex(uid, group);

        logger.info(`Updated device from TAK: ${uid}`);
        if (group !== '未分組') {
 logger.info(`群組: ${group}${role ?` - ${role}` : ''}`);
        }

        // 廣播到前端
        broadcastToClients({
          type: 'device_update',
          device: cleanDeviceData(device)
        });

        // 同時廣播原始 TAK 訊息
        broadcastToClients({
          type: 'tak_message',
          data: result,
          timestamp: new Date().toISOString()
        });
      });
    } catch (error) {
 logger.error('TAK message parse error:', error);
    }
  }

  disconnect() {
 logger.info('Disconnecting from TAK Server');
    this.stopHeartbeat();
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  getStatus() {
    return {
      connected: this.connected,
      host: this.config.host,
      port: this.config.port,
      useTLS: this.config.useTLS,
      queuedMessages: this.messageQueue.length
    };
  }
}

// 初始化 TAK Client
let takClient = null;
if (TAK_CONFIG.enabled) {
  takClient = new TAKClient(TAK_CONFIG);
  takClient.connect();
}

// ==================== 群組管理函數 ====================

function updateGroupIndex(deviceId, groupName) {
  deviceGroups.forEach((members, group) => {
    members.delete(deviceId);
    if (members.size === 0) {
      deviceGroups.delete(group);
    }
  });

  if (!deviceGroups.has(groupName)) {
    deviceGroups.set(groupName, new Set());
  }
  deviceGroups.get(groupName).add(deviceId);
}

function getGroupMembers(groupName) {
  return Array.from(deviceGroups.get(groupName) || []);
}

function getAllGroups() {
  return Array.from(deviceGroups.keys());
}

function getDeviceGroup(deviceId) {
  const device = connectedDevices.get(deviceId);
  return device?.group || '未分組';
}

// ==================== PTT 訊息解析函數 ====================

/**
 * 解析 PTT MQTT 訊息格式
 *
 * PTT 訊息使用固定的二進制格式：
 * ┌──────────────┬───────────────┬─────────────┐
 * │  Tag         │    UUID       │   Data      │
 * │  (32 bytes)  │  (128 bytes)  │ (Variable)  │
 * └──────────────┴───────────────┴─────────────┘
 *
 * @param {Buffer} buffer - MQTT 訊息的 Binary Buffer
 * @returns {Object|null} { tag, uuid, data } 或 null（如果解析失敗）
 *
 * Tag 類型範例：
 * - "GPS"          - GPS 位置更新
 * - "SOS"          - 緊急求救
 * - "SPEECH_AUDIO" - 群組語音音訊
 * - "PRIVATE_AUDIO" - 私人語音音訊
 * - "BROADCAST"    - 廣播訊息
 *
 * UUID: 發送者的設備 ID
 * Data: 根據 Tag 類型而異的資料內容
 */
function parsePTTMessage(buffer) {
  const result = pttLogic.parsePTTMessage(buffer);
  if (!result) logger.warn('PTT message too short or parse error', { length: buffer?.length });
  return result;
}

/**
 * 處理 PTT GPS 位置訊息
 *
 * Topic: /WJI/PTT/{Channel}/GPS
 * Data 格式: "UUID,Lat,Lon" 或 "Lat,Lon"
 *
 * 功能：
 * 1. 解析 GPS 座標
 * 2. 建立或更新設備位置資訊
 * 3. 透過 WebSocket 廣播給所有前端客戶端
 *
 * @param {string} channel - PTT 頻道名稱（如 "channel1"）
 * @param {string} uuid - 設備 ID（執法儀或使用者 ID）
 * @param {string} data - GPS 資料字串
 */
function handlePTT_GPS(channel, uuid, data) {
  try {
    logger.debug('PTT GPS received', { channel, uuid });

    // 解析 GPS 資料：支援兩種格式
    // 格式 1: "UUID,Lat,Lon" - 包含 UUID 的完整格式
    // 格式 2: "Lat,Lon"      - 簡化格式
    const parts = data.split(',');
    let lat, lon;

    if (parts.length >= 3) {
      // 格式 1：UUID,Lat,Lon
      lat = parseFloat(parts[1]);
      lon = parseFloat(parts[2]);
    } else if (parts.length >= 2) {
      // 格式 2：Lat,Lon
      lat = parseFloat(parts[0]);
      lon = parseFloat(parts[1]);
    } else {
      logger.warn('Invalid GPS data format', { uuid });
      return;
    }

    // 驗證座標有效性
    if (isNaN(lat) || isNaN(lon)) {
      logger.warn('Invalid GPS coordinates', { uuid });
      return;
    }

    // 計算設備的串流頻道索引（用於多設備支援）
    // 基於 UUID 的穩定雜湊，確保同一設備總是取得相同頻道
    const existingDevice = connectedDevices.get(uuid);
    let streamChannelIndex = 0;
    if (existingDevice && existingDevice.streamChannelIndex !== undefined) {
      streamChannelIndex = existingDevice.streamChannelIndex;
    } else {
      // 新設備：分配頻道索引（基於當前設備數量）
      streamChannelIndex = connectedDevices.size;
    }

    // 建立或更新設備物件
    const device = {
      id: uuid,                          // 設備唯一 ID
      type: 'bwc',                        // 設備類型：BWC 執法儀
      position: { lat, lng: lon, alt: 0 },  // 位置（經緯度、高度）
      callsign: uuid.substring(0, 20),   // 顯示名稱（截取前 20 字元）
      group: channel || 'PTT',           // 所屬群組（預設為 PTT）
      status: 'active',                  // 設備狀態
      source: 'ptt_gps',                 // 資料來源標記
      priority: 3,                       // 優先級（1-4，3 為一般）
      lastUpdate: new Date().toISOString(),  // 最後更新時間
      // ===== BWC 執法儀專屬屬性 =====
      streamUrl: BWC_STREAM_CONFIG.getStreamUrl(uuid, streamChannelIndex),  // 預設影像串流
      streamChannelIndex: streamChannelIndex,  // 串流頻道索引
      isBWC: true                         // 標記為 BWC 執法儀
    };

    // 存入記憶體儲存
    connectedDevices.set(uuid, device);           // 設備列表
    updateGroupIndex(uuid, device.group);         // 群組索引
    pttState.activeUsers.set(uuid, {              // PTT 活躍使用者
      lastSeen: Date.now(),
      channel
    });

    // DB: batch GPS position + upsert device
    gpsBatcher.add(uuid, lat, lon, 0, channel);
    db.query(
      `INSERT INTO devices (device_id, device_type, lat, lng, alt, callsign, device_group, status, source, is_bwc, stream_channel_index, last_update)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       ON CONFLICT (device_id) DO UPDATE SET lat=$3, lng=$4, alt=$5, device_group=$7, status=$8, last_update=NOW()`,
      [uuid, 'bwc', lat, lon, 0, uuid.substring(0, 20), channel || 'PTT', 'active', 'ptt_gps', true, streamChannelIndex]
    ).catch(err => logger.error('Device upsert error', { error: err.message }));

    logger.info(`PTT GPS updated: ${uuid}`);

    // 透過 WebSocket 廣播給所有連線的前端客戶端
    // 前端會在地圖上顯示/更新該設備的位置標記
    broadcastToClients({
      type: 'device_update',
      device: cleanDeviceData(device)  // 使用 cleanDeviceData 確保格式正確
    });

  } catch (error) {
    logger.error('PTT GPS handler error', { error: error.message });
  }
}

/**
 * 處理 PTT SOS 訊息
 */
function handlePTT_SOS(channel, uuid, data) {
  try {
 logger.info('🆘 [PTT SOS]', { channel, uuid, data });

    // 解析 SOS 資料：格式 "Lat,Lon"
    const parts = data.split(',');
    if (parts.length < 2) {
 logger.warn('Invalid SOS data format:', data);
      return;
    }

    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);

    if (isNaN(lat) || isNaN(lon)) {
      logger.warn('Invalid SOS coordinates', { uuid });
      return;
    }

    // 建立 SOS 事件
    const sosEvent = {
      id: `SOS-${uuid}-${Date.now()}`,
      type: 'sos',
      deviceId: uuid,
      position: { lat, lng: lon, alt: 0 },
      callsign: uuid.substring(0, 20),
      group: channel || 'PTT',
      timestamp: new Date().toISOString(),
      priority: 1,  // 最高優先級
      status: 'active',
      source: 'ptt_sos'
    };

    // 存入 SOS 警報列表
    pttState.sosAlerts.set(sosEvent.id, sosEvent);

    // DB: persist SOS alert
    db.query(
      `INSERT INTO sos_alerts (alert_id, device_id, lat, lng, alt, callsign, channel, priority, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (alert_id) DO NOTHING`,
      [sosEvent.id, uuid, lat, lon, 0, uuid.substring(0, 20), channel || 'PTT', 1, 'active']
    ).catch(err => logger.error('SOS insert error', { error: err.message }));

    // 同時也作為設備更新
    connectedDevices.set(uuid, {
      ...sosEvent,
      id: uuid
    });
    updateGroupIndex(uuid, sosEvent.group);

    logger.info('SOS Alert received', { uuid, channel });

    // 廣播 SOS 警報
    broadcastToClients({
      type: 'sos_alert',
      event: sosEvent
    });

    // 也廣播設備更新
    broadcastToClients({
      type: 'device_update',
      device: cleanDeviceData(sosEvent)
    });

  } catch (error) {
 logger.error('PTT SOS handler error:', error);
  }
}

/**
 * 處理 PTT 廣播訊息
 */
function handlePTT_Broadcast(channel, uuid, tag, data) {
  try {
 logger.info('[PTT Broadcast]', { channel, uuid, tag, data });

    // 建立訊息物件 - 廣播發送到所有頻道
    const message = {
      id: `ptt-msg-${Date.now()}`,
      from: uuid,
      to: 'all',  // 廣播到所有頻道
      text: data || `PTT ${tag}`,
      priority: 3,
      timestamp: new Date().toISOString(),
      source: 'ptt_broadcast',
      channel: channel  // 保留來源頻道資訊
    };

    // 存入訊息歷史
    messages.push(message);
    if (messages.length > 100) {
      messages.shift();
    }

    // DB: persist broadcast message
    db.query(
      `INSERT INTO messages (message_id, from_user, to_target, text, priority, source, channel)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [message.id, message.from, message.to, message.text, message.priority, message.source, channel]
    ).catch(err => logger.error('Message insert error', { error: err.message }));

 logger.info(`PTT Broadcast: ${uuid} → ALL (from ${channel})`);

    // 只廣播一次，使用 ptt_broadcast 類型
    broadcastToClients({
      type: 'ptt_broadcast',
      message: message
    });

  } catch (error) {
 logger.error('PTT Broadcast handler error:', error);
  }
}

/**
 * 處理 PTT 文字訊息 (TEXT_MESSAGE)
 */
function handlePTT_TextMessage(channel, uuid, data) {
  try {
 logger.info('[PTT Text Message]', { channel, uuid, data });

    // 建立訊息物件
    const message = {
      id: `ptt-text-${Date.now()}`,
      from: uuid,
      to: `group:${channel || 'PTT'}`,
      text: data,
      priority: 3,
      timestamp: new Date().toISOString(),
      source: 'ptt_text'
    };

    // 存入訊息歷史
    messages.push(message);
    if (messages.length > 100) {
      messages.shift();
    }

    // DB: persist text message
    db.query(
      `INSERT INTO messages (message_id, from_user, to_target, text, priority, source, channel)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [message.id, message.from, message.to, message.text, message.priority, message.source, channel]
    ).catch(err => logger.error('Message insert error', { error: err.message }));

 logger.info(`PTT Text Message: ${uuid} → ${channel}: ${data}`);

    // 只廣播一次，使用 ptt_broadcast 類型
    broadcastToClients({
      type: 'ptt_broadcast',
      message: message
    });

  } catch (error) {
 logger.error('PTT Text Message handler error:', error);
  }
}

/**
 * 處理 PTT MARK (標記) 訊息
 */
function handlePTT_MARK(channel, uuid, tag, data) {
  try {
 logger.info('[PTT MARK]', { channel, uuid, tag, data });

    const isStart = tag.includes('START');
    const action = isStart ? '開始錄影' : '停止錄影';

    // 更新設備狀態
    const device = connectedDevices.get(uuid);
    if (device) {
      device.recording = isStart;
      device.lastUpdate = new Date().toISOString();
      connectedDevices.set(uuid, device);

      broadcastToClients({
        type: 'device_update',
        device: cleanDeviceData(device)
      });
    }

    // 建立標記事件
    const markEvent = {
      id: `mark-${uuid}-${Date.now()}`,
      deviceId: uuid,
      action: isStart ? 'start' : 'stop',
      timestamp: new Date().toISOString(),
      channel: channel
    };

 logger.info(`MARK ${action}: ${uuid}`);

    // 廣播標記事件
    broadcastToClients({
      type: 'ptt_mark',
      event: markEvent
    });

  } catch (error) {
 logger.error('PTT MARK handler error:', error);
  }
}

/**
 * 處理 PTT 群組語音音訊
 *
 * Topic: /WJI/PTT/{Channel}/SPEECH
 * Data: Binary 音訊資料（WebM Opus 或 OGG Opus 格式）
 *
 * 功能：
 * 1. 接收執法儀發送的群組語音音訊
 * 2. 將音訊編碼為 Base64
 * 3. 透過 WebSocket 廣播給該頻道的所有前端客戶端
 * 4. 前端自動播放音訊（遠端監聽）
 *
 * @param {string} channel - PTT 頻道名稱
 * @param {string} uuid - 發送者設備 ID
 * @param {string} tag - 訊息標籤（如 "SPEECH_AUDIO"）
 * @param {Buffer} audioBuffer - 原始音訊資料 Buffer
 */
function handlePTT_SPEECH(channel, uuid, tag, audioBuffer) {
  try {
 logger.info('[PTT SPEECH]', {
      channel,
      uuid,
      tag,
      audioSize: audioBuffer.length,
      arbiterMode: pttState.arbiterMode
    });

    // ===== 仲裁模式：不在音訊層攔截 =====
    // BWC 不會等 ALLOW 才送音訊，所以仲裁只在 SPEECH_START 信令層控制
    // 這裡只記錄狀態，音訊一律轉發給前端
    if (pttState.arbiterMode) {
      const currentSpeaker = pttState.channelSpeakers.get(channel);
      const allowedSpeakers = pttState.allowedSpeakers.get(channel) || new Set();
      const isApproved = currentSpeaker === uuid || allowedSpeakers.has(uuid);
      if (!isApproved) {
 logger.info(`[ARBITER] SPEECH from unapproved ${uuid} - forwarding anyway (BWC sends before ALLOW)`);
      }
    }

    // 將音訊 Binary 資料轉換為 Base64 字串
    const audioData = audioBuffer.toString('base64');

    // 去重檢查：避免重複廣播同一段音訊
    const messageKey = `${uuid}-${audioData.substring(0, 50)}`;
    if (pttState.broadcastedTranscripts.has(messageKey)) {
 logger.info(`⏭ Skipping duplicate broadcast (already sent as transcript): ${uuid}`);
      return;
    }

    // 建立音訊封包事件物件
    const audioPacket = {
      id: `speech-${uuid}-${Date.now()}`,
      type: 'speech',
      channel: channel,
      from: uuid,
      timestamp: new Date().toISOString(),
      audioData: audioData,
      tag: tag
    };

    // 群組語音廣播給所有連線的網頁端客戶端
    broadcastToClients({
      type: 'ptt_audio',
      packet: audioPacket
    });

 logger.info(`SPEECH broadcasted: ${uuid} → ${channel} (${audioBuffer.length} bytes, ${wss.clients.size} clients)`);

  } catch (error) {
 logger.error('PTT SPEECH handler error:', error);
  }
}

/**
 * 處理 PTT PRIVATE (私人語音/房間語音)
 *
 * 注意：BWC 執法儀的 PRIVATE 模式實際上是「房間」概念
 * targetDeviceId (如 user_9131) 代表一個房間 ID，
 * 所有在該房間的人都應該收到音訊。
 *
 * 目前實作：廣播給所有連線的 WebSocket 客戶端（監控模式）
 */
function handlePTT_PRIVATE(topic, channel, uuid, tag, audioBuffer) {
  try {
    // 從 topic 中提取房間 ID
    // 格式: /WJI/PTT/{Channel}/PRIVATE/{RoomId}
    const parts = topic.split('/');
    const roomId = parts[parts.length - 1];

    // ===== 自動建立房間：如果收到音訊但房間不存在，自動建立並通知前端 =====
    if (!pttState.activePrivateCalls.has(roomId)) {
 logger.info(`Auto-creating room from PRIVATE audio: ${roomId}`);
      const autoCall = {
        channel: channel,
        from: uuid,
        to: roomId,
        privateTopicID: roomId,
        startTime: new Date().toISOString(),
        participants: new Set([uuid])
      };
      pttState.activePrivateCalls.set(roomId, autoCall);

      // 通知所有前端：新房間出現
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
 logger.info(`Room ${roomId} auto-created & broadcasted (Active rooms: ${pttState.activePrivateCalls.size})`);
    }

 logger.info('[PTT PRIVATE/ROOM]', {
      channel,
      from: uuid,
      room: roomId,
      tag,
      audioSize: audioBuffer.length
    });

    // 建立私人/房間音訊封包事件
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

    // 廣播給已加入該私人房間的網頁端客戶端
    const sentCount = broadcastToRoom(roomId, {
      type: 'ptt_audio',
      packet: audioPacket
    });

 logger.info(`PRIVATE/ROOM to room: ${uuid} → room:${roomId} (${sentCount} clients)`);

  } catch (error) {
 logger.error('PTT PRIVATE handler error:', error);
  }
}

/**
 * 處理私人通話請求 (握手)
 *
 * 網頁端組長自動加入所有私人通話房間：
 * - 當 BWC 執法儀發起私人通話時，自動追蹤該房間
 * - 所有網頁端客戶端都能收到私人通話的音訊（監聽模式）
 * - 組長可以看到所有進行中的私人通話
 */
function handlePTT_PrivateRequest(channel, uuid, data) {
  try {
    // Data 格式: "TargetUUID,PrivateTopicID"
    logger.debug('PRIVATE_SPK_REQ received', { channel, uuid });
    const parts = data.split(',');
    const targetUUID = parts[0]?.trim();
    const privateTopicID = parts[1]?.trim();

    if (!targetUUID || !privateTopicID) {
      logger.error('PRIVATE_SPK_REQ invalid data format', { uuid });
      return;
    }

 logger.info('[PRIVATE_SPK_REQ]', {
      from: uuid,
      to: targetUUID,
      privateTopicID: privateTopicID
    });

    // ===== 追蹤私人通話房間（網頁端組長自動加入） =====
    const privateCall = {
      channel: channel,
      from: uuid,
      to: targetUUID,
      privateTopicID: privateTopicID,
      startTime: new Date().toISOString(),
      participants: new Set([uuid, targetUUID])
    };
    pttState.activePrivateCalls.set(privateTopicID, privateCall);

    // DB: persist call record
    db.query(
      `INSERT INTO call_records (private_topic_id, channel, from_device, to_device, started_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [privateTopicID, channel, uuid, targetUUID, new Date()]
    ).catch(err => logger.error('Call record insert error', { error: err.message }));

 logger.info(`Private call room registered: ${privateTopicID} (Active rooms: ${pttState.activePrivateCalls.size})`);

    // 建立通話請求訊息
    const callRequest = {
      type: 'private_call_request',
      from: uuid,
      to: targetUUID,
      privateTopicID: privateTopicID,
      channel: channel,
      timestamp: new Date().toISOString()
    };

    // ===== 廣播通知前端：有新房間可加入 =====
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
 logger.info(`Room ${privateTopicID} created, notified ${wss.clients.size} web clients`);

    // 發給目標設備
    const targetWs = pttState.deviceConnections.get(targetUUID);
    const senderWs = pttState.deviceConnections.get(uuid);

    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(JSON.stringify(callRequest));
 logger.info(`Private call request sent: ${uuid} → ${targetUUID} (Topic: ${privateTopicID})`);
    } else {
 logger.info(`Target device ${targetUUID} not connected (web clients still monitoring)`);
    }

    // 通知發送者請求已發送
    if (senderWs && senderWs.readyState === WebSocket.OPEN) {
      senderWs.send(JSON.stringify({
        type: 'private_call_request_sent',
        to: targetUUID,
        privateTopicID: privateTopicID
      }));
    }

  } catch (error) {
 logger.error('PTT PRIVATE_SPK_REQ handler error:', error);
  }
}

/**
 * 處理私人通話結束
 *
 * 當私人通話結束時：
 * - 清理 activePrivateCalls 中的房間記錄
 * - 通知所有網頁端客戶端該房間已關閉
 */
function handlePTT_PrivateStop(channel, uuid, data) {
  try {
    const targetUUID = data.trim();

 logger.info('[PRIVATE_SPK_STOP]', {
      channel: channel,
      from: uuid,
      to: targetUUID
    });

    // ===== 查找並清理對應的私人通話房間 =====
    let closedRoomId = null;
    for (const [topicId, call] of pttState.activePrivateCalls.entries()) {
      // 找到包含這兩個參與者的房間
      if ((call.from === uuid && call.to === targetUUID) ||
          (call.from === targetUUID && call.to === uuid)) {
        closedRoomId = topicId;
        pttState.activePrivateCalls.delete(topicId);

        // DB: update call record with end time
        db.query(
          `UPDATE call_records SET ended_at=NOW(), status='ended',
           duration_seconds=EXTRACT(EPOCH FROM (NOW() - started_at))::integer
           WHERE private_topic_id=$1 AND status='active'`,
          [topicId]
        ).catch(err => logger.error('Call record update error', { error: err.message }));

 logger.info(`Private call room closed: ${topicId} (Active rooms: ${pttState.activePrivateCalls.size})`);
        break;
      }
    }

    const stopMessage = {
      type: 'private_call_stop',
      from: uuid,
      to: targetUUID,
      privateTopicID: closedRoomId,
      channel: channel,
      timestamp: new Date().toISOString()
    };

    // ===== 廣播給所有網頁端客戶端（組長離開房間） =====
    broadcastToClients({
      type: 'private_call_ended',
      call: stopMessage
    });
 logger.info(`Private call end broadcasted to ${wss.clients.size} web clients`);

    // 通知雙方結束通話
    const targetWs = pttState.deviceConnections.get(targetUUID);
    const senderWs = pttState.deviceConnections.get(uuid);

    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(JSON.stringify(stopMessage));
 logger.info(`Private call stopped: ${uuid} → ${targetUUID}`);
    }

    if (senderWs && senderWs.readyState === WebSocket.OPEN) {
      senderWs.send(JSON.stringify(stopMessage));
    }

  } catch (error) {
 logger.error('PTT PRIVATE_SPK_STOP handler error:', error);
  }
}

/**
 * 處理 PTT 群組通話「請求發言」
 * Tag: PTT_MSG_TYPE_SPEECH_START
 *
 * 組長仲裁模式：所有發言請求都需要組長（前端）核准
 */
function handlePTT_SpeechStart(channel, uuid, data) {
  try {
    logger.info('[PTT_MSG_TYPE_SPEECH_START]', {
      channel, from: uuid,
      arbiterMode: pttState.arbiterMode,
      currentSpeaker: pttState.channelSpeakers.get(channel)
    });
    pttLogic.handlePTT_SpeechStart(channel, uuid, data, {
      pttState, sendPTTSpeechResponse, broadcastToClients
    });
  } catch (error) {
    logger.error('PTT SPEECH_START handler error:', error);
  }
}

/**
 * 發送 PTT 發言回應 (ALLOW/DENY) 給 BWC 設備
 * 透過 MQTT 發送到 /WJI/PTT/{Channel}/CHANNEL_ANNOUNCE
 */
function sendPTTSpeechResponse(channel, targetUUID, response) {
  try {
    const tag = response === 'ALLOW'
      ? 'PTT_MSG_TYPE_SPEECH_START_ALLOW'
      : 'PTT_MSG_TYPE_SPEECH_START_DENY';

    // 建立 PTT 格式訊息 (Tag: 32 bytes + UUID: 128 bytes + Data)
    const tagBuffer = Buffer.alloc(32);
    tagBuffer.write(tag, 0, 'utf8');

    const uuidBuffer = Buffer.alloc(128);
    uuidBuffer.write('SERVER', 0, 'utf8');  // 發送者是伺服器

    const dataBuffer = Buffer.from(targetUUID, 'utf8');  // Data 是目標 UUID

    const message = Buffer.concat([tagBuffer, uuidBuffer, dataBuffer]);

    const topic = `/WJI/PTT/${channel}/CHANNEL_ANNOUNCE`;

    pttMqttClient.publish(topic, message, (err) => {
      if (err) {
 logger.error(`Failed to send ${response} to ${targetUUID}:`, err);
      } else {
 logger.info(`Sent ${tag} to ${targetUUID} on ${topic}`);
      }
    });

  } catch (error) {
 logger.error('sendPTTSpeechResponse error:', error);
  }
}

/**
 * 組長允許/拒絕發言請求
 * 由前端 WebSocket 呼叫
 */
function arbiterDecision(channel, targetUUID, decision) {
  try {
    logger.info(`Arbiter decision: ${decision} for ${targetUUID} on channel ${channel}`);
    pttLogic.arbiterDecision(channel, targetUUID, decision, {
      pttState, sendPTTSpeechResponse, broadcastToClients
    });
  } catch (error) {
    logger.error('arbiterDecision error:', error);
  }
}

/**
 * 組長撤銷發言權限
 */
function arbiterRevoke(channel, targetUUID) {
  try {
 logger.info(`Arbiter revoke: ${targetUUID} on channel ${channel}`);

    // 從允許列表中移除
    const allowedSpeakers = pttState.allowedSpeakers.get(channel);
    if (allowedSpeakers) {
      allowedSpeakers.delete(targetUUID);
    }

    // 如果是當前發言者，清除
    if (pttState.channelSpeakers.get(channel) === targetUUID) {
      pttState.channelSpeakers.delete(channel);
    }

    // 發送 DENY 給 BWC 設備（表示發言權被撤銷）
    sendPTTSpeechResponse(channel, targetUUID, 'DENY');

    // 廣播給所有前端
    broadcastToClients({
      type: 'ptt_speaker_update',
      channel: channel,
      speaker: null,
      action: 'revoke',
      revokedFrom: targetUUID,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
 logger.error('arbiterRevoke error:', error);
  }
}

/**
 * 處理搶麥請求的回應 (同意或拒絕)
 * Tag: PTT_MSG_TYPE_MIC_RESPONSE
 */
function handlePTT_MicResponse(channel, uuid, data) {
  try {
    // data 格式: "requesterUUID,accept/deny"
    const [requesterUUID, response] = data.split(',');

 logger.info('[PTT_MSG_TYPE_MIC_RESPONSE]', {
      channel: channel,
      from: uuid,
      requester: requesterUUID,
      response: response
    });

    const requesterWs = pttState.deviceConnections.get(requesterUUID);
    const currentSpeaker = pttState.channelSpeakers.get(channel);

    if (response === 'accept') {
      // 當前說話者同意讓出麥克風
      pttState.channelSpeakers.set(channel, requesterUUID);
 logger.info(`Mic handed over: ${uuid} → ${requesterUUID}`);

      // 通知請求者：已獲得麥克風
      if (requesterWs && requesterWs.readyState === WebSocket.OPEN) {
        requesterWs.send(JSON.stringify({
          type: 'ptt_speech_allow',
          channel: channel,
          timestamp: new Date().toISOString()
        }));
      }

      // 廣播給所有人：新的說話者
      broadcastToClients({
        type: 'ptt_speaker_update',
        channel: channel,
        speaker: requesterUUID,
        action: 'start',
        previousSpeaker: uuid,
        timestamp: new Date().toISOString()
      });
    } else {
      // 拒絕請求
 logger.info(`Mic request denied: ${uuid} refused ${requesterUUID}`);

      if (requesterWs && requesterWs.readyState === WebSocket.OPEN) {
        requesterWs.send(JSON.stringify({
          type: 'ptt_speech_deny',
          channel: channel,
          reason: `${uuid} 拒絕讓出麥克風`,
          timestamp: new Date().toISOString()
        }));
      }
    }

  } catch (error) {
 logger.error('PTT MIC_RESPONSE handler error:', error);
  }
}

/**
 * 處理 PTT 群組通話「結束發言」
 * Tag: PTT_MSG_TYPE_SPEECH_STOP
 */
function handlePTT_SpeechStop(channel, uuid, data) {
  try {
    logger.info('[PTT_MSG_TYPE_SPEECH_STOP]', { channel, from: uuid });
    pttLogic.handlePTT_SpeechStop(channel, uuid, data, {
      pttState, broadcastToClients
    });
  } catch (error) {
    logger.error('PTT SPEECH_STOP handler error:', error);
  }
}

/**
 * 處理 PTT 群組仲裁允許說話
 * Tag: PTT_MSG_TYPE_SPEECH_START_ALLOW
 *
 * BWC 模擬器用於允許指定 UUID 在群組中說話
 *
 * @param {string} channel - 頻道名稱
 * @param {string} uuid - 發送者 UUID
 * @param {string} data - 被允許說話的 UUID
 */
function handlePTT_SpeechAllow(channel, uuid, data) {
  try {
    const allowedUUID = data.trim() || uuid;

 logger.info('[PTT_MSG_TYPE_SPEECH_START_ALLOW]', {
      channel: channel,
      allowedBy: uuid,
      allowedUUID: allowedUUID
    });

    // 設置允許說話的使用者為當前發言者
    pttState.channelSpeakers.set(channel, allowedUUID);

    // 通知被允許的使用者
    const allowedWs = pttState.deviceConnections.get(allowedUUID);
    if (allowedWs && allowedWs.readyState === 1) { // WebSocket.OPEN = 1
      allowedWs.send(JSON.stringify({
        type: 'ptt_speech_allow',
        channel: channel,
        allowedBy: uuid,
        timestamp: new Date().toISOString()
      }));
    }

    // 廣播給所有人：誰被允許說話
    broadcastToClients({
      type: 'ptt_speaker_update',
      channel: channel,
      speaker: allowedUUID,
      action: 'allow',
      allowedBy: uuid,
      timestamp: new Date().toISOString()
    });

 logger.info(`Speech allowed: ${allowedUUID} on channel ${channel} (by ${uuid})`);

  } catch (error) {
 logger.error('PTT SPEECH_ALLOW handler error:', error);
  }
}

// ==================== RTSP 串流管理器 ====================

class StreamManager {
  constructor(config) {
    this.config = config;
    this.streams = rtspStreams;
    this.processes = rtspProcesses;
    this.activity = streamActivity;
  }

  startStream(streamId, streamUrl, options = {}) {
    if (this.processes.size >= this.config.maxStreams) {
      throw new Error(`Maximum streams limit reached (${this.config.maxStreams})`);
    }

    this.stopStream(streamId);

    const outputPath = path.join(this.config.outputDir, `${streamId}.m3u8`);
    const segmentPath = path.join(this.config.outputDir, `${streamId}_%03d.ts`);

    // 判斷串流類型
    const isRTSP = streamUrl.startsWith('rtsp://');
    const isHTTP = streamUrl.startsWith('http://') || streamUrl.startsWith('https://');

 logger.info(`Starting stream: ${streamId}`);
 logger.info(`Source: ${streamUrl}`);
 logger.info(`Type: ${isRTSP ? 'RTSP' : isHTTP ? 'HTTP/MJPEG' : 'Unknown'}`);
 logger.info(`HLS: /streams/${streamId}.m3u8`);

    let ffmpegArgs = [];

    if (isRTSP) {
      // RTSP 串流配置
      ffmpegArgs = [
        '-rtsp_transport', 'tcp',
        '-timeout', '5000000',  // 5秒超時
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', streamUrl,
        '-c:v', 'libx264',  // 重新編碼以確保相容性
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '5',
        '-hls_flags', 'delete_segments+append_list',
        '-hls_segment_filename', segmentPath,
        outputPath
      ];
    } else if (isHTTP) {
      // HTTP/MJPEG 串流配置
      ffmpegArgs = [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', streamUrl,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '5',
        '-hls_flags', 'delete_segments+append_list',
        '-hls_segment_filename', segmentPath,
        outputPath
      ];
    } else {
      throw new Error(`Unsupported stream URL format: ${streamUrl}`);
    }

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    ffmpeg.stderr.on('data', (data) => {
      const message = data.toString();
      if (message.includes('error') || message.includes('Error')) {
 logger.error(`[${streamId}]`, message.substring(0, 200));
      }
    });

    ffmpeg.on('close', (code) => {
 logger.info(`[${streamId}] FFmpeg exited with code ${code}`);
      this.processes.delete(streamId);
      this.streams.delete(streamId);
      this.activity.delete(streamId);
    });

    ffmpeg.on('error', (error) => {
 logger.error(`[${streamId}] FFmpeg error:`, error.message);
    });

    this.processes.set(streamId, ffmpeg);
    this.activity.set(streamId, Date.now());

    const streamInfo = {
      streamId: streamId,
      hlsUrl: `/streams/${streamId}.m3u8`,
      streamUrl: streamUrl,  // 統一使用 streamUrl
      rtspUrl: streamUrl,    // 保持向後相容
      status: 'active',
      startTime: new Date().toISOString(),
      ...options
    };

    this.streams.set(streamId, streamInfo);

    return streamInfo;
  }

  stopStream(streamId) {
    const process = this.processes.get(streamId);
    if (process) {
 logger.info(`Stopping stream: ${streamId}`);
      process.kill('SIGTERM');
      this.processes.delete(streamId);
      this.streams.delete(streamId);
      this.activity.delete(streamId);
      this.cleanupStreamFiles(streamId);
      return true;
    }
    return false;
  }

  cleanupStreamFiles(streamId) {
    try {
      const files = fs.readdirSync(this.config.outputDir);
      files.forEach(file => {
        if (file.startsWith(streamId)) {
          const filePath = path.join(this.config.outputDir, file);
          fs.unlinkSync(filePath);
        }
      });
    } catch (error) {
 logger.error(`Error cleaning up stream files for ${streamId}:`, error);
    }
  }

  updateActivity(streamId) {
    this.activity.set(streamId, Date.now());
  }

  checkInactiveStreams() {
    const now = Date.now();
    this.activity.forEach((lastActivity, streamId) => {
      if (now - lastActivity > this.config.streamTimeout) {
 logger.info(`⏱ Stream ${streamId} inactive, stopping...`);
        this.stopStream(streamId);
      }
    });
  }

  getStreamInfo(streamId) {
    return this.streams.get(streamId);
  }

  getAllStreams() {
    return Array.from(this.streams.values());
  }

  stopAllStreams() {
 logger.info('Stopping all streams...');
    this.processes.forEach((process, streamId) => {
      this.stopStream(streamId);
    });
  }
}

const streamManager = new StreamManager(STREAM_CONFIG);

if (STREAM_CONFIG.enabled) {
  setInterval(() => {
    streamManager.checkInactiveStreams();
  }, 60000);
}

// ==================== 舊版 MQTT 客戶端（已移除） ====================
// 原有的 mqttClient 連接到 test.mosquitto.org 已被移除
// 所有功能已整合到 PTT MQTT 客戶端 (pttMqttClient)

// ==================== PTT MQTT 客戶端 (新增) ====================

const pttMqttClient = mqtt.connect(PTT_MQTT_CONFIG.broker, PTT_MQTT_CONFIG.options);

pttMqttClient.on('connect', () => {
 logger.info('Connected to PTT MQTT Broker');

  // 訂閱所有 PTT 主題
  pttMqttClient.subscribe(PTT_MQTT_CONFIG.topics.ALL, (err) => {
    if (!err) {
 logger.info(`Subscribed to PTT: ${PTT_MQTT_CONFIG.topics.ALL}`);
    } else {
 logger.error(`PTT Subscribe failed:`, err);
    }
  });
});

pttMqttClient.on('message', (topic, message) => {
  try {
 logger.info(`PTT MQTT [${topic}]:`, message.length, 'bytes');

    // ===== 按照主管指示：拆解 Topic =====
    const InTopic = topic.toString().split('/');
    // InTopic = ['', 'WJI', 'PTT', '{Channel}', '{Function}', ...]
    // 例如：/WJI/PTT/channel1/GPS
    // InTopic[0] = ''
    // InTopic[1] = 'WJI'
    // InTopic[2] = 'PTT'
    // InTopic[3] = 'channel1'
    // InTopic[4] = 'GPS'

    if (InTopic.length < 5) {
 logger.warn('Invalid PTT topic format:', topic);
      return;
    }

    const channel = InTopic[3];    // 頻道名稱
    const function_ = InTopic[4];  // 功能類型

 logger.info(`PTT Message: Channel=${channel}, Function=${function_}`);

    // 解析 PTT 二進位格式
    const parsed = parsePTTMessage(message);
    if (!parsed) {
 logger.warn('Failed to parse PTT message');
      return;
    }

    const { tag, uuid, data } = parsed;
 logger.info(`Tag: ${tag}`);
 logger.info(`UUID: ${uuid}`);
 logger.info(`Data: ${data}`);

    // ===== 根據功能類型分類處理 =====
    switch (function_) {
      case 'GPS':
        handlePTT_GPS(channel, uuid, data);
        break;

      case 'SOS':
        handlePTT_SOS(channel, uuid, data);
        break;

      case 'CHANNEL_ANNOUNCE':
        // 根據 Tag 區分不同類型的廣播訊息
        // DEBUG: 顯示 raw tag hex 以利除錯
 logger.info(`[CHANNEL_ANNOUNCE] tag="${tag}" (hex: ${Buffer.from(tag).toString('hex')}) uuid="${uuid}" data="${data}"`);
        if (tag === 'TEXT_MESSAGE') {
          handlePTT_TextMessage(channel, uuid, data);
        } else if (tag === 'BROADCAST') {
          handlePTT_Broadcast(channel, uuid, tag, data);
        } else if (tag === 'PTT_MSG_TYPE_SPEECH_START') {
          handlePTT_SpeechStart(channel, uuid, data);
        } else if (tag === 'PTT_MSG_TYPE_SPEECH_STOP') {
          handlePTT_SpeechStop(channel, uuid, data);
        } else if (tag === 'PTT_MSG_TYPE_SPEECH_START_ALLOW') {
          // BWC 模擬器：群組仲裁允許 UUID 說話
          handlePTT_SpeechAllow(channel, uuid, data);
        } else if (tag === 'PTT_MSG_TYPE_MIC_RESPONSE') {
          handlePTT_MicResponse(channel, uuid, data);
        } else if (tag === 'PRIVATE_SPK_REQ') {
          handlePTT_PrivateRequest(channel, uuid, data);
        } else if (tag === 'PRIVATE_SPK_STOP') {
          handlePTT_PrivateStop(channel, uuid, data);
        } else {
          // 其他未知的 CHANNEL_ANNOUNCE 訊息
 logger.info(`[CHANNEL_ANNOUNCE] Unknown tag: ${tag}`);
          handlePTT_Broadcast(channel, uuid, tag, data);
        }
        break;

      case 'MARK':
        handlePTT_MARK(channel, uuid, tag, data);
        break;

      case 'SPEECH':
        // 群組語音音訊
        handlePTT_SPEECH(channel, uuid, tag, message.slice(160));
        break;

      case 'PRIVATE':
        // 私人語音音訊
        handlePTT_PRIVATE(topic, channel, uuid, tag, message.slice(160));
        break;

      default:
 logger.info(`Unknown PTT function: ${function_}, tag: ${tag}`);
    }

  } catch (error) {
 logger.error('PTT MQTT message error:', error);
  }
});

pttMqttClient.on('error', (error) => {
 logger.error('PTT MQTT Error:', error.message);
});

pttMqttClient.on('reconnect', () => {
 logger.info('PTT MQTT reconnecting...');
});

// ==================== WebSocket Server ====================
const wss = new WebSocket.Server({ 
  port: WS_PORT,
  host: '0.0.0.0'  // ← 加上這行，監聽所有 IPv4 介面
});

wss.on('listening', () => {
 logger.info(`WebSocket Server successfully started on port ${WS_PORT}`);
 logger.info(`Listening on: ${HOST}:${WS_PORT}`);
});

wss.on('error', (error) => {
 logger.error(`WebSocket Server failed:`, error);
  if (error.code === 'EADDRINUSE') {
 logger.error(`Port ${WS_PORT} is already in use!`);
    process.exit(1);
  }
});

// 新連線
wss.on('connection', async (ws, req) => {
  // WebSocket JWT authentication
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token');

    if (process.env.COGNITO_USER_POOL_ID) {
      const user = await verifyWsToken(token);
      if (!user) {
        ws.close(4001, 'Authentication required');
        return;
      }
      ws.user = user;
      logger.info('WebSocket authenticated', { username: user.username });
    }
  } catch (err) {
    logger.error('WebSocket auth error', { error: err.message });
    ws.close(4001, 'Authentication error');
    return;
  }

  logger.info('WebSocket client connected');
 logger.info(`Total clients: ${wss.clients.size}`);

  const initialDevices = getValidDevices();
  ws.send(JSON.stringify({
    type: 'initial_state',
    devices: initialDevices,
    cotMessages: cotMessages.slice(-50),
    streams: [],
    takStatus: null,
    groups: getAllGroups()
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleWebSocketMessage(ws, data);
    } catch (error) {
 logger.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    // 從設備連線表中移除
    if (ws.deviceId) {
      pttState.deviceConnections.delete(ws.deviceId);
 logger.info(`Device unregistered: ${ws.deviceId}`);
    }
    // 離開所有房間
    leaveAllRooms(ws);
    logger.info('WebSocket client disconnected');
 logger.info(`Remaining clients: ${wss.clients.size}`);
  });

  ws.on('error', (error) => {
 logger.error('WebSocket client error:', error);
  });
});

function broadcastToClients(data) {
  const message = JSON.stringify(data);
  let successCount = 0;

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        successCount++;
      } catch (error) {
 logger.error('Broadcast error:', error);
      }
    }
  });

  if (successCount > 0) {
 logger.info(`Broadcast to ${successCount} clients`);
  }
}

// ===== 房間管理函數（網頁端加入/離開房間） =====

/**
 * 網頁端客戶端加入房間
 * @param {WebSocket} ws - WebSocket 連線
 * @param {string} roomId - 房間 ID（頻道名稱或私人房間 ID）
 */
function joinRoom(ws, roomId) {
  pttLogic.joinRoom(ws, roomId, { pttState });
  logger.info(`Client joined room: ${roomId} (Room size: ${pttState.roomClients.get(roomId)?.size})`);
}

/**
 * 網頁端客戶端離開房間
 * @param {WebSocket} ws - WebSocket 連線
 * @param {string} roomId - 房間 ID
 */
function leaveRoom(ws, roomId) {
  pttLogic.leaveRoom(ws, roomId, { pttState });
  logger.info(`Client left room: ${roomId}`);
}

/**
 * 網頁端客戶端離開所有房間（斷線時呼叫）
 * @param {WebSocket} ws - WebSocket 連線
 */
function leaveAllRooms(ws) {
  const roomCount = pttState.clientRooms.get(ws)?.size ?? 0;
  pttLogic.leaveAllRooms(ws, { pttState });
  if (roomCount > 0) logger.info(`Client left all rooms (${roomCount} rooms)`);
}

/**
 * 廣播訊息給指定房間的所有網頁端客戶端
 * @param {string} roomId - 房間 ID
 * @param {object} data - 要廣播的資料
 */
function broadcastToRoom(roomId, data) {
  const count = pttLogic.broadcastToRoom(roomId, data, { pttState, WebSocket });
  logger.info(`Room broadcast: ${roomId} → ${count} clients`);
  return count;
}

/**
 * 取得客戶端已加入的所有房間
 * @param {WebSocket} ws - WebSocket 連線
 * @returns {Array<string>} 房間 ID 列表
 */
function getClientRooms(ws) {
  const rooms = pttState.clientRooms.get(ws);
  return rooms ? Array.from(rooms) : [];
}

// ===== WebRTC 信令輔助函數 =====

/**
 * 廣播訊息給指定頻道的所有用戶（除了發送者）
 * @param {string} channel - PTT 頻道名稱
 * @param {object} message - 要廣播的訊息
 * @param {string} excludeUUID - 要排除的設備 UUID（通常是發送者）
 */
function broadcastToChannel(channel, message, excludeUUID) {
  const channelUsers = pttState.channelUsers.get(channel);
  if (!channelUsers || channelUsers.size === 0) {
 logger.warn(`No users in channel ${channel}`);
    return;
  }

  let successCount = 0;
  const messageStr = JSON.stringify(message);

  channelUsers.forEach(userId => {
    if (userId !== excludeUUID) {
      const targetWs = pttState.deviceConnections.get(userId);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        try {
          targetWs.send(messageStr);
          successCount++;
        } catch (error) {
 logger.error(`Failed to send to ${userId}:`, error);
        }
      }
    }
  });

 logger.info(`Broadcast to ${successCount} users in channel ${channel} (excluded: ${excludeUUID})`);
}

/**
 * 發送訊息給指定設備
 * @param {string} deviceId - 目標設備 UUID
 * @param {object} message - 要發送的訊息
 */
function sendToDevice(deviceId, message) {
  const targetWs = pttState.deviceConnections.get(deviceId);
  if (!targetWs || targetWs.readyState !== WebSocket.OPEN) {
 logger.warn(`Device ${deviceId} not connected or not ready`);
    return;
  }

  try {
    targetWs.send(JSON.stringify(message));
 logger.info(`Sent message to device ${deviceId}`);
  } catch (error) {
 logger.error(`Failed to send to ${deviceId}:`, error);
  }
}

// Input validation helpers
function isValidString(val, maxLen = 128) {
  return typeof val === 'string' && val.length > 0 && val.length <= maxLen;
}

function isValidId(val) {
  return isValidString(val, 128) && /^[a-zA-Z0-9_\-:.]+$/.test(val);
}

function handleWebSocketMessage(ws, data) {
  if (!data || typeof data.type !== 'string') {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    return;
  }

  switch (data.type) {
    case 'register_device':
      if (!isValidId(data.deviceId)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid deviceId' }));
        break;
      }
      {
        pttState.deviceConnections.set(data.deviceId, ws);
        ws.deviceId = data.deviceId;
        logger.info('Device registered', { deviceId: data.deviceId, total: pttState.deviceConnections.size });
      }
      break;

    // 已移除: send_command 和 send_cot（舊版 MQTT 功能）
    // 如需攝影機控制，請使用 PTT 或其他 API

    case 'request_devices':
      const devices = getValidDevices();
      ws.send(JSON.stringify({
        type: 'devices_update',
        devices: devices,
        groups: getAllGroups()
      }));
      break;

    case 'request_messages':
      const { deviceId, group, limit = 20 } = data;
      let filteredMessages = messages;

      if (deviceId) {
        filteredMessages = messages.filter(
          (msg) =>
            msg.to === `device:${deviceId}` ||
            msg.from === deviceId ||
            msg.to === 'all'
        );
      }

      if (group) {
        filteredMessages = messages.filter(
          (msg) =>
            msg.to === `group:${group}` ||
            msg.to === 'all'
        );
      }

      const recentMessages = filteredMessages.slice(-limit);

      ws.send(
        JSON.stringify({
          type: 'messages_history',
          messages: recentMessages,
        })
      );
      break;

    case 'request_groups':
      ws.send(JSON.stringify({
        type: 'groups_list',
        groups: getAllGroups().map(groupName => ({
          name: groupName,
          members: getGroupMembers(groupName),
          count: getGroupMembers(groupName).length
        }))
      }));
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    // ===== WebRTC 信令處理 =====
    case 'webrtc_offer':
      if (!isValidString(data.from) || !isValidString(data.channel)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid webrtc_offer fields' }));
        break;
      }
      logger.info('Broadcasting WebRTC offer', { from: data.from, channel: data.channel });
      broadcastToChannel(data.channel, data, data.from);
      break;

    case 'webrtc_answer':
      if (!isValidString(data.from) || !isValidString(data.to)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid webrtc_answer fields' }));
        break;
      }
      logger.info('Forwarding WebRTC answer', { from: data.from, to: data.to });
      sendToDevice(data.to, data);
      break;

    case 'webrtc_ice_candidate':
      if (!isValidString(data.from)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid webrtc_ice_candidate fields' }));
        break;
      }
      if (data.to === 'all') {
        logger.debug('Broadcasting ICE candidate', { from: data.from, channel: data.channel });
        broadcastToChannel(data.channel, data, data.from);
      } else {
        logger.debug('Forwarding ICE candidate', { from: data.from, to: data.to });
        sendToDevice(data.to, data);
      }
      break;

    // ===== 組長仲裁控制 =====
    case 'arbiter_allow':
      if (!isValidString(data.channel) || !isValidString(data.targetUUID)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing channel or targetUUID' }));
        break;
      }
      arbiterDecision(data.channel, data.targetUUID, 'allow');
      logger.info('Arbiter allowed', { targetUUID: data.targetUUID, channel: data.channel });
      break;

    case 'arbiter_deny':
      if (!isValidString(data.channel) || !isValidString(data.targetUUID)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing channel or targetUUID' }));
        break;
      }
      arbiterDecision(data.channel, data.targetUUID, 'deny');
      logger.info('Arbiter denied', { targetUUID: data.targetUUID, channel: data.channel });
      break;

    case 'arbiter_revoke':
      if (!isValidString(data.channel) || !isValidString(data.targetUUID)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing channel or targetUUID' }));
        break;
      }
      arbiterRevoke(data.channel, data.targetUUID);
      logger.info('Arbiter revoked', { targetUUID: data.targetUUID, channel: data.channel });
      break;

    case 'arbiter_mode_toggle':
      if (data.enabled !== undefined && typeof data.enabled !== 'boolean') {
        ws.send(JSON.stringify({ type: 'error', message: 'enabled must be boolean' }));
        break;
      }
      pttState.arbiterMode = data.enabled !== undefined ? data.enabled : !pttState.arbiterMode;
 logger.info(`Arbiter mode: ${pttState.arbiterMode ? 'ENABLED' : 'DISABLED'}`);
      broadcastToClients({
        type: 'arbiter_mode_status',
        enabled: pttState.arbiterMode,
        timestamp: new Date().toISOString()
      });
      break;

    case 'get_pending_requests':
      // 取得等待核准的發言請求
      {
        const channel = data.channel;
        const pendingRequests = pttState.pendingSpeechRequests.get(channel) || [];
        const allowedSpeakers = Array.from(pttState.allowedSpeakers.get(channel) || []);
        ws.send(JSON.stringify({
          type: 'pending_requests_response',
          channel: channel,
          pendingRequests: pendingRequests,
          allowedSpeakers: allowedSpeakers,
          currentSpeaker: pttState.channelSpeakers.get(channel) || null,
          arbiterMode: pttState.arbiterMode,
          timestamp: new Date().toISOString()
        }));
      }
      break;

    case 'get_active_private_calls':
      // 取得所有進行中的房間（僅回傳列表，不自動加入）
      {
        const activeCalls = [];
        for (const [topicId, call] of pttState.activePrivateCalls.entries()) {
          activeCalls.push({
            privateTopicID: topicId,
            channel: call.channel,
            from: call.from,
            to: call.to,
            startTime: call.startTime
          });
        }
        ws.send(JSON.stringify({
          type: 'active_private_calls_response',
          calls: activeCalls,
          count: activeCalls.length,
          timestamp: new Date().toISOString()
        }));
 logger.info(`Active rooms sent to client: ${activeCalls.length} rooms`);
      }
      break;

    // ===== 房間管理（網頁端加入/離開房間） =====
    case 'join_room':
      {
        if (!isValidString(data.roomId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid roomId' }));
          break;
        }
        const roomId = data.roomId;
        joinRoom(ws, roomId);
        ws.send(JSON.stringify({
          type: 'room_joined',
          roomId: roomId,
          joinedRooms: getClientRooms(ws),
          timestamp: new Date().toISOString()
        }));
      }
      break;

    case 'create_test_room':
      // Only available in development mode
      if (process.env.NODE_ENV === 'production') {
        ws.send(JSON.stringify({ type: 'error', message: 'Not available in production' }));
        break;
      }
      {
        const testRoomId = data.roomId || `test_room_${Date.now()}`;
        const testCall = {
          channel: 'TEST',
          from: data.from || 'WEB_TEST',
          to: data.to || 'TEST_TARGET',
          privateTopicID: testRoomId,
          startTime: new Date().toISOString(),
          participants: new Set(['WEB_TEST', 'TEST_TARGET'])
        };
        pttState.activePrivateCalls.set(testRoomId, testCall);
        logger.info('Test room created', { roomId: testRoomId });

        broadcastToClients({
          type: 'private_call_started',
          call: {
            privateTopicID: testRoomId,
            channel: 'TEST',
            from: testCall.from,
            to: testCall.to,
            startTime: testCall.startTime
          }
        });

        ws.send(JSON.stringify({
          type: 'test_room_created',
          roomId: testRoomId,
          timestamp: new Date().toISOString()
        }));
      }
      break;

    case 'leave_room':
      {
        if (!isValidString(data.roomId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid roomId' }));
          break;
        }
        const roomId = data.roomId;
        leaveRoom(ws, roomId);
        ws.send(JSON.stringify({
          type: 'room_left',
          roomId: roomId,
          joinedRooms: getClientRooms(ws),
          timestamp: new Date().toISOString()
        }));
      }
      break;

    case 'get_joined_rooms':
      // 取得已加入的房間列表
      {
        ws.send(JSON.stringify({
          type: 'joined_rooms_response',
          rooms: getClientRooms(ws),
          timestamp: new Date().toISOString()
        }));
      }
      break;
  }
}

// ==================== 訊息處理函數（舊版 MQTT 已移除） ====================
// 以下函數已移除（原用於 mezzo/* MQTT topics）：
// - handleCotMessage    → TAK Server 已停用
// - processCotData      → TAK Server 已停用
// - handleGpsUpdate     → 改用 handlePTT_GPS
// - handleCameraStatus  → 未使用
// - handleDeviceStatus  → 未使用
// - updateDevicePosition → TAK Server 已停用
// - handleIncomingMessage → 舊版 MQTT 已移除

// ==================== 驗證和清理函數 ====================

function isValidDeviceData(device) {
  return (
    device &&
    device.id &&
    device.position &&
    typeof device.position.lat === 'number' &&
    typeof device.position.lng === 'number' &&
    !isNaN(device.position.lat) &&
    !isNaN(device.position.lng) &&
    Math.abs(device.position.lat) <= 90 &&
    Math.abs(device.position.lng) <= 180 &&
    device.lastUpdate
  );
}

function cleanDeviceData(device) {
  if (!device || !device.position) return null;

  return {
    id: device.id || 'unknown',
    type: device.type || 'unknown',
    position: {
      lat: parseFloat(device.position.lat) || 0,
      lng: parseFloat(device.position.lng) || 0,
      alt: parseFloat(device.position.alt) || 0
    },
    callsign: device.callsign || device.id || 'Unknown',
    status: device.status || 'unknown',
    battery: device.battery ? parseInt(device.battery) : undefined,
    signal: device.signal ? parseInt(device.signal) : undefined,
    priority: device.priority ? parseInt(device.priority) : 3,
    group: device.group || '未分組',
    role: device.role,
    streamUrl: device.streamUrl,
    rtspUrl: device.rtspUrl,
    source: device.source,
    lastUpdate: device.lastUpdate || new Date().toISOString(),
    // BWC 執法儀專屬屬性
    isBWC: device.isBWC || false,
    streamChannelIndex: device.streamChannelIndex,
    recording: device.recording
  };
}

function getValidDevices() {
  const devices = Array.from(connectedDevices.values())
    .map(cleanDeviceData)
    .filter(device => device && isValidDeviceData(device));

  return devices;
}

// ==================== CoT 生成函數 ====================

function generateCotXml(data) {
  const now = new Date();
  const stale = new Date(now.getTime() + 300000);

  // 同樣移除 <?xml?> 標頭 
  return `<event version="2.0" uid="${data.uid}" type="${data.type || 'a-f-G-U-C'}" how="h-e" time="${now.toISOString()}" start="${now.toISOString()}" stale="${stale.toISOString()}">
  <point lat="${data.lat}" lon="${data.lon}" hae="${data.hae || 0}" ce="9999999.0" le="9999999.0"/>
  <detail>
    <contact callsign="${data.callsign || 'Unknown'}"/>
    <remarks>${data.remarks || ''}</remarks>
  </detail>
</event>`;
}

function generateDeviceCoT(device) {
  const now = new Date();
  
  // 1. 時間策略：倒退 5 分鐘，避免時間誤差導致被丟棄
  const pastTime = new Date(now.getTime() - 5 * 60 * 1000); 
  const staleTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // 2. 處理 URL：必須將 localhost 替換成真實 IP，否則 WinTAK 播不了
  // 假設你的 HTTP_PORT 是 4000
  const port = '4000';
  const baseUrl = `http://${SERVER_URL}:${port}`;

  let videoTag = '';
  if (device.streamUrl) {
      let cleanPath = device.streamUrl;
      // 強制替換 localhost 為 IP
      if (cleanPath.startsWith('http')) {
        cleanPath = cleanPath.replace('localhost', serverIp).replace('127.0.0.1', serverIp);
      } else {
        cleanPath = baseUrl + cleanPath;
      }
      cleanPath = cleanPath.replace(/&/g, '&amp;');
      videoTag = `<__video url="${cleanPath}"/>`;
  }

  let groupTag = '';
  if (device.group && device.group !== '未分組') {
      groupTag = `<__group name="${device.group}"${device.role ? ` role="${device.role}"` : ''}/>`;
  }

  const callsign = device.callsign || device.id;

  // 🚀 強制壓縮成單行，不留任何換行符號
  return `<event version="2.0" uid="${device.id}" type="a-f-G-U-C" how="m-g" time="${now.toISOString()}" start="${pastTime.toISOString()}" stale="${staleTime.toISOString()}"><point lat="${device.position.lat}" lon="${device.position.lng}" hae="${device.position.alt || 0}" ce="10.0" le="10.0"/><detail><contact callsign="${callsign}"/>${videoTag}${groupTag}<remarks>Mezzo Cam</remarks><priority>3</priority><status>active</status></detail></event>`;
}

// ==================== Express 中介軟體 ====================

app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
    : ['http://localhost:5173'],
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));  // 增加限制以支援音訊封包
app.use('/streams', express.static(streamsPath));

// ==================== REST API ====================

app.get('/health', (req, res) => {
  const validDevices = getValidDevices();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mqtt: {
      ptt: pttMqttClient.connected
    },
    devices: {
      total: validDevices.length,
      active: validDevices.filter(d => d.status === 'active').length,
      ptt: validDevices.filter(d => d.source?.includes('ptt')).length
    },
    groups: {
      total: getAllGroups().length,
      list: getAllGroups()
    },
    ptt: {
      activeUsers: pttState.activeUsers.size,
      sosAlerts: pttState.sosAlerts.size
    },
    websocket: {
      clients: wss.clients.size
    }
  });
});

app.get('/devices', requireAuth, (req, res) => {
  const validDevices = getValidDevices();
  res.json({
    devices: validDevices,
    count: validDevices.length,
    groups: getAllGroups()
  });
});


app.get('/devices/:deviceId', requireAuth, (req, res) => {
  const device = connectedDevices.get(req.params.deviceId);
  if (device) {
    res.json(cleanDeviceData(device));
  } else {
    res.status(404).json({ error: 'Device not found' });
  }
});

app.get('/groups', requireAuth, (req, res) => {
  const groups = getAllGroups().map(groupName => ({
    name: groupName,
    members: getGroupMembers(groupName).map(deviceId => {
      const device = connectedDevices.get(deviceId);
      return device ? cleanDeviceData(device) : null;
    }).filter(Boolean),
    count: getGroupMembers(groupName).length
  }));

  res.json({
    groups: groups,
    count: groups.length
  });
});

app.post('/api/rtsp/register', requireAuth, (req, res) => {
  // 支援兩種參數名稱：streamUrl (新) 和 rtspUrl (舊，向後相容)
  const { streamId, streamUrl, rtspUrl, position, priority, callsign, group, directStream } = req.body;
  const sourceUrl = streamUrl || rtspUrl;  // 優先使用 streamUrl

  if (!STREAM_CONFIG.enabled) {
    return res.status(503).json({
      success: false,
      error: 'Streaming not enabled'
    });
  }

  if (!streamId || !sourceUrl || !position) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: streamId, streamUrl (or rtspUrl), position'
    });
  }

  try {
    // 判斷串流類型
    const isRTSP = sourceUrl.startsWith('rtsp://');
    const isMJPEG = sourceUrl.includes('mjpeg') || sourceUrl.includes('.cgi');
    const useDirectStream = directStream !== false && isMJPEG; // 預設對 MJPEG 使用直接串流

    let device;
    let streamType;

    if (useDirectStream) {
      // MJPEG 直接串流，不經過 FFmpeg 轉換
 logger.info(`[Direct Stream] 註冊 MJPEG 直接串流: ${streamId}`);
      streamType = 'mjpeg';

      device = {
        id: streamId,
        type: 'camera',
        position: {
          lat: parseFloat(position.lat),
          lng: parseFloat(position.lon || position.lng),
          alt: parseFloat(position.alt) || 0
        },
        priority: priority || 3,
        callsign: callsign || streamId,
        group: group || '未分組',
        streamUrl: sourceUrl,    // 直接使用原始 URL
        sourceUrl: sourceUrl,
        rtspUrl: sourceUrl,      // 向後相容
        streamType: 'mjpeg',
        status: 'active',
        lastUpdate: new Date().toISOString()
      };
    } else {
      // RTSP 或需要轉換的串流，經過 FFmpeg
 logger.info(`[FFmpeg Stream] 註冊並轉換串流: ${streamId}`);
      streamType = isRTSP ? 'rtsp' : 'http';

      const streamInfo = streamManager.startStream(streamId, sourceUrl, {
        position: position,
        priority: priority || 3,
        callsign: callsign,
        group: group
      });

      device = {
        id: streamId,
        type: 'camera',
        position: {
          lat: parseFloat(position.lat),
          lng: parseFloat(position.lon || position.lng),
          alt: parseFloat(position.alt) || 0
        },
        priority: priority || 3,
        callsign: callsign || streamId,
        group: group || '未分組',
        streamUrl: streamInfo.hlsUrl,  // HLS 轉換後的 URL
        sourceUrl: sourceUrl,          // 原始串流來源
        rtspUrl: sourceUrl,            // 向後相容
        streamType: 'hls',
        status: 'active',
        lastUpdate: new Date().toISOString()
      };
    }

    connectedDevices.set(streamId, device);
    updateGroupIndex(streamId, device.group);

    // if (takClient && TAK_CONFIG.enabled) {
    //   const cotXml = generateDeviceCoT(device);
    //   takClient.sendCoT(cotXml);
 // logger.info(`Sent camera CoT to TAK Server: ${streamId}`);
    // }

    // TAK direct send mode
    if (TAK_CONFIG.enabled) {
        const xmlPayload = generateDeviceCoT(device);
        logger.info('TAK direct send for stream', { streamId });

        const tempSocket = new net.Socket();
        tempSocket.connect(TAK_CONFIG.port, TAK_CONFIG.host, () => {
            logger.debug('TAK direct send connected');
            tempSocket.write(xmlPayload + '\n');
            tempSocket.end();
            logger.debug('TAK direct send completed');
        });

        tempSocket.on('error', (err) => {
            logger.error('TAK direct send failed', { error: err.message });
        });
    }

    broadcastToClients({
      type: 'device_added',
      device: cleanDeviceData(device)
    });

    res.json({
      success: true,
      streamType: streamType,
      message: useDirectStream
        ? 'MJPEG 直接串流註冊成功，可立即使用'
        : 'FFmpeg 轉換中，請稍候數秒後串流將可用',
      device: device
    });
  } catch (error) {
 logger.error('Register stream error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/streams', requireAuth, (req, res) => {
  const streams = streamManager.getAllStreams();
  res.json({
    streams: streams,
    count: streams.length
  });
});

app.delete('/api/rtsp/:streamId', requireAuth, (req, res) => {
  const { streamId } = req.params;

  if (streamManager.stopStream(streamId)) {
    const device = connectedDevices.get(streamId);
    if (device && device.group) {
      const members = deviceGroups.get(device.group);
      if (members) {
        members.delete(streamId);
        if (members.size === 0) {
          deviceGroups.delete(device.group);
        }
      }
    }

    connectedDevices.delete(streamId);

    broadcastToClients({
      type: 'device_removed',
      deviceId: streamId
    });

    res.json({ success: true });
  } else {
    res.status(404).json({
      success: false,
      error: 'Stream not found'
    });
  }
});

app.post('/send-cot', requireAuth, (req, res) => {
  try {
    const cotXml = generateCotXml(req.body);

    if (takClient && TAK_CONFIG.enabled) {
      const sent = takClient.sendCoT(cotXml);
      res.json({
        success: sent,
        method: 'tak_server'
      });
    } else {
      // TAK Server 已停用，舊版 MQTT 已移除
      res.json({
        success: false,
        method: 'none',
        message: 'TAK Server is disabled and legacy MQTT has been removed'
      });
    }
  } catch (error) {
 logger.error('Send CoT error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/send-message', requireAuth, (req, res) => {
  try {
    const { from, to, text, priority, timestamp } = req.body;

    if (!from || !to || !text) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const message = {
      id: `msg-${Date.now()}`,
      from,
      to,
      text,
      priority: priority || 3,
      timestamp: timestamp || new Date().toISOString(),
    };

    logger.info('Sending message', { from: message.from, to: message.to });

    messages.push(message);

    if (messages.length > 100) {
      messages.shift();
    }

    // DB: persist message
    db.query(
      `INSERT INTO messages (message_id, from_user, to_target, text, priority, source)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [message.id, message.from, message.to, message.text, message.priority, 'web']
    ).catch(err => logger.error('Message insert error', { error: err.message }));

    broadcastToClients({
      type: 'message',
      message: message,
    });

    // 舊版 MQTT 發布已移除，改用 WebSocket 廣播

    // ✅ 修正：使用 .connected 屬性而非 .isConnected()
    if (takClient && takClient.connected) {
      const cotMessage = `<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="MSG-${message.id}" type="b-t-f" how="h-e" time="${message.timestamp}" start="${message.timestamp}" stale="${new Date(Date.now() + 300000).toISOString()}">
  <point lat="0" lon="0" hae="0" ce="10.0" le="10.0"/>
  <detail>
    <contact callsign="${from}"/>
    <remarks>${text}</remarks>
    <dest callsign="${to}"/>
  </detail>
</event>`;

      takClient.sendCoT(cotMessage);
 logger.info('Message sent to TAK Server');
    }

    res.json({
      success: true,
      message: message,
    });
  } catch (error) {
 logger.error('Send message error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/messages', requireAuth, (req, res) => {
  const { deviceId, group, limit = 50 } = req.query;

  let filteredMessages = messages;

  if (deviceId) {
    filteredMessages = messages.filter(
      (msg) =>
        msg.to === `device:${deviceId}` ||
        msg.from === deviceId ||
        msg.to === 'all'
    );
  }

  if (group) {
    filteredMessages = messages.filter(
      (msg) =>
        msg.to === `group:${group}` ||
        msg.to === 'all'
    );
  }

  const limitNum = parseInt(limit) || 50;
  const recentMessages = filteredMessages.slice(-limitNum);

  res.json({
    messages: recentMessages,
    count: recentMessages.length,
    total: messages.length,
  });
});

app.post('/voice-message', requireAuth, (req, res) => {
  const { message } = req.body;
  logger.info('Voice command received');

  let command = null;

  if (/向左|左邊|left/i.test(message)) {
    command = 'left';
  } else if (/向右|右邊|right/i.test(message)) {
    command = 'right';
  } else if (/拍照|capture|photo/i.test(message)) {
    command = 'capture';
  } else if (/錄影|record|video/i.test(message)) {
    command = 'record';
  } else if (/停止|stop/i.test(message)) {
    command = 'stop';
  }

  if (command) {
    // 舊版 MQTT 攝影機控制已移除
 logger.info(`Voice command recognized: ${command} (MQTT disabled)`);

    // 保留 Python 腳本執行（如有需要）
    // try {
    //   exec(`python mqtt_publish.py ${command}`);
    // } catch (error) {
 // logger.error('Python script error:', error);
    // }
  }

  res.json({
    success: true,
    command: command,
    originalMessage: message
  });
});

app.get('/api/tak/status', requireAuth, (req, res) => {
  if (takClient) {
    res.json(takClient.getStatus());
  } else {
    res.json({ enabled: false });
  }
});

// ==================== PTT MQTT API ====================
// 添加到 server.js 中的 app.get('/api/tak/status'...) 之後

app.post('/ptt/publish', requireAuth, (req, res) => {
  try {
    const { topic, message, encoding, transcript } = req.body;

    if (!topic || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: topic, message'
      });
    }

    logger.info(`Publishing to PTT MQTT: ${topic}`);

    // 處理二進位訊息
    let buffer;
    if (encoding === 'binary' && Array.isArray(message)) {
      buffer = Buffer.from(message);
    } else if (typeof message === 'string') {
      buffer = Buffer.from(message, 'utf8');
    } else {
      buffer = Buffer.from(JSON.stringify(message));
    }

    // 如果有轉錄文字，直接廣播文字訊息（包含音訊數據）
    if (transcript && transcript.trim()) {
      const topicParts = topic.split('/');
      const channel = topicParts[3];  // /WJI/PTT/{Channel}/...

      // 解析 UUID (從 buffer 的前 160 bytes 中提取)
      const uuidBuffer = buffer.slice(32, 160);
      const uuid = uuidBuffer.toString('utf8').replace(/\0/g, '').trim();

      // 提取音訊數據 (從 160 bytes 之後)
      const audioData = buffer.slice(160).toString('base64');

      // 建立唯一識別碼 (用於追蹤已廣播的訊息)
      const messageKey = `${uuid}-${audioData.substring(0, 50)}`;  // 使用 UUID + 音訊前綴

      // 廣播文字訊息（包含音訊數據以便重播）
      broadcastToClients({
        type: 'ptt_transcript',
        message: {
          id: `transcript-${uuid}-${Date.now()}`,
          from: uuid,
          to: `group:${channel}`,
          text: `💬 ${transcript}`,
          timestamp: new Date().toISOString(),
          priority: 3,
          audioData: audioData  // 加入音訊數據
        }
      });

      // 標記此訊息已廣播（避免 MQTT 回調時重複廣播）
      pttState.broadcastedTranscripts.add(messageKey);

      // 5 秒後清除標記（避免記憶體洩漏）
      setTimeout(() => {
        pttState.broadcastedTranscripts.delete(messageKey);
      }, 5000);

      logger.info('Transcript broadcasted', { uuid, audioBytes: audioData.length });
    }

    // 發布到 PTT MQTT
    pttMqttClient.publish(topic, buffer, (err) => {
      if (err) {
 logger.error('PTT MQTT publish error:', err);
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

 logger.info(`PTT MQTT published: ${topic}`);
      res.json({
        success: true,
        topic: topic,
        messageSize: buffer.length,
        transcriptSent: !!transcript
      });
    });
  } catch (error) {
 logger.error('PTT publish error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== 語音訊息端點 (用於通訊面板的語音訊息功能) =====
app.post('/ptt/voice-message', requireAuth, (req, res) => {
  try {
    const { channel, from, to, text, audioData, transcript } = req.body;

    if (!channel || !from || !audioData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: channel, from, audioData'
      });
    }

 logger.info(`Voice message from ${from} to ${to} on channel ${channel}`);

    // 建立語音訊息物件
    const voiceMessage = {
      type: 'ptt_transcript',
      message: {
        id: `voice-${from}-${Date.now()}`,
        from: from,
        to: to || 'all',
        text: text || '💬 語音訊息',
        audioData: audioData,
        timestamp: new Date().toISOString(),
        priority: 3
      }
    };

    // 廣播給所有 WebSocket 客戶端
    broadcastToClients(voiceMessage);

 logger.info(`Voice message broadcasted: ${from} → ${to}`);

    res.json({
      success: true,
      messageId: voiceMessage.message.id
    });
  } catch (error) {
 logger.error('Voice message error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// PTT 狀態查詢
app.get('/ptt/status', requireAuth, (req, res) => {
  res.json({
    connected: pttMqttClient.connected,
    broker: PTT_MQTT_CONFIG.broker,
    activeUsers: pttState.activeUsers.size,
    sosAlerts: pttState.sosAlerts.size,
    channels: Array.from(pttState.channelUsers.keys())
  });
});

// PTT 活躍使用者列表
app.get('/ptt/users', requireAuth, (req, res) => {
  const users = Array.from(pttState.activeUsers.entries()).map(([uuid, info]) => ({
    uuid,
    channel: info.channel,
    lastSeen: info.lastSeen,
    timeSinceLastSeen: Date.now() - info.lastSeen
  }));

  res.json({
    users,
    count: users.length
  });
});

// PTT SOS 警報列表
app.get('/ptt/sos', requireAuth, (req, res) => {
  const alerts = Array.from(pttState.sosAlerts.values());
  
  res.json({
    alerts,
    count: alerts.length
  });
});

// 清除 SOS 警報
app.delete('/ptt/sos/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  
  if (pttState.sosAlerts.has(id)) {
    pttState.sosAlerts.delete(id);

    // DB: mark SOS alert as cleared
    db.query(
      `UPDATE sos_alerts SET status='cleared', resolved_at=NOW() WHERE alert_id=$1`,
      [id]
    ).catch(err => logger.error('SOS clear error', { error: err.message }));

    broadcastToClients({
      type: 'sos_cleared',
      id: id
    });

    res.json({ success: true });
  } else {
    res.status(404).json({
      success: false,
      error: 'SOS alert not found'
    });
  }
});
// ==================== 💓 自動心跳機制 (Auto Heartbeat) ====================
// 每 10 秒鐘，把所有已註冊的設備重新發送一次給 TAK Server
// 這能確保：
// 1. 如果第一次註冊遺失，第二次會補上
// 2. 設備永遠保持「在線」狀態
setInterval(() => {
  if (!takClient || !takClient.connected) return;

  const devices = getValidDevices();
  if (devices.length > 0) {
 logger.info(`Sending heartbeat for ${devices.length} devices...`);
    devices.forEach(device => {
      // 確保它是活躍狀態才發送
      if (device.status === 'active') {
        const xml = generateDeviceCoT(device);
        takClient.sendCoT(xml);
      }
    });
  }
}, 10000); // 10秒一次

// // ==================== 🛠️ 除錯用：假資料產生器 ====================
// // 如果前端沒顯示東西，把這段加進去，確保前端能畫出東西
// setInterval(() => {
//   // 模擬一個在台北 101 附近繞圈圈的友軍
//   const time = Date.now() / 1000;
//   const centerLat = 25.033964;
//   const centerLon = 121.564472;
//   const radius = 0.005; // 約 500公尺半徑

//   const fakeDevice = {
//     id: 'SIMULATED-FRIENDLY-01',
//     type: 'friendly', // 這裡對應前端的圖示邏輯
//     callsign: '測試友軍(Alpha)',
//     group: 'Alpha小隊',
//     status: 'active',
//     battery: 85,
//     source: 'simulation',
//     lastUpdate: new Date().toISOString(),
//     position: {
//       lat: centerLat + Math.cos(time) * radius,
//       lng: centerLon + Math.sin(time) * radius,
//       alt: 100
//     }
//   };

//   // 1. 存入後端記憶體
//   connectedDevices.set(fakeDevice.id, fakeDevice);
//   updateGroupIndex(fakeDevice.id, fakeDevice.group);

//   // 2. 廣播給前端
//   broadcastToClients({
//     type: 'device_update',
//     device: fakeDevice
//   });

//   // ========== 👇 關鍵修改在這裡 👇 ==========
//   // 3. 發送給 TAK Server (讓 WinTAK 看得到)
//   if (takClient && takClient.connected) {
//       // 使用你程式碼裡現有的函數轉成 XML
//       const xml = generateDeviceCoT(fakeDevice); 
//       takClient.sendCoT(xml);
// logger.info(`模擬訊號已發送至 WinTAK: ${fakeDevice.callsign}`);
//   } else {
// logger.info('TAK Server 未連線，無法發送模擬訊號');
//   }
//   // =======================================

//   // 每 3 秒更新一次位置
// }, 3000);

// logger.info('Simulation Mode: Active (Generating fake friendly unit)');
// // ============================================================

// ==================== 啟動服務器 ====================
app.listen(HTTP_PORT, '0.0.0.0', () => {
 logger.info('');
 logger.info('╔═══════════════════════════════════════════════════════════╗');
 logger.info('║ Mezzo TAK Integration Server - COMPLETE EDITION ║');
 logger.info('╚═══════════════════════════════════════════════════════════╝');
 logger.info('');
 logger.info('服務狀態:');
 logger.info(`HTTP Server: http://0.0.0.0:${HTTP_PORT}`);
 logger.info(`WebSocket: ws://0.0.0.0:${WS_PORT}`);
 logger.info(`PTT MQTT: ${PTT_MQTT_CONFIG.broker}`);
 logger.info(`TAK Server: ${TAK_CONFIG.enabled ?` ${TAK_CONFIG.host}:${TAK_CONFIG.port}` : ' Disabled'}`);
 logger.info(`RTSP Streams: ${STREAM_CONFIG.enabled ? ' Enabled' : ' Disabled'}`);
 logger.info('');
 logger.info('功能:');
 logger.info('PTT 執法儀語音對講');
 logger.info('訊息系統 (WebSocket)');
 logger.info('群組訊息路由');
 logger.info('設備群組管理');
 logger.info('RTSP 攝像頭註冊與串流');
 logger.info('');
 logger.info('主要 API 端點:');
 logger.info('GET /health - 系統健康檢查');
 logger.info('GET /devices - 所有設備列表');
 logger.info('GET /groups - 所有群組列表');
 logger.info('POST /api/rtsp/register - 註冊 RTSP 攝像頭');
 logger.info('POST /send-message - 發送訊息');
 logger.info('GET /messages - 訊息歷史');
 logger.info('');
});

logger.info(`WebSocket Server listening on port ${WS_PORT}`);

// ==================== 優雅關閉 ====================

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function shutdown() {
  logger.info('Shutting down gracefully...');

  // Flush remaining GPS positions
  try { await gpsBatcher.stop(); } catch (e) { logger.error('GPS batcher stop error', { error: e.message }); }

  streamManager.stopAllStreams();

  wss.close(() => {
    logger.info('WebSocket server closed');
  });

  pttMqttClient.end(false, () => {
    logger.info('PTT MQTT client disconnected');
  });

  if (takClient) {
    takClient.disconnect();
    logger.info('TAK client disconnected');
  }

  // Close Redis and PG connections
  if (redis) {
    try { await redis.quit(); } catch (e) { logger.error('Redis quit error', { error: e.message }); }
  }
  if (db.pool) {
    try { await db.pool.end(); } catch (e) { logger.error('PG pool end error', { error: e.message }); }
  }

  logger.info('Goodbye!');
  process.exit(0);
}