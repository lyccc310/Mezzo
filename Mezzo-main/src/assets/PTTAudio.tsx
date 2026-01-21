import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX } from 'lucide-react';

interface PTTAudioProps {
    deviceId: string;
    channel: string;
    onAudioSend: (audioData: ArrayBuffer, isPrivate: boolean, targetId?: string, transcript?: string) => void;
    onSpeechToText?: (text: string) => void;  // 語音轉文字回調（即時顯示用）
    ws?: WebSocket | null;  // WebSocket 連線（用於接收 PTT 權限訊息）
}

interface AudioPacket {
    id: string;
    type: 'speech' | 'private';
    channel: string;
    from: string;
    audioData: string;  // base64
    timestamp: string;
    randomId?: string;
}

const PTTAudio = ({ deviceId, channel, onAudioSend, onSpeechToText, ws }: PTTAudioProps) => {
    // 錄音狀態
    const [isRecording, setIsRecording] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [audioLevel, setAudioLevel] = useState(0);

    // PTT 搶麥狀態
    const [requestingMic, setRequestingMic] = useState(false);  // 正在請求麥克風
    const [hasPermission, setHasPermission] = useState(false);  // 已獲得麥克風權限
    const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);  // 當前頻道誰在說話

    // 私人通話狀態
    const [privateCallActive, setPrivateCallActive] = useState(false);
    const [privateTargetId, setPrivateTargetId] = useState('');
    const [randomCallId, setRandomCallId] = useState('');

    // 語音轉文字狀態
    const [autoSend, setAutoSend] = useState(false);  // 自動發送開關（預設關閉）
    const [silenceThreshold, setSilenceThreshold] = useState(0.02);  // 靜音閾值
    const [silenceDuration, setSilenceDuration] = useState(1500);  // 靜音持續時間 (ms)
    const [speechRecognitionEnabled, setSpeechRecognitionEnabled] = useState(false);  // STT 可用性
    const [currentTranscript, setCurrentTranscript] = useState('');  // 當前識別的文字

    // Refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const recognitionRef = useRef<any>(null);  // Web Speech API
    const isRecordingRef = useRef<boolean>(false);  // 錄音狀態的 ref
    const finalTranscriptRef = useRef<string>('');  // 累積的最終轉錄文字

    // 初始化音訊上下文和語音識別
    useEffect(() => {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();

        // 初始化 Web Speech API (如果瀏覽器支援)
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = true;
            recognitionRef.current.interimResults = true;
            recognitionRef.current.lang = 'zh-TW';  // 繁體中文

            recognitionRef.current.onstart = () => {
                console.log('✅ Speech recognition started successfully');
                setSpeechRecognitionEnabled(true);
            };

            recognitionRef.current.onend = () => {
                console.log('⏹️ Speech recognition ended');
                setSpeechRecognitionEnabled(false);

                // 如果正在錄音，自動重新啟動語音識別
                // 這樣可以保持持續識別
                if (isRecordingRef.current) {
                    setTimeout(() => {
                        try {
                            if (recognitionRef.current && isRecordingRef.current) {
                                recognitionRef.current.start();
                                console.log('🔄 Speech recognition auto-restarted');
                            }
                        } catch (err) {
                            console.warn('⚠️ Auto-restart failed:', err);
                        }
                    }, 100);
                }
            };

            recognitionRef.current.onresult = (event: any) => {
                // 收集當前這次的結果
                let interimTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        // 累積最終結果
                        finalTranscriptRef.current += transcript;
                        console.log('✅ Final result added:', transcript);
                    } else {
                        // 臨時結果
                        interimTranscript += transcript;
                    }
                }

                // 顯示的文字 = 已確認的文字 + 臨時文字
                const displayText = finalTranscriptRef.current + interimTranscript;
                console.log('🎤 Speech recognized:', {
                    finalAccumulated: finalTranscriptRef.current || '(none)',
                    interim: interimTranscript || '(none)',
                    display: displayText
                });

                // 即時更新顯示
                setCurrentTranscript(displayText);

                // 通知父組件（僅用於即時顯示，不影響發送）
                if (onSpeechToText && displayText) {
                    onSpeechToText(displayText);
                }
            };

            recognitionRef.current.onerror = (event: any) => {
                console.error('❌ Speech recognition error:', event.error);
                if (event.error === 'not-allowed') {
                    alert('請允許麥克風權限以使用語音轉文字功能');
                }
            };

            console.log('✅ Speech Recognition API initialized');
        } else {
            console.warn('⚠️ Web Speech API not supported in this browser');
        }

        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
        };
    }, [onSpeechToText]);

    // 監控音訊電平和靜音偵測
    useEffect(() => {
        if (!isRecording || !analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        const updateLevel = () => {
            if (!analyserRef.current) return;

            analyserRef.current.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            const level = average / 255;
            setAudioLevel(level);

            // 靜音偵測 (自動斷句)
            if (autoSend && !privateCallActive) {
                if (level < silenceThreshold) {
                    // 偵測到靜音，開始計時
                    if (!silenceTimerRef.current) {
                        silenceTimerRef.current = setTimeout(() => {
                            console.log('🔇 Silence detected, auto-sending audio chunk...');
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

            if (isRecording) {
                requestAnimationFrame(updateLevel);
            }
        };

        updateLevel();

        return () => {
            if (silenceTimerRef.current) {
                clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = null;
            }
        };
    }, [isRecording, autoSend, silenceThreshold, silenceDuration, privateCallActive]);

    // 監聽 WebSocket 的 PTT 權限訊息
    useEffect(() => {
        if (!ws) return;

        const handleMessage = (event: MessageEvent) => {
            try {
                const data = JSON.parse(event.data);

                // 收到允許發言
                if (data.type === 'ptt_speech_allow' && data.channel === channel) {
                    console.log('✅ PTT permission granted');
                    setRequestingMic(false);
                    setHasPermission(true);
                    // 立即開始錄音
                    actuallyStartRecording();
                }

                // 收到拒絕發言
                if (data.type === 'ptt_speech_deny' && data.channel === channel) {
                    console.log('🚫 PTT permission denied:', data.reason);
                    setRequestingMic(false);
                    setHasPermission(false);
                    alert(`無法取得麥克風：${data.reason || '已有人在使用'}`);
                }

                // 收到請求已發送通知
                if (data.type === 'ptt_mic_request_sent' && data.channel === channel) {
                    console.log(`⏳ Mic request sent to ${data.currentSpeaker}, waiting for response...`);
                    // 保持 requestingMic 狀態，顯示等待中
                }

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

                // 收到說話者更新（誰在說話）
                if (data.type === 'ptt_speaker_update' && data.channel === channel) {
                    if (data.action === 'start') {
                        setCurrentSpeaker(data.speaker);
                        console.log(`🎙️ ${data.speaker} is now speaking`);
                    } else if (data.action === 'stop') {
                        setCurrentSpeaker(null);
                        console.log(`🛑 ${data.previousSpeaker} stopped speaking`);
                    }
                }
            } catch (error) {
                // Ignore parse errors for non-JSON messages
            }
        };

        ws.addEventListener('message', handleMessage);

        return () => {
            ws.removeEventListener('message', handleMessage);
        };
    }, [ws, channel, deviceId]);

    // 請求發言權限（群組通話的搶麥機制）
    const startGroupRecording = async () => {
        try {
            const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:4000' : `http://${window.location.hostname}:4000`;

            console.log('🎙️ Requesting PTT permission...');
            setRequestingMic(true);

            // 建立 PTT_MSG_TYPE_SPEECH_START 訊息
            const tag = 'PTT_MSG_TYPE_SPEECH_START';
            const data = '';  // 無需額外資料

            // 建立 PTT 訊息格式: Tag(32) + UUID(128) + Data
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

            // 發送請求到後端
            const response = await fetch(`${API_BASE}/ptt/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: `/WJI/PTT/${channel}/CHANNEL_ANNOUNCE`,
                    message: Array.from(combined),
                    encoding: 'binary'
                })
            });

            if (!response.ok) {
                setRequestingMic(false);
                alert('請求發言權限失敗');
            }

            // 等待 WebSocket 回應 (在 useEffect 中處理)
            console.log('⏳ Waiting for PTT permission response...');

        } catch (error) {
            console.error('❌ Failed to request PTT permission:', error);
            setRequestingMic(false);
            alert('無法請求發言權限');
        }
    };

    // 發送搶麥回應（同意或拒絕讓出麥克風）
    const sendMicResponse = async (requesterUUID: string, accept: boolean) => {
        try {
            const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:4000' : `http://${window.location.hostname}:4000`;

            const tag = 'PTT_MSG_TYPE_MIC_RESPONSE';
            const data = `${requesterUUID},${accept ? 'accept' : 'deny'}`;

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

    // 實際開始錄音（內部函數，權限獲得後調用）
    const actuallyStartRecording = async () => {
        try {
            // 清空之前累積的轉錄文字
            finalTranscriptRef.current = '';
            setCurrentTranscript('');

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000  // 16kHz 適合語音
                }
            });

            streamRef.current = stream;

            // 設置音訊分析器
            if (audioContextRef.current) {
                const source = audioContextRef.current.createMediaStreamSource(stream);
                analyserRef.current = audioContextRef.current.createAnalyser();
                analyserRef.current.fftSize = 256;
                source.connect(analyserRef.current);
            }

            // 創建 MediaRecorder
            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                const arrayBuffer = await audioBlob.arrayBuffer();

                // 使用當前顯示的文字（包含最終和臨時結果）
                // 因為有時候語音識別還沒來得及標記為 final 就被停止了
                const textToSend = currentTranscript || finalTranscriptRef.current;
                console.log('📝 Sending audio with transcript:', {
                    currentTranscript,
                    finalTranscript: finalTranscriptRef.current,
                    willSend: textToSend || '(empty)'
                });
                onAudioSend(arrayBuffer, false, undefined, textToSend);

                // 清空轉錄文字
                setCurrentTranscript('');
                finalTranscriptRef.current = '';

                // 清理
                audioChunksRef.current = [];
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                    streamRef.current = null;
                }
            };

            mediaRecorder.start(100);  // 每 100ms 收集一次數據
            setIsRecording(true);
            isRecordingRef.current = true;

            // 啟動語音識別
            if (recognitionRef.current) {
                try {
                    // 先嘗試停止（如果正在運行）
                    if (speechRecognitionEnabled) {
                        recognitionRef.current.stop();
                    }
                    // 等待一下再啟動
                    setTimeout(() => {
                        try {
                            recognitionRef.current.start();
                            console.log('🎤 Starting speech recognition...');
                        } catch (err) {
                            console.warn('⚠️ Speech recognition start failed:', err);
                        }
                    }, 100);
                } catch (err) {
                    console.warn('⚠️ Speech recognition stop failed:', err);
                }
            } else {
                console.warn('⚠️ Speech recognition not initialized');
            }

            console.log('🎙️ Started group recording');

        } catch (error) {
            console.error('❌ Failed to start recording:', error);
            alert('無法訪問麥克風，請確保已授予權限');
        }
    };

    // 停止群組錄音
    const stopGroupRecording = async () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            isRecordingRef.current = false;
            setAudioLevel(0);
            setHasPermission(false);  // 釋放麥克風權限

            // 停止語音識別
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.stop();
                    console.log('🎤 Speech recognition stopped');
                } catch (err) {
                    console.warn('⚠️ Speech recognition stop failed:', err);
                }
            }

            // 清除靜音計時器
            if (silenceTimerRef.current) {
                clearTimeout(silenceTimerRef.current);
                silenceTimerRef.current = null;
            }

            // 發送 PTT_MSG_TYPE_SPEECH_STOP 通知後端釋放麥克風
            try {
                const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:4000' : `http://${window.location.hostname}:4000`;

                const tag = 'PTT_MSG_TYPE_SPEECH_STOP';
                const data = '';

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

                console.log('🛑 PTT_MSG_TYPE_SPEECH_STOP sent');
            } catch (error) {
                console.error('❌ Failed to send SPEECH_STOP:', error);
            }

            console.log('🎙️ Stopped group recording');
        }
    };

    // 發送私人通話請求（握手）
    const startPrivateCall = async () => {
        if (!privateTargetId.trim()) {
            alert('請輸入目標設備 ID');
            return;
        }

        // 生成隨機通話 Topic ID
        const callTopicId = `PRIVATE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setRandomCallId(callTopicId);

        try {
            // 發送 PRIVATE_SPK_REQ 握手請求
            const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:4000' : `http://${window.location.hostname}:4000`;

            // 建立握手訊息: Tag + UUID + Data
            const tag = 'PRIVATE_SPK_REQ';
            const data = `${privateTargetId},${callTopicId}`;  // "TargetUUID,PrivateTopicID"

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

            const response = await fetch(`${API_BASE}/ptt/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: `/WJI/PTT/${channel}/CHANNEL_ANNOUNCE`,
                    message: Array.from(combined),
                    encoding: 'binary'
                })
            });

            if (response.ok) {
                setPrivateCallActive(true);
                console.log(`📞 Private call request sent: ${deviceId} → ${privateTargetId} (Topic: ${callTopicId})`);
                // TODO: 等待對方接受後才開始錄音
                // 目前先直接進入通話狀態（簡化版）
            } else {
                throw new Error('Failed to send call request');
            }

        } catch (error) {
            console.error('❌ Failed to start private call:', error);
            alert('發送通話請求失敗');
            setPrivateCallActive(false);
            setRandomCallId('');
        }
    };

    // 結束私人通話
    const endPrivateCall = async () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        isRecordingRef.current = false;

        // 發送 PRIVATE_SPK_STOP 通知對方
        try {
            const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:4000' : `http://${window.location.hostname}:4000`;

            const tag = 'PRIVATE_SPK_STOP';
            const data = privateTargetId;  // TargetUUID

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

            console.log(`📞 Private call stop sent to ${privateTargetId}`);
        } catch (error) {
            console.error('❌ Failed to send call stop:', error);
        }

        setPrivateCallActive(false);
        setRandomCallId('');
        setAudioLevel(0);
        console.log('📞 Ended private call');
    };

    // 切換靜音
    const toggleMute = () => {
        if (streamRef.current) {
            streamRef.current.getAudioTracks().forEach(track => {
                track.enabled = isMuted;
            });
            setIsMuted(!isMuted);
        }
    };

    return (
        <div className="space-y-4">
            {/* 群組語音 PTT */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <Mic className="w-4 h-4" />
                    群組語音 PTT
                </h4>

                <div className="space-y-3">
                    {/* 當前頻道 */}
                    <div className="text-sm text-gray-600">
                        當前頻道: <span className="font-medium text-gray-900">{channel}</span>
                    </div>

                    {/* 頻道狀態顯示 */}
                    {isRecording ? (
                        // 自己正在錄音
                        <div className="bg-red-50 border border-red-200 rounded-lg p-2">
                            <div className="flex items-center gap-2">
                                <Mic className="w-4 h-4 text-red-600 animate-pulse" />
                                <div className="text-sm">
                                    <span className="font-medium text-red-900">您正在發話中</span>
                                </div>
                            </div>
                        </div>
                    ) : currentSpeaker && currentSpeaker !== deviceId ? (
                        // 其他人正在發話
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2">
                            <div className="flex items-center gap-2">
                                <Mic className="w-4 h-4 text-yellow-600 animate-pulse" />
                                <div className="text-sm">
                                    <span className="font-medium text-yellow-900">{currentSpeaker}</span>
                                    <span className="text-yellow-700"> 正在發話中</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        // 頻道空閒
                        <div className="bg-green-50 border border-green-200 rounded-lg p-2">
                            <div className="flex items-center gap-2">
                                <Mic className="w-4 h-4 text-green-600" />
                                <div className="text-sm text-green-700">
                                    頻道空閒 - 可以發話
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 請求中狀態 - 只在請求階段但還沒開始錄音時顯示 */}
                    {requestingMic && !isRecording && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                <div className="text-sm text-blue-700">
                                    正在請求發話權限...
                                </div>
                            </div>
                        </div>
                    )}

                    {/* PTT 按鈕 - 改為點擊開始/結束 */}
                    <button
                        onClick={() => {
                            if (isRecording && !privateCallActive) {
                                stopGroupRecording();
                            } else if (!privateCallActive) {
                                startGroupRecording();
                            }
                        }}
                        disabled={privateCallActive}
                        className={`w-full py-4 rounded-lg font-semibold transition-all ${
                            isRecording && !privateCallActive
                                ? 'bg-red-600 text-white shadow-lg scale-105'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                        } disabled:bg-gray-300 disabled:cursor-not-allowed`}
                    >
                        {isRecording && !privateCallActive ? (
                            <div className="flex items-center justify-center gap-2">
                                <Mic className="w-5 h-5 animate-pulse" />
                                <span>點擊停止發話</span>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center gap-2">
                                <Mic className="w-5 h-5" />
                                <span>點擊開始發話 (PTT)</span>
                            </div>
                        )}
                    </button>

                    {/* 音訊電平指示器 */}
                    {isRecording && !privateCallActive && (
                        <div className="space-y-1">
                            <div className="text-xs text-gray-600">音訊電平</div>
                            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-green-500 transition-all duration-100"
                                    style={{ width: `${audioLevel * 100}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* 即時轉錄文字顯示 */}
                    {isRecording && currentTranscript && (
                        <div className="bg-blue-50 border border-blue-200 rounded p-2">
                            <div className="text-xs text-gray-600 mb-1">正在識別:</div>
                            <div className="text-sm text-blue-900 italic">{currentTranscript}</div>
                        </div>
                    )}

                    {/* 靜音按鈕 */}
                    <button
                        onClick={toggleMute}
                        disabled={!isRecording}
                        className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            isMuted
                                ? 'bg-red-100 text-red-700 border border-red-300'
                                : 'bg-gray-100 text-gray-700 border border-gray-300'
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                        {isMuted ? (
                            <span className="flex items-center justify-center gap-2">
                                <VolumeX className="w-4 h-4" />
                                已靜音
                            </span>
                        ) : (
                            <span className="flex items-center justify-center gap-2">
                                <Volume2 className="w-4 h-4" />
                                取消靜音
                            </span>
                        )}
                    </button>
                </div>
            </div>

            {/* 私人通話 */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <Phone className="w-4 h-4" />
                    私人通話
                </h4>

                <div className="space-y-3">
                    {!privateCallActive ? (
                        <>
                            <input
                                type="text"
                                value={privateTargetId}
                                onChange={(e) => setPrivateTargetId(e.target.value)}
                                placeholder="輸入目標設備 ID"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                                onClick={startPrivateCall}
                                disabled={isRecording || !privateTargetId.trim()}
                                className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                            >
                                <span className="flex items-center justify-center gap-2">
                                    <Phone className="w-4 h-4" />
                                    發起通話
                                </span>
                            </button>
                        </>
                    ) : (
                        <div className="space-y-3">
                            <div className="text-sm">
                                <div className="text-gray-600">通話中</div>
                                <div className="font-medium">→ {privateTargetId}</div>
                                <div className="text-xs text-gray-500 mt-1">
                                    Call ID: {randomCallId}
                                </div>
                            </div>

                            {/* 音訊電平 */}
                            {isRecording && (
                                <div className="space-y-1">
                                    <div className="text-xs text-gray-600">音訊電平</div>
                                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-blue-500 transition-all duration-100"
                                            style={{ width: `${audioLevel * 100}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={endPrivateCall}
                                className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                            >
                                <span className="flex items-center justify-center gap-2">
                                    <PhoneOff className="w-4 h-4" />
                                    結束通話
                                </span>
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* 語音轉文字和自動斷句設定 */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
                <h4 className="font-semibold mb-3 flex items-center justify-between">
                    進階設定
                    {speechRecognitionEnabled && (
                        <span className="text-xs text-green-600 flex items-center gap-1">
                            <span className="w-2 h-2 bg-green-600 rounded-full animate-pulse"></span>
                            STT 運行中
                        </span>
                    )}
                </h4>

                <div className="space-y-3">
                    {/* 語音識別狀態 */}
                    <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs">
                        <div className="font-semibold mb-1">語音轉文字狀態</div>
                        <div className="text-gray-700">
                            {speechRecognitionEnabled ? (
                                <span className="text-green-600">✅ 語音識別已啟動</span>
                            ) : (
                                <span className="text-gray-500">⏸️ 語音識別未啟動</span>
                            )}
                        </div>
                    </div>

                    {/* 自動發送開關 */}
                    <div className="flex items-center justify-between">
                        <label className="text-sm text-gray-700">自動斷句發送</label>
                        <input
                            type="checkbox"
                            checked={autoSend}
                            onChange={(e) => setAutoSend(e.target.checked)}
                            className="w-4 h-4"
                        />
                    </div>

                    {/* 靜音閾值 */}
                    <div>
                        <label className="text-sm text-gray-700 block mb-1">
                            靜音閾值: {(silenceThreshold * 100).toFixed(0)}%
                        </label>
                        <input
                            type="range"
                            min="0"
                            max="0.1"
                            step="0.01"
                            value={silenceThreshold}
                            onChange={(e) => setSilenceThreshold(parseFloat(e.target.value))}
                            className="w-full"
                        />
                    </div>

                    {/* 靜音持續時間 */}
                    <div>
                        <label className="text-sm text-gray-700 block mb-1">
                            靜音持續時間: {(silenceDuration / 1000).toFixed(1)}秒
                        </label>
                        <input
                            type="range"
                            min="500"
                            max="3000"
                            step="100"
                            value={silenceDuration}
                            onChange={(e) => setSilenceDuration(parseInt(e.target.value))}
                            className="w-full"
                        />
                    </div>

                    <div className="text-xs text-gray-600">
                        啟用自動斷句後，系統會偵測靜音並自動發送語音片段
                    </div>
                </div>
            </div>

            {/* 使用說明 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-gray-700">
                <div className="font-semibold mb-1">使用說明</div>
                <ul className="space-y-1 list-disc list-inside">
                    <li>群組語音：點擊「開始發話」開始錄音，點擊「停止發話」結束並發送</li>
                    <li>私人通話：輸入目標 ID，點擊發起通話</li>
                    <li>通話中無法使用群組 PTT</li>
                    <li>自動斷句：可開啟後系統會根據靜音偵測自動分段發送（預設關閉）</li>
                    <li>語音轉文字：支援繁體中文即時轉換（需瀏覽器支援）</li>
                </ul>
            </div>
        </div>
    );
};

export default PTTAudio;
