# PTT 語音功能完整指南

## 更新日期
2026-01-21

## 功能概述

本次更新實作了完整的 PTT 語音通訊系統，包含以下主要功能：

1. **語音錄製和傳輸** - 群組語音和私人通話
2. **語音播放** - 接收並自動播放其他用戶的語音
3. **語音轉文字** - 即時將語音轉換為文字顯示在聊天室
4. **自動斷句** - 基於靜音偵測的自動分段發送

---

## 1. 語音錄製和傳輸

### 群組語音 (SPEECH)

**Topic**: `/WJI/PTT/{Channel}/SPEECH`

**使用方式**:
1. 在 GPSTracking 介面點擊「PTT」按鈕
2. 選擇頻道 (channel1, channel2, channel3, emergency)
3. 按住「按住發話 (PTT)」按鈕
4. 開始說話
5. 鬆開按鈕停止發話並自動發送

**技術細節**:
- 音訊格式: WebM + Opus 編碼
- 採樣率: 16kHz (適合語音)
- 收集間隔: 100ms
- 音訊處理: 回音消除、噪音抑制、自動增益控制

### 私人通話 (PRIVATE)

**Topic**: `/WJI/PTT/{Channel}/PRIVATE/{RandomID}`

**使用方式**:
1. 在「私人通話」區域輸入目標設備 ID
2. 點擊「發起通話」按鈕
3. 系統自動生成 RandomID (格式: `CALL-{timestamp}-{random}`)
4. 開始錄音並持續傳輸
5. 點擊「結束通話」停止

**特點**:
- 一對一通話
- 動態生成通話 ID
- 通話中無法使用群組 PTT

---

## 2. 語音播放功能

### 自動播放

當接收到語音封包時，系統會：

1. **解碼音訊**: 將 base64 編碼的音訊數據解碼
2. **創建播放器**: 使用 HTML5 Audio API
3. **自動播放**: 立即播放接收到的語音
4. **顯示通知**: 在狀態欄顯示「正在播放來自 XXX 的語音」
5. **聊天記錄**: 在聊天室顯示 `🎙️ [語音訊息]`

### 技術實作

```typescript
// GPSTracking.tsx - handleAudioPlayback()
const handleAudioPlayback = async (packet: any) => {
    // 1. 解碼 base64
    const audioData = atob(packet.audioData);
    const audioBytes = new Uint8Array(audioData.length);

    // 2. 創建 Blob
    const audioBlob = new Blob([audioBytes], { type: 'audio/webm' });
    const audioUrl = URL.createObjectURL(audioBlob);

    // 3. 播放
    const audio = new Audio(audioUrl);
    await audio.play();

    // 4. 清理
    audio.onended = () => URL.revokeObjectURL(audioUrl);
};
```

### WebSocket 訊息格式

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

## 3. 語音轉文字功能

### Web Speech API

系統使用瀏覽器內建的 Web Speech Recognition API 進行即時語音識別。

**支援的瀏覽器**:
- Chrome / Edge (推薦)
- Safari (部分支援)
- Firefox (需啟用實驗功能)

### 功能特點

1. **即時轉換**: 說話時即時顯示識別結果
2. **繁體中文**: 語言設定為 `zh-TW`
3. **持續識別**: `continuous: true` 支援長時間錄音
4. **中間結果**: `interimResults: true` 顯示臨時識別結果

### 實作細節

```typescript
// PTTAudio.tsx - 初始化語音識別
const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
recognitionRef.current = new SpeechRecognition();
recognitionRef.current.continuous = true;
recognitionRef.current.interimResults = true;
recognitionRef.current.lang = 'zh-TW';

recognitionRef.current.onresult = (event) => {
    const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('');

    if (onSpeechToText) {
        onSpeechToText(transcript);
    }
};
```

### 轉錄文字顯示

轉錄的文字會即時顯示在聊天室中，格式為：

```
💬 這是語音轉文字的結果
```

---

## 4. 自動斷句功能

### 靜音偵測原理

系統使用 Web Audio API 的 AnalyserNode 即時監控音訊電平，當偵測到靜音超過設定時間時，自動停止錄音並發送。

### 工作流程

```
1. 開始錄音
   ↓
2. 持續監控音訊電平
   ↓
3. 電平 < 靜音閾值？
   ├─ 是 → 開始計時
   │         ↓
   │    持續靜音 > 設定時間？
   │         ├─ 是 → 自動停止並發送
   │         └─ 否 → 繼續監控
   │
   └─ 否 → 清除計時器，繼續錄音
```

### 技術實作

```typescript
// PTTAudio.tsx - 靜音偵測
if (autoSend && !privateCallActive) {
    if (level < silenceThreshold) {
        // 偵測到靜音，開始計時
        if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
                console.log('🔇 Silence detected, auto-sending...');
                stopGroupRecording();  // 自動停止並發送
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

### 使用者介面

「進階設定」面板提供以下控制：

1. **自動斷句發送** (開關)
   - 勾選: 啟用自動斷句
   - 取消勾選: 手動控制錄音停止

2. **靜音閾值滑桿**
   - 即時顯示百分比
   - 拖動調整靈敏度

3. **靜音持續時間滑桿**
   - 即時顯示秒數
   - 拖動調整等待時間

---

## 5. 完整使用流程

### 情境 1: 群組語音對話

```
User A:
1. 開啟 PTT 面板
2. 選擇 channel1
3. 啟用「自動斷句發送」
4. 按住 PTT 按鈕
5. 說話: "大家好，我是用戶 A"
6. 停頓 1.5 秒
7. → 系統自動發送語音
8. → 語音轉文字: "💬 大家好，我是用戶 A"

User B (接收):
1. 收到 WebSocket ptt_audio 封包
2. → 自動播放語音
3. → 狀態顯示: "🔊 正在播放來自 USER-A 的語音"
4. → 聊天室顯示: "🎙️ [語音訊息]"
```

### 情境 2: 私人通話

```
User A:
1. 在「私人通話」輸入 "USER-B"
2. 點擊「發起通話」
3. → 生成 RandomID: "CALL-1737504000000-abc123"
4. 開始說話，持續錄音
5. 點擊「結束通話」停止

User B (接收):
1. 收到 ptt_audio (type: private, randomId: CALL-...)
2. → 自動播放
3. → 聊天室顯示語音訊息
```

---

## 6. 故障排除

### 問題 1: 無法錄音

**症狀**: 點擊 PTT 按鈕後無反應

**解決方案**:
1. 檢查瀏覽器麥克風權限
   - Chrome: 設定 → 隱私權與安全性 → 網站設定 → 麥克風
2. 確認使用 HTTPS 或 localhost
   - MediaRecorder API 需要安全環境
3. 嘗試其他瀏覽器

### 問題 2: 語音無法播放

**症狀**: 收到語音封包但無聲音

**解決方案**:
1. 檢查瀏覽器控制台錯誤
2. 確認 WebSocket 連接正常
3. 檢查音量設定
4. 嘗試點擊頁面後再測試（瀏覽器自動播放限制）

### 問題 3: 語音轉文字不工作

**症狀**: 說話但沒有顯示轉錄文字

**解決方案**:
1. 檢查瀏覽器支援度
   ```javascript
   console.log('SpeechRecognition supported:',
       'webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
   ```
2. 確認麥克風權限已授予
3. 檢查控制台是否有語音識別錯誤
4. 嘗試使用 Chrome/Edge 瀏覽器

### 問題 4: 自動斷句太敏感或不敏感

**症狀**:
- 太敏感: 說話中途就自動發送
- 不敏感: 停止說話很久才發送

**解決方案**:
1. **太敏感**:
   - 降低靜音閾值 (1-2%)
   - 延長靜音持續時間 (2-3秒)
2. **不敏感**:
   - 提高靜音閾值 (3-5%)
   - 縮短靜音持續時間 (0.8-1.2秒)

### 問題 5: buffer is not defined 錯誤

**症狀**: 後端日誌顯示 `ReferenceError: buffer is not defined`

**解決方案**:
✅ 已修復 - 將 `buffer.slice(160)` 改為 `message.slice(160)`
- 檔案: `backend/server.cjs`
- 行號: 1113, 1117

---

## 7. API 參考

### PTTAudio Props

```typescript
interface PTTAudioProps {
    deviceId: string;              // 當前設備 ID
    channel: string;               // PTT 頻道
    onAudioSend: (                 // 音訊發送回調
        audioData: ArrayBuffer,
        isPrivate: boolean,
        targetId?: string
    ) => void;
    onSpeechToText?: (             // 語音轉文字回調
        transcript: string
    ) => void;
}
```

### 後端處理函數

#### handlePTT_SPEECH()
```javascript
function handlePTT_SPEECH(channel, uuid, tag, audioBuffer) {
    const audioPacket = {
        id: `speech-${uuid}-${Date.now()}`,
        type: 'speech',
        channel: channel,
        from: uuid,
        timestamp: new Date().toISOString(),
        audioData: audioBuffer.toString('base64'),
        tag: tag
    };

    broadcastToClients({
        type: 'ptt_audio',
        packet: audioPacket
    });
}
```

#### handlePTT_PRIVATE()
```javascript
function handlePTT_PRIVATE(topic, channel, uuid, tag, audioBuffer) {
    const parts = topic.split('/');
    const randomId = parts[parts.length - 1];

    const audioPacket = {
        id: `private-${uuid}-${Date.now()}`,
        type: 'private',
        channel: channel,
        randomId: randomId,
        from: uuid,
        timestamp: new Date().toISOString(),
        audioData: audioBuffer.toString('base64'),
        tag: tag
    };

    broadcastToClients({
        type: 'ptt_audio',
        packet: audioPacket
    });
}
```

---

## 8. 效能考量

### 音訊封包大小

- **錄音 1 秒**: 約 2-5 KB (WebM + Opus)
- **錄音 5 秒**: 約 10-25 KB
- **100ms 收集間隔**: 每次約 200-500 bytes

### 網路頻寬需求

- **單一語音發送**: 2-10 KB/秒
- **10 人同時發話**: 20-100 KB/秒
- **建議頻寬**: > 100 kbps

### 記憶體使用

- **AudioContext**: 約 5-10 MB
- **MediaRecorder**: 約 2-5 MB
- **每個音訊封包**: 2-10 KB

---

## 9. 安全性考量

### 權限管理

1. **麥克風權限**: 需用戶明確授權
2. **自動播放**: 遵守瀏覽器自動播放政策
3. **WebSocket**: 建議使用 WSS (加密)

### 資料保護

1. **音訊數據**: Base64 編碼傳輸
2. **設備 ID**: 用於識別發送者
3. **私人通話**: RandomID 動態生成

### 建議改進 (未來)

- [ ] 端到端加密 (E2EE)
- [ ] 音訊數據壓縮優化
- [ ] 通話錄音功能
- [ ] 權限管理系統

---

## 10. 相關檔案

### 前端
- `src/assets/PTTAudio.tsx` - 音訊錄製組件
- `src/assets/GPSTracking.tsx` - 主要介面和播放邏輯
- `src/types.ts` - TypeScript 類型定義

### 後端
- `backend/server.cjs` - MQTT 和 WebSocket 處理

### 文件
- `PTT_AUDIO_GUIDE.md` - 原始音訊功能指南
- `PTT_COMMUNICATION_GUIDE.md` - PTT 通訊協議
- `PTT_VOICE_FEATURES_GUIDE.md` - 本文件

---

## 11. 更新日誌

### 2026-01-21 - v2.0
✅ 修復 `buffer is not defined` 錯誤
✅ 實作語音播放功能（接收端）
✅ 整合 Web Speech API 語音轉文字
✅ 實作自動斷句功能（靜音偵測）
✅ 新增進階設定面板
✅ 優化使用者介面

### 2026-01-20 - v1.0
- 初始版本：群組語音和私人通話

---

## 12. 常見問題 FAQ

**Q: 語音轉文字支援哪些語言？**
A: 目前設定為繁體中文 (zh-TW)，可修改 `recognitionRef.current.lang` 支援其他語言。

**Q: 可以同時進行群組語音和私人通話嗎？**
A: 不可以。通話中會禁用群組 PTT 按鈕。

**Q: 語音訊息會儲存嗎？**
A: 目前只在記憶體中保留，重新整理後會消失。可在 Message 中保存 audioData 實作重播。

**Q: 自動斷句在私人通話中有效嗎？**
A: 不會。自動斷句只在群組語音中啟用，私人通話需手動結束。

**Q: 如何提高語音識別準確度？**
A:
1. 使用高品質麥克風
2. 在安靜環境中使用
3. 說話清晰，避免過快
4. 使用耳機避免回音

---

## 13. 技術支援

遇到問題？請提供以下資訊：

1. 瀏覽器版本
2. 錯誤訊息（控制台）
3. 操作步驟
4. 網路環境

---

## 結語

PTT 語音通訊系統現已完整實作語音錄製、播放、轉文字和自動斷句功能。系統使用現代 Web API（MediaRecorder、Web Audio、Speech Recognition）提供流暢的使用體驗。

如有任何問題或建議，歡迎回饋！
