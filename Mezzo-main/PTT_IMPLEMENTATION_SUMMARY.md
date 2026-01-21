# PTT 功能分離實作總結

## 概述

根據您的要求，我們已經成功將 PTT 功能分離為兩個獨立的功能：

### 功能 1: 語音訊息（通訊面板）
- **性質**: 類似 LINE/WhatsApp 的語音訊息
- **用途**: 錄製語音檔案並發送到聊天室，附帶文字轉錄
- **特點**:
  - 非即時通訊
  - 可以重播
  - 會儲存在聊天記錄中
  - 附帶語音轉文字功能
- **位置**: 通訊面板的訊息輸入區旁邊

### 功能 2: PTT 群組通話（PTT 控制面板）
- **性質**: 真正的對講機搶麥機制
- **用途**: 即時語音通訊
- **特點**:
  - 需要請求麥克風權限
  - 顯示誰正在發話
  - 即時傳輸，不儲存到聊天
  - 遵循官方 PTT 協議
- **位置**: PTT 功能選擇器中的「語音通話」選項

---

## 實作細節

### 一、語音訊息功能（通訊面板）

#### 前端實作 ([GPSTracking.tsx](Mezzo-main/src/assets/GPSTracking.tsx))

**新增狀態變數** (Lines 41-45):
```typescript
// ===== 語音訊息錄製狀態 =====
const [isRecordingVoiceMsg, setIsRecordingVoiceMsg] = useState(false);
const voiceMsgRecorderRef = useRef<MediaRecorder | null>(null);
const voiceMsgChunksRef = useRef<Blob[]>([]);
const voiceMsgRecognitionRef = useRef<any>(null);
```

**錄音功能實作** (Lines 763-885):
- `startVoiceMessageRecording()`: 開始錄製語音訊息，同時啟動語音轉文字
- `stopVoiceMessageRecording()`: 停止錄製
- `sendVoiceMessage()`: 發送語音檔案 + 文字轉錄到後端

**UI 實作** (Lines 1344-1365):
```typescript
{/* 語音訊息按鈕 */}
<button
    onClick={isRecordingVoiceMsg ? stopVoiceMessageRecording : startVoiceMessageRecording}
    className={`... ${isRecordingVoiceMsg ? 'bg-red-600 animate-pulse' : 'bg-gray-600'}`}
>
    <Mic className="w-4 h-4" />
</button>

{/* 文字訊息按鈕 */}
<button onClick={handleSendMessage} disabled={!messageText.trim() || isRecordingVoiceMsg}>
    <Send className="w-4 h-4" />
</button>
```

#### 後端實作 ([server.cjs](Mezzo-main/backend/server.cjs))

**新增 API 端點** (Lines 2333-2377):
```javascript
app.post('/ptt/voice-message', (req, res) => {
  const { channel, from, to, text, audioData, transcript } = req.body;

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
});
```

---

### 二、PTT 群組通話搶麥機制

#### 官方協議流程

根據提供的 PTT 協議文件，群組通話使用以下流程：

1. **請求發言**: 發送 `PTT_MSG_TYPE_SPEECH_START` 到 `/WJI/PTT/{Channel}/CHANNEL_ANNOUNCE`
2. **等待回應**:
   - 允許: 收到 `PTT_MSG_TYPE_SPEECH_START_ALLOW`
   - 拒絕: 收到 `PTT_MSG_TYPE_SPEECH_START_DENY`
3. **傳輸音訊**: 如果允許，發送 `AUDIODATA` 到 `/WJI/PTT/{Channel}/SPEECH`
4. **結束發言**: 發送 `PTT_MSG_TYPE_SPEECH_STOP` 到 `/WJI/PTT/{Channel}/CHANNEL_ANNOUNCE`

#### 後端實作 ([server.cjs](Mezzo-main/backend/server.cjs))

**新增狀態管理** (Line 105):
```javascript
const pttState = {
  activeUsers: new Map(),
  sosAlerts: new Map(),
  channelUsers: new Map(),
  broadcastedTranscripts: new Set(),
  deviceConnections: new Map(),
  channelSpeakers: new Map()   // 頻道 ID → 當前說話者 UUID（搶麥機制）
};
```

**搶麥處理函數** (Lines 912-1006):

```javascript
// 處理請求發言
function handlePTT_SpeechStart(channel, uuid, data) {
  const currentSpeaker = pttState.channelSpeakers.get(channel);

  if (currentSpeaker && currentSpeaker !== uuid) {
    // 拒絕 - 已有人在使用
    const senderWs = pttState.deviceConnections.get(uuid);
    if (senderWs) {
      senderWs.send(JSON.stringify({
        type: 'ptt_speech_deny',
        channel: channel,
        reason: `${currentSpeaker} 正在使用麥克風`
      }));
    }
    return;
  }

  // 允許 - 授予麥克風
  pttState.channelSpeakers.set(channel, uuid);

  const senderWs = pttState.deviceConnections.get(uuid);
  if (senderWs) {
    senderWs.send(JSON.stringify({
      type: 'ptt_speech_allow',
      channel: channel
    }));
  }

  // 廣播給所有人：誰在說話
  broadcastToClients({
    type: 'ptt_speaker_update',
    channel: channel,
    speaker: uuid,
    action: 'start'
  });
}

// 處理結束發言
function handlePTT_SpeechStop(channel, uuid, data) {
  const currentSpeaker = pttState.channelSpeakers.get(channel);

  if (currentSpeaker === uuid) {
    pttState.channelSpeakers.delete(channel);

    broadcastToClients({
      type: 'ptt_speaker_update',
      channel: channel,
      speaker: null,
      action: 'stop',
      previousSpeaker: uuid
    });
  }
}
```

**MQTT 訊息路由** (Lines 1307-1310):
```javascript
case 'CHANNEL_ANNOUNCE':
  if (tag === 'PTT_MSG_TYPE_SPEECH_START') {
    handlePTT_SpeechStart(channel, uuid, data);
  } else if (tag === 'PTT_MSG_TYPE_SPEECH_STOP') {
    handlePTT_SpeechStop(channel, uuid, data);
  }
  // ... 其他處理
```

#### 前端實作 ([PTTAudio.tsx](Mezzo-main/src/assets/PTTAudio.tsx))

**新增介面參數** (Line 9):
```typescript
interface PTTAudioProps {
    deviceId: string;
    channel: string;
    onAudioSend: (audioData: ArrayBuffer, isPrivate: boolean, targetId?: string, transcript?: string) => void;
    onSpeechToText?: (text: string) => void;
    ws?: WebSocket | null;  // 新增：用於接收 PTT 權限訊息
}
```

**新增狀態變數** (Lines 27-30):
```typescript
// PTT 搶麥狀態
const [requestingMic, setRequestingMic] = useState(false);  // 正在請求麥克風
const [hasPermission, setHasPermission] = useState(false);  // 已獲得麥克風權限
const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);  // 當前頻道誰在說話
```

**監聽 WebSocket 權限訊息** (Lines 195-240):
```typescript
useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
        const data = JSON.parse(event.data);

        // 收到允許發言
        if (data.type === 'ptt_speech_allow' && data.channel === channel) {
            setRequestingMic(false);
            setHasPermission(true);
            actuallyStartRecording();  // 立即開始錄音
        }

        // 收到拒絕發言
        if (data.type === 'ptt_speech_deny' && data.channel === channel) {
            setRequestingMic(false);
            alert(`無法取得麥克風：${data.reason}`);
        }

        // 收到說話者更新
        if (data.type === 'ptt_speaker_update' && data.channel === channel) {
            if (data.action === 'start') {
                setCurrentSpeaker(data.speaker);
            } else if (data.action === 'stop') {
                setCurrentSpeaker(null);
            }
        }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
}, [ws, channel]);
```

**修改錄音流程** (Lines 242-293):
```typescript
// 新的 startGroupRecording: 發送權限請求
const startGroupRecording = async () => {
    const API_BASE = window.location.hostname === 'localhost'
        ? 'http://localhost:4000'
        : `http://${window.location.hostname}:4000`;

    setRequestingMic(true);

    // 建立 PTT_MSG_TYPE_SPEECH_START 訊息
    const tag = 'PTT_MSG_TYPE_SPEECH_START';
    // ... 格式化為 Tag(32) + UUID(128) + Data

    await fetch(`${API_BASE}/ptt/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            topic: `/WJI/PTT/${channel}/CHANNEL_ANNOUNCE`,
            message: Array.from(combined),
            encoding: 'binary'
        })
    });

    // 等待 WebSocket 回應...
};

// actuallyStartRecording: 權限獲得後才執行的實際錄音邏輯
const actuallyStartRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // ... 原本的錄音邏輯
};
```

**停止錄音並釋放麥克風** (Lines 396-459):
```typescript
const stopGroupRecording = async () => {
    if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
        setHasPermission(false);  // 釋放權限

        // 發送 PTT_MSG_TYPE_SPEECH_STOP
        const tag = 'PTT_MSG_TYPE_SPEECH_STOP';
        // ... 格式化並發送
    }
};
```

**UI 狀態顯示** (Lines 596-628):
```typescript
{/* 頻道狀態顯示 */}
{currentSpeaker ? (
    <div className="bg-yellow-50 border border-yellow-200">
        <Mic className="animate-pulse" />
        <span>{currentSpeaker} 正在發話中</span>
    </div>
) : (
    <div className="bg-green-50 border border-green-200">
        <Mic />
        <span>頻道空閒 - 可以發話</span>
    </div>
)}

{/* 請求中狀態 */}
{requestingMic && (
    <div className="bg-blue-50 border border-blue-200">
        <div className="animate-spin"></div>
        <span>正在請求發話權限...</span>
    </div>
)}
```

**傳遞 WebSocket 到組件** ([GPSTracking.tsx](Mezzo-main/src/assets/GPSTracking.tsx) Line 1064):
```typescript
<PTTAudio
    deviceId={pttDeviceId}
    channel={pttChannel}
    onAudioSend={handleAudioSend}
    onSpeechToText={handleSpeechToText}
    ws={wsRef.current}  // 新增
/>
```

---

## 訊息流程圖

### 語音訊息流程
```
用戶按下錄音按鈕
    ↓
開始錄製 + 語音轉文字
    ↓
用戶按下停止
    ↓
發送到 /ptt/voice-message API
    ↓
後端廣播給所有 WebSocket 客戶端
    ↓
顯示在通訊面板聊天記錄中
    ↓
可以點擊播放按鈕重播
```

### PTT 群組通話流程
```
用戶點擊「開始發話」
    ↓
發送 PTT_MSG_TYPE_SPEECH_START 到 MQTT
    ↓
後端檢查是否有人在說話
    ↓
    ├─ 有人在用 → 發送 ptt_speech_deny → 顯示「已有人在使用」
    │
    └─ 無人使用 → 發送 ptt_speech_allow → 開始實際錄音
                  ↓
            廣播 ptt_speaker_update (action: start)
                  ↓
            所有用戶看到「XXX 正在發話中」
                  ↓
            傳輸音訊到 /WJI/PTT/{Channel}/SPEECH
                  ↓
            用戶點擊「停止發話」
                  ↓
            發送 PTT_MSG_TYPE_SPEECH_STOP
                  ↓
            廣播 ptt_speaker_update (action: stop)
                  ↓
            所有用戶看到「頻道空閒」
```

---

## 關鍵差異總結

| 特性 | 語音訊息 | PTT 群組通話 |
|------|---------|------------|
| **位置** | 通訊面板 | PTT 控制面板 |
| **性質** | 非即時訊息 | 即時對講 |
| **儲存** | 儲存在聊天記錄 | 不儲存 |
| **轉錄** | 有文字轉錄 | 有文字轉錄 |
| **權限控制** | 無 | 搶麥機制 |
| **重播** | 可重播 | 不可重播 |
| **UI 圖示** | 💬 語音訊息 | 🎙️ 正在發話 |
| **後端 API** | `/ptt/voice-message` | MQTT `/CHANNEL_ANNOUNCE` + `/SPEECH` |
| **協議** | 自定義 HTTP API | 官方 PTT MQTT 協議 |

---

## 測試建議

### 語音訊息測試
1. 開啟通訊面板
2. 點擊麥克風按鈕開始錄音
3. 說話（應該會看到即時轉錄）
4. 點擊麥克風按鈕停止
5. 訊息應該出現在聊天記錄中，帶有「💬」圖示和轉錄文字
6. 點擊「播放語音訊息」按鈕應該可以重播

### PTT 群組通話測試

**單人測試**:
1. 開啟 PTT 控制面板，選擇「語音通話」
2. 應該看到「頻道空閒 - 可以發話」
3. 點擊「開始發話」
4. 應該看到「正在請求發話權限...」
5. 獲得權限後開始錄音，應該看到「XXX 正在發話中」（XXX 是你的設備 ID）
6. 點擊「停止發話」
7. 應該恢復到「頻道空閒」狀態

**雙人測試**:
1. 開啟兩個瀏覽器視窗，登入不同帳號（或使用不同設備 ID）
2. 兩邊都選擇相同頻道
3. A 先點擊「開始發話」
4. B 應該看到「A 正在發話中」的提示
5. B 嘗試點擊「開始發話」
6. B 應該收到拒絕訊息：「無法取得麥克風：A 正在使用麥克風」
7. A 點擊「停止發話」
8. 兩邊都應該看到「頻道空閒」
9. B 現在可以成功取得麥克風權限

---

## 檔案修改清單

### 前端檔案
- ✅ `Mezzo-main/src/assets/GPSTracking.tsx`
  - 新增語音訊息錄製狀態和功能
  - 新增語音訊息按鈕到通訊面板
  - 傳遞 WebSocket 到 PTTAudio 組件

- ✅ `Mezzo-main/src/assets/PTTAudio.tsx`
  - 新增 PTT 搶麥狀態管理
  - 實作請求發言流程
  - 監聽 WebSocket 權限訊息
  - 新增頻道狀態顯示 UI

### 後端檔案
- ✅ `Mezzo-main/backend/server.cjs`
  - 新增 `channelSpeakers` 狀態管理
  - 實作 `handlePTT_SpeechStart` 函數
  - 實作 `handlePTT_SpeechStop` 函數
  - 新增 `/ptt/voice-message` API 端點
  - 更新 MQTT 訊息路由

---

## 下一步

建議進行以下測試和優化：

1. **功能測試**
   - 測試語音訊息功能
   - 測試 PTT 搶麥機制
   - 測試多人同時使用

2. **可能的改進**
   - 添加語音訊息播放進度條
   - 添加 PTT 發話計時器
   - 添加音訊品質設定
   - 添加頻道使用統計

3. **錯誤處理**
   - 網路斷線時的重連機制
   - 麥克風權限被拒絕的處理
   - 音訊編碼失敗的 fallback

4. **效能優化**
   - 語音訊息壓縮
   - WebSocket 訊息節流
   - 音訊緩衝優化

---

## 技術支援

如果遇到問題，請檢查：

1. **後端 Console 日誌**
   - 查看 `📞 [PTT_MSG_TYPE_SPEECH_START]` 訊息
   - 查看 `✅ Speech request allowed` 或 `🚫 Speech request denied` 訊息
   - 查看 WebSocket 連線狀態

2. **前端 Console 日誌**
   - 查看 `🎙️ Requesting PTT permission...` 訊息
   - 查看 `✅ PTT permission granted` 或 `🚫 PTT permission denied` 訊息
   - 查看 `🎙️ XXX is now speaking` 訊息

3. **WebSocket 連線**
   - 確認 WebSocket 已連線（`✅ WebSocket connected`）
   - 確認設備已註冊（`📱 Device registered: XXX`）

4. **MQTT 連線**
   - 確認 PTT MQTT 已連線
   - 確認訊息格式正確（Tag 32 bytes + UUID 128 bytes + Data）

---

**實作完成日期**: 2026-01-22
**實作者**: Claude Sonnet 4.5
