# PTT 通訊系統整合說明

## 🎯 概述

本系統已完全整合 PTT MQTT 協議，實現分群組的即時通訊功能。所有通訊功能都使用 PTT MQTT 路徑，完全不依賴 `myapp/` 路徑。

---

## 📡 系統架構

### 前端 (GPSTracking.tsx)
- **通訊介面**: 點擊「通訊」按鈕開啟聊天面板
- **頻道選擇**: 支援全體廣播或指定群組/頻道
- **訊息發送**: 使用 PTT MQTT 格式發送文字訊息
- **訊息接收**: 透過 WebSocket 接收所有 PTT 訊息

### 後端 (server.cjs)
- **PTT MQTT 客戶端**: 連接到 `mqtt://118.163.141.80:1883`
- **訊息解析**: 解析 PTT 二進位格式 (Tag + UUID + Data)
- **訊息路由**: 根據頻道和 Tag 分發訊息
- **WebSocket 廣播**: 即時推送訊息到所有前端客戶端

---

## 🔧 技術細節

### PTT MQTT 訊息格式

```
+--------------------------------+--------------------------------------------------+----------------------------------+
| Tag (Header)                   | Sender UUID                                      | Data (Payload)                   |
+--------------------------------+--------------------------------------------------+----------------------------------+
| 32 Bytes                       | 128 Bytes                                        | Variable Length (N Bytes)        |
+--------------------------------+--------------------------------------------------+----------------------------------+
```

### 文字訊息 Topic 路徑

```
/WJI/PTT/{Channel}/CHANNEL_ANNOUNCE
```

**範例**:
- 全體廣播: `/WJI/PTT/channel1/CHANNEL_ANNOUNCE`
- 群組訊息: `/WJI/PTT/Alpha小隊/CHANNEL_ANNOUNCE`
- 緊急頻道: `/WJI/PTT/emergency/CHANNEL_ANNOUNCE`

---

## 💬 訊息流程

### 發送訊息流程

1. **前端**: 使用者在通訊面板輸入訊息
2. **前端**: 選擇目標頻道/群組
3. **前端**: 調用 `sendPTTMessage(channel, text)`
4. **前端**: 建立 PTT 格式訊息:
   - Tag: `TEXT_MESSAGE` (32 bytes)
   - UUID: 當前 PTT 設備 ID (128 bytes)
   - Data: 訊息文字內容 (變長)
5. **前端**: 發送 POST 到 `/ptt/publish`
6. **後端**: 接收並發布到 PTT MQTT Broker
7. **PTT Broker**: 廣播到所有訂閱該頻道的設備

### 接收訊息流程

1. **PTT Broker**: 接收到新訊息
2. **後端**: PTT MQTT 客戶端接收訊息
3. **後端**: 解析二進位格式 (parsePTTMessage)
4. **後端**: 根據 Tag 分類處理:
   - `TEXT_MESSAGE` → `handlePTT_TextMessage()`
   - `BROADCAST` → `handlePTT_Broadcast()`
   - `GPS` → `handlePTT_GPS()`
   - `SOS` → `handlePTT_SOS()`
   - `MARK_START/STOP` → `handlePTT_MARK()`
5. **後端**: 建立訊息物件並存入記憶體
6. **後端**: 透過 WebSocket 廣播到所有前端
7. **前端**: 接收 WebSocket 訊息並顯示在聊天介面

---

## 🎨 前端功能

### 通訊面板特性

- ✅ 頻道/群組選擇器
- ✅ 即時訊息列表 (聊天氣泡式介面)
- ✅ 自動滾動到最新訊息
- ✅ 發送狀態提示
- ✅ PTT 設備 ID 顯示
- ✅ Enter 發送、Shift+Enter 換行
- ✅ 發送/接收訊息區分顯示

### 群組分類

系統會自動從設備資料中提取群組資訊:

```javascript
const deviceGroups = Array.from(
    new Set(devices.map((d) => d.group || '未分組').filter(Boolean))
);
```

每個群組會對應一個 PTT 頻道。

---

## 🔌 API 端點

### POST /ptt/publish
發布訊息到 PTT MQTT Broker

**Request Body**:
```json
{
  "topic": "/WJI/PTT/{channel}/CHANNEL_ANNOUNCE",
  "message": [/* PTT 二進位格式的陣列 */],
  "encoding": "binary"
}
```

**Response**:
```json
{
  "success": true,
  "topic": "/WJI/PTT/channel1/CHANNEL_ANNOUNCE",
  "messageSize": 192
}
```

### GET /ptt/status
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

---

## 🚀 使用方式

### 1. 開啟通訊面板

點擊右上角的「通訊」按鈕開啟聊天介面。

### 2. 選擇頻道

在下拉選單中選擇:
- 📢 **全體廣播**: 使用當前 PTT 頻道廣播
- 📻 **特定群組**: 選擇特定群組/頻道發送訊息

### 3. 發送訊息

輸入訊息後按 Enter 或點擊「發送」按鈕。

### 4. 查看訊息

- **藍色氣泡 (右側)**: 指令中心發送的訊息
- **白色氣泡 (左側)**: 其他設備/使用者發送的訊息

---

## 📋 支援的 PTT 功能

| 功能 | Topic | Tag | 狀態 |
|------|-------|-----|------|
| 文字訊息 | `CHANNEL_ANNOUNCE` | `TEXT_MESSAGE` | ✅ 已實現 |
| 廣播訊息 | `CHANNEL_ANNOUNCE` | `BROADCAST` | ✅ 已實現 |
| GPS 定位 | `GPS` | `GPS` | ✅ 已實現 |
| SOS 求救 | `SOS` | `SOS` | ✅ 已實現 |
| 錄影標記 | `MARK` | `MARK_START/STOP` | ✅ 已實現 |
| 語音通話 | `SPEECH` | `AUDIODATA` | ⏳ 待實現 |
| 私人通話 | `PRIVATE` | `PRIVATE_SPK_REQ` | ⏳ 待實現 |

---

## 🔍 除錯資訊

### 前端 Console 訊息

```javascript
// 發送訊息
📤 Sending message: {from: "COMMAND_CENTER", to: "group:Alpha小隊", ...}
💬 PTT Message sent: {topic: "/WJI/PTT/Alpha小隊/CHANNEL_ANNOUNCE", text: "測試訊息"}
✅ 訊息已發送至頻道 Alpha小隊

// 接收訊息
📨 WebSocket message: ptt_broadcast
💬 Received PTT broadcast: {from: "USER-001", to: "group:channel1", ...}
```

### 後端 Console 訊息

```javascript
// MQTT 接收
📨 PTT MQTT [/WJI/PTT/channel1/CHANNEL_ANNOUNCE]: 192 bytes
📡 PTT Message: Channel=channel1, Function=CHANNEL_ANNOUNCE
   Tag: TEXT_MESSAGE
   UUID: USER-001
   Data: 測試訊息

// 訊息處理
💬 [PTT Text Message] {channel: "channel1", uuid: "USER-001", data: "測試訊息"}
💬 PTT Text Message: USER-001 → channel1: 測試訊息

// WebSocket 廣播
📤 Broadcast to 3 clients
```

---

## ⚙️ 設定選項

### PTT 設備設定

在 PTT 控制面板中可以設定:

- **PTT 頻道**: 選擇通訊頻道 (channel1, channel2, channel3, emergency)
- **設備 ID**: 設定發送者識別碼 (預設: USER-001)

### MQTT 設定 (server.cjs)

```javascript
const PTT_MQTT_CONFIG = {
  broker: 'mqtt://118.163.141.80:1883',
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
```

---

## 🎯 完整整合確認

- ✅ **前端發送**: 使用 PTT MQTT 路徑 `/WJI/PTT/{channel}/CHANNEL_ANNOUNCE`
- ✅ **前端接收**: 透過 WebSocket 接收 PTT 訊息
- ✅ **後端發布**: 發布到 PTT MQTT Broker (118.163.141.80:1883)
- ✅ **後端訂閱**: 訂閱 `/WJI/PTT/#` 接收所有 PTT 訊息
- ✅ **訊息格式**: 使用 PTT 標準格式 (Tag + UUID + Data)
- ✅ **群組支援**: 支援多頻道/群組通訊
- ❌ **不使用 myapp/**: 完全不依賴舊的 MQTT 路徑

---

## 📞 聯絡與支援

如需協助或有任何問題，請參考:
- `server.cjs` - 後端處理邏輯
- `GPSTracking.tsx` - 前端通訊介面
- PTT MQTT Broker: 118.163.141.80:1883

---

*最後更新: 2026-01-20*
*系統版本: PTT Integration v2.0*
