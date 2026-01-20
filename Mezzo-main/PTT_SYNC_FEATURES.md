# PTT 與通訊面板同步功能說明

## 🎯 更新內容

已實現 PTT 控制面板與通訊面板的完整同步，確保所有 PTT 活動都在通訊面板中即時顯示。

---

## ✅ 已實現的同步功能

### 1. **頻道/群組統一管理**

#### 問題
- PTT 控制面板只有固定的 4 個頻道
- 通訊面板的群組是從設備動態提取
- 兩者不同步

#### 解決方案
創建統一的 `pttChannels` 列表，整合：
- ✅ 固定頻道: channel1, channel2, channel3, emergency
- ✅ 動態群組: 從設備的 `group` 屬性提取
- ✅ 自動去重和過濾

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

#### 結果
- 🎯 PTT 控制面板和通訊面板顯示相同的頻道列表
- 🎯 新加入的設備群組會自動出現在兩個面板
- 🎯 頻道數量實時同步

---

### 2. **GPS 位置發送同步**

#### 功能
當在 PTT 控制面板發送 GPS 位置時：

```typescript
// 發送 GPS
sendPTTGPS()
  ↓
// MQTT 發送到 /WJI/PTT/{channel}/GPS
  ↓
// 在通訊面板顯示通知
"📍 發送了位置資訊 (25.033964, 121.564472)"
```

#### 訊息格式
- **發送者**: PTT 設備 ID (如: USER-001)
- **接收者**: `group:{當前頻道}`
- **內容**: `📍 發送了位置資訊 (緯度, 經度)`
- **優先級**: 3 (一般)

#### 即時顯示
- ✅ 本地發送的 GPS 立即顯示在通訊面板
- ✅ 其他設備發送的 GPS 透過 WebSocket 接收並顯示
- ✅ 顯示格式: `用戶ID 📍 更新了位置資訊 (25.033964, 121.564472)`

---

### 3. **SOS 緊急求救同步**

#### 功能
當發送 SOS 求救訊號時：

```typescript
// 發送 SOS
sendPTTSOS()
  ↓
// MQTT 發送到 /WJI/PTT/{channel}/SOS
  ↓
// 在通訊面板顯示緊急警報
"🆘 發送了緊急求救訊號！位置: (25.033964, 121.564472)"
```

#### 訊息格式
- **發送者**: PTT 設備 ID
- **接收者**: `group:{當前頻道}`
- **內容**: `🆘 發送了緊急求救訊號！位置: (緯度, 經度)`
- **優先級**: 1 (最高優先級)

#### 特殊處理
- ✅ 紅色高亮顯示 (如果實現優先級樣式)
- ✅ 本地和遠端 SOS 都會顯示
- ✅ 包含詳細的位置資訊

---

### 4. **廣播訊息同步**

#### 功能
在 PTT 控制面板發送廣播訊息時：

```typescript
// 發送廣播
sendPTTBroadcast()
  ↓
// MQTT 發送到 /WJI/PTT/{channel}/CHANNEL_ANNOUNCE (Tag: BROADCAST)
  ↓
// 在通訊面板顯示廣播內容
"📢 這是一條廣播訊息"
```

#### 訊息格式
- **發送者**: PTT 設備 ID
- **接收者**: `group:{當前頻道}`
- **內容**: `📢 {廣播內容}`
- **優先級**: 3 (一般)

---

### 5. **錄影標記同步**

#### 功能
控制錄影開始/停止時：

```typescript
// 切換錄影狀態
toggleRecording()
  ↓
// MQTT 發送到 /WJI/PTT/{channel}/MARK (Tag: MARK_START/STOP)
  ↓
// 在通訊面板顯示錄影狀態
"📹 開始錄影" 或 "⏹️ 停止錄影"
```

#### 訊息格式
- **發送者**: PTT 設備 ID
- **接收者**: `group:{當前頻道}`
- **內容**: `📹 開始錄影` 或 `⏹️ 停止錄影`
- **優先級**: 3 (一般)

#### 雙向同步
- ✅ 本地操作立即顯示
- ✅ 其他設備的錄影狀態透過 WebSocket 接收

---

### 6. **文字訊息同步**

#### 功能
在通訊面板發送的文字訊息：

```typescript
// 通訊面板發送訊息
handleSendMessage()
  ↓
// 使用 PTT MQTT 發送
sendPTTMessage(channel, text)
  ↓
// Topic: /WJI/PTT/{channel}/CHANNEL_ANNOUNCE (Tag: TEXT_MESSAGE)
  ↓
// 本地顯示 + WebSocket 廣播
```

#### 訊息格式
- **發送者**: COMMAND_CENTER
- **接收者**: `group:{選擇的頻道}` 或 `all`
- **內容**: 使用者輸入的文字
- **優先級**: 3 (一般)

---

## 📡 WebSocket 訊息處理

### 接收的訊息類型

| 訊息類型 | 觸發條件 | 處理方式 |
|---------|---------|---------|
| `message` | 文字訊息 | 直接顯示在通訊面板 |
| `ptt_broadcast` | PTT 廣播/文字訊息 | 顯示在通訊面板 |
| `device_update` (source: ptt_*) | GPS 位置更新 | 生成位置通知訊息 |
| `sos_alert` | SOS 緊急警報 | 生成緊急通知訊息 |
| `ptt_mark` | 錄影標記 | 生成錄影狀態訊息 |

### 範例處理邏輯

```typescript
// GPS 更新
if (data.type === 'device_update' && data.device.source?.includes('ptt')) {
    const notification: Message = {
        id: `gps-update-${Date.now()}`,
        from: device.id,
        to: `group:${device.group}`,
        text: `📍 更新了位置資訊 (${lat}, ${lng})`,
        timestamp: new Date().toISOString(),
        priority: 3
    };
    setMessages(prev => [...prev, notification]);
}

// SOS 警報
if (data.type === 'sos_alert') {
    const alert: Message = {
        id: `sos-alert-${Date.now()}`,
        from: event.deviceId,
        to: `group:${event.group}`,
        text: `🆘 緊急求救！位置: (${lat}, ${lng})`,
        timestamp: event.timestamp,
        priority: 1
    };
    setMessages(prev => [...prev, alert]);
}
```

---

## 🎨 使用者介面更新

### PTT 控制面板
```
┌─────────────────────────────────┐
│ PTT 頻道:                        │
│ ┌─────────────────────────────┐ │
│ │ 頻道 1                       │ │  ← 動態選項
│ │ 頻道 2                       │ │
│ │ 頻道 3                       │ │
│ │ 🆘 緊急頻道                  │ │
│ │ 📻 Alpha小隊                 │ │  ← 從設備動態提取
│ │ 📻 Bravo小隊                 │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

### 通訊面板
```
┌─────────────────────────────────┐
│ 選擇 PTT 頻道/群組:              │
│ ┌─────────────────────────────┐ │
│ │ 📢 全體廣播 (channel1)       │ │
│ │ 📻 channel1 頻道             │ │
│ │ 📻 channel2 頻道             │ │
│ │ 📻 channel3 頻道             │ │
│ │ 📻 emergency 頻道            │ │
│ │ 📻 Alpha小隊 頻道 (5 人)     │ │  ← 顯示成員數
│ │ 📻 Bravo小隊 頻道 (3 人)     │ │
│ └─────────────────────────────┘ │
│ 當前 PTT 設備: USER-001          │
└─────────────────────────────────┘
```

---

## 📊 訊息流程圖

### 本地操作流程

```
使用者操作 PTT 控制面板
    ↓
發送 MQTT 到 PTT Broker
    ↓
後端接收並處理
    ↓
WebSocket 廣播到所有客戶端
    ↓
前端顯示在通訊面板
```

### 遠端訊息接收流程

```
其他設備發送 PTT 訊息
    ↓
PTT Broker 廣播
    ↓
後端接收並解析
    ↓
WebSocket 推送到前端
    ↓
前端解析並顯示通知
```

---

## 🔍 訊息範例

### GPS 位置通知
```json
{
  "id": "gps-1234567890",
  "from": "USER-001",
  "to": "group:channel1",
  "text": "📍 發送了位置資訊 (25.033964, 121.564472)",
  "timestamp": "2026-01-20T10:30:00.000Z",
  "priority": 3
}
```

### SOS 緊急通知
```json
{
  "id": "sos-1234567890",
  "from": "USER-001",
  "to": "group:emergency",
  "text": "🆘 發送了緊急求救訊號！位置: (25.040000, 121.570000)",
  "timestamp": "2026-01-20T10:35:00.000Z",
  "priority": 1
}
```

### 廣播訊息
```json
{
  "id": "broadcast-1234567890",
  "from": "USER-001",
  "to": "group:channel1",
  "text": "📢 全體注意，開始執行任務",
  "timestamp": "2026-01-20T10:40:00.000Z",
  "priority": 3
}
```

### 錄影標記
```json
{
  "id": "recording-1234567890",
  "from": "USER-001",
  "to": "group:channel1",
  "text": "📹 開始錄影",
  "timestamp": "2026-01-20T10:45:00.000Z",
  "priority": 3
}
```

---

## ✅ 測試檢查清單

### 頻道/群組同步
- [ ] PTT 控制面板顯示所有頻道（固定 + 動態）
- [ ] 通訊面板顯示所有頻道（固定 + 動態）
- [ ] 新設備加入時，群組自動出現在兩個面板
- [ ] 頻道數量保持一致

### GPS 位置同步
- [ ] 發送 GPS 後，通訊面板立即顯示通知
- [ ] 通知包含正確的位置資訊
- [ ] 其他設備的 GPS 更新也會顯示

### SOS 緊急求救同步
- [ ] 發送 SOS 後，通訊面板顯示緊急警報
- [ ] SOS 訊息包含位置資訊
- [ ] 接收到其他設備的 SOS 警報

### 廣播訊息同步
- [ ] PTT 廣播在通訊面板顯示
- [ ] 廣播訊息帶有 📢 圖示
- [ ] 內容正確傳遞

### 錄影標記同步
- [ ] 開始錄影時顯示通知
- [ ] 停止錄影時顯示通知
- [ ] 其他設備的錄影狀態也會顯示

### 文字訊息同步
- [ ] 通訊面板發送的訊息使用 PTT MQTT
- [ ] 本地發送的訊息立即顯示
- [ ] 其他設備的訊息透過 WebSocket 接收

---

## 🎯 核心改進總結

1. **統一頻道管理**: PTT 和通訊共用 `pttChannels` 列表
2. **即時通知**: 所有 PTT 操作都在通訊面板顯示
3. **雙向同步**: 本地操作和遠端訊息都正確處理
4. **完整資訊**: 通知包含詳細資訊（位置、時間、狀態）
5. **優先級標記**: 緊急訊息 (SOS) 標記最高優先級

---

*最後更新: 2026-01-20*
*版本: v2.1 - PTT 通訊同步版*
