const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const mqtt = require('mqtt');
const WebSocket = require('ws');
const xml2js = require('xml2js');
const path = require('path');
const fs = require('fs');
const net = require('net'); // [新增] 確保引入 net
const TAKServerClient = require('./tak-client.cjs'); // [新增] 引入外部檔案

const app = express();
const HTTP_PORT = 4000;
const WS_PORT = 4005;
const PYTHON_PORT = 8999; // [新增] 專給 Python 連線的 Port

// ==================== 配置 ====================

// TAK Server 配置（改這裡來啟用/關閉 TAK Server）
const TAK_CONFIG = {
  enabled: true,  // ← 改成 true
  host: '127.0.0.1',  // ← 改成公開伺服器
  port: 8087,
  useTLS: false
};

// MQTT 配置
const MQTT_BROKER = 'mqtt://test.mosquitto.org:1883';
const MQTT_TOPICS = {
  CAMERA_CONTROL: 'myapp/camera/control',
  CAMERA_STATUS: 'myapp/camera/status',
  CAMERA_GPS: 'myapp/camera/gps',
  COT_MESSAGE: 'myapp/cot/message',
  DEVICE_STATUS: 'myapp/device/+/status'
};
// RTSP 配置
const RTSP_CONFIG = {
  enabled: true,
  outputDir: path.join(__dirname, 'streams')
};

// ==================== 儲存 ====================

const connectedDevices = new Map();
const cotMessages = [];
const rtspStreams = new Map();
const rtspProcesses = new Map();

// 確保 streams 目錄存在
if (RTSP_CONFIG.enabled && !fs.existsSync(RTSP_CONFIG.outputDir)) {
  fs.mkdirSync(RTSP_CONFIG.outputDir, { recursive: true });
  console.log('📁 Created streams directory');
}

function processCoTData(sourceType, evt) {
    if (!evt || !evt.point) return;
    
    // 過濾掉 Ping 心跳包
    if (evt.uid === 'NodeJS-Ping' || evt.type === 't-x-c-t') return;

    // 1. 翻譯圖示類型
    let type = 'unknown';
    if (evt.type && evt.type.includes('a-f-G')) type = 'user';     // 地面友軍
    if (evt.type && evt.type.includes('a-f-A')) type = 'drone';    // 空中友軍
    if (evt.type && evt.type.includes('b-m-p')) type = 'vehicle';  // 車輛
    if (evt.type === 't-x-c-t') type = 'base';

    // 2. 建立前端 JSON (Lat/Lon -> Lat/Lng)
    const deviceData = {
        id: evt.uid,
        type: type,
        position: {
            lat: parseFloat(evt.point.lat),
            lng: parseFloat(evt.point.lon), // [關鍵修正] TAK用lon, 前端用lng
            alt: parseFloat(evt.point.hae || 0)
        },
        callsign: evt.detail?.contact?.callsign || evt.uid,
        status: 'active',
        battery: evt.detail?.status?.battery ? parseInt(evt.detail.status.battery) : undefined,
        lastUpdate: new Date().toISOString(),
        priority: 1
    };

    console.log(`📡 [${sourceType}] 收到裝置: ${deviceData.callsign}`);

    // 3. 存入並廣播
    connectedDevices.set(deviceData.id, deviceData);
    
    broadcastToClients({
        type: 'devices_update',
        devices: [deviceData]
    });
}

// ==================== TAK Server 客戶端 (使用外部檔案) ====================

let takClient = null;

if (TAK_CONFIG.enabled) {
  // 使用 require 進來的強壯 Client，取代原本內部的 SimpleTAKClient
  takClient = new TAKServerClient(TAK_CONFIG);

  takClient.on('onConnect', () => {
      // 連線成功
  });

  takClient.on('onMessage', (result) => {
      // 收到 Server (WinTAK) 傳來的資料
      if (result && result.event) {
          processCoTData('TAK-Server', result.event);
      }
  });

  takClient.connect();
}

// ==================== RTSP 轉換器（簡化版）====================

function startRtspStream(streamId, rtspUrl) {
  const { spawn } = require('child_process');

  const outputPath = path.join(RTSP_CONFIG.outputDir, `${streamId}.m3u8`);
  const segmentPath = path.join(RTSP_CONFIG.outputDir, `${streamId}_%03d.ts`);

  console.log(`🎥 Starting RTSP stream: ${streamId}`);

  const ffmpeg = spawn('ffmpeg', [
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
  ]);

  ffmpeg.stderr.on('data', (data) => {
    const message = data.toString();
    if (message.includes('error') || message.includes('Error')) {
      console.error(`[${streamId}] ❌`, message);
    }
  });

  ffmpeg.on('close', (code) => {
    console.log(`[${streamId}] FFmpeg exited with code ${code}`);
    rtspProcesses.delete(streamId);
  });

  rtspProcesses.set(streamId, ffmpeg);

  return {
    streamId: streamId,
    hlsUrl: `/streams/${streamId}.m3u8`,
    rtspUrl: rtspUrl,
    status: 'active'
  };
}

function stopRtspStream(streamId) {
  const process = rtspProcesses.get(streamId);
  if (process) {
    process.kill('SIGTERM');
    rtspProcesses.delete(streamId);
    console.log(`🛑 Stopped stream: ${streamId}`);
    return true;
  }
  return false;
}

// ==================== MQTT 客戶端 ====================

const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT Broker');

  Object.values(MQTT_TOPICS).forEach(topic => {
    mqttClient.subscribe(topic, (err) => {
      if (!err) {
        console.log(`📡 Subscribed to: ${topic}`);
      }
    });
  });
});

mqttClient.on('message', (topic, message) => {
  const messageStr = message.toString();
  console.log(`📨 MQTT [${topic}]:`, messageStr.substring(0, 80));

  try {
    if (topic === MQTT_TOPICS.COT_MESSAGE) {
      handleCotMessage(messageStr);
    } else if (topic === MQTT_TOPICS.CAMERA_GPS) {
      handleGpsUpdate(messageStr);
    } else if (topic === MQTT_TOPICS.CAMERA_STATUS) {
      handleCameraStatus(messageStr);
    } else if (topic.startsWith('device/')) {
      handleDeviceStatus(topic, messageStr);
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

// ==================== WebSocket Server ====================

const wss = new WebSocket.Server({ port: WS_PORT });

wss.on('connection', (ws) => {
  console.log('🔌 WebSocket client connected');

  const initialDevices = getValidDevices();
  ws.send(JSON.stringify({
    type: 'initial_state',
    devices: initialDevices,
    cotMessages: cotMessages.slice(-50),
    streams: Array.from(rtspStreams.values())
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
});

function broadcastToClients(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(data));
      } catch (error) {
        console.error('❌ Broadcast error:', error);
      }
    }
  });
}

function handleWebSocketMessage(ws, data) {
  switch (data.type) {
    case 'send_command':
      mqttClient.publish(
        data.topic || MQTT_TOPICS.CAMERA_CONTROL,
        JSON.stringify(data.payload)
      );
      console.log(`📤 Command sent: ${data.payload?.action}`);
      break;

    case 'send_cot':
      const cotXml = generateCotXml(data.payload);
      if (takClient && TAK_CONFIG.enabled) {
        takClient.sendCoT(cotXml);
      } else {
        mqttClient.publish(MQTT_TOPICS.COT_MESSAGE, cotXml);
      }
      break;

    case 'request_devices':
      const devices = getValidDevices();
      ws.send(JSON.stringify({
        type: 'devices_update',
        devices: devices
      }));
      break;
  }
}

// ==================== 訊息處理函數 ====================

function handleCotMessage(message) {
  const parser = new xml2js.Parser();

  parser.parseString(message, (err, result) => {
    if (err) {
      try {
        const jsonData = JSON.parse(message);
        processCotData(jsonData);
      } catch (jsonErr) {
        console.error('❌ CoT parse error:', err.message);
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

    const deviceId = gpsData.deviceId || 'camera_1';
    const existingDevice = connectedDevices.get(deviceId) || {};

    const device = {
      ...existingDevice,
      id: deviceId,
      type: existingDevice.type || 'camera',
      position: {
        lat: lat,
        lng: lng,
        alt: parseFloat(gpsData.altitude) || 0
      },
      lastUpdate: new Date().toISOString(),
      status: existingDevice.status || 'active'
    };

    connectedDevices.set(deviceId, device);
    console.log(`📍 GPS updated for ${deviceId}: ${lat}, ${lng}`);

    // 如果啟用 TAK Server，發送 CoT
    if (takClient && TAK_CONFIG.enabled) {
      const cotXml = generateDeviceCoT(device);
      takClient.sendCoT(cotXml);
    }
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
    }
  } catch (error) {
    console.error('❌ Camera status error:', error);
  }
}

function handleDeviceStatus(topic, message) {
  const deviceId = topic.split('/')[1];

  try {
    // 檢查是否為有效 JSON
    if (!message || message.length === 0) {
      return;
    }

    // 嘗試解析 JSON
    let statusData;
    try {
      statusData = JSON.parse(message);
    } catch (parseError) {
      console.warn(`⚠️  Device ${deviceId} sent invalid JSON: ${message.substring(0, 50)}`);
      return;
    }

    // ===== 加上這段 =====
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
    // ====================

    connectedDevices.set(deviceId, {
      id: deviceId,
      type: statusData.type || 'unknown',
      position: {
        lat: lat,  // ← 現在 lat 已定義
        lng: lng,  // ← 現在 lng 已定義
        alt: parseFloat(statusData.position.alt) || 0
      },
      callsign: statusData.callsign || deviceId,
      status: statusData.status || 'active',
      battery: statusData.battery ? parseInt(statusData.battery) : undefined,
      signal: statusData.signal ? parseInt(statusData.signal) : undefined,
      lastUpdate: new Date().toISOString()
    });

    console.log(`📊 Device status updated: ${deviceId}`);
  } catch (error) {
    console.error('❌ Device status error:', error);
  }
}

function updateDevicePosition(cotData) {
  try {
    const deviceId = cotData.uid || cotData.callsign || 'unknown';
    const point = cotData.point || {};

    const lat = parseFloat(point.lat);
    const lng = parseFloat(point.lon);

    if (isNaN(lat) || isNaN(lng)) {
      console.warn('⚠️  CoT invalid coordinates');
      return;
    }

    connectedDevices.set(deviceId, {
      id: deviceId,
      type: cotData.type || 'unknown',
      position: {
        lat: lat,
        lng: lng,
        alt: parseFloat(point.hae) || 0
      },
      callsign: cotData.callsign || deviceId,
      lastUpdate: new Date().toISOString(),
      status: 'active'
    });

    console.log(`📍 Position updated for ${deviceId}: ${lat}, ${lng}`);
  } catch (error) {
    console.error('❌ Update position error:', error);
  }
}

// ==================== 驗證函數 ====================

function isValidDeviceData(device) {
  return (
    device &&
    device.id &&
    device.position &&
    typeof device.position.lat === 'number' &&
    typeof device.position.lng === 'number' &&
    !isNaN(device.position.lat) &&
    !isNaN(device.position.lng) &&
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
    streamUrl: device.streamUrl,
    rtspUrl: device.rtspUrl,
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

  const videoTag = device.streamUrl ? `<__video url="http://localhost:${HTTP_PORT}${device.streamUrl}"/>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="${device.id}" type="b-m-p-s-p-loc" how="m-g" time="${now.toISOString()}" start="${now.toISOString()}" stale="${stale.toISOString()}">
  <point lat="${device.position.lat}" lon="${device.position.lng}" hae="${device.position.alt || 0}" ce="10.0" le="10.0"/>
  <detail>
    <contact callsign="${device.callsign || device.id}"/>
    ${videoTag}
    <remarks>${device.type} - Priority ${device.priority || 3}</remarks>
    <priority>${device.priority || 3}</priority>
    <status>${device.status || 'unknown'}</status>
  </detail>
</event>`;
}

// ==================== Express 中介軟體 ====================

app.use(cors());
app.use(express.json());
app.use('/streams', express.static(RTSP_CONFIG.outputDir));

// ==================== REST API ====================

// 語音指令
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
  }

  if (command) {
    mqttClient.publish(MQTT_TOPICS.CAMERA_CONTROL, JSON.stringify({
      action: command,
      timestamp: new Date().toISOString()
    }));
    exec(`python mqtt_publish.py ${command}`);
  }

  res.json({ success: true, command: command });
});

// 設備管理
app.get('/devices', (req, res) => {
  const validDevices = getValidDevices();
  res.json({
    devices: validDevices,
    count: validDevices.length
  });
});

app.get('/health', (req, res) => {
  const validDevices = getValidDevices();
  res.json({
    status: 'ok',
    mqtt: mqttClient.connected,
    takServer: TAK_CONFIG.enabled ? (takClient?.connected ? 'connected' : 'disconnected') : 'disabled',
    devices: validDevices.length,
    streams: rtspStreams.size,
    websocketClients: wss.clients.size
  });
});

// RTSP 管理
app.post('/api/rtsp/register', (req, res) => {
  const { streamId, rtspUrl, position, priority } = req.body;

  if (!RTSP_CONFIG.enabled) {
    return res.status(503).json({
      success: false,
      error: 'RTSP not enabled'
    });
  }

  try {
    const streamInfo = startRtspStream(streamId, rtspUrl);

    rtspStreams.set(streamId, {
      ...streamInfo,
      position: position,
      priority: priority || 3
    });

    // 註冊為設備
    const device = {
      id: streamId,
      type: 'camera',
      position: position,
      priority: priority || 3,
      streamUrl: streamInfo.hlsUrl,
      rtspUrl: rtspUrl,
      status: 'active',
      lastUpdate: new Date().toISOString()
    };

    connectedDevices.set(streamId, device);

    // 如果啟用 TAK Server，發送 CoT
    if (takClient && TAK_CONFIG.enabled) {
      const cotXml = generateDeviceCoT(device);
      takClient.sendCoT(cotXml);
      console.log(`📤 Sent camera CoT to TAK Server: ${streamId}`);
    }

    res.json({ success: true, stream: streamInfo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/streams', (req, res) => {
  const streams = Array.from(rtspStreams.values());
  res.json({ streams, count: streams.length });
});

app.delete('/api/rtsp/:streamId', (req, res) => {
  const { streamId } = req.params;

  if (stopRtspStream(streamId)) {
    rtspStreams.delete(streamId);
    connectedDevices.delete(streamId);
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: 'Stream not found' });
  }
});

// CoT 訊息
app.post('/send-cot', (req, res) => {
  try {
    const cotXml = generateCotXml(req.body);
    if (takClient && TAK_CONFIG.enabled) {
      takClient.sendCoT(cotXml);
    } else {
      mqttClient.publish(MQTT_TOPICS.COT_MESSAGE, cotXml);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 啟動服務器 ====================

app.listen(HTTP_PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     CivTAK/ATAK Integration Server with TAK Support   ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('🚀 服務狀態:');
  console.log(`   HTTP Server: http://localhost:${HTTP_PORT}`);
  console.log(`   WebSocket:   ws://localhost:${WS_PORT}`);
  console.log(`   MQTT Broker: ${MQTT_BROKER}`);
  console.log(`   TAK Server:  ${TAK_CONFIG.enabled ? `${TAK_CONFIG.host}:${TAK_CONFIG.port}` : '❌ Disabled'}`);
  console.log(`   RTSP:        ${RTSP_CONFIG.enabled ? '✅ Enabled' : '❌ Disabled'}`);
  console.log('');
  console.log('📋 啟用/關閉 TAK Server:');
  console.log('   編輯 server.js 第 14 行: TAK_CONFIG.enabled = true/false');
  console.log('');
  console.log('📋 API 端點:');
  console.log('   GET  /health              - 健康檢查');
  console.log('   GET  /devices             - 所有設備');
  console.log('   POST /voice-message       - 語音指令');
  console.log('   POST /api/rtsp/register   - 註冊 RTSP 攝像頭');
  console.log('   POST /send-cot            - 發送 CoT 訊息');
  console.log('');
  console.log('💡 測試指令:');
  console.log(`   curl http://localhost:${HTTP_PORT}/health`);
  console.log('');
});

// 優雅關閉
process.on('SIGINT', () => {
  console.log('\n⏹️  Shutting down...');

  // 停止所有 RTSP 串流
  rtspProcesses.forEach((process, streamId) => {
    process.kill('SIGTERM');
    console.log(`✅ Stopped stream: ${streamId}`);
  });

  wss.close();
  mqttClient.end();

  if (takClient) {
    takClient.disconnect();
  }

  console.log('👋 Goodbye!\n');
  process.exit(0);
});