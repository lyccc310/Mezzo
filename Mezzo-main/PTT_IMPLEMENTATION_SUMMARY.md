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

## 2026-01-23 更新：修復語音訊息與群組通話分離

### 問題描述

使用者反映以下問題：
1. **語音訊息重複**: 聊天室中的語音訊息出現兩次，且沒有顯示文字轉譯
2. **群組通話轉譯問題**: 群組 PTT 通話的轉譯內容被錯誤地發送到聊天室
3. **搶麥機制改進**: 希望改為「請求式」搶麥，而不是自動拒絕

### 修復內容

#### 1. 修復語音訊息重複問題

**原因**: 前端在發送語音訊息後創建了本地訊息，而後端也通過 WebSocket 廣播訊息，導致重複。

**修復** ([GPSTracking.tsx:862-868](Mezzo-main/src/assets/GPSTracking.tsx#L862-L868)):
```typescript
if (response.ok) {
    // 不需要本地顯示，後端會透過 WebSocket 廣播回來
    showPTTStatus(`✅ 語音訊息已發送`, 'success');
    console.log('📤 Voice message sent, waiting for WebSocket broadcast...');
}
```

移除了本地訊息創建，現在完全依賴後端的 WebSocket 廣播。

#### 2. 完全分離語音訊息與群組 PTT 通話

**問題**: 群組 PTT 通話仍然使用語音識別，並將轉譯文字發送到聊天室。

**修復 A** - 移除群組通話的語音識別 ([PTTAudio.tsx:393-414](Mezzo-main/src/assets/PTTAudio.tsx#L393-L414)):
```typescript
mediaRecorder.onstop = async () => {
    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    const arrayBuffer = await audioBlob.arrayBuffer();

    // 群組通話：不發送轉譯文字，只發送音訊
    console.log('📝 Sending group PTT audio (no transcript)');
    onAudioSend(arrayBuffer, false, undefined, undefined);  // <- undefined transcript

    // 清理
    audioChunksRef.current = [];
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }
};

mediaRecorder.start(100);
setIsRecording(true);
isRecordingRef.current = true;

// 群組通話不啟動語音識別（即時對講，不需要轉譯）
console.log('🎙️ Started group PTT recording (no speech recognition)');
```

**修復 B** - 條件式發送轉譯參數 ([GPSTracking.tsx:322-338](Mezzo-main/src/assets/GPSTracking.tsx#L322-L338)):
```typescript
// 發送到後端（只有語音訊息才包含轉錄文字）
const requestBody: any = {
    topic,
    message,
    encoding: 'binary'
};

// 只在有實際轉錄內容時才加入 transcript 參數（語音訊息），群組 PTT 不加入
if (transcript && transcript.trim()) {
    requestBody.transcript = transcript;
}

const response = await fetch(`${API_CONFIG.baseUrl}/ptt/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
});
```

這樣可以確保：
- **語音訊息**: 有語音識別，發送 transcript，後端廣播為聊天訊息
- **群組 PTT**: 無語音識別，不發送 transcript，僅通過 MQTT 即時傳輸

#### 3. 改進搶麥機制為「請求式」

**原始行為**: 當有人正在說話時，其他人嘗試發話會立即被拒絕。

**新行為**: 當有人正在說話時，其他人請求發話會發送請求給當前說話者，由當前說話者決定是否讓出麥克風。

**後端修改** ([server.cjs:916-983](Mezzo-main/backend/server.cjs#L916-L983)):

```javascript
function handlePTT_SpeechStart(channel, uuid, data) {
  const currentSpeaker = pttState.channelSpeakers.get(channel);

  // 如果有人正在說話
  if (currentSpeaker && currentSpeaker !== uuid) {
    // 發送請求給當前說話者（而不是直接拒絕）
    const currentSpeakerWs = pttState.deviceConnections.get(currentSpeaker);
    if (currentSpeakerWs && currentSpeakerWs.readyState === WebSocket.OPEN) {
      currentSpeakerWs.send(JSON.stringify({
        type: 'ptt_mic_request',
        channel: channel,
        requester: uuid,
        currentSpeaker: currentSpeaker,
        timestamp: new Date().toISOString()
      }));
    }

    // 通知請求者：請求已發送
    const requesterWs = pttState.deviceConnections.get(uuid);
    if (requesterWs && requesterWs.readyState === WebSocket.OPEN) {
      requesterWs.send(JSON.stringify({
        type: 'ptt_mic_request_sent',
        channel: channel,
        currentSpeaker: currentSpeaker,
        timestamp: new Date().toISOString()
      }));
    }
    return;
  }

  // 沒有人使用，直接授予權限
  pttState.channelSpeakers.set(channel, uuid);
  // ... 發送 allow 並廣播
}
```

**新增麥克風回應處理** ([server.cjs:989-1044](Mezzo-main/backend/server.cjs#L989-L1044)):

```javascript
function handlePTT_MicResponse(channel, uuid, data) {
  const [requesterUUID, response] = data.split(',');

  if (response === 'accept') {
    // 當前說話者同意讓出麥克風
    pttState.channelSpeakers.set(channel, requesterUUID);

    // 通知請求者：已獲得權限
    const requesterWs = pttState.deviceConnections.get(requesterUUID);
    if (requesterWs && requesterWs.readyState === WebSocket.OPEN) {
      requesterWs.send(JSON.stringify({
        type: 'ptt_speech_allow',
        channel: channel
      }));
    }

    // 廣播新的說話者
    broadcastToClients({
      type: 'ptt_speaker_update',
      channel: channel,
      speaker: requesterUUID,
      action: 'start',
      previousSpeaker: uuid
    });
  } else {
    // 拒絕讓出
    const requesterWs = pttState.deviceConnections.get(requesterUUID);
    if (requesterWs) {
      requesterWs.send(JSON.stringify({
        type: 'ptt_speech_deny',
        channel: channel,
        reason: `${uuid} 拒絕讓出麥克風`
      }));
    }
  }
}
```

**前端處理搶麥請求** ([PTTAudio.tsx:226-238](Mezzo-main/src/assets/PTTAudio.tsx#L226-L238)):

```typescript
// 收到搶麥請求（有人想要搶我的麥克風）
if (data.type === 'ptt_mic_request' && data.channel === channel && data.currentSpeaker === deviceId) {
    console.log(`🔔 Mic request from ${data.requester}`);
    const accept = window.confirm(`${data.requester} 想要發言，是否讓出麥克風？`);

    // 發送回應
    sendMicResponse(data.requester, accept);

    if (accept) {
        // 停止自己的錄音
        stopGroupRecording();
    }
}
```

**前端發送麥克風回應** ([PTTAudio.tsx:315-351](Mezzo-main/src/assets/PTTAudio.tsx#L315-L351)):

```typescript
const sendMicResponse = async (requesterUUID: string, accept: boolean) => {
    try {
        const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:4000' : `http://${window.location.hostname}:4000`;

        const tag = 'PTT_MSG_TYPE_MIC_RESPONSE';
        const data = `${requesterUUID},${accept ? 'accept' : 'deny'}`;

        // 建立 PTT 訊息格式：Tag(32) + UUID(128) + Data
        const tagBuffer = new Uint8Array(32);
        const tagBytes = new TextEncoder().encode(tag);
        tagBuffer.set(tagBytes.slice(0, 32));

        const uuidBuffer = new Uint8Array(128);
        const uuidBytes = new TextEncoder().encode(deviceId);
        uuidBuffer.set(uuidBytes.slice(0, 128));

        const dataBytes = new TextEncoder().encode(data);
        const combined = new Uint8Array(160 + dataBytes.length);
        combined.set(tagBuffer, 0);
        combined.set(uuidBuffer, 32);
        combined.set(dataBytes, 160);

        await fetch(`${API_BASE}/ptt/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                topic: `/WJI/PTT/${channel}/CHANNEL_ANNOUNCE`,
                message: Array.from(combined),
                encoding: 'binary'
            })
        });

        console.log(`📤 Mic response sent: ${accept ? 'accept' : 'deny'} to ${requesterUUID}`);
    } catch (error) {
        console.error('❌ Failed to send mic response:', error);
    }
};
```

#### 4. 修復 PTT 狀態顯示問題

**問題**: 用戶反映在發話時，UI 同時顯示「正在發話中」和「正在請求發話權限」兩個狀態。

**修復** ([PTTAudio.tsx:655-689](Mezzo-main/src/assets/PTTAudio.tsx#L655-L689)):

```typescript
{isRecording ? (
    // 自己正在錄音 - 紅色
    <div className="bg-red-50 border border-red-200">
        <Mic className="text-red-600 animate-pulse" />
        <span>您正在發話中</span>
    </div>
) : currentSpeaker && currentSpeaker !== deviceId ? (
    // 其他人正在說話 - 黃色
    <div className="bg-yellow-50 border border-yellow-200">
        <Mic className="text-yellow-600 animate-pulse" />
        <span>{currentSpeaker} 正在發話中</span>
    </div>
) : (
    // 頻道空閒 - 綠色
    <div className="bg-green-50 border border-green-200">
        <Mic className="text-green-600" />
        <span>頻道空閒 - 可以發話</span>
    </div>
)}

{/* 只在「請求中且尚未開始錄音」時顯示請求狀態 */}
{requestingMic && !isRecording && (
    <div className="bg-blue-50">
        <div className="animate-spin"></div>
        <span>正在請求發話權限...</span>
    </div>
)}
```

關鍵改進：
- 使用優先級：錄音中 > 他人說話 > 頻道空閒
- 請求狀態只在 `requestingMic && !isRecording` 時顯示
- 明確區分自己和他人的狀態

#### 5. 添加 Debug 日誌

為了方便診斷問題，添加了詳細的 debug 日誌：

**語音識別日誌** ([GPSTracking.tsx:769-817](Mezzo-main/src/assets/GPSTracking.tsx#L769-L817)):
```typescript
recognition.onresult = (event: any) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
            const newText = event.results[i][0].transcript;
            transcript += newText + ' ';
            console.log('🎤 Speech recognized:', newText, '| Total:', transcript);
        }
    }
};

recognition.onstart = () => {
    console.log('🎤 Speech recognition started for voice message');
};

recognition.onend = () => {
    console.log('🎤 Speech recognition ended. Final transcript:', transcript);
};
```

**語音訊息發送日誌** ([GPSTracking.tsx:814-857](Mezzo-main/src/assets/GPSTracking.tsx#L814-L857)):
```typescript
console.log('📝 Voice message transcript:', {
    raw: transcript,
    trimmed: transcript.trim(),
    displayText,
    hasRecognition: !!voiceMsgRecognitionRef.current
});

console.log('📤 Sending voice message:', {
    channel,
    from: pttDeviceId,
    to: selectedGroup === 'all' ? 'all' : `group:${selectedGroup}`,
    textLength: voiceMessageData.text.length,
    hasAudio: !!base64Audio,
    transcriptLength: transcript.length
});
```

### 功能確認清單

#### GPS 回報功能
✅ **已實作** ([GPSTracking.tsx:143-174](Mezzo-main/src/assets/GPSTracking.tsx#L143-L174))
- Topic: `/WJI/PTT/{Channel}/GPS`
- Tag: `GPS`
- Data: `UUID,Lat,Lon`
- 後端處理: [server.cjs:479-535](Mezzo-main/backend/server.cjs#L479-L535)

#### SOS 求救功能
✅ **已實作** ([GPSTracking.tsx:178-209](Mezzo-main/src/assets/GPSTracking.tsx#L178-L209))
- Topic: `/WJI/PTT/{Channel}/SOS`
- Tag: `SOS`
- Data: `Lat,Lon`
- 後端處理: [server.cjs:539-594](Mezzo-main/backend/server.cjs#L539-L594)

### 新增訊息類型

| 訊息類型 | 用途 | 發送時機 |
|---------|------|---------|
| `ptt_mic_request` | 搶麥請求 | B 想要發話但 A 正在使用時 |
| `ptt_mic_request_sent` | 請求已發送確認 | 後端通知 B 請求已發送給 A |
| `PTT_MSG_TYPE_MIC_RESPONSE` | 麥克風回應 | A 同意或拒絕讓出麥克風 |

### 測試結果

根據用戶反饋：
- ✅ 語音訊息現在正確顯示轉譯文字
- ✅ 群組 PTT 通話不再將轉譯發送到聊天室
- ✅ 搶麥機制改為請求式，體驗更好
- ✅ PTT 狀態顯示正確，不再出現重疊

### 技術總結

**核心原則**:
1. **語音訊息** = 聊天功能，有轉譯，儲存記錄
2. **群組 PTT** = 即時通話，無轉譯，不儲存記錄
3. 通過 `transcript` 參數的有無來區分兩種功能

**關鍵判斷邏輯**:
```typescript
// 前端：群組 PTT 不發送 transcript
onAudioSend(arrayBuffer, false, undefined, undefined);

// 前端：語音訊息發送 transcript
onAudioSend(arrayBuffer, false, undefined, transcript);

// 後端：只有有 transcript 時才廣播到聊天
if (transcript && transcript.trim()) {
    broadcastToClients({ type: 'ptt_transcript', message: {...} });
}
```

---

**更新日期**: 2026-01-23
**實作者**: Claude Sonnet 4.5
