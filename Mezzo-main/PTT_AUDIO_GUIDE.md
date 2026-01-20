# PTT 音訊通訊功能指南

## 功能概述

PTT (Push-to-Talk) 音訊通訊系統支援群組語音和私人通話功能，透過 MQTT 協議傳輸即時音訊封包。

## 功能特性

### 1. 群組語音 (SPEECH)
- **Topic**: `/WJI/PTT/{Channel}/SPEECH`
- **用途**: 在指定頻道進行群組語音通訊
- **操作**: 按住 PTT 按鈕發話，鬆開停止
- **格式**: Tag (32 bytes) + UUID (128 bytes) + Audio Data (variable)

### 2. 私人通話 (PRIVATE)
- **Topic**: `/WJI/PTT/{Channel}/PRIVATE/{RandomID}`
- **用途**: 一對一私人語音通話
- **RandomID**: 動態生成的通話識別碼
- **格式**: 同群組語音

## 技術架構

### 後端處理

#### 1. SPEECH 處理器 (`handlePTT_SPEECH`)
```javascript
// 接收音訊封包
const audioPacket = {
  type: 'speech',
  channel: channel,
  from: uuid,
  audioData: buffer.toString('base64'),
  timestamp: new Date().toISOString()
};

// 廣播到所有連接的客戶端
broadcastToClients({
  type: 'ptt_audio',
  packet: audioPacket
});
```

#### 2. PRIVATE 處理器 (`handlePTT_PRIVATE`)
```javascript
// 從 topic 提取 RandomID
// /WJI/PTT/{Channel}/PRIVATE/{RandomID}
const randomId = topic.split('/').pop();

const audioPacket = {
  type: 'private',
  channel: channel,
  randomId: randomId,
  from: uuid,
  audioData: buffer.toString('base64')
};
```

### 前端實作

#### PTTAudio 組件

**功能**:
1. 麥克風訪問和錄音
2. 音訊電平監控
3. 群組 PTT 控制
4. 私人通話管理

**關鍵技術**:
- **MediaRecorder API**: 錄製音訊
- **AudioContext**: 音訊分析
- **AnalyserNode**: 即時音訊電平監控

**音訊設定**:
```typescript
{
  audio: {
    echoCancellation: true,      // 回音消除
    noiseSuppression: true,      // 噪音抑制
    autoGainControl: true,       // 自動增益控制
    sampleRate: 16000            // 16kHz 適合語音
  }
}
```

**編碼格式**:
- MIME Type: `audio/webm;codecs=opus`
- 數據收集間隔: 100ms
- 傳輸格式: WebM + Opus 編碼

## 使用方式

### 群組語音

1. **開啟 PTT 控制面板**
   - 在 GPSTracking 中點擊「PTT」按鈕

2. **選擇頻道**
   - channel1, channel2, channel3
   - emergency (緊急頻道)

3. **發話**
   - 按住「按住發話 (PTT)」按鈕
   - 開始說話
   - 鬆開按鈕停止發話

4. **監控**
   - 綠色音訊電平條顯示即時音量
   - 可使用靜音功能

### 私人通話

1. **輸入目標設備 ID**
   - 在私人通話區域輸入對方設備 ID
   - 例如: `USER-002`

2. **發起通話**
   - 點擊「發起通話」按鈕
   - 系統自動生成 RandomID

3. **通話中**
   - 音訊持續錄製並傳輸
   - 顯示音訊電平
   - 顯示通話 ID

4. **結束通話**
   - 點擊「結束通話」按鈕

## 訊息格式

### PTT 音訊封包結構

```
+------------------+------------------+------------------+
| Tag (32 bytes)   | UUID (128 bytes) | Audio Data       |
+------------------+------------------+------------------+
```

#### Tag 類型
- `SPEECH_AUDIO`: 群組語音
- `PRIVATE_AUDIO`: 私人通話

#### UUID
- 發送者的設備識別碼
- 固定長度 128 bytes

#### Audio Data
- WebM 格式音訊數據
- Opus 編碼
- 可變長度

### WebSocket 廣播格式

```json
{
  "type": "ptt_audio",
  "packet": {
    "id": "speech-USER-001-1234567890",
    "type": "speech",
    "channel": "channel1",
    "from": "USER-001",
    "timestamp": "2026-01-21T00:00:00.000Z",
    "audioData": "base64_encoded_audio...",
    "tag": "SPEECH_AUDIO"
  }
}
```

### 私人通話格式

```json
{
  "type": "ptt_audio",
  "packet": {
    "id": "private-USER-001-1234567890",
    "type": "private",
    "channel": "channel1",
    "randomId": "CALL-1234567890-abc123",
    "from": "USER-001",
    "timestamp": "2026-01-21T00:00:00.000Z",
    "audioData": "base64_encoded_audio...",
    "tag": "PRIVATE_AUDIO"
  }
}
```

## API 端點

### 發送音訊

**URL**: `POST /ptt/publish`

**Request Body**:
```json
{
  "topic": "/WJI/PTT/channel1/SPEECH",
  "message": [32bytes_tag, 128bytes_uuid, ...audio_data],
  "encoding": "binary"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Audio published"
}
```

## 測試方式

### 1. 群組語音測試

```javascript
// 在瀏覽器控制台
// 1. 開啟麥克風權限
// 2. 選擇頻道
// 3. 按住 PTT 按鈕
// 4. 說話
// 5. 鬆開按鈕
// 6. 檢查後端日誌: "🎙️ SPEECH broadcasted"
```

### 2. 私人通話測試

```javascript
// 1. 在設備 A 輸入設備 B 的 ID
// 2. 點擊「發起通話」
// 3. 開始說話
// 4. 設備 B 收到音訊封包 (randomId 匹配)
// 5. 檢查後端日誌: "📞 PRIVATE broadcasted"
```

### 3. 後端日誌監控

```bash
# 啟動後端
cd backend
node server.cjs

# 觀察日誌
🎙️ [PTT SPEECH] { channel: 'channel1', uuid: 'USER-001', audioSize: 5120 }
🎙️ SPEECH broadcasted: USER-001 → channel1 (5120 bytes)

📞 [PTT PRIVATE] { channel: 'channel1', uuid: 'USER-001', randomId: 'CALL-...', audioSize: 3840 }
📞 PRIVATE broadcasted: USER-001 → CALL-... (3840 bytes)
```

## 注意事項

### 瀏覽器權限
- 首次使用需要授予麥克風權限
- HTTPS 環境下才能使用 MediaRecorder
- localhost 可以使用 HTTP

### 音訊品質
- 預設 16kHz 採樣率，適合語音通訊
- Opus 編碼提供良好的壓縮率
- 建議使用耳機避免回音

### 網路要求
- 需要穩定的 WebSocket 連接
- 音訊封包大小約 2-10KB/100ms
- 建議網路頻寬 > 100kbps

### 並發限制
- 群組語音可多人同時發話
- 私人通話建議一對一使用
- 通話中無法使用群組 PTT

## 故障排除

### 無法錄音
1. 檢查瀏覽器麥克風權限
2. 確認 HTTPS 或 localhost 環境
3. 檢查瀏覽器支援 MediaRecorder API

### 音訊無法傳輸
1. 檢查 WebSocket 連接狀態
2. 確認後端 MQTT 正常運行
3. 查看瀏覽器控制台錯誤

### 音質問題
1. 調整麥克風音量
2. 檢查網路穩定性
3. 嘗試使用耳機

## 擴展功能 (未來)

- [ ] 音訊播放功能（接收端）
- [ ] 多人語音會議
- [ ] 音訊錄製和回放
- [ ] 音訊壓縮優化
- [ ] 端到端加密
- [ ] 語音轉文字
- [ ] 噪音過濾增強

## 相關文件

- [PTT 通訊協議指南](PTT_COMMUNICATION_GUIDE.md)
- [PTT 同步功能說明](PTT_SYNC_FEATURES.md)
- [MQTT PTT 協議規範](https://your-protocol-docs-url)
