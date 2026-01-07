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

// ==================== 配置 ====================

// 公開訪問 URL（用於 ATAK 手機訪問影片）
const PUBLIC_URL = `http://localhost:${HTTP_PORT}`;

// TAK Server 配置
const TAK_CONFIG = {
  enabled: true,
  host: '137.184.101.250',        // FTS Official Public Server
  port: 8087,
  useTLS: false,
  description: 'FTS Official Public Server',
  software: 'freetakserver',
  reconnectInterval: 5000,
  heartbeatInterval: 30000
};

// MQTT 配置
const MQTT_CONFIG = {
  broker: 'mqtt://test.mosquitto.org:1883',
  topics: {
    CAMERA_CONTROL: 'myapp/camera/control',
    CAMERA_STATUS: 'myapp/camera/status',
    CAMERA_GPS: 'myapp/camera/gps',
    COT_MESSAGE: 'myapp/cot/message',
    DEVICE_STATUS: 'myapp/device/+/status',
    STREAM_CONTROL: 'myapp/stream/control',
    // ===== 訊息主題 =====
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
  streamTimeout: 300000  // 5 分鐘無活動自動停止
};

// ==================== 儲存 ====================

const connectedDevices = new Map();
const cotMessages = [];
const rtspStreams = new Map();
const rtspProcesses = new Map();
const streamActivity = new Map();
const messages = [];  // 訊息歷史記錄
const deviceGroups = new Map();  // 群組管理: groupName -> Set(deviceIds)
const streamsPath = path.resolve(__dirname, 'streams');
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
      this.socket.write(message + '\n');
      if (!message.includes('<ping')) {
        console.log('📤 Sent to TAK Server');
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
  // 移除設備從所有舊群組
  deviceGroups.forEach((members, group) => {
    members.delete(deviceId);
    if (members.size === 0) {
      deviceGroups.delete(group);
    }
  });

  // 添加到新群組
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

// ==================== RTSP 串流管理器 ====================

class StreamManager {
  constructor(config) {
    this.config = config;
    this.streams = rtspStreams;
    this.processes = rtspProcesses;
    this.activity = streamActivity;
  }

  startStream(streamId, rtspUrl, options = {}) {
    if (this.processes.size >= this.config.maxStreams) {
      throw new Error(`Maximum streams limit reached (${this.config.maxStreams})`);
    }

    this.stopStream(streamId);

    const outputPath = path.join(this.config.outputDir, `${streamId}.m3u8`);
    const segmentPath = path.join(this.config.outputDir, `${streamId}_%03d.ts`);

    console.log(`🎥 Starting stream: ${streamId}`);
    console.log(`   RTSP: ${rtspUrl}`);
    console.log(`   HLS:  /streams/${streamId}.m3u8`);

    const ffmpegArgs = [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '5',
      '-hls_flags', 'delete_segments+append_list',
      '-hls_segment_filename', segmentPath,
      outputPath
    ];

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
      rtspUrl: rtspUrl,
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

const mqttClient = mqtt.connect(MQTT_CONFIG.broker, MQTT_CONFIG.options);

mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT Broker');

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
    }
    // ===== 處理訊息 =====
    else if (topic.includes('messages/')) {
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

mqttClient.on('reconnect', () => {
  console.log('🔄 MQTT reconnecting...');
});

mqttClient.on('offline', () => {
  console.warn('⚠️  MQTT offline');
});

// ==================== WebSocket Server ====================

const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws) => {
  console.log('🔌 WebSocket client connected');

  const initialDevices = getValidDevices();
  ws.send(JSON.stringify({
    type: 'initial_state',
    devices: initialDevices,
    cotMessages: cotMessages.slice(-50),
    streams: streamManager.getAllStreams(),
    takStatus: takClient ? takClient.getStatus() : null,
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
    console.log('🔌 WebSocket client disconnected');
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
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

  return `<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="${data.uid}" type="${data.type || 'a-f-G-U-C'}" how="h-e" time="${now.toISOString()}" start="${now.toISOString()}" stale="${stale.toISOString()}">
  <point lat="${data.lat}" lon="${data.lon}" hae="${data.hae || 0}" ce="9999999.0" le="9999999.0"/>
  <detail>
    <contact callsign="${data.callsign || 'Unknown'}"/>
    <remarks>${data.remarks || ''}</remarks>
  </detail>
</event>`;
}

function generateDeviceCoT(device) {
  const now = new Date();
  const stale = new Date(now.getTime() + 300000);

  const videoTag = device.streamUrl
    ? `<__video url="${PUBLIC_URL}${device.streamUrl}"/>`
    : '';

  const groupTag = device.group && device.group !== '未分組'
    ? `<__group name="${device.group}"${device.role ? ` role="${device.role}"` : ''}/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="${device.id}" type="b-m-p-s-p-loc" how="m-g" time="${now.toISOString()}" start="${now.toISOString()}" stale="${stale.toISOString()}">
  <point lat="${device.position.lat}" lon="${device.position.lng}" hae="${device.position.alt || 0}" ce="10.0" le="10.0"/>
  <detail>
    <contact callsign="${device.callsign || device.id}"/>
    ${videoTag}
    ${groupTag}
    <remarks>${device.type} - Priority ${device.priority || 3}</remarks>
    <priority>${device.priority || 3}</priority>
    <status>${device.status || 'unknown'}</status>
  </detail>
</event>`;
}

// ==================== Express 中介軟體 ====================

app.use(cors({
  origin: '*', // 開發環境允許所有來源
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
      connected: mqttClient.connected,
      broker: MQTT_CONFIG.broker
    },
    takServer: takClient ? takClient.getStatus() : { enabled: false },
    devices: {
      total: validDevices.length,
      active: validDevices.filter(d => d.status === 'active').length
    },
    groups: {
      total: getAllGroups().length,
      list: getAllGroups()
    },
    streams: {
      total: streamManager.getAllStreams().length,
      active: rtspProcesses.size
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
  const { streamId, rtspUrl, position, priority, callsign, group } = req.body;

  if (!STREAM_CONFIG.enabled) {
    return res.status(503).json({
      success: false,
      error: 'RTSP streaming not enabled'
    });
  }

  if (!streamId || !rtspUrl || !position) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: streamId, rtspUrl, position'
    });
  }

  try {
    const streamInfo = streamManager.startStream(streamId, rtspUrl, {
      position: position,
      priority: priority || 3,
      callsign: callsign,
      group: group
    });

    const device = {
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
      streamUrl: streamInfo.hlsUrl,
      rtspUrl: rtspUrl,
      status: 'active',
      lastUpdate: new Date().toISOString()
    };

    connectedDevices.set(streamId, device);
    updateGroupIndex(streamId, device.group);

    if (takClient && TAK_CONFIG.enabled) {
      const cotXml = generateDeviceCoT(device);
      takClient.sendCoT(cotXml);
      console.log(`📤 Sent camera CoT to TAK Server: ${streamId}`);
    }

    broadcastToClients({
      type: 'device_added',
      device: device
    });

    res.json({
      success: true,
      stream: streamInfo,
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

// ==================== 啟動服務器 ====================

app.listen(HTTP_PORT, () => {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   Mezzo TAK Integration Server - COMPLETE EDITION        ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('🚀 服務狀態:');
  console.log(`   HTTP Server:  http://localhost:${HTTP_PORT}`);
  console.log(`   WebSocket:    ws://localhost:${WS_PORT}`);
  console.log(`   MQTT Broker:  ${MQTT_CONFIG.broker}`);
  console.log(`   TAK Server:   ${TAK_CONFIG.enabled ? `✅ ${TAK_CONFIG.host}:${TAK_CONFIG.port}` : '❌ Disabled'}`);
  console.log(`   RTSP Streams: ${STREAM_CONFIG.enabled ? '✅ Enabled' : '❌ Disabled'}`);
  console.log('');
  console.log('📋 新功能:');
  console.log('   ✅ ATAK 群組支援 (自動解析群組資訊)');
  console.log('   ✅ 訊息系統 (MQTT + WebSocket + TAK Server)');
  console.log('   ✅ 群組訊息路由');
  console.log('   ✅ 設備群組管理');
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