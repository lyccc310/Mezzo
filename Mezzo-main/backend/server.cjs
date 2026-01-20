const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const xml2js = require('xml2js');
const path = require('path');
const fs = require('fs');
const tls = require('tls');
const net = require('net');

const app = express();
const HTTP_PORT = 4000;
const WS_PORT = 4001;
const HOST = '0.0.0.0';

// ==================== 配置 ====================

const SERVER_URL = '192.168.254.1';
const PUBLIC_URL = `http://${SERVER_URL}:${HTTP_PORT}`;

// TAK Server 配置
const TAK_CONFIG = {
  enabled: false,  // ← 暫時關閉 WinTAK
  host: SERVER_URL,
  port: 8087,
  useTLS: false,
  reconnectInterval: 5000,
  heartbeatInterval: 30000
};

// MQTT 配置 - 你們原有的
const MQTT_CONFIG = {
  broker: 'mqtt://test.mosquitto.org:1883',
  topics: {
    CAMERA_CONTROL: 'myapp/camera/control',
    CAMERA_STATUS: 'myapp/camera/status',
    CAMERA_GPS: 'myapp/camera/gps',
    COT_MESSAGE: 'myapp/cot/message',
    DEVICE_STATUS: 'myapp/device/+/status',
    STREAM_CONTROL: 'myapp/stream/control',
    MESSAGE_BROADCAST: 'myapp/messages/broadcast',
    MESSAGE_GROUP: 'myapp/messages/group/+',
    MESSAGE_DEVICE: 'myapp/messages/device/+'
  },
  options: {
    clientId: `mezzo-server-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000
  }
};

// ===== 新增：PTT MQTT 配置 =====
const PTT_MQTT_CONFIG = {
  broker: 'mqtt://118.163.141.80:1883',  // PTT 系統的 Broker
  topics: {
    ALL: '/WJI/PTT/#'  // 訂閱所有 PTT 主題
  },
  options: {
    clientId: `mezzo-ptt-bridge-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000
  }
};

// RTSP/影像配置
const STREAM_CONFIG = {
  enabled: true,
  outputDir: path.join(__dirname, 'streams'),
  ffmpegOptions: {
    rtspTransport: 'tcp',
    videoCodec: 'copy',
    audioCodec: 'aac',
    hlsTime: 2,
    hlsListSize: 5,
    hlsFlags: 'delete_segments+append_list'
  },
  maxStreams: 10,
  streamTimeout: 300000
};
// ==================== 儲存 ====================
const connectedDevices = new Map();
const cotMessages = [];
const rtspStreams = new Map();
const rtspProcesses = new Map();
const streamActivity = new Map();
const messages = [];
const deviceGroups = new Map();
const streamsPath = path.resolve(__dirname, 'streams');
// 確保 streams 目錄存在
if (STREAM_CONFIG.enabled && !fs.existsSync(STREAM_CONFIG.outputDir)) {
  fs.mkdirSync(STREAM_CONFIG.outputDir, { recursive: true });
  console.log('📁 Created streams directory:', STREAM_CONFIG.outputDir);
}

// ===== 新增：PTT 狀態管理 =====
const pttState = {
  activeUsers: new Map(),      // 活躍的 PTT 使用者
  sosAlerts: new Map(),        // SOS 警報
  channelUsers: new Map()      // 各頻道的使用者
};

// 確保 streams 目錄存在
if (STREAM_CONFIG.enabled && !fs.existsSync(STREAM_CONFIG.outputDir)) {
  fs.mkdirSync(STREAM_CONFIG.outputDir, { recursive: true });
  console.log('📁 Created streams directory:', STREAM_CONFIG.outputDir);
}
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
    console.log(`🔌 Connecting to TAK Server: ${this.config.host}:${this.config.port} (TLS: ${this.config.useTLS})`);

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
      console.log('✅ Connected to TAK Server');
      this.connected = true;
      this.clearReconnectTimer();
      this.startHeartbeat();
      this.flushMessageQueue();
    });

    this.socket.on('secureConnect', () => {
      console.log('🔒 TLS connection established');
      this.connected = true;
    });

    this.socket.on('data', (data) => {
      const message = data.toString();
      if (!message.includes('<ping') && !message.includes('<pong')) {
        console.log('📥 TAK Server:', message.substring(0, 100) + '...');
      }
      this.handleTakMessage(message);
    });

    this.socket.on('error', (error) => {
      console.error('❌ TAK Server error:', error.message);
      this.connected = false;
    });

    this.socket.on('close', () => {
      console.log('🔌 TAK Server disconnected');
      this.connected = false;
      this.stopHeartbeat();
      this.reconnect();
    });

    this.socket.on('timeout', () => {
      console.warn('⏱️  TAK Server timeout');
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

    console.log(`⏳ Reconnecting to TAK Server in ${this.config.reconnectInterval / 1000}s...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.config.reconnectInterval);
  }

  sendCoT(cotXml) {
    if (!this.connected || !this.socket) {
      console.warn('⚠️  TAK Server not connected, queuing message');
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
        console.log('📤 Sent to TAK Server');
        // 把送出的 XML 印出來
        console.log('------------------------------------------------');
        console.log('📤 [DEBUG] 正要發送的 XML:');
        console.log(message);
        console.log('------------------------------------------------');
      }
      return true;
    } catch (error) {
      console.error('❌ Failed to send to TAK:', error.message);
      this.connected = false;
      return false;
    }
  }

  flushMessageQueue() {
    if (this.messageQueue.length === 0) return;

    console.log(`📤 Flushing ${this.messageQueue.length} queued messages`);
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
          console.error('❌ TAK message parse error:', err.message);
          return;
        }

        if (!result || !result.event) {
          return;
        }

        const event = result.event;
        console.log('📥 Received CoT from TAK Server:', event.$.uid);

        // 提取設備資訊
        const uid = event.$.uid;
        const type = event.$.type || 'unknown';
        const point = event.point?.$;

        if (!point || !point.lat || !point.lon) {
          console.warn('⚠️  CoT missing position data');
          return;
        }

        const lat = parseFloat(point.lat);
        const lng = parseFloat(point.lon);
        const alt = parseFloat(point.hae || point.alt || 0);

        if (isNaN(lat) || isNaN(lng)) {
          console.warn('⚠️  Invalid coordinates in CoT');
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

        console.log(`✅ Updated device from TAK: ${uid} (${callsign})`);
        console.log(`   位置: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        if (group !== '未分組') {
          console.log(`   群組: ${group}${role ? ` - ${role}` : ''}`);
        }

        // 廣播到前端
        broadcastToClients({
          type: 'device_update',
          device: device
        });

        // 同時廣播原始 TAK 訊息
        broadcastToClients({
          type: 'tak_message',
          data: result,
          timestamp: new Date().toISOString()
        });
      });
    } catch (error) {
      console.error('❌ TAK message parse error:', error);
    }
  }

  disconnect() {
    console.log('🔌 Disconnecting from TAK Server');
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

// ==================== PTT 資料解析函數 ====================

/**
 * 解析 PTT MQTT 訊息格式
 * 格式：[Tag (32 bytes)][UUID (128 bytes)][Data (Variable)]
 */
function parsePTTMessage(buffer) {
  try {
    // 確保 buffer 至少有 160 bytes (32 + 128)
    if (buffer.length < 160) {
      console.warn('⚠️ PTT message too short:', buffer.length);
      return null;
    }

    // 解析 Tag (前 32 bytes)
    const tag = buffer.slice(0, 32).toString('utf8').trim().replace(/\0/g, '');

    // 解析 UUID (接下來 128 bytes)
    const uuid = buffer.slice(32, 160).toString('utf8').trim().replace(/\0/g, '');

    // 解析 Data (剩餘部分)
    const data = buffer.slice(160).toString('utf8').trim();

    return { tag, uuid, data };
  } catch (error) {
    console.error('❌ PTT message parse error:', error);
    return null;
  }
}

/**
 * 處理 PTT GPS 訊息
 */
function handlePTT_GPS(channel, uuid, data) {
  try {
    console.log('📍 [PTT GPS]', { channel, uuid, data });

    // 解析 GPS 資料：格式 "UUID,Lat,Lon" 或 "Lat,Lon"
    const parts = data.split(',');
    let lat, lon;

    if (parts.length >= 3) {
      // 格式：UUID,Lat,Lon
      lat = parseFloat(parts[1]);
      lon = parseFloat(parts[2]);
    } else if (parts.length >= 2) {
      // 格式：Lat,Lon
      lat = parseFloat(parts[0]);
      lon = parseFloat(parts[1]);
    } else {
      console.warn('⚠️ Invalid GPS data format:', data);
      return;
    }

    if (isNaN(lat) || isNaN(lon)) {
      console.warn('⚠️ Invalid GPS coordinates:', { lat, lon });
      return;
    }

    // 建立設備物件
    const device = {
      id: uuid,
      type: 'ptt_user',
      position: { lat, lng: lon, alt: 0 },
      callsign: uuid.substring(0, 20),  // 取前 20 個字元作為 callsign
      group: channel || 'PTT',
      status: 'active',
      source: 'ptt_gps',
      priority: 3,
      lastUpdate: new Date().toISOString()
    };

    // 存入記憶體
    connectedDevices.set(uuid, device);
    updateGroupIndex(uuid, device.group);
    pttState.activeUsers.set(uuid, { lastSeen: Date.now(), channel });

    console.log(`✅ PTT GPS updated: ${uuid} at ${lat}, ${lon}`);

    // 廣播到前端
    broadcastToClients({
      type: 'device_update',
      device: device
    });

  } catch (error) {
    console.error('❌ PTT GPS handler error:', error);
  }
}

/**
 * 處理 PTT SOS 訊息
 */
function handlePTT_SOS(channel, uuid, data) {
  try {
    console.log('🆘 [PTT SOS]', { channel, uuid, data });

    // 解析 SOS 資料：格式 "Lat,Lon"
    const parts = data.split(',');
    if (parts.length < 2) {
      console.warn('⚠️ Invalid SOS data format:', data);
      return;
    }

    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);

    if (isNaN(lat) || isNaN(lon)) {
      console.warn('⚠️ Invalid SOS coordinates:', { lat, lon });
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

    // 同時也作為設備更新
    connectedDevices.set(uuid, {
      ...sosEvent,
      id: uuid
    });
    updateGroupIndex(uuid, sosEvent.group);

    console.log(`🆘 SOS Alert from ${uuid} at ${lat}, ${lon}`);

    // 廣播 SOS 警報
    broadcastToClients({
      type: 'sos_alert',
      event: sosEvent
    });

    // 也廣播設備更新
    broadcastToClients({
      type: 'device_update',
      device: sosEvent
    });

  } catch (error) {
    console.error('❌ PTT SOS handler error:', error);
  }
}

/**
 * 處理 PTT 廣播訊息
 */
function handlePTT_Broadcast(channel, uuid, tag, data) {
  try {
    console.log('📢 [PTT Broadcast]', { channel, uuid, tag, data });

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

    console.log(`📢 PTT Broadcast: ${uuid} → ALL (from ${channel})`);

    // 只廣播一次，使用 ptt_broadcast 類型
    broadcastToClients({
      type: 'ptt_broadcast',
      message: message
    });

  } catch (error) {
    console.error('❌ PTT Broadcast handler error:', error);
  }
}

/**
 * 處理 PTT 文字訊息 (TEXT_MESSAGE)
 */
function handlePTT_TextMessage(channel, uuid, data) {
  try {
    console.log('💬 [PTT Text Message]', { channel, uuid, data });

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

    console.log(`💬 PTT Text Message: ${uuid} → ${channel}: ${data}`);

    // 只廣播一次，使用 ptt_broadcast 類型
    broadcastToClients({
      type: 'ptt_broadcast',
      message: message
    });

  } catch (error) {
    console.error('❌ PTT Text Message handler error:', error);
  }
}

/**
 * 處理 PTT MARK (標記) 訊息
 */
function handlePTT_MARK(channel, uuid, tag, data) {
  try {
    console.log('📹 [PTT MARK]', { channel, uuid, tag, data });

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
        device: device
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

    console.log(`📹 MARK ${action}: ${uuid}`);

    // 廣播標記事件
    broadcastToClients({
      type: 'ptt_mark',
      event: markEvent
    });

  } catch (error) {
    console.error('❌ PTT MARK handler error:', error);
  }
}

/**
 * 處理 PTT SPEECH (群組語音)
 */
function handlePTT_SPEECH(channel, uuid, tag, audioBuffer) {
  try {
    console.log('🎙️ [PTT SPEECH]', {
      channel,
      uuid,
      tag,
      audioSize: audioBuffer.length
    });

    // 建立音訊封包事件
    const audioPacket = {
      id: `speech-${uuid}-${Date.now()}`,
      type: 'speech',
      channel: channel,
      from: uuid,
      timestamp: new Date().toISOString(),
      audioData: audioBuffer.toString('base64'),  // 轉為 base64 傳輸
      tag: tag
    };

    // 廣播到所有連接的客戶端（群組語音）
    broadcastToClients({
      type: 'ptt_audio',
      packet: audioPacket
    });

    console.log(`🎙️ SPEECH broadcasted: ${uuid} → ${channel} (${audioBuffer.length} bytes)`);

  } catch (error) {
    console.error('❌ PTT SPEECH handler error:', error);
  }
}

/**
 * 處理 PTT PRIVATE (私人語音)
 */
function handlePTT_PRIVATE(topic, channel, uuid, tag, audioBuffer) {
  try {
    // 從 topic 中提取 RandomID
    // 格式: /WJI/PTT/{Channel}/PRIVATE/{RandomID}
    const parts = topic.split('/');
    const randomId = parts[parts.length - 1];

    console.log('📞 [PTT PRIVATE]', {
      channel,
      uuid,
      randomId,
      tag,
      audioSize: audioBuffer.length
    });

    // 建立私人音訊封包事件
    const audioPacket = {
      id: `private-${uuid}-${Date.now()}`,
      type: 'private',
      channel: channel,
      randomId: randomId,  // 私人通話的唯一 ID
      from: uuid,
      timestamp: new Date().toISOString(),
      audioData: audioBuffer.toString('base64'),
      tag: tag
    };

    // 廣播到所有客戶端（客戶端需要根據 randomId 過濾）
    broadcastToClients({
      type: 'ptt_audio',
      packet: audioPacket
    });

    console.log(`📞 PRIVATE broadcasted: ${uuid} → ${randomId} (${audioBuffer.length} bytes)`);

  } catch (error) {
    console.error('❌ PTT PRIVATE handler error:', error);
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

    console.log(`🎥 Starting stream: ${streamId}`);
    console.log(`   Source: ${streamUrl}`);
    console.log(`   Type: ${isRTSP ? 'RTSP' : isHTTP ? 'HTTP/MJPEG' : 'Unknown'}`);
    console.log(`   HLS:  /streams/${streamId}.m3u8`);

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
        console.error(`[${streamId}] ❌`, message.substring(0, 200));
      }
    });

    ffmpeg.on('close', (code) => {
      console.log(`[${streamId}] FFmpeg exited with code ${code}`);
      this.processes.delete(streamId);
      this.streams.delete(streamId);
      this.activity.delete(streamId);
    });

    ffmpeg.on('error', (error) => {
      console.error(`[${streamId}] FFmpeg error:`, error.message);
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
      console.log(`🛑 Stopping stream: ${streamId}`);
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
      console.error(`Error cleaning up stream files for ${streamId}:`, error);
    }
  }

  updateActivity(streamId) {
    this.activity.set(streamId, Date.now());
  }

  checkInactiveStreams() {
    const now = Date.now();
    this.activity.forEach((lastActivity, streamId) => {
      if (now - lastActivity > this.config.streamTimeout) {
        console.log(`⏱️  Stream ${streamId} inactive, stopping...`);
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
    console.log('🛑 Stopping all streams...');
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

// ==================== MQTT 客戶端 ====================

// ==================== MQTT 客戶端 (你們原有的) ====================

const mqttClient = mqtt.connect(MQTT_CONFIG.broker, MQTT_CONFIG.options);

mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT Broker (Mezzo)');

  Object.values(MQTT_CONFIG.topics).forEach(topic => {
    mqttClient.subscribe(topic, (err) => {
      if (!err) {
        console.log(`📡 Subscribed: ${topic}`);
      } else {
        console.error(`❌ Subscribe failed: ${topic}`, err);
      }
    });
  });
});

mqttClient.on('message', (topic, message) => {
  const messageStr = message.toString();
  console.log(`📨 MQTT [${topic}]:`, messageStr.substring(0, 100));

  try {
    if (topic === MQTT_CONFIG.topics.COT_MESSAGE) {
      handleCotMessage(messageStr);
    } else if (topic === MQTT_CONFIG.topics.CAMERA_GPS) {
      handleGpsUpdate(messageStr);
    } else if (topic === MQTT_CONFIG.topics.CAMERA_STATUS) {
      handleCameraStatus(messageStr);
    } else if (topic.includes('device/')) {
      const deviceId = topic.split('/')[2];
      handleDeviceStatus(deviceId, messageStr);
    } else if (topic.includes('messages/')) {
      handleIncomingMessage(messageStr, topic);
    }

    broadcastToClients({
      type: 'mqtt_message',
      topic: topic,
      data: messageStr,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ MQTT message error:', error);
  }
});

mqttClient.on('error', (error) => {
  console.error('❌ MQTT Error:', error.message);
});

// ==================== PTT MQTT 客戶端 (新增) ====================

const pttMqttClient = mqtt.connect(PTT_MQTT_CONFIG.broker, PTT_MQTT_CONFIG.options);

pttMqttClient.on('connect', () => {
  console.log('✅ Connected to PTT MQTT Broker');

  // 訂閱所有 PTT 主題
  pttMqttClient.subscribe(PTT_MQTT_CONFIG.topics.ALL, (err) => {
    if (!err) {
      console.log(`📡 Subscribed to PTT: ${PTT_MQTT_CONFIG.topics.ALL}`);
    } else {
      console.error(`❌ PTT Subscribe failed:`, err);
    }
  });
});

pttMqttClient.on('message', (topic, message) => {
  try {
    console.log(`📨 PTT MQTT [${topic}]:`, message.length, 'bytes');

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
      console.warn('⚠️ Invalid PTT topic format:', topic);
      return;
    }

    const channel = InTopic[3];    // 頻道名稱
    const function_ = InTopic[4];  // 功能類型

    console.log(`📡 PTT Message: Channel=${channel}, Function=${function_}`);

    // 解析 PTT 二進位格式
    const parsed = parsePTTMessage(message);
    if (!parsed) {
      console.warn('⚠️ Failed to parse PTT message');
      return;
    }

    const { tag, uuid, data } = parsed;
    console.log(`   Tag: ${tag}`);
    console.log(`   UUID: ${uuid}`);
    console.log(`   Data: ${data}`);

    // ===== 根據功能類型分類處理 =====
    switch (function_) {
      case 'GPS':
        handlePTT_GPS(channel, uuid, data);
        break;

      case 'SOS':
        handlePTT_SOS(channel, uuid, data);
        break;

      case 'CHANNEL_ANNOUNCE':
        // 根據 Tag 區分不同類型的廣播
        if (tag === 'TEXT_MESSAGE') {
          handlePTT_TextMessage(channel, uuid, data);
        } else if (tag === 'BROADCAST') {
          handlePTT_Broadcast(channel, uuid, tag, data);
        } else if (tag.includes('PTT_MSG_TYPE_SPEECH')) {
          console.log('🎙️ [PTT SPEECH CONTROL]', tag);
          // TODO: 語音控制處理
        } else if (tag.includes('PRIVATE_SPK')) {
          console.log('📞 [PTT PRIVATE CALL CONTROL]', tag);
          // TODO: 私人通話控制處理
        } else {
          // 其他未知的 CHANNEL_ANNOUNCE 訊息
          handlePTT_Broadcast(channel, uuid, tag, data);
        }
        break;

      case 'MARK':
        handlePTT_MARK(channel, uuid, tag, data);
        break;

      case 'SPEECH':
        handlePTT_SPEECH(channel, uuid, tag, buffer.slice(160));
        break;

      case 'PRIVATE':
        handlePTT_PRIVATE(topic, channel, uuid, tag, buffer.slice(160));
        break;

      default:
        console.log(`⚠️ Unknown PTT function: ${function_}`);
    }

  } catch (error) {
    console.error('❌ PTT MQTT message error:', error);
  }
});

pttMqttClient.on('error', (error) => {
  console.error('❌ PTT MQTT Error:', error.message);
});

pttMqttClient.on('reconnect', () => {
  console.log('🔄 PTT MQTT reconnecting...');
});

// ==================== WebSocket Server ====================
const wss = new WebSocket.Server({ 
  port: WS_PORT,
  host: '0.0.0.0'  // ← 加上這行，監聽所有 IPv4 介面
});

wss.on('listening', () => {
  console.log(`✅ WebSocket Server successfully started on port ${WS_PORT}`);
  console.log(`   Listening on: ${HOST}:${WS_PORT}`);
});

wss.on('error', (error) => {
  console.error(`❌ WebSocket Server failed:`, error);
  if (error.code === 'EADDRINUSE') {
    console.error(`⚠️  Port ${WS_PORT} is already in use!`);
    process.exit(1);
  }
});

// 新連線
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`🔌 WebSocket client connected from ${clientIp}`);
  console.log(`   Total clients: ${wss.clients.size}`);

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
      console.error('❌ WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log(`🔌 WebSocket client disconnected from ${clientIp}`);
    console.log(`   Remaining clients: ${wss.clients.size}`);
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket client error:', error);
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
        console.error('❌ Broadcast error:', error);
      }
    }
  });

  if (successCount > 0) {
    console.log(`📤 Broadcast to ${successCount} clients`);
  }
}

function handleWebSocketMessage(ws, data) {
  switch (data.type) {
    case 'send_command':
      mqttClient.publish(
        data.topic || MQTT_CONFIG.topics.CAMERA_CONTROL,
        JSON.stringify(data.payload)
      );
      console.log(`📤 Command sent: ${data.payload?.action}`);
      break;

    case 'send_cot':
      const cotXml = generateCotXml(data.payload);
      if (takClient && TAK_CONFIG.enabled) {
        takClient.sendCoT(cotXml);
      } else {
        mqttClient.publish(MQTT_CONFIG.topics.COT_MESSAGE, cotXml);
      }
      break;

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
  }
}

function getValidDevices() {
  const devices = Array.from(connectedDevices.values());
  return devices.filter(device => 
    device && 
    device.id && 
    device.position && 
    typeof device.position.lat === 'number' &&
    typeof device.position.lng === 'number'
  );
}
// ==================== 訊息處理函數 ====================

function handleCotMessage(message) {
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
      try {
        const jsonData = JSON.parse(message);
        processCotData(jsonData);
      } catch (jsonErr) {
        console.error('❌ CoT parse error:', err.message);
        console.error('   Message preview:', cleanedMessage.substring(0, 100));
      }
    } else {
      processCotData(result);
    }
  });
}

function processCotData(cotData) {
  try {
    const cotMessage = {
      id: cotData.uid || cotData.id || Date.now().toString(),
      timestamp: new Date().toISOString(),
      data: cotData
    };

    cotMessages.push(cotMessage);
    if (cotMessages.length > 100) {
      cotMessages.shift();
    }

    if (cotData.point || cotData.location) {
      updateDevicePosition(cotData);
    }

    broadcastToClients({
      type: 'cot_update',
      message: cotMessage
    });
  } catch (error) {
    console.error('❌ Process CoT error:', error);
  }
}

function handleGpsUpdate(message) {
  try {
    const gpsData = JSON.parse(message);

    const lat = parseFloat(gpsData.latitude);
    const lng = parseFloat(gpsData.longitude);

    if (isNaN(lat) || isNaN(lng)) {
      console.warn('⚠️  Invalid GPS data');
      return;
    }

    const deviceId = gpsData.deviceId || 'unknown';
    const existingDevice = connectedDevices.get(deviceId) || {};

    const device = {
      ...existingDevice,
      id: deviceId,
      type: existingDevice.type || gpsData.type || 'mobile',
      position: {
        lat: lat,
        lng: lng,
        alt: parseFloat(gpsData.altitude) || 0
      },
      callsign: gpsData.callsign || existingDevice.callsign || deviceId,
      group: gpsData.group || existingDevice.group || '未分組',
      lastUpdate: new Date().toISOString(),
      status: 'active'
    };

    connectedDevices.set(deviceId, device);
    updateGroupIndex(deviceId, device.group);

    console.log(`📍 GPS updated for ${deviceId}: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);

    if (takClient && TAK_CONFIG.enabled) {
      const cotXml = generateDeviceCoT(device);
      takClient.sendCoT(cotXml);
    }

    broadcastToClients({
      type: 'device_update',
      device: device
    });
  } catch (error) {
    console.error('❌ GPS update error:', error);
  }
}

function handleCameraStatus(message) {
  try {
    const statusData = JSON.parse(message);
    const deviceId = statusData.deviceId || 'camera_1';

    const existingDevice = connectedDevices.get(deviceId);

    if (existingDevice) {
      existingDevice.status = statusData.status || existingDevice.status;
      existingDevice.battery = statusData.battery !== undefined ? parseInt(statusData.battery) : existingDevice.battery;
      existingDevice.signal = statusData.signal !== undefined ? parseInt(statusData.signal) : existingDevice.signal;
      existingDevice.lastUpdate = new Date().toISOString();
      connectedDevices.set(deviceId, existingDevice);

      console.log(`📊 Status updated for ${deviceId}`);

      broadcastToClients({
        type: 'device_update',
        device: existingDevice
      });
    }
  } catch (error) {
    console.error('❌ Camera status error:', error);
  }
}

function handleDeviceStatus(deviceId, message) {
  try {
    if (!message || message.length === 0) {
      return;
    }

    let statusData;
    try {
      statusData = JSON.parse(message);
    } catch (parseError) {
      console.warn(`⚠️  Device ${deviceId} sent invalid JSON`);
      return;
    }

    if (!statusData.position?.lat || !statusData.position?.lng) {
      console.warn(`⚠️  Device ${deviceId} missing position`);
      return;
    }

    const lat = parseFloat(statusData.position.lat);
    const lng = parseFloat(statusData.position.lng);

    if (isNaN(lat) || isNaN(lng)) {
      console.warn(`⚠️  Device ${deviceId} invalid coordinates`);
      return;
    }

    const device = {
      id: deviceId,
      type: statusData.type || 'unknown',
      position: {
        lat: lat,
        lng: lng,
        alt: parseFloat(statusData.position.alt) || 0
      },
      callsign: statusData.callsign || deviceId,
      status: statusData.status || 'active',
      battery: statusData.battery ? parseInt(statusData.battery) : undefined,
      signal: statusData.signal ? parseInt(statusData.signal) : undefined,
      priority: statusData.priority ? parseInt(statusData.priority) : 3,
      group: statusData.group || '未分組',
      streamUrl: statusData.streamUrl,
      rtspUrl: statusData.rtspUrl,
      lastUpdate: new Date().toISOString()
    };

    connectedDevices.set(deviceId, device);
    updateGroupIndex(deviceId, device.group);

    console.log(`📊 Device status updated: ${deviceId}`);

    if (takClient && TAK_CONFIG.enabled) {
      const cotXml = generateDeviceCoT(device);
      takClient.sendCoT(cotXml);
    }

    broadcastToClients({
      type: 'device_update',
      device: device
    });
  } catch (error) {
    console.error('❌ Device status error:', error);
  }
}

function updateDevicePosition(cotData) {
  try {
    const deviceId = cotData.uid || cotData.callsign || 'unknown';
    const point = cotData.point || {};

    const lat = parseFloat(point.lat);
    const lng = parseFloat(point.lon || point.lng);

    if (isNaN(lat) || isNaN(lng)) {
      console.warn('⚠️  CoT invalid coordinates');
      return;
    }

    const device = {
      id: deviceId,
      type: cotData.type || 'unknown',
      position: {
        lat: lat,
        lng: lng,
        alt: parseFloat(point.hae || point.alt) || 0
      },
      callsign: cotData.callsign || deviceId,
      lastUpdate: new Date().toISOString(),
      status: 'active'
    };

    connectedDevices.set(deviceId, device);
    console.log(`📍 Position updated for ${deviceId}: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);

    broadcastToClients({
      type: 'device_update',
      device: device
    });
  } catch (error) {
    console.error('❌ Update position error:', error);
  }
}

// ===== 處理接收訊息 (MQTT) =====
function handleIncomingMessage(messageStr, topic) {
  try {
    const incomingMsg = JSON.parse(messageStr);

    console.log(`💬 Incoming message from MQTT:`, incomingMsg);

    if (!incomingMsg.from || !incomingMsg.text) {
      console.warn('⚠️  Invalid message format');
      return;
    }

    const message = {
      id: incomingMsg.id || `msg-${Date.now()}`,
      from: incomingMsg.from,
      to: incomingMsg.to || 'COMMAND_CENTER',
      text: incomingMsg.text,
      priority: incomingMsg.priority || 3,
      timestamp: incomingMsg.timestamp || new Date().toISOString(),
      source: 'mqtt',
      topic: topic
    };

    messages.push(message);

    if (messages.length > 100) {
      messages.shift();
    }

    broadcastToClients({
      type: 'message',
      message: message,
    });

    console.log(`✅ Message stored and broadcasted: ${message.from} → ${message.to}`);
  } catch (error) {
    console.error('❌ Handle incoming message error:', error);
  }
}

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
    lastUpdate: device.lastUpdate || new Date().toISOString()
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
  origin: '*',
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use('/streams', express.static(streamsPath));

// ==================== REST API ====================

app.get('/health', (req, res) => {
  const validDevices = getValidDevices();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    mqtt: {
      mezzo: mqttClient.connected,
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

app.get('/devices', (req, res) => {
  const validDevices = getValidDevices();
  res.json({
    devices: validDevices,
    count: validDevices.length,
    groups: getAllGroups()
  });
});


app.get('/devices/:deviceId', (req, res) => {
  const device = connectedDevices.get(req.params.deviceId);
  if (device) {
    res.json(cleanDeviceData(device));
  } else {
    res.status(404).json({ error: 'Device not found' });
  }
});

app.get('/groups', (req, res) => {
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

app.post('/api/rtsp/register', (req, res) => {
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
      console.log(`📷 [Direct Stream] 註冊 MJPEG 直接串流: ${streamId}`);
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
      console.log(`🎥 [FFmpeg Stream] 註冊並轉換串流: ${streamId}`);
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
    //   console.log(`📤 Sent camera CoT to TAK Server: ${streamId}`);
    // }

// 👇👇👇 關鍵修改：暴力發送模式 (跟 debug_sender.js 一樣) 👇👇👇
    if (TAK_CONFIG.enabled) {
        const xmlPayload = generateDeviceCoT(device);
        
        console.log(`🚀 [暴力模式] 為 ${streamId} 建立獨立連線...`);
        
        const tempSocket = new net.Socket();
        
        // ⚠️ 直接連線到 FTS IP，不透過 TAKClient 類別
        tempSocket.connect(8087, '192.168.254.1', () => {
            console.log('✅ [暴力模式] 連線成功，發送 XML...');
            tempSocket.write(xmlPayload + '\n'); // 寫入資料
            tempSocket.end(); // 發送完馬上斷線
            console.log('🏁 [暴力模式] 發送完畢，已斷線');
        });

        tempSocket.on('error', (err) => {
            console.error('❌ [暴力模式] 失敗:', err.message);
        });
    }
    // 👆👆👆 修改結束 👆👆👆

    broadcastToClients({
      type: 'device_added',
      device: device
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
    console.error('❌ Register stream error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/streams', (req, res) => {
  const streams = streamManager.getAllStreams();
  res.json({
    streams: streams,
    count: streams.length
  });
});

app.delete('/api/rtsp/:streamId', (req, res) => {
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

app.post('/send-cot', (req, res) => {
  try {
    const cotXml = generateCotXml(req.body);

    if (takClient && TAK_CONFIG.enabled) {
      const sent = takClient.sendCoT(cotXml);
      res.json({
        success: sent,
        method: 'tak_server'
      });
    } else {
      mqttClient.publish(MQTT_CONFIG.topics.COT_MESSAGE, cotXml);
      res.json({
        success: true,
        method: 'mqtt'
      });
    }
  } catch (error) {
    console.error('❌ Send CoT error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/send-message', (req, res) => {
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

    console.log('📨 Sending message:', message);

    messages.push(message);

    if (messages.length > 100) {
      messages.shift();
    }

    broadcastToClients({
      type: 'message',
      message: message,
    });

    if (mqttClient && mqttClient.connected) {
      let topic = 'myapp/messages/broadcast';

      if (to.startsWith('group:')) {
        const groupName = to.replace('group:', '');
        topic = `myapp/messages/group/${groupName}`;
      } else if (to.startsWith('device:')) {
        const deviceId = to.replace('device:', '');
        topic = `myapp/messages/device/${deviceId}`;
      }

      mqttClient.publish(topic, JSON.stringify(message), (err) => {
        if (err) {
          console.error('❌ MQTT publish error:', err);
        } else {
          console.log(`📤 Message published to MQTT: ${topic}`);
        }
      });
    }

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
      console.log('📤 Message sent to TAK Server');
    }

    res.json({
      success: true,
      message: message,
    });
  } catch (error) {
    console.error('❌ Send message error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/messages', (req, res) => {
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

app.post('/voice-message', (req, res) => {
  const { message } = req.body;
  console.log('🎤 Voice command:', message);

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
    mqttClient.publish(MQTT_CONFIG.topics.CAMERA_CONTROL, JSON.stringify({
      action: command,
      timestamp: new Date().toISOString()
    }));

    try {
      exec(`python mqtt_publish.py ${command}`);
    } catch (error) {
      console.error('Python script error:', error);
    }
  }

  res.json({
    success: true,
    command: command,
    originalMessage: message
  });
});

app.get('/api/tak/status', (req, res) => {
  if (takClient) {
    res.json(takClient.getStatus());
  } else {
    res.json({ enabled: false });
  }
});

// ==================== PTT MQTT API ====================
// 添加到 server.js 中的 app.get('/api/tak/status'...) 之後

app.post('/ptt/publish', (req, res) => {
  try {
    const { topic, message, encoding } = req.body;

    if (!topic || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: topic, message'
      });
    }

    console.log(`📤 Publishing to PTT MQTT: ${topic}`);

    // 處理二進位訊息
    let buffer;
    if (encoding === 'binary' && Array.isArray(message)) {
      buffer = Buffer.from(message);
    } else if (typeof message === 'string') {
      buffer = Buffer.from(message, 'utf8');
    } else {
      buffer = Buffer.from(JSON.stringify(message));
    }

    // 發布到 PTT MQTT
    pttMqttClient.publish(topic, buffer, (err) => {
      if (err) {
        console.error('❌ PTT MQTT publish error:', err);
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      console.log(`✅ PTT MQTT published: ${topic}`);
      res.json({
        success: true,
        topic: topic,
        messageSize: buffer.length
      });
    });
  } catch (error) {
    console.error('❌ PTT publish error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// PTT 狀態查詢
app.get('/ptt/status', (req, res) => {
  res.json({
    connected: pttMqttClient.connected,
    broker: PTT_MQTT_CONFIG.broker,
    activeUsers: pttState.activeUsers.size,
    sosAlerts: pttState.sosAlerts.size,
    channels: Array.from(pttState.channelUsers.keys())
  });
});

// PTT 活躍使用者列表
app.get('/ptt/users', (req, res) => {
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
app.get('/ptt/sos', (req, res) => {
  const alerts = Array.from(pttState.sosAlerts.values());
  
  res.json({
    alerts,
    count: alerts.length
  });
});

// 清除 SOS 警報
app.delete('/ptt/sos/:id', (req, res) => {
  const { id } = req.params;
  
  if (pttState.sosAlerts.has(id)) {
    pttState.sosAlerts.delete(id);
    
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
    console.log(`💓 Sending heartbeat for ${devices.length} devices...`);
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
//       console.log(`📤 模擬訊號已發送至 WinTAK: ${fakeDevice.callsign}`);
//   } else {
//       console.log('⚠️ TAK Server 未連線，無法發送模擬訊號');
//   }
//   // =======================================

//   // 每 3 秒更新一次位置
// }, 3000);

// console.log('🛠️ Simulation Mode: Active (Generating fake friendly unit)');
// // ============================================================

// ==================== 啟動服務器 ====================
app.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   Mezzo TAK Integration Server - COMPLETE EDITION        ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('🚀 服務狀態:');
  console.log(`   HTTP Server:  http://0.0.0.0:${HTTP_PORT}`);
  console.log(`   WebSocket:    ws://0.0.0.0:${WS_PORT}`);
  console.log(`   MQTT Broker:  ${MQTT_CONFIG.broker}`);
  console.log(`   TAK Server:   ${TAK_CONFIG.enabled ? `✅ ${TAK_CONFIG.host}:${TAK_CONFIG.port}` : '❌ Disabled'}`);
  console.log(`   RTSP Streams: ${STREAM_CONFIG.enabled ? '✅ Enabled' : '❌ Disabled'}`);
  console.log('');
  console.log('📋 功能:');
  console.log('   ✅ ATAK 群組支援 (自動解析群組資訊)');
  console.log('   ✅ 訊息系統 (MQTT + WebSocket + TAK Server)');
  console.log('   ✅ 群組訊息路由');
  console.log('   ✅ 設備群組管理');
  console.log('   ✅ RTSP 攝像頭註冊與串流');
  console.log('');
  console.log('📋 主要 API 端點:');
  console.log('   GET  /health                - 系統健康檢查');
  console.log('   GET  /devices               - 所有設備列表');
  console.log('   GET  /groups                - 所有群組列表');
  console.log('   POST /api/rtsp/register     - 註冊 RTSP 攝像頭');
  console.log('   POST /send-message          - 發送訊息');
  console.log('   GET  /messages              - 訊息歷史');
  console.log('');
});

console.log(`📡 WebSocket Server listening on port ${WS_PORT}`);

// ==================== 優雅關閉 ====================

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
  console.log('\n⏹️  Shutting down gracefully...');

  streamManager.stopAllStreams();

  wss.close(() => {
    console.log('✅ WebSocket server closed');
  });

  mqttClient.end(false, () => {
    console.log('✅ MQTT client disconnected');
  });

  if (takClient) {
    takClient.disconnect();
    console.log('✅ TAK client disconnected');
  }

  console.log('👋 Goodbye!\n');
  process.exit(0);
}