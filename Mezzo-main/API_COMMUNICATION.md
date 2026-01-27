# Mezzo 系統 API 通訊文檔

> **目的**：提供 Ben 進行執法儀語音測試的完整前後端通訊說明
> **更新時間**：2026-01-27
> **針對功能**：遠端監聽、PTT 語音溝通

---

## 目錄
1. [系統架構概覽](#系統架構概覽)
2. [伺服器 Ports 配置](#伺服器-ports-配置)
3. [MQTT Topics 清單](#mqtt-topics-清單)
4. [HTTP API Endpoints](#http-api-endpoints)
5. [WebSocket 通訊協議](#websocket-通訊協議)
6. [PTT 訊息格式](#ptt-訊息格式)
7. [前端組件對應](#前端組件對應)

---

## 系統架構概覽

```
┌──────────────────────────────────────────────────────────────┐
│                        前端 (React)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │GPSTracking.tsx│  │Communication │  │   WebRTC (Signal)  │  │
│  │    (主頁面)    │  │   .tsx       │  │                    │  │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘  │
│         │                  │                     │             │
└─────────┼──────────────────┼─────────────────────┼─────────────┘
          │                  │                     │
          │ HTTP/WS          │ HTTP/WS             │ Socket.IO
          │ :4000/:4001      │ :4000/:4001         │ :3001
          ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                      後端伺服器                               │
│  ┌────────────────┐  ┌──────────────────────────────────┐  │
│  │  server.cjs    │  │    signaling_server.js           │  │
│  │  (主伺服器)     │  │    (WebRTC 信令伺服器)            │  │
│  │  Port: 4000/1  │  │    Port: 3001                    │  │
│  └───────┬────────┘  └──────────────────────────────────┘  │
│          │ MQTT Client                                      │
└──────────┼──────────────────────────────────────────────────┘
           │
           ▼
  ┌────────────────────┐
  │   MQTT Broker      │
  │ 118.163.141.80:1883│  ← PTT 執法儀 MQTT 主機
  └────────────────────┘
```

---

## 伺服器 Ports 配置

### 主伺服器 (server.cjs)

| Port  | 協議 | 用途             | 說明                          |
|-------|------|------------------|------------------------------|
| 4000  | HTTP | REST API         | 設備管理、訊息發送、PTT 控制   |
| 4001  | WS   | WebSocket        | 設備即時更新、訊息推送         |

### 信令伺服器 (signaling_server.js)

| Port  | 協議      | 用途             | 說明                          |
|-------|-----------|------------------|------------------------------|
| 3001  | Socket.IO | WebRTC 信令      | 視訊通話連接協商、媒體控制     |

### MQTT Broker (外部)

| 主機               | Port | 協議 | 用途           |
|-------------------|------|------|----------------|
| 118.163.141.80    | 1883 | MQTT | PTT 系統訊息    |

---

## MQTT Topics 清單

### PTT 系統 MQTT Topics (前綴: `/WJI/PTT/`)

#### 格式說明
```
/WJI/PTT/{Channel}/{MessageType}[/{Target}]
```

#### 訊息類型清單

| Topic 模式 | 方向 | 說明 | 對應 Handler |
|-----------|------|------|-------------|
| `/WJI/PTT/{Channel}/GPS` | → Broker | 發送 GPS 位置 | `handlePTT_GPS()` |
| `/WJI/PTT/{Channel}/SOS` | → Broker | 發送緊急求救訊號 | `handlePTT_SOS()` |
| `/WJI/PTT/{Channel}/CHANNEL_ANNOUNCE` | ↔ Broker | 頻道廣播訊息 | `handlePTT_Broadcast()` |
| `/WJI/PTT/{Channel}/SPEECH` | ↔ Broker | **群組語音音訊** | `handlePTT_SPEECH()` |
| `/WJI/PTT/{Channel}/PRIVATE/{TargetID}` | → Broker | **私人語音音訊（點對點）** | `handlePTT_PRIVATE()` |
| `/WJI/PTT/{Channel}/PRIVATE_SPK_REQ` | → Broker | **私人通話請求** | `handlePTT_PrivateRequest()` |
| `/WJI/PTT/{Channel}/PRIVATE_SPK_STOP` | → Broker | **私人通話結束** | `handlePTT_PrivateStop()` |
| `/WJI/PTT/{Channel}/MARK` | → Broker | 錄影標記（開始/停止） | `handlePTT_MARK()` |
| `/WJI/PTT/{Channel}/SPEECH_START` | → Broker | **群組搶麥請求** | `handlePTT_SpeechStart()` |
| `/WJI/PTT/{Channel}/SPEECH_STOP` | → Broker | **釋放麥克風** | `handlePTT_SpeechStop()` |
| `/WJI/PTT/{Channel}/MIC_RESPONSE` | → Broker | **搶麥請求回應** | `handlePTT_MicResponse()` |
| `/WJI/PTT/#` | ← Broker | **訂閱所有 PTT 主題** | (伺服器訂閱) |

#### 頻道 (Channel) 清單

系統預設頻道：
- `channel1` - 頻道 1
- `channel2` - 頻道 2
- `channel3` - 頻道 3
- `emergency` - 緊急頻道
- `{動態群組名稱}` - 根據設備群組自動建立

---

## HTTP API Endpoints

### Base URL
```
http://localhost:4000
```

### 設備管理

#### `GET /devices`
**說明**：取得所有連線設備清單

**回應**：
```json
{
  "devices": [
    {
      "id": "USER-ABC123",
      "type": "ptt_user",
      "position": { "lat": 25.033964, "lng": 121.564472, "alt": 0 },
      "callsign": "USER-ABC123",
      "group": "channel1",
      "status": "active",
      "priority": 3,
      "lastUpdate": "2026-01-27T10:00:00.000Z"
    }
  ]
}
```

#### `GET /devices/:deviceId`
**說明**：取得特定設備資訊

#### `GET /groups`
**說明**：取得所有群組及其成員

**回應**：
```json
{
  "groups": [
    {
      "name": "channel1",
      "members": ["USER-ABC123", "USER-XYZ789"]
    }
  ]
}
```

### PTT 控制

#### `POST /ptt/publish`
**說明**：發送 PTT 訊息到 MQTT Broker

**請求**：
```json
{
  "topic": "/WJI/PTT/channel1/GPS",
  "message": [/* PTT訊息陣列 */],
  "encoding": "binary"
}
```

**回應**：
```json
{
  "success": true
}
```

**PTT 訊息格式**（Binary Array）：
```
[Tag (32 bytes)] + [UUID (128 bytes)] + [Data (Variable)]
```

#### `POST /ptt/voice-message`
**說明**：發送語音訊息（包含音訊和文字轉錄）

**請求**：
```json
{
  "channel": "channel1",
  "from": "USER-ABC123",
  "to": "group:channel1",
  "text": "💬 語音訊息內容",
  "audioData": "base64EncodedAudioData...",
  "transcript": "語音轉文字結果"
}
```

**回應**：
```json
{
  "success": true
}
```

**說明**：
- 伺服器會自動透過 WebSocket 廣播給所有連線的客戶端
- `transcript` 欄位為語音識別結果（可選）

#### `GET /ptt/status`
**說明**：取得 PTT 系統狀態

**回應**：
```json
{
  "connected": true,
  "broker": "mqtt://118.163.141.80:1883",
  "activeUsers": 5,
  "sosAlerts": 0
}
```

#### `GET /ptt/users`
**說明**：取得所有活躍 PTT 使用者

#### `GET /ptt/sos`
**說明**：取得所有 SOS 警報

#### `DELETE /ptt/sos/:id`
**說明**：清除特定 SOS 警報

### 訊息管理

#### `GET /messages`
**說明**：取得歷史訊息

**Query 參數**：
- `group`: 群組名稱 (可選)
- `device`: 設備 ID (可選)

**回應**：
```json
{
  "messages": [
    {
      "id": "msg-1234",
      "from": "USER-ABC123",
      "to": "group:channel1",
      "text": "測試訊息",
      "timestamp": "2026-01-27T10:00:00.000Z",
      "priority": 3
    }
  ]
}
```

#### `POST /send-message`
**說明**：發送文字訊息

**請求**：
```json
{
  "to": "group:channel1",
  "text": "測試訊息",
  "priority": 3
}
```

### 系統狀態

#### `GET /health`
**說明**：健康檢查

**回應**：
```json
{
  "status": "ok",
  "uptime": 12345,
  "connections": {
    "mqtt": "connected",
    "websocket": 3
  }
}
```

---

## WebSocket 通訊協議

### 連接 URL
```
ws://localhost:4001
```

### 訊息類型（後端 → 前端）

#### 1. 初始狀態
```json
{
  "type": "initial_state",
  "devices": [/* 設備陣列 */]
}
```

#### 2. 設備更新
```json
{
  "type": "device_update",
  "device": {
    "id": "USER-ABC123",
    "position": { "lat": 25.033964, "lng": 121.564472 },
    "lastUpdate": "2026-01-27T10:00:00.000Z"
  }
}
```

#### 3. 設備新增
```json
{
  "type": "device_added",
  "device": {/* 設備物件 */}
}
```

#### 4. 設備移除
```json
{
  "type": "device_removed",
  "deviceId": "USER-ABC123"
}
```

#### 5. PTT 廣播訊息
```json
{
  "type": "ptt_broadcast",
  "message": {
    "id": "ptt-msg-1234",
    "from": "USER-ABC123",
    "to": "group:channel1",
    "text": "廣播內容",
    "timestamp": "2026-01-27T10:00:00.000Z"
  }
}
```

#### 6. PTT 音訊封包（語音通話）
```json
{
  "type": "ptt_audio",
  "packet": {
    "id": "audio-1234",
    "type": "group",  // 或 "private"
    "channel": "channel1",
    "from": "USER-ABC123",
    "to": "TARGET-ID",  // 私人通話時才有
    "audioData": "base64EncodedAudio...",
    "timestamp": "2026-01-27T10:00:00.000Z"
  }
}
```

**說明**：
- **群組語音** (`type: "group"`)：所有頻道成員都會收到
- **私人語音** (`type: "private"`)：只有指定的 `to` 設備會收到

#### 7. PTT 語音轉錄文字
```json
{
  "type": "ptt_transcript",
  "message": {
    "id": "transcript-1234",
    "from": "USER-ABC123",
    "text": "📝 語音轉文字內容",
    "audioData": "base64...",  // 可選，帶有音訊檔案
    "timestamp": "2026-01-27T10:00:00.000Z"
  }
}
```

#### 8. SOS 警報
```json
{
  "type": "sos_alert",
  "event": {
    "id": "SOS-USER-1234567890",
    "deviceId": "USER-ABC123",
    "position": { "lat": 25.033964, "lng": 121.564472 },
    "timestamp": "2026-01-27T10:00:00.000Z",
    "priority": 1
  }
}
```

#### 9. 私人通話請求
```json
{
  "type": "private_call_request",
  "from": "USER-ABC123",
  "to": "USER-XYZ789",
  "privateTopicID": "/WJI/PTT/channel1/PRIVATE/USER-XYZ789",
  "timestamp": "2026-01-27T10:00:00.000Z"
}
```

#### 10. 私人通話結束
```json
{
  "type": "private_call_stop",
  "from": "USER-ABC123",
  "to": "USER-XYZ789",
  "timestamp": "2026-01-27T10:00:00.000Z"
}
```

#### 11. 搶麥請求
```json
{
  "type": "ptt_mic_request",
  "channel": "channel1",
  "requester": "USER-ABC123",
  "currentSpeaker": "USER-XYZ789",
  "timestamp": "2026-01-27T10:00:00.000Z"
}
```

#### 12. 發言權狀態更新
```json
{
  "type": "ptt_speaker_update",
  "channel": "channel1",
  "speaker": "USER-ABC123",
  "action": "start",  // 或 "stop"
  "timestamp": "2026-01-27T10:00:00.000Z"
}
```

### 訊息類型（前端 → 後端）

#### 1. 註冊設備
```json
{
  "type": "register_device",
  "deviceId": "USER-ABC123"
}
```

#### 2. 請求設備列表
```json
{
  "type": "request_devices"
}
```

#### 3. 心跳
```json
{
  "type": "ping"
}
```

**回應**：
```json
{
  "type": "pong"
}
```

---

## PTT 訊息格式

### Binary 訊息結構

所有 PTT MQTT 訊息都使用以下格式：

```
┌──────────────┬───────────────┬─────────────┐
│  Tag         │    UUID       │   Data      │
│  (32 bytes)  │  (128 bytes)  │ (Variable)  │
└──────────────┴───────────────┴─────────────┘
```

### Tag 類型清單

| Tag | 說明 | Data 格式 |
|-----|------|-----------|
| `GPS` | GPS 位置 | `"UUID,Lat,Lon"` 或 `"Lat,Lon"` |
| `SOS` | 緊急求救 | `"Lat,Lon"` |
| `BROADCAST` | 廣播訊息 | `"訊息內容"` |
| `TEXT_MESSAGE` | 文字訊息 | `"訊息內容"` |
| `MARK_START` | 開始錄影 | 空字串 |
| `MARK_STOP` | 停止錄影 | 空字串 |
| `SPEECH_AUDIO` | 群組語音音訊 | Binary 音訊資料 |
| `PRIVATE_AUDIO` | 私人語音音訊 | Binary 音訊資料 |
| `PRIVATE_SPK_REQ` | 私人通話請求 | `"TargetUUID,PrivateTopicID"` |
| `PRIVATE_SPK_STOP` | 私人通話結束 | `"TargetUUID"` |
| `PTT_MSG_TYPE_SPEECH_START` | 請求發言 | 空字串 |
| `PTT_MSG_TYPE_SPEECH_STOP` | 釋放麥克風 | 空字串 |
| `PTT_MSG_TYPE_MIC_RESPONSE` | 搶麥回應 | `"RequesterUUID,accept/deny"` |

### 前端建立 PTT 訊息範例 (GPSTracking.tsx)

```typescript
// 建立 PTT 訊息
function createPTTMessage(tag: string, uuid: string, data: string): number[] {
    // Tag Buffer (32 bytes)
    const tagBuffer = new Uint8Array(32);
    const tagBytes = new TextEncoder().encode(tag);
    tagBuffer.set(tagBytes.slice(0, 32));

    // UUID Buffer (128 bytes)
    const uuidBuffer = new Uint8Array(128);
    const uuidBytes = new TextEncoder().encode(uuid);
    uuidBuffer.set(uuidBytes.slice(0, 128));

    // Data Buffer (可變長度)
    const dataBytes = new TextEncoder().encode(data);

    // 組合成完整訊息
    const combined = new Uint8Array(160 + dataBytes.length);
    combined.set(tagBuffer, 0);
    combined.set(uuidBuffer, 32);
    combined.set(dataBytes, 160);

    return Array.from(combined);
}

// 使用範例：發送 GPS
const gpsMessage = createPTTMessage('GPS', 'USER-ABC123', '25.033964,121.564472');
```

### 後端解析 PTT 訊息 (server.cjs)

```javascript
function parsePTTMessage(buffer) {
    if (buffer.length < 160) {
        return null;
    }

    // 解析 Tag (前 32 bytes)
    const tag = buffer.slice(0, 32).toString('utf8').trim().replace(/\0/g, '');

    // 解析 UUID (接下來 128 bytes)
    const uuid = buffer.slice(32, 160).toString('utf8').trim().replace(/\0/g, '');

    // 解析 Data (剩餘部分)
    const data = buffer.slice(160).toString('utf8').trim();

    return { tag, uuid, data };
}
```

---

## 前端組件對應

### GPSTracking.tsx

**負責功能**：
- PTT 主控制介面
- GPS 位置發送（手動 + 自動定位）
- SOS 警報發送
- 廣播訊息
- 錄影控制
- 群組語音通話（透過 PTTAudio 組件）
- 訊息顯示與發送

**使用的 API**：
- WebSocket: `ws://localhost:4001`
- HTTP POST: `/ptt/publish`
- HTTP POST: `/ptt/voice-message`

**程式碼位置**：`src/assets/GPSTracking.tsx`

#### 主要狀態管理

```typescript
// PTT 設備 ID（使用登入名稱或隨機生成）
const pttDeviceId = userName || `USER-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

// PTT 頻道
const [pttChannel, setPttChannel] = useState('channel1');

// GPS 座標
const [gpsLat, setGpsLat] = useState('25.033964');
const [gpsLon, setGpsLon] = useState('121.564472');

// 自動定位狀態
const [autoLocationEnabled, setAutoLocationEnabled] = useState(false);
```

#### WebSocket 連接與設備註冊

```typescript
useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        // 註冊設備 ID
        ws.send(JSON.stringify({
            type: 'register_device',
            deviceId: pttDeviceId
        }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // 處理不同類型的訊息
        switch (data.type) {
            case 'ptt_audio':
                handleAudioPlayback(data.packet);
                break;
            case 'ptt_broadcast':
                setMessages(prev => [...prev, data.message]);
                break;
            // ... 其他訊息類型
        }
    };
}, []);
```

#### 自動定位功能

```typescript
// 啟用自動定位
const startAutoLocation = () => {
    navigator.geolocation.getCurrentPosition((position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lon = position.coords.longitude.toFixed(6);

        setGpsLat(lat);
        setGpsLon(lon);

        // 立即發送位置
        sendPTTGPS(lat, lon);
    });

    // 監聽位置變化
    const watchId = navigator.geolocation.watchPosition((position) => {
        // 位置變化超過 10 米才更新
        // ...
    });
};

// 定期發送位置（每 30 秒）
useEffect(() => {
    if (!autoLocationEnabled) return;

    const intervalId = setInterval(() => {
        sendPTTGPS();
    }, 30000);

    return () => clearInterval(intervalId);
}, [autoLocationEnabled]);
```

### PTTAudio.tsx

**負責功能**：
- 群組語音通話（Push-to-Talk）
- 私人語音通話
- 語音轉文字
- 音訊編碼與發送

**程式碼位置**：`src/assets/PTTAudio.tsx`

### Communication.tsx

**負責功能**：
- WebRTC 視訊通話（多人）
- 媒體源切換（攝影機/螢幕）
- 媒體控制權管理

**使用的 API**：
- Socket.IO: `http://localhost:3001`

**程式碼位置**：`src/assets/Communication.tsx`

### CameraMap.tsx

**負責功能**：
- 地圖顯示
- 設備標記與篩選
- 設備資訊彈窗

**程式碼位置**：`src/assets/CameraMap.tsx`

---

## 執法儀語音測試注意事項

### 1. 遠端監聽

**流程**：
1. 執法儀發送語音到 MQTT Topic: `/WJI/PTT/{Channel}/SPEECH`
2. 後端 `server.cjs` 接收並解析音訊
3. 後端透過 WebSocket 廣播給所有連線的前端
4. 前端 `GPSTracking.tsx` 接收並播放音訊

**測試要點**：
- 確認 MQTT Broker 連接正常 (`118.163.141.80:1883`)
- 檢查音訊格式是否支援 (WebM Opus 或 OGG Opus)
- 驗證音訊 base64 編碼/解碼正確

### 2. PTT 語音溝通

**群組通話流程**：
1. 前端按住麥克風按鈕錄音
2. 錄音完成後發送到 `/ptt/publish` API
3. 後端轉發到 MQTT Topic: `/WJI/PTT/{Channel}/SPEECH`
4. 執法儀接收並播放

**私人通話流程**：
1. 發起通話請求 → Topic: `/WJI/PTT/{Channel}/PRIVATE_SPK_REQ`
2. 對方接受後，雙方建立點對點連線
3. 音訊發送到 Topic: `/WJI/PTT/{Channel}/PRIVATE/{TargetID}`

**搶麥機制**：
1. 使用者請求發言 → Tag: `PTT_MSG_TYPE_SPEECH_START`
2. 若有人正在說話，發送搶麥請求給當前說話者
3. 當前說話者同意或拒絕 → Tag: `PTT_MSG_TYPE_MIC_RESPONSE`

### 3. 語音轉文字

**功能說明**：
- 前端使用 Web Speech API (`webkitSpeechRecognition`)
- 錄音的同時進行語音識別
- 將轉錄文字與音訊一起發送到後端
- 後端廣播給所有客戶端顯示

**API 欄位**：
```json
{
  "audioData": "base64編碼音訊",
  "transcript": "轉錄的文字內容"
}
```

### 4. 定位功能

**自動定位**：
- 使用瀏覽器 Geolocation API
- 位置變化超過 10 米才更新
- 每 30 秒定期發送位置

**GPS 訊息格式**：
```
Topic: /WJI/PTT/{Channel}/GPS
Data: "UUID,Lat,Lon"
```

---

## 常見問題與排查

### Q1: MQTT 連接失敗

**檢查**：
- MQTT Broker 是否可達：`118.163.141.80:1883`
- 防火牆是否阻擋 MQTT 連接
- 後端 `server.cjs` 的 MQTT 配置是否正確

### Q2: WebSocket 連接失敗

**檢查**：
- 後端 `server.cjs` 是否在 Port 4001 正常運行
- 前端配置的 WebSocket URL 是否正確
- 瀏覽器是否支援 WebSocket

### Q3: 音訊無法播放

**檢查**：
- 音訊格式是否為 WebM Opus 或 OGG Opus
- Base64 編碼/解碼是否正確
- 瀏覽器是否支援該音訊格式

### Q4: 語音轉文字無效

**檢查**：
- 瀏覽器是否支援 Web Speech API
- 麥克風權限是否授予
- 語言設定是否為 `zh-TW`

---

## 附錄

### 相關文件
- [PTT_IMPLEMENTATION_SUMMARY.md](./PTT_IMPLEMENTATION_SUMMARY.md) - PTT 實作總結
- [PTT_VOICE_FEATURES_GUIDE.md](./PTT_VOICE_FEATURES_GUIDE.md) - PTT 語音功能指南
- [WEBRTC_PTT_DESIGN.md](./WEBRTC_PTT_DESIGN.md) - WebRTC PTT 設計文件

### 後端程式碼
- 主伺服器：`backend/server.cjs`
- WebRTC 信令：`signaling-server/signaling_server.js`

### 前端程式碼
- PTT 主介面：`src/assets/GPSTracking.tsx`
- PTT 音訊組件：`src/assets/PTTAudio.tsx`
- 通訊組件：`src/assets/Communication.tsx`
- 地圖組件：`src/assets/CameraMap.tsx`

---

**文檔版本**：1.0
**最後更新**：2026-01-27
**維護者**：Mezzo Development Team
