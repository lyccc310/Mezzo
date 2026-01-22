# WebRTC 即時 PTT 通話設計文檔

## 概述

本設計將 WebRTC 即時音訊串流與現有 PTT MQTT 協議整合，實現真正的對講機即時通話體驗。

## 架構設計

### 混合架構：MQTT 信令 + WebRTC 媒體

```
┌─────────────┐                    ┌─────────────┐
│   用戶 A    │                    │   用戶 B    │
│  (說話者)   │                    │  (監聽者)   │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │  1. PTT_MSG_TYPE_SPEECH_START   │
       │─────────────────────────────────>│
       │         (MQTT)                   │
       │                                  │
       │  2. PTT_MSG_TYPE_SPEECH_START_ALLOW
       │<─────────────────────────────────│
       │         (MQTT)                   │
       │                                  │
       │  3. WebRTC Offer (SDP)          │
       │─────────────────────────────────>│
       │      (WebSocket)                 │
       │                                  │
       │  4. WebRTC Answer (SDP)         │
       │<─────────────────────────────────│
       │      (WebSocket)                 │
       │                                  │
       │  5. ICE Candidates              │
       │<────────────────────────────────>│
       │      (WebSocket)                 │
       │                                  │
       │  6. 即時音訊串流                  │
       │═════════════════════════════════>│
       │      (WebRTC P2P/Relay)          │
       │                                  │
       │  7. PTT_MSG_TYPE_SPEECH_STOP    │
       │─────────────────────────────────>│
       │         (MQTT)                   │
```

### 為什麼選擇混合架構？

1. **MQTT 處理權限控制**：
   - 搶麥機制
   - 頻道管理
   - 權限仲裁
   - 與現有協議完全兼容

2. **WebRTC 處理音訊傳輸**：
   - 低延遲（< 100ms）
   - P2P 直連（可選）
   - 自動處理編解碼
   - 網路抖動緩衝

## 協議整合

### MQTT 訊息（保持不變）

| Tag | 用途 | Data |
|-----|------|------|
| `PTT_MSG_TYPE_SPEECH_START` | 請求發話權限 | (Empty) |
| `PTT_MSG_TYPE_SPEECH_START_ALLOW` | 允許發話 | Requesting UUID |
| `PTT_MSG_TYPE_SPEECH_START_DENY` | 拒絕發話 | Requesting UUID |
| `PTT_MSG_TYPE_SPEECH_STOP` | 釋放麥克風 | (Empty) |
| `PTT_MSG_TYPE_MIC_RESPONSE` | 搶麥回應 | `UUID,accept/deny` |

### 新增 WebSocket 訊息（用於 WebRTC 信令）

```typescript
// WebRTC Offer
{
    type: 'webrtc_offer',
    channel: string,
    from: string,
    to: 'all',  // 廣播給頻道所有人
    offer: RTCSessionDescriptionInit
}

// WebRTC Answer
{
    type: 'webrtc_answer',
    channel: string,
    from: string,
    to: string,  // 回覆給說話者
    answer: RTCSessionDescriptionInit
}

// ICE Candidate
{
    type: 'webrtc_ice_candidate',
    channel: string,
    from: string,
    to: string,  // 或 'all'
    candidate: RTCIceCandidateInit
}
```

## 實作策略

### 方案 A: SFU 架構（推薦）

**Selective Forwarding Unit**：後端轉發音訊

```
     說話者
        │
        ├──> WebRTC 上傳 ───> 後端 SFU
                                │
                    ┌───────────┼───────────┐
                    │           │           │
                    v           v           v
                監聽者1     監聽者2     監聽者3
```

**優點**:
- 說話者只需一個上行連線
- 後端可以管理誰能聽到
- 延遲仍然很低（< 100ms）
- 容易擴展多人

**缺點**:
- 需要後端支持 WebRTC
- 需要處理更多流量

### 方案 B: Mesh 架構

**Peer-to-Peer Mesh**：說話者直連所有監聽者

```
           監聽者1
              ^
             /
            /
     說話者 ────> 監聽者2
            \
             \
              v
           監聽者3
```

**優點**:
- 延遲最低
- 後端負擔輕

**缺點**:
- 說話者需要多個上行連線（N 個監聽者 = N 個連線）
- NAT 穿透問題（可能需要 TURN）
- 不適合大型頻道

### 推薦：使用方案 A (SFU)

原因：
1. PTT 通常是一對多（1 說話者，多監聽者）
2. SFU 對說話者友善（只需 1 個上行）
3. 後端可以做權限控制（誰能聽）
4. 延遲仍然足夠低

## 詳細流程

### 1. 發起通話流程

```typescript
// 前端 (PTTAudio.tsx)
const startStreamingCall = async () => {
    // 1. 先請求 MQTT 權限
    sendSpeechStartRequest();  // 現有邏輯

    // 2. 等待 ptt_speech_allow
    // (在 WebSocket listener 中處理)

    // 3. 獲得權限後，建立 WebRTC 連線
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 4. 建立 PeerConnection
    const pc = new RTCPeerConnection(config);
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    // 5. 創建 Offer 並發送
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({
        type: 'webrtc_offer',
        channel: channel,
        from: deviceId,
        to: 'all',
        offer: offer
    }));
};
```

### 2. 接收通話流程

```typescript
// 前端 (PTTAudio.tsx)
ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'webrtc_offer' && data.channel === channel) {
        // 建立 PeerConnection 接收音訊
        const pc = new RTCPeerConnection(config);

        // 監聽遠端音軌
        pc.ontrack = (event) => {
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            audio.play();
        };

        // 設置遠端描述
        await pc.setRemoteDescription(data.offer);

        // 創建 Answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // 發送 Answer
        ws.send(JSON.stringify({
            type: 'webrtc_answer',
            channel: data.channel,
            from: deviceId,
            to: data.from,
            answer: answer
        }));
    }
};
```

### 3. 停止通話流程

```typescript
const stopStreamingCall = async () => {
    // 1. 關閉 WebRTC 連線
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    // 2. 停止本地串流
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // 3. 發送 MQTT 停止訊息
    sendSpeechStopRequest();  // 現有邏輯
};
```

## 技術細節

### WebRTC Configuration

```typescript
const rtcConfig: RTCConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // 如果需要 TURN (Relay)
        // {
        //     urls: 'turn:your-turn-server.com:3478',
        //     username: 'user',
        //     credential: 'pass'
        // }
    ],
    iceCandidatePoolSize: 10
};
```

### 音訊約束

```typescript
const audioConstraints = {
    audio: {
        echoCancellation: true,      // 回音消除
        noiseSuppression: true,       // 噪音抑制
        autoGainControl: true,        // 自動增益
        sampleRate: 48000,            // 採樣率
        channelCount: 1               // 單聲道
    }
};
```

## 後端修改

### 新增 WebRTC 信令轉發 (server.cjs)

```javascript
// WebSocket 訊息處理
ws.on('message', (message) => {
    const data = JSON.parse(message);

    switch(data.type) {
        case 'webrtc_offer':
            // 廣播 offer 給頻道內所有人（除了發送者）
            broadcastToChannel(data.channel, data, data.from);
            break;

        case 'webrtc_answer':
            // 轉發 answer 給指定的說話者
            sendToDevice(data.to, data);
            break;

        case 'webrtc_ice_candidate':
            // 轉發 ICE candidate
            if (data.to === 'all') {
                broadcastToChannel(data.channel, data, data.from);
            } else {
                sendToDevice(data.to, data);
            }
            break;
    }
});

function broadcastToChannel(channel, message, excludeUUID) {
    // 發送給頻道內所有人（除了 excludeUUID）
    pttState.channelUsers.get(channel)?.forEach(uuid => {
        if (uuid !== excludeUUID) {
            const ws = pttState.deviceConnections.get(uuid);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        }
    });
}
```

## 優化建議

### 1. 音訊編碼優化

WebRTC 預設使用 Opus 編碼，但可以調整參數：

```typescript
pc.addTransceiver('audio', {
    direction: 'sendonly',
    sendEncodings: [{
        maxBitrate: 64000  // 64kbps，平衡品質與頻寬
    }]
});
```

### 2. 連線品質監控

```typescript
pc.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') {
        // 重新連線或降級到錄音模式
    }
};

// 監控統計
setInterval(async () => {
    const stats = await pc.getStats();
    stats.forEach(stat => {
        if (stat.type === 'inbound-rtp') {
            console.log('Jitter:', stat.jitter);
            console.log('Packets lost:', stat.packetsLost);
        }
    });
}, 5000);
```

### 3. 降級方案

如果 WebRTC 連線失敗，自動降級到現有的錄音模式：

```typescript
const startCall = async () => {
    try {
        await startStreamingCall();  // 嘗試 WebRTC
    } catch (error) {
        console.warn('WebRTC failed, fallback to recording mode');
        startGroupRecording();  // 降級到錄音模式
    }
};
```

## 與現有功能的整合

### 保持兩種模式並存

1. **語音訊息**（聊天室）：
   - 保持現有實作（錄音 + 轉譯）
   - 用於非即時通訊

2. **PTT 即時通話**（對講機）：
   - 使用新的 WebRTC 實作
   - 真正的即時串流

### UI 區分

```typescript
// PTTAudio.tsx
const [streamingMode, setStreamingMode] = useState(true);  // 預設使用串流模式

<div>
    <label>
        <input
            type="checkbox"
            checked={streamingMode}
            onChange={(e) => setStreamingMode(e.target.checked)}
        />
        即時串流模式（低延遲）
    </label>
</div>
```

## 測試計劃

### 1. 單元測試
- [ ] WebRTC 連線建立
- [ ] ICE candidate 交換
- [ ] 音訊串流發送/接收

### 2. 整合測試
- [ ] MQTT 權限控制 + WebRTC 音訊
- [ ] 搶麥機制在串流模式下運作
- [ ] 多人同時監聽

### 3. 效能測試
- [ ] 延遲測量（目標 < 100ms）
- [ ] 網路抖動處理
- [ ] 弱網環境測試

### 4. 兼容性測試
- [ ] Chrome
- [ ] Firefox
- [ ] Safari
- [ ] Edge

## 部署考量

### STUN/TURN 伺服器

**開發環境**:
- 使用 Google 的公共 STUN 伺服器

**生產環境**:
- 建議自架 TURN 伺服器（coturn）
- 原因：
  - NAT 穿透問題
  - 某些企業網路阻擋 P2P
  - 更好的連線成功率

### HTTPS 要求

WebRTC 需要 HTTPS（或 localhost）：
- 開發：使用 localhost
- 生產：必須配置 SSL 證書

## 預期效果

### 延遲對比

| 模式 | 延遲 | 適用場景 |
|-----|------|---------|
| 現有錄音模式 | 1-3 秒 | 非即時通訊 |
| WebRTC 串流 | < 100ms | 即時對講 |
| 語音訊息 | N/A | 聊天記錄 |

### 用戶體驗

**WebRTC 即時通話**:
- 按下「開始發話」→ 立即開始串流
- 對方幾乎同時聽到聲音
- 像真正的對講機一樣

**語音訊息**:
- 錄完後發送
- 附帶文字轉譯
- 可以重複播放

---

**設計完成日期**: 2026-01-23
**設計者**: Claude Sonnet 4.5
