# WebRTC 即時 PTT 實作指南

## 完成的工作

### 1. ✅ 架構設計文檔
已創建 `WEBRTC_PTT_DESIGN.md`，包含：
- 混合架構設計（MQTT 信令 + WebRTC 媒體）
- 詳細流程圖
- SFU vs Mesh 架構對比
- 協議整合方案

### 2. ✅ WebRTC 管理器
已創建 `src/utils/WebRTCManager.ts`，提供：
- `WebRTCManager`: 單一 PeerConnection 管理
- `WebRTCMeshManager`: 多 PeerConnection 管理（Mesh 架構）
- ICE 候選處理
- 連線狀態監控
- 錯誤處理

## 下一步實作步驟

### 步驟 1: 修改 PTTAudio.tsx 整合 WebRTC

在 PTTAudio.tsx 頂部導入 WebRTC 管理器：

```typescript
import { WebRTCManager } from '../utils/WebRTCManager';
```

添加狀態和 refs：

```typescript
// WebRTC 狀態
const [streamingMode, setStreamingMode] = useState(true);  // 預設使用串流模式
const [isStreaming, setIsStreaming] = useState(false);

// WebRTC Refs
const webrtcManagerRef = useRef<WebRTCManager | null>(null);
const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
```

修改 `startGroupRecording` 函數：

```typescript
const startGroupRecording = async () => {
    const API_BASE = window.location.hostname === 'localhost'
        ? 'http://localhost:4000'
        : `http://${window.location.hostname}:4000`;

    setRequestingMic(true);

    // 1. 發送 MQTT 權限請求（保持不變）
    const tag = 'PTT_MSG_TYPE_SPEECH_START';
    const tagBuffer = new Uint8Array(32);
    const tagBytes = new TextEncoder().encode(tag);
    tagBuffer.set(tagBytes.slice(0, 32));

    const uuidBuffer = new Uint8Array(128);
    const uuidBytes = new TextEncoder().encode(deviceId);
    uuidBuffer.set(uuidBytes.slice(0, 128));

    const combined = new Uint8Array(160);
    combined.set(tagBuffer, 0);
    combined.set(uuidBuffer, 32);

    await fetch(`${API_BASE}/ptt/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            topic: `/WJI/PTT/${channel}/CHANNEL_ANNOUNCE`,
            message: Array.from(combined),
            encoding: 'binary'
        })
    });

    console.log('📤 PTT permission request sent, waiting for response...');
};
```

添加 WebRTC 串流開始函數：

```typescript
const startWebRTCStreaming = async () => {
    try {
        console.log('🚀 Starting WebRTC streaming...');

        // 創建 WebRTC 管理器
        webrtcManagerRef.current = new WebRTCManager(
            undefined, // 使用預設 STUN 配置
            undefined, // 使用預設音訊約束
            {
                onIceCandidate: (candidate) => {
                    // 發送 ICE candidate 給其他用戶
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'webrtc_ice_candidate',
                            channel: channel,
                            from: deviceId,
                            to: 'all',
                            candidate: candidate.toJSON()
                        }));
                    }
                },
                onConnectionStateChange: (state) => {
                    console.log('🔗 WebRTC connection state:', state);
                    if (state === 'connected') {
                        setIsStreaming(true);
                    } else if (state === 'failed' || state === 'disconnected') {
                        setIsStreaming(false);
                        stopWebRTCStreaming();
                    }
                },
                onError: (error) => {
                    console.error('❌ WebRTC error:', error);
                    alert(`WebRTC 錯誤: ${error.message}`);
                    stopWebRTCStreaming();
                }
            }
        );

        // 初始化作為發送者
        const offer = await webrtcManagerRef.current.initializeAsSender();

        // 通過 WebSocket 發送 offer 給所有人
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'webrtc_offer',
                channel: channel,
                from: deviceId,
                to: 'all',
                offer: offer
            }));
            console.log('📤 WebRTC offer sent');
        }

        setIsRecording(true);
        isRecordingRef.current = true;
        setRequestingMic(false);
        setHasPermission(true);

        console.log('✅ WebRTC streaming started');
    } catch (error) {
        console.error('❌ Failed to start WebRTC streaming:', error);
        alert('無法啟動即時串流，請檢查麥克風權限');
        setRequestingMic(false);
        stopWebRTCStreaming();
    }
};
```

添加停止函數：

```typescript
const stopWebRTCStreaming = () => {
    console.log('🛑 Stopping WebRTC streaming...');

    if (webrtcManagerRef.current) {
        webrtcManagerRef.current.close();
        webrtcManagerRef.current = null;
    }

    setIsStreaming(false);
    setIsRecording(false);
    isRecordingRef.current = false;
    setHasPermission(false);

    // 發送 PTT 停止訊息
    sendSpeechStopRequest();
};
```

修改 WebSocket 監聽器（添加 WebRTC 信令處理）：

```typescript
useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
        try {
            const data = JSON.parse(event.data);

            // 現有的 MQTT 權限處理
            if (data.type === 'ptt_speech_allow' && data.channel === channel) {
                console.log('✅ PTT permission granted');
                setRequestingMic(false);
                setHasPermission(true);

                // 根據模式選擇
                if (streamingMode) {
                    startWebRTCStreaming();  // WebRTC 串流
                } else {
                    actuallyStartRecording();  // 傳統錄音
                }
            }

            if (data.type === 'ptt_speech_deny' && data.channel === channel) {
                console.log('🚫 PTT permission denied:', data.reason);
                setRequestingMic(false);
                alert(`無法取得麥克風：${data.reason}`);
            }

            if (data.type === 'ptt_speaker_update' && data.channel === channel) {
                if (data.action === 'start') {
                    setCurrentSpeaker(data.speaker);
                } else if (data.action === 'stop') {
                    setCurrentSpeaker(null);
                }
            }

            // === 新增：WebRTC 信令處理 ===

            // 收到 WebRTC Offer（監聽者）
            if (data.type === 'webrtc_offer' && data.channel === channel && data.from !== deviceId) {
                handleWebRTCOffer(data.from, data.offer);
            }

            // 收到 WebRTC Answer（發送者）
            if (data.type === 'webrtc_answer' && data.channel === channel && data.to === deviceId) {
                handleWebRTCAnswer(data.answer);
            }

            // 收到 ICE Candidate
            if (data.type === 'webrtc_ice_candidate' && data.channel === channel) {
                if (data.to === 'all' && data.from !== deviceId) {
                    handleICECandidate(data.candidate);
                } else if (data.to === deviceId) {
                    handleICECandidate(data.candidate);
                }
            }

            // 收到搶麥請求（保持不變）
            if (data.type === 'ptt_mic_request' && data.channel === channel && data.currentSpeaker === deviceId) {
                console.log(`🔔 Mic request from ${data.requester}`);
                const accept = window.confirm(`${data.requester} 想要發言，是否讓出麥克風？`);

                sendMicResponse(data.requester, accept);

                if (accept) {
                    if (streamingMode) {
                        stopWebRTCStreaming();
                    } else {
                        stopGroupRecording();
                    }
                }
            }
        } catch (error) {
            console.error('❌ WebSocket message parse error:', error);
        }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
}, [ws, channel, deviceId, streamingMode]);
```

添加 WebRTC 信令處理函數：

```typescript
// 處理接收到的 Offer（監聽者）
const handleWebRTCOffer = async (from: string, offer: RTCSessionDescriptionInit) => {
    try {
        console.log(`📥 Received WebRTC offer from ${from}`);

        // 創建接收者的 WebRTC 管理器
        if (!webrtcManagerRef.current) {
            webrtcManagerRef.current = new WebRTCManager(
                undefined,
                undefined,
                {
                    onRemoteStream: (stream) => {
                        console.log('🎵 Received remote stream, playing...');

                        // 創建或使用現有的 audio 元素
                        if (!remoteAudioRef.current) {
                            remoteAudioRef.current = new Audio();
                            remoteAudioRef.current.autoplay = true;
                        }

                        remoteAudioRef.current.srcObject = stream;
                        remoteAudioRef.current.play().catch(err => {
                            console.error('❌ Failed to play remote audio:', err);
                        });
                    },
                    onIceCandidate: (candidate) => {
                        // 發送 ICE candidate 回給發送者
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'webrtc_ice_candidate',
                                channel: channel,
                                from: deviceId,
                                to: from,
                                candidate: candidate.toJSON()
                            }));
                        }
                    },
                    onError: (error) => {
                        console.error('❌ WebRTC receiver error:', error);
                    }
                }
            );
        }

        // 作為接收者初始化
        const answer = await webrtcManagerRef.current.initializeAsReceiver(offer);

        // 發送 answer 回給發送者
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'webrtc_answer',
                channel: channel,
                from: deviceId,
                to: from,
                answer: answer
            }));
            console.log(`📤 WebRTC answer sent to ${from}`);
        }
    } catch (error) {
        console.error('❌ Failed to handle WebRTC offer:', error);
    }
};

// 處理接收到的 Answer（發送者）
const handleWebRTCAnswer = async (answer: RTCSessionDescriptionInit) => {
    try {
        console.log('📥 Received WebRTC answer');

        if (webrtcManagerRef.current) {
            await webrtcManagerRef.current.handleAnswer(answer);
            console.log('✅ Answer processed');
        }
    } catch (error) {
        console.error('❌ Failed to handle WebRTC answer:', error);
    }
};

// 處理 ICE Candidate
const handleICECandidate = async (candidate: RTCIceCandidateInit) => {
    try {
        if (webrtcManagerRef.current) {
            await webrtcManagerRef.current.addIceCandidate(candidate);
        }
    } catch (error) {
        console.error('❌ Failed to add ICE candidate:', error);
    }
};
```

添加 UI 切換開關：

```tsx
{/* 串流模式切換 */}
<div className="flex items-center gap-2 p-2 bg-gray-100 rounded">
    <input
        type="checkbox"
        id="streamingMode"
        checked={streamingMode}
        onChange={(e) => setStreamingMode(e.target.checked)}
        disabled={isRecording || requestingMic}
        className="cursor-pointer"
    />
    <label htmlFor="streamingMode" className="text-sm cursor-pointer">
        即時串流模式（低延遲 &lt; 100ms）
    </label>
</div>

{/* 串流狀態指示 */}
{isStreaming && (
    <div className="bg-green-50 border border-green-200 rounded p-2 text-sm text-green-800">
        🔴 即時串流中...
    </div>
)}
```

### 步驟 2: 後端 WebSocket 信令轉發

修改 `backend/server.cjs`，添加 WebRTC 信令處理：

```javascript
// WebSocket 訊息處理（在現有的 ws.on('message') 中添加）
ws.on('message', (message) => {
    try {
        const data = JSON.parse(message);

        // 現有的處理...

        // === WebRTC 信令處理 ===
        if (data.type === 'webrtc_offer') {
            console.log(`📡 Forwarding WebRTC offer from ${data.from} to channel ${data.channel}`);

            // 廣播給頻道內所有人（除了發送者）
            const channelUsers = pttState.channelUsers.get(data.channel) || new Set();
            channelUsers.forEach(userId => {
                if (userId !== data.from) {
                    const targetWs = pttState.deviceConnections.get(userId);
                    if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                        targetWs.send(JSON.stringify(data));
                    }
                }
            });
        }

        if (data.type === 'webrtc_answer') {
            console.log(`📡 Forwarding WebRTC answer from ${data.from} to ${data.to}`);

            // 轉發給指定的發送者
            const targetWs = pttState.deviceConnections.get(data.to);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify(data));
            }
        }

        if (data.type === 'webrtc_ice_candidate') {
            console.log(`📡 Forwarding ICE candidate from ${data.from}`);

            if (data.to === 'all') {
                // 廣播給頻道內所有人（除了發送者）
                const channelUsers = pttState.channelUsers.get(data.channel) || new Set();
                channelUsers.forEach(userId => {
                    if (userId !== data.from) {
                        const targetWs = pttState.deviceConnections.get(userId);
                        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                            targetWs.send(JSON.stringify(data));
                        }
                    }
                });
            } else {
                // 轉發給指定用戶
                const targetWs = pttState.deviceConnections.get(data.to);
                if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                    targetWs.send(JSON.stringify(data));
                }
            }
        }
    } catch (error) {
        console.error('❌ WebSocket message error:', error);
    }
});
```

添加頻道用戶追蹤（如果還沒有）：

```javascript
// 在 pttState 中添加
const pttState = {
    activeUsers: new Map(),
    sosAlerts: new Map(),
    channelUsers: new Map(),  // channel -> Set<userId>
    broadcastedTranscripts: new Set(),
    deviceConnections: new Map(),
    channelSpeakers: new Map()
};

// 當用戶加入頻道時
function handleUserJoinChannel(userId, channel) {
    if (!pttState.channelUsers.has(channel)) {
        pttState.channelUsers.set(channel, new Set());
    }
    pttState.channelUsers.get(channel).add(userId);
    console.log(`📍 User ${userId} joined channel ${channel}`);
}

// 當用戶離開頻道時
function handleUserLeaveChannel(userId, channel) {
    const channelUsers = pttState.channelUsers.get(channel);
    if (channelUsers) {
        channelUsers.delete(userId);
        if (channelUsers.size === 0) {
            pttState.channelUsers.delete(channel);
        }
    }
    console.log(`📍 User ${userId} left channel ${channel}`);
}
```

### 步驟 3: 測試步驟

1. **單人測試**：
   ```
   1. 開啟 PTT 控制面板
   2. 確認「即時串流模式」已勾選
   3. 點擊「開始發話」
   4. 應該看到「🔴 即時串流中...」
   5. 查看瀏覽器控制台確認 WebRTC 連線建立
   ```

2. **雙人測試**：
   ```
   1. 開啟兩個瀏覽器視窗（A 和 B）
   2. 兩邊都選擇相同頻道
   3. A 點擊「開始發話」
   4. A 說話，B 應該幾乎即時聽到（延遲 < 100ms）
   5. 查看控制台確認：
      - A: WebRTC offer sent, answer received
      - B: WebRTC offer received, answer sent, remote stream playing
   ```

3. **降級測試**：
   ```
   1. 取消勾選「即時串流模式」
   2. 應該回到傳統錄音模式
   3. 確認錄音模式仍然正常工作
   ```

### 步驟 4: 部署考量

1. **HTTPS 要求**：
   - WebRTC 需要 HTTPS（localhost 除外）
   - 生產環境必須配置 SSL

2. **STUN/TURN 伺服器**：
   - 目前使用 Google 公共 STUN
   - 生產環境建議自架 TURN（coturn）

3. **防火牆**：
   - 確保 UDP 端口開放（WebRTC 媒體）
   - 確保 WebSocket 端口開放（信令）

## 預期效果

### 延遲對比

| 模式 | 延遲 | 說明 |
|-----|------|------|
| WebRTC 串流 | < 100ms | 即時通話體驗 |
| 傳統錄音 | 1-3 秒 | 錄完後發送 |
| 語音訊息 | N/A | 聊天記錄 |

### 用戶體驗

**WebRTC 模式**：
- ✅ 低延遲，像真正的對講機
- ✅ 自動處理網路抖動
- ✅ 回音消除和噪音抑制
- ⚠️ 需要較好的網路

**傳統模式**：
- ✅ 兼容性好
- ✅ 網路要求低
- ⚠️ 延遲較高

## 故障排除

### WebRTC 連線失敗

1. 檢查麥克風權限
2. 檢查是否使用 HTTPS
3. 查看 ICE 連線狀態
4. 嘗試使用 TURN 伺服器

### 音訊無法播放

1. 檢查瀏覽器自動播放政策
2. 確認 `audio.play()` 沒有被阻擋
3. 檢查遠端串流是否正確接收

### 高延遲

1. 檢查網路品質
2. 查看 WebRTC 統計資訊
3. 考慮降低音訊品質

## 下一步優化

1. **連線品質監控**：
   - 顯示延遲、丟包率
   - 自動調整音訊品質

2. **自動降級**：
   - WebRTC 失敗自動切換到錄音模式

3. **SFU 後端**：
   - 使用 mediasoup 或 Janus
   - 更好的多人支持

---

**文檔完成日期**: 2026-01-23
**作者**: Claude Sonnet 4.5
