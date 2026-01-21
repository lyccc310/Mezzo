# Mezzo PTT 系統完整文檔

**最後更新**: 2026-01-21
**版本**: v2.0

---

## 目錄

1. [專案概述](#專案概述)
2. [PTT 通訊系統](#ptt-通訊系統)
3. [PTT 音訊功能](#ptt-音訊功能)
4. [PTT 語音轉文字](#ptt-語音轉文字)
5. [PTT 同步功能](#ptt-同步功能)
6. [技術架構](#技術架構)
7. [API 參考](#api-參考)
8. [故障排除](#故障排除)
9. [開發指南](#開發指南)

---

## 專案概述

Mezzo 是一個基於 React + Vite 的 PTT (Push-to-Talk) 即時通訊系統，整合了 MQTT 協議、WebSocket 通訊和語音功能。

### 主要功能

- ✅ **文字通訊**: 支援群組和頻道訊息
- ✅ **語音通話**: 群組語音和私人通話
- ✅ **語音轉文字**: 即時語音識別（繁體中文）
- ✅ **GPS 追蹤**: 即時位置分享
- ✅ **SOS 緊急求救**: 緊急警報系統
- ✅ **錄影標記**: 錄影狀態同步
- ✅ **自動斷句**: 基於靜音偵測的自動發送

### 技術棧

- **前端**: React 18 + TypeScript + Vite + Tailwind CSS
- **後端**: Node.js + Express + WebSocket
- **通訊協議**: MQTT + WebSocket
- **音訊處理**: MediaRecorder API + Web Audio API + Web Speech API

---

## PTT 通訊系統

### 系統架構

```
前端 (React)                 後端 (Node.js)              PTT MQTT Broker
    │                            │                         (118.163.141.80:1883)
    │ WebSocket                  │ MQTT Subscribe          │
    ├──────────────────────────> │ <──────────────────────┤
    │                            │                         │
    │ HTTP POST /ptt/publish     │ MQTT Publish           │
    ├──────────────────────────> ├───────────────────────>│
    │                            │                         │
    │ WebSocket Broadcast        │ MQTT Message           │
    │<────────────────────────── │<───────────────────────┤
```

### PTT MQTT 訊息格式

所有 PTT 訊息使用統一的二進位格式：

```
+--------------------------------+--------------------------------------------------+----------------------------------+
| Tag (Header)                   | Sender UUID                                      | Data (Payload)                   |
+--------------------------------+--------------------------------------------------+----------------------------------+
| 32 Bytes                       | 128 Bytes                                        | Variable Length (N Bytes)        |
+--------------------------------+--------------------------------------------------+----------------------------------+
```

### Topic 路徑結構

```
/WJI/PTT/{Channel}/{Function}
```

#### 支援的 Function 類型

| Function | 用途 | Tag 範例 |
|----------|------|---------|
| `CHANNEL_ANNOUNCE` | 文字訊息/廣播 | `TEXT_MESSAGE`, `BROADCAST` |
| `GPS` | GPS 定位 | `GPS` |
| `SOS` | 緊急求救 | `SOS` |
| `MARK` | 錄影標記 | `MARK_START`, `MARK_STOP` |
| `SPEECH` | 群組語音 | `SPEECH_AUDIO` |
| `PRIVATE/{RandomID}` | 私人通話 | `PRIVATE_AUDIO` |

### 訊息流程

#### 發送訊息

1. **前端**: 用戶輸入訊息
2. **前端**: 調用 `sendPTTMessage(channel, text)`
3. **前端**: 建立 PTT 格式 (Tag + UUID + Data)
4. **前端**: POST 到 `/ptt/publish`
5. **後端**: 發布到 PTT MQTT Broker
6. **PTT Broker**: 廣播到所有訂閱設備

#### 接收訊息

1. **PTT Broker**: 接收到新訊息
2. **後端**: MQTT 客戶端接收
3. **後端**: 解析二進位格式
4. **後端**: 根據 Tag 分類處理
5. **後端**: WebSocket 廣播到前端
6. **前端**: 顯示在聊天介面

---

## PTT 音訊功能

### 群組語音 (SPEECH)

**Topic**: `/WJI/PTT/{Channel}/SPEECH`

#### 使用方式

1. 開啟 PTT 控制面板
2. 選擇頻道 (channel1, channel2, channel3, emergency)
3. 點擊「開始發話 (PTT)」按鈕
4. 開始說話
5. 點擊「停止發話」結束並自動發送

#### 技術規格

- **音訊格式**: WebM + Opus 編碼
- **採樣率**: 16kHz (適合語音)
- **收集間隔**: 100ms
- **音訊處理**:
  - 回音消除 (echoCancellation)
  - 噪音抑制 (noiseSuppression)
  - 自動增益控制 (autoGainControl)

### 私人通話 (PRIVATE)

**Topic**: `/WJI/PTT/{Channel}/PRIVATE/{RandomID}`

#### 使用方式

1. 在「私人通話」區域輸入目標設備 ID
2. 點擊「發起通話」按鈕
3. 系統自動生成 RandomID (格式: `CALL-{timestamp}-{random}`)
4. 開始錄音並持續傳輸
5. 點擊「結束通話」停止

#### 特點

- 一對一通話
- 動態生成通話 ID
- 通話中禁用群組 PTT

### 語音播放

系統自動接收並播放其他用戶的語音：

1. **解碼音訊**: 將 base64 編碼解碼為二進位
2. **創建 Blob**: 使用 `audio/webm;codecs=opus` 格式
3. **自動播放**: HTML5 Audio API
4. **備用格式**: 如果失敗，嘗試 `audio/ogg;codecs=opus`
5. **顯示通知**: 狀態欄提示「正在播放來自 XXX 的語音」
6. **聊天記錄**: 顯示 `🎙️ [語音訊息]` 和播放按鈕

### WebSocket 音訊封包格式

```json
{
  "type": "ptt_audio",
  "packet": {
    "id": "speech-USER-001-1234567890",
    "type": "speech",
    "channel": "channel1",
    "from": "USER-001",
    "timestamp": "2026-01-21T00:00:00.000Z",
    "audioData": "base64_encoded_audio_data...",
    "tag": "SPEECH_AUDIO"
  }
}
```

---

## PTT 語音轉文字

### Web Speech API

系統使用瀏覽器內建的 Web Speech Recognition API 進行即時語音識別。

#### 支援的瀏覽器

- ✅ Chrome / Edge (推薦)
- ⚠️ Safari (部分支援)
- ⚠️ Firefox (需啟用實驗功能)

### 功能特點

1. **即時轉換**: 說話時即時顯示識別結果
2. **繁體中文**: 語言設定為 `zh-TW`
3. **持續識別**: `continuous: true` 支援長時間錄音
4. **中間結果**: `interimResults: true` 顯示臨時識別結果

### 實作邏輯

```typescript
const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
recognitionRef.current = new SpeechRecognition();
recognitionRef.current.continuous = true;
recognitionRef.current.interimResults = true;
recognitionRef.current.lang = 'zh-TW';

recognitionRef.current.onresult = (event) => {
    // 累積最終結果
    let finalTranscript = '';
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
            finalTranscript += transcript;
        } else {
            interimTranscript += transcript;
        }
    }

    // 顯示組合結果
    const displayText = finalTranscript + interimTranscript;
    setCurrentTranscript(displayText);
};
```

### 轉錄文字顯示

識別的文字會同時顯示：
- **錄音時**: PTT 面板中即時顯示
- **發送後**: 聊天室中顯示為 `💬 {轉錄文字}` + 播放按鈕

---

## 自動斷句功能

### 靜音偵測原理

系統使用 Web Audio API 的 AnalyserNode 即時監控音訊電平，當偵測到靜音超過設定時間時，自動停止錄音並發送。

### 工作流程

```
開始錄音
    ↓
持續監控音訊電平
    ↓
電平 < 靜音閾值？
    ├─ 是 → 開始計時
    │         ↓
    │    持續靜音 > 設定時間？
    │         ├─ 是 → 自動停止並發送
    │         └─ 否 → 繼續監控
    │
    └─ 否 → 清除計時器，繼續錄音
```

### 可調參數

#### 靜音閾值 (Silence Threshold)

- **範圍**: 0% - 10%
- **預設**: 2%
- **說明**: 音量低於此值視為靜音
- **調整建議**:
  - 環境嘈雜 → 提高閾值 (3-5%)
  - 環境安靜 → 降低閾值 (1-2%)

#### 靜音持續時間 (Silence Duration)

- **範圍**: 0.5 - 3.0 秒
- **預設**: 1.5 秒
- **說明**: 持續靜音多久後自動發送
- **調整建議**:
  - 快速對話 → 縮短時間 (0.8-1.2秒)
  - 思考時間長 → 延長時間 (2.0-3.0秒)

### 實作代碼

```typescript
if (autoSend && !privateCallActive) {
    if (level < silenceThreshold) {
        // 偵測到靜音，開始計時
        if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
                console.log('🔇 Silence detected, auto-sending...');
                stopGroupRecording();
            }, silenceDuration);
        }
    } else {
        // 有聲音，清除計時器
        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }
    }
}
```

---

## PTT 同步功能

### 頻道/群組統一管理

系統整合固定頻道和動態群組：

```typescript
const pttChannels = Array.from(
    new Set([
        'channel1',
        'channel2',
        'channel3',
        'emergency',
        ...deviceGroups.filter(g => g !== '未分組')
    ])
);
```

#### 同步特點

- 🎯 PTT 控制面板和通訊面板顯示相同頻道
- 🎯 新加入設備群組自動出現
- 🎯 頻道數量實時同步

### GPS 位置發送同步

發送 GPS 時同步顯示在通訊面板：

```typescript
sendPTTGPS()
  ↓
MQTT → /WJI/PTT/{channel}/GPS
  ↓
通訊面板顯示: "📍 發送了位置資訊 (25.033964, 121.564472)"
```

**訊息格式**:
- 發送者: PTT 設備 ID
- 接收者: `group:{當前頻道}`
- 內容: `📍 發送了位置資訊 (緯度, 經度)`
- 優先級: 3

**過濾無效座標**: 系統會過濾掉 (0,0) 的無效 GPS 更新，避免聊天室洗版。

### SOS 緊急求救同步

發送 SOS 時在通訊面板顯示警報：

```typescript
sendPTTSOS()
  ↓
MQTT → /WJI/PTT/{channel}/SOS
  ↓
通訊面板顯示: "🆘 發送了緊急求救訊號！位置: (25.033964, 121.564472)"
```

**訊息格式**:
- 優先級: 1 (最高)
- 包含詳細位置資訊
- 紅色高亮顯示

### 錄影標記同步

錄影狀態變更時同步通知：

```typescript
toggleRecording()
  ↓
MQTT → /WJI/PTT/{channel}/MARK
  ↓
通訊面板顯示: "📹 開始錄影" 或 "⏹️ 停止錄影"
```

### WebSocket 訊息處理

| 訊息類型 | 觸發條件 | 處理方式 |
|---------|---------|---------|
| `message` | 文字訊息 | 直接顯示 |
| `ptt_broadcast` | PTT 廣播 | 顯示在聊天室 |
| `ptt_transcript` | 語音轉文字 | 顯示文字 + 播放按鈕 |
| `ptt_audio` | 語音封包 | 自動播放音訊 |
| `device_update` (ptt) | GPS 更新 | 位置通知（過濾 0,0）|
| `sos_alert` | SOS 警報 | 緊急通知 |
| `ptt_mark` | 錄影標記 | 錄影狀態 |

---

## 技術架構

### 前端架構

#### 主要組件

- **App.tsx**: 根組件，處理登入和路由
- **GPSTracking.tsx**: 主要介面，包含地圖、通訊面板和 PTT 控制
- **PTTAudio.tsx**: 音訊錄製和語音識別組件
- **Device.tsx**: 設備管理
- **Communication.tsx**: 通訊面板
- **CameraMap.tsx**: 攝影機地圖

#### 狀態管理

使用 React Hooks:
- `useState`: UI 狀態管理
- `useRef`: 持久化數據（不觸發重渲染）
- `useEffect`: 副作用處理和清理

### 後端架構

#### server.cjs 主要功能

1. **MQTT 客戶端管理**
   - 連接 PTT MQTT Broker
   - 訂閱 `/WJI/PTT/#` 接收所有訊息
   - 解析 PTT 二進位格式

2. **WebSocket 服務器**
   - 維護客戶端連接
   - 廣播訊息到所有客戶端
   - 處理客戶端訂閱

3. **HTTP API**
   - POST `/ptt/publish`: 發布 PTT 訊息
   - GET `/ptt/status`: 查詢 PTT 狀態

#### PTT 訊息處理函數

- `parsePTTMessage()`: 解析二進位格式
- `handlePTT_TextMessage()`: 處理文字訊息
- `handlePTT_GPS()`: 處理 GPS 定位
- `handlePTT_SOS()`: 處理 SOS 警報
- `handlePTT_MARK()`: 處理錄影標記
- `handlePTT_SPEECH()`: 處理群組語音
- `handlePTT_PRIVATE()`: 處理私人通話

#### 重複訊息過濾

```javascript
const pttState = {
    broadcastedTranscripts: new Set()  // 追蹤已廣播的訊息
};

// 發送 transcript 時標記
const messageKey = `${uuid}-${audioData.substring(0, 50)}`;
pttState.broadcastedTranscripts.add(messageKey);

// 5 秒後清除標記
setTimeout(() => {
    pttState.broadcastedTranscripts.delete(messageKey);
}, 5000);

// SPEECH 處理時檢查
if (pttState.broadcastedTranscripts.has(messageKey)) {
    console.log('⏭️ Skipping duplicate broadcast');
    return;
}
```

---

## API 參考

### HTTP API

#### POST /ptt/publish

發布訊息到 PTT MQTT Broker

**Request Body**:
```json
{
  "topic": "/WJI/PTT/channel1/SPEECH",
  "message": [/* PTT 二進位格式 */],
  "encoding": "binary",
  "transcript": "語音轉文字結果（選填）"
}
```

**Response**:
```json
{
  "success": true,
  "topic": "/WJI/PTT/channel1/SPEECH",
  "messageSize": 5120,
  "transcriptSent": true
}
```

#### GET /ptt/status

查詢 PTT 系統狀態

**Response**:
```json
{
  "connected": true,
  "broker": "mqtt://118.163.141.80:1883",
  "activeUsers": 5,
  "sosAlerts": 0,
  "channels": ["channel1", "channel2", "emergency"]
}
```

### WebSocket Events

#### 發送事件

客戶端可發送：
```json
{
  "type": "subscribe",
  "channels": ["channel1", "emergency"]
}
```

#### 接收事件

##### ptt_audio (語音封包)
```json
{
  "type": "ptt_audio",
  "packet": {
    "id": "speech-USER-001-1234567890",
    "type": "speech",
    "channel": "channel1",
    "from": "USER-001",
    "audioData": "base64...",
    "timestamp": "2026-01-21T00:00:00.000Z"
  }
}
```

##### ptt_transcript (語音轉文字)
```json
{
  "type": "ptt_transcript",
  "message": {
    "id": "transcript-USER-001-1234567890",
    "from": "USER-001",
    "to": "group:channel1",
    "text": "💬 你好",
    "audioData": "base64...",
    "timestamp": "2026-01-21T00:00:00.000Z",
    "priority": 3
  }
}
```

##### device_update (GPS 更新)
```json
{
  "type": "device_update",
  "device": {
    "id": "USER-001",
    "position": {
      "lat": 25.033964,
      "lng": 121.564472
    },
    "source": "ptt_gps",
    "lastUpdate": "2026-01-21T00:00:00.000Z"
  }
}
```

---

## 故障排除

### 語音錄製問題

#### 問題: 無法錄音

**症狀**: 點擊 PTT 按鈕無反應

**解決方案**:
1. 檢查麥克風權限
   - Chrome: 設定 → 隱私權與安全性 → 網站設定 → 麥克風
2. 確認使用 HTTPS 或 localhost
3. 檢查瀏覽器支援 MediaRecorder API
4. 查看控制台錯誤訊息

#### 問題: 音質差

**症狀**: 錄音有雜音或失真

**解決方案**:
1. 使用高品質麥克風
2. 調整麥克風音量（系統設定）
3. 在安靜環境中使用
4. 啟用降噪功能（已預設開啟）
5. 使用耳機避免回音

### 語音播放問題

#### 問題: 無法播放接收的語音

**症狀**: 收到封包但無聲音

**解決方案**:
1. 檢查控制台錯誤（`NotSupportedError`）
2. 確認 WebSocket 連接正常
3. 檢查系統音量設定
4. 點擊頁面後再測試（瀏覽器自動播放限制）
5. 嘗試不同瀏覽器

**錯誤處理**: 系統自動嘗試備用格式 (`audio/ogg;codecs=opus`)

### 語音轉文字問題

#### 問題: 語音識別不工作

**症狀**: 說話但沒有顯示文字

**解決方案**:
1. 檢查瀏覽器支援度
   ```javascript
   console.log('SpeechRecognition:',
       'webkitSpeechRecognition' in window);
   ```
2. 確認麥克風權限已授予
3. 檢查 STT 運行狀態（進階設定面板）
4. 使用 Chrome/Edge 瀏覽器
5. 確認網路連接正常

#### 問題: 識別準確度低

**症狀**: 文字轉換錯誤多

**解決方案**:
1. 說話清晰，語速適中
2. 使用高品質麥克風
3. 在安靜環境中使用
4. 避免方言或俚語
5. 使用耳機避免回音干擾

### 自動斷句問題

#### 問題: 太敏感（說話中途就發送）

**解決方案**:
1. 降低靜音閾值 (1-2%)
2. 延長靜音持續時間 (2-3秒)
3. 調整音訊電平指示器觀察

#### 問題: 不敏感（停止說話很久才發送）

**解決方案**:
1. 提高靜音閾值 (3-5%)
2. 縮短靜音持續時間 (0.8-1.2秒)

### 重複訊息問題

#### 問題: 語音訊息出現兩次

**症狀**: 同一條語音訊息重複顯示

**解決方案**:
✅ 已修復 - 後端實作重複訊息過濾機制
- 使用 `broadcastedTranscripts` Set 追蹤
- 檢查 messageKey 避免重複廣播

### 連線問題

#### 問題: WebSocket 斷線

**症狀**: 無法接收訊息，顯示「未連線」

**解決方案**:
1. 檢查網路連接
2. 確認後端服務運行中
3. 查看瀏覽器控制台 WebSocket 錯誤
4. 系統會自動重連（5秒間隔）

#### 問題: MQTT 連線失敗

**症狀**: 無法發送訊息，後端日誌顯示 MQTT 錯誤

**解決方案**:
1. 確認 MQTT Broker 可訪問 (118.163.141.80:1883)
2. 檢查防火牆設定
3. 確認網路環境允許 MQTT 連接
4. 查看後端日誌詳細錯誤

---

## 開發指南

### 環境設置

#### 前端

```bash
cd Mezzo-main
npm install
npm run dev
```

**開發服務器**: http://localhost:5173

#### 後端

```bash
cd backend
npm install
node server.cjs
```

**服務端口**:
- HTTP: 4000
- WebSocket: 4000
- MQTT: 連接到 118.163.141.80:1883

### 專案結構

```
Mezzo-main/
├── src/
│   ├── App.tsx                 # 根組件
│   ├── assets/
│   │   ├── GPSTracking.tsx     # 主要介面
│   │   ├── PTTAudio.tsx        # 音訊組件
│   │   ├── Communication.tsx   # 通訊面板
│   │   ├── Device.tsx          # 設備管理
│   │   └── CameraMap.tsx       # 攝影機地圖
│   └── types.ts                # TypeScript 類型
├── backend/
│   ├── server.cjs              # 後端服務器
│   ├── test_ptt.py             # PTT 測試腳本
│   └── test_ptt_auto.py        # 自動化測試
└── PROJECT_DOCUMENTATION.md    # 本文件
```

### 新增功能開發

#### 1. 新增 PTT 功能類型

**後端** (server.cjs):

```javascript
// 1. 新增處理函數
function handlePTT_NEWFUNCTION(channel, uuid, tag, data) {
    console.log('📝 [PTT NEW FUNCTION]', { channel, uuid, data });

    // 處理邏輯
    const event = {
        id: `new-${uuid}-${Date.now()}`,
        deviceId: uuid,
        channel: channel,
        data: data
    };

    // 廣播
    broadcastToClients({
        type: 'ptt_newfunction',
        event: event
    });
}

// 2. 在 MQTT 訊息處理中加入
case 'NEWFUNCTION':
    handlePTT_NEWFUNCTION(channel, uuid, tag, data);
    break;
```

**前端** (GPSTracking.tsx):

```typescript
// WebSocket 訊息處理
if (data.type === 'ptt_newfunction' && data.event) {
    const notification: Message = {
        id: `new-${Date.now()}`,
        from: data.event.deviceId,
        to: `group:${data.event.channel}`,
        text: `新功能: ${data.event.data}`,
        timestamp: new Date().toISOString(),
        priority: 3
    };
    setMessages(prev => [...prev, notification]);
}
```

#### 2. 擴展語音功能

**新增語音效果**:

```typescript
// PTTAudio.tsx
const applyAudioEffect = (audioContext: AudioContext, source: MediaStreamSource) => {
    // 新增音訊效果節點
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 5000;

    source.connect(filter);
    filter.connect(audioContext.destination);
};
```

### 測試

#### 手動測試

1. **語音測試**:
   - 開啟兩個瀏覽器視窗
   - 登入不同用戶
   - 測試群組語音和私人通話

2. **訊息測試**:
   - 發送文字訊息
   - 測試 GPS、SOS、錄影標記
   - 確認同步顯示

#### 自動化測試

使用後端測試腳本：

```bash
cd backend
python test_ptt_auto.py
```

測試項目：
- ✅ 文字訊息
- ✅ GPS 定位
- ✅ SOS 求救
- ✅ 廣播訊息
- ✅ 錄影標記
- ✅ 多頻道測試
- ✅ 壓力測試

### 部署

#### 前端部署

```bash
npm run build
# 將 dist/ 目錄部署到靜態服務器
```

#### 後端部署

使用 PM2 管理進程：

```bash
npm install -g pm2
pm2 start backend/server.cjs --name mezzo-ptt
pm2 save
pm2 startup
```

#### Docker 部署

參考 `compose.yaml`:

```yaml
services:
  backend:
    build: ./backend
    ports:
      - "4000:4000"
    environment:
      - MQTT_BROKER=118.163.141.80:1883
```

---

## 效能考量

### 音訊傳輸

- **單次語音**: 2-10 KB/秒
- **10 人同時**: 20-100 KB/秒
- **建議頻寬**: > 100 kbps

### 記憶體使用

- **AudioContext**: 5-10 MB
- **MediaRecorder**: 2-5 MB
- **每個音訊封包**: 2-10 KB
- **訊息歷史**: 根據訊息數量

### 最佳化建議

1. **音訊壓縮**: 使用 Opus 編碼
2. **訊息限制**: 限制歷史訊息數量
3. **連線池**: 複用 WebSocket 連接
4. **快取**: 快取頻繁使用的數據

---

## 安全性

### 權限管理

1. **麥克風權限**: 用戶明確授權
2. **自動播放**: 遵守瀏覽器政策
3. **WebSocket**: 建議使用 WSS (加密)

### 資料保護

1. **音訊數據**: Base64 編碼傳輸
2. **設備 ID**: 用於識別發送者
3. **私人通話**: RandomID 動態生成

### 未來改進

- [ ] 端到端加密 (E2EE)
- [ ] 使用者認證系統
- [ ] 權限管理（頻道管理員）
- [ ] 訊息簽章驗證
- [ ] Rate Limiting

---

## 更新日誌

### v2.0 (2026-01-21)

#### 新功能
- ✅ 語音播放功能（接收端）
- ✅ 語音轉文字（Web Speech API）
- ✅ 自動斷句（靜音偵測）
- ✅ 重複訊息過濾
- ✅ 無效 GPS 過濾 (0,0)
- ✅ 音訊播放備用格式支援

#### 修復
- ✅ 修復 `buffer is not defined` 錯誤
- ✅ 修復語音訊息重複顯示
- ✅ 修復文字轉譯不顯示問題
- ✅ 修復音訊播放格式不支援錯誤

#### 優化
- ✅ 改進使用者介面
- ✅ 新增進階設定面板
- ✅ 優化 WebSocket 訊息處理
- ✅ 改進錯誤處理和提示

### v1.0 (2026-01-20)

#### 初始功能
- ✅ PTT 通訊系統
- ✅ 群組語音和私人通話
- ✅ 文字訊息
- ✅ GPS 追蹤
- ✅ SOS 緊急求救
- ✅ 錄影標記
- ✅ WebSocket 即時通訊
- ✅ MQTT 整合

---

## 常見問題 FAQ

**Q: 語音轉文字支援哪些語言？**
A: 目前設定為繁體中文 (zh-TW)，可修改 `recognitionRef.current.lang` 支援其他語言。

**Q: 可以同時進行群組語音和私人通話嗎？**
A: 不可以。通話中會禁用群組 PTT 按鈕。

**Q: 語音訊息會儲存嗎？**
A: 目前只在記憶體中保留，重新整理後會消失。可在 Message 中保存 audioData 實作重播功能。

**Q: 自動斷句在私人通話中有效嗎？**
A: 不會。自動斷句只在群組語音中啟用，私人通話需手動結束。

**Q: 如何提高語音識別準確度？**
A: 1) 使用高品質麥克風 2) 在安靜環境使用 3) 說話清晰 4) 使用耳機避免回音

**Q: 為什麼收到 (0,0) 的 GPS 更新？**
A: 這是測試裝置或無 GPS 訊號的裝置。系統已過濾這些訊息，不會顯示在聊天室。

**Q: 如何停止接收特定頻道的訊息？**
A: 在通訊面板切換到其他頻道，或在 PTT 控制面板選擇不同頻道。

---

## 技術支援

### 回報問題

請提供以下資訊：
1. 瀏覽器版本
2. 錯誤訊息（控制台）
3. 操作步驟
4. 網路環境
5. 螢幕截圖（如適用）

### 聯絡方式

- GitHub Issues: [專案連結]
- 後端日誌: 查看 `backend/server.cjs` 輸出
- 前端控制台: 瀏覽器開發者工具

---

## 授權

本專案為內部使用，請勿外傳。

---

## 結語

Mezzo PTT 系統提供完整的即時通訊解決方案，整合語音、文字、GPS 追蹤和緊急求救功能。系統使用現代 Web 技術（MediaRecorder、Web Audio、Speech Recognition）提供流暢的使用體驗。

如有任何問題或建議，歡迎回饋！

---

*文件版本: 2.0*
*最後更新: 2026-01-21*
