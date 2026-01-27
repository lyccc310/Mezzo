import { useState, useRef, useEffect } from 'react';
import {
    Mic,
    MicOff,
    Phone,
    PhoneOff,
    Volume2,
    VolumeX,
    Radio,
    Wifi,
    Settings,
    Clock,
    Zap,
    Activity,
    Info,
    CheckCircle,
    XCircle,
    Loader2
} from 'lucide-react';
import { WebRTCManager } from '../utils/WebRTCManager';

interface PTTAudioProps {
    deviceId: string;
    channel: string;
    onAudioSend: (audioData: ArrayBuffer, isPrivate: boolean, targetId?: string, transcript?: string) => void;
    onSpeechToText?: (text: string) => void;
    ws?: WebSocket | null;
}

interface AudioPacket {
    id: string;
    type: 'speech' | 'private';
    channel: string;
    from: string;
    audioData: string;
    timestamp: string;
    randomId?: string;
}

const PTTAudio = ({ deviceId, channel, onAudioSend, onSpeechToText, ws }: PTTAudioProps) => {
    // 錄音狀態
    const [isRecording, setIsRecording] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [audioLevel, setAudioLevel] = useState(0);

    // PTT 搶麥狀態
    const [requestingMic, setRequestingMic] = useState(false);
    const [hasPermission, setHasPermission] = useState(false);
    const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null);

    // WebRTC 即時串流狀態
    const [streamingMode, setStreamingMode] = useState(true);
    const [isStreaming, setIsStreaming] = useState(false);

    // 私人通話狀態
    const [privateCallActive, setPrivateCallActive] = useState(false);
    const [privateTargetId, setPrivateTargetId] = useState('');
    const [randomCallId, setRandomCallId] = useState('');

    // 語音轉文字狀態
    const [autoSend, setAutoSend] = useState(false);
    const [silenceThreshold, setSilenceThreshold] = useState(0.02);
    const [silenceDuration, setSilenceDuration] = useState(1500);
    const [speechRecognitionEnabled, setSpeechRecognitionEnabled] = useState(false);
    const [currentTranscript, setCurrentTranscript] = useState('');

    // Refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const recognitionRef = useRef<any>(null);
    const isRecordingRef = useRef<boolean>(false);
    const finalTranscriptRef = useRef<string>('');

    // WebRTC Refs
    const webrtcManagerRef = useRef<WebRTCManager | null>(null);
    const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

    // 初始化音訊上下文和語音識別
    useEffect(() => {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();

        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = true;
            recognitionRef.current.interimResults = true;
            recognitionRef.current.lang = 'zh-TW';

            recognitionRef.current.onstart = () => {
                console.log('Speech recognition started');
                setSpeechRecognitionEnabled(true);
            };

            recognitionRef.current.onend = () => {
                console.log('Speech recognition ended');
                setSpeechRecognitionEnabled(false);

                if (isRecordingRef.current) {
                    setTimeout(() => {
                        try {
                            if (recognitionRef.current && isRecordingRef.current) {
                                recognitionRef.current.start();
                            }
                        } catch (err) {
                            console.warn('Auto-restart failed:', err);
                        }
                    }, 100);
                }
            };

            recognitionRef.current.onresult = (event: any) => {
                let interimTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        finalTranscriptRef.current += transcript;
                    } else {
                        interimTranscript += transcript;
                    }
                }

                const displayText = finalTranscriptRef.current + interimTranscript;
                setCurrentTranscript(displayText);

                if (onSpeechToText && displayText) {
                    onSpeechToText(displayText);
                }
            };

            recognitionRef.current.onerror = (event: any) => {
                console.error('Speech recognition error:', event.error);
                if (event.error === 'not-allowed') {
                    alert('請允許麥克風權限以使用語音轉文字功能');
                }
            };
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

            if (autoSend && !privateCallActive) {
                if (level < silenceThreshold) {
                    if (!silenceTimerRef.current) {
                        silenceTimerRef.current = setTimeout(() => {
                            stopGroupRecording();
                        }, silenceDuration);
                    }
                } else {
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

                if (data.type === 'ptt_speech_allow' && data.channel === channel) {
                    setRequestingMic(false);
                    setHasPermission(true);
                    actuallyStartRecording();
                }

                if (data.type === 'ptt_speech_deny' && data.channel === channel) {
                    setRequestingMic(false);
                    setHasPermission(false);
                    alert(`無法取得麥克風：${data.reason || '已有人在使用'}`);
                }

                if (data.type === 'ptt_mic_request' && data.channel === channel && data.currentSpeaker === deviceId) {
                    const accept = window.confirm(`${data.requester} 想要發言，是否讓出麥克風？`);
                    sendMicResponse(data.requester, accept);
                    if (accept) {
                        stopGroupRecording();
                    }
                }

                if (data.type === 'ptt_speaker_update' && data.channel === channel) {
                    if (data.action === 'start') {
                        setCurrentSpeaker(data.speaker);
                    } else if (data.action === 'stop') {
                        setCurrentSpeaker(null);
                    }
                }

                // WebRTC 信令處理
                if (data.type === 'webrtc_offer' && data.channel === channel && data.from !== deviceId) {
                    handleWebRTCOffer(data.from, data.offer);
                }

                if (data.type === 'webrtc_answer' && data.channel === channel && data.to === deviceId) {
                    handleWebRTCAnswer(data.answer);
                }

                if (data.type === 'webrtc_ice_candidate' && data.channel === channel &&
                    (data.to === deviceId || data.to === 'all')) {
                    handleWebRTCIceCandidate(data.candidate);
                }
            } catch (error) {
                // Ignore parse errors
            }
        };

        ws.addEventListener('message', handleMessage);
        return () => ws.removeEventListener('message', handleMessage);
    }, [ws, channel, deviceId]);

    // WebRTC 即時串流：開始發話
    const startWebRTCStreaming = async () => {
        try {
            webrtcManagerRef.current = new WebRTCManager(
                undefined,
                undefined,
                {
                    onIceCandidate: (candidate) => {
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
                        if (state === 'connected') {
                            setIsStreaming(true);
                        } else if (state === 'failed' || state === 'disconnected') {
                            setIsStreaming(false);
                        }
                    },
                    onError: (error) => {
                        console.error('WebRTC error:', error);
                        stopWebRTCStreaming();
                        alert('WebRTC 連線失敗，請稍後再試');
                    }
                }
            );

            const offer = await webrtcManagerRef.current.initializeAsSender();

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'webrtc_offer',
                    channel: channel,
                    from: deviceId,
                    to: 'all',
                    offer: offer
                }));
            }

            setIsRecording(true);
            isRecordingRef.current = true;

        } catch (error) {
            console.error('Failed to start WebRTC streaming:', error);
            alert('無法啟動即時串流，請檢查麥克風權限');
            stopWebRTCStreaming();
        }
    };

    const stopWebRTCStreaming = () => {
        if (webrtcManagerRef.current) {
            webrtcManagerRef.current.close();
            webrtcManagerRef.current = null;
        }

        setIsRecording(false);
        isRecordingRef.current = false;
        setIsStreaming(false);
        setAudioLevel(0);
        setHasPermission(false);
    };

    const handleWebRTCOffer = async (from: string, offer: RTCSessionDescriptionInit) => {
        try {
            webrtcManagerRef.current = new WebRTCManager(
                undefined,
                undefined,
                {
                    onRemoteStream: (stream) => {
                        if (!remoteAudioRef.current) {
                            remoteAudioRef.current = new Audio();
                            remoteAudioRef.current.autoplay = true;
                        }
                        remoteAudioRef.current.srcObject = stream;
                        remoteAudioRef.current.play().catch(err => {
                            console.error('Failed to play remote audio:', err);
                        });
                    },
                    onIceCandidate: (candidate) => {
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
                    onConnectionStateChange: (state) => {
                        console.log('Receiver connection state:', state);
                    },
                    onError: (error) => {
                        console.error('Receiver WebRTC error:', error);
                    }
                }
            );

            const answer = await webrtcManagerRef.current.initializeAsReceiver(offer);

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'webrtc_answer',
                    channel: channel,
                    from: deviceId,
                    to: from,
                    answer: answer
                }));
            }
        } catch (error) {
            console.error('Failed to handle WebRTC offer:', error);
        }
    };

    const handleWebRTCAnswer = async (answer: RTCSessionDescriptionInit) => {
        try {
            if (webrtcManagerRef.current) {
                await webrtcManagerRef.current.handleAnswer(answer);
            }
        } catch (error) {
            console.error('Failed to handle WebRTC answer:', error);
        }
    };

    const handleWebRTCIceCandidate = async (candidate: RTCIceCandidateInit) => {
        try {
            if (webrtcManagerRef.current) {
                await webrtcManagerRef.current.addIceCandidate(candidate);
            }
        } catch (error) {
            console.error('Failed to add ICE candidate:', error);
        }
    };

    const startGroupRecording = async () => {
        try {
            const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:4000' : `http://${window.location.hostname}:4000`;
            setRequestingMic(true);

            const tag = 'PTT_MSG_TYPE_SPEECH_START';
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

        } catch (error) {
            console.error('Failed to request PTT permission:', error);
            setRequestingMic(false);
            alert('無法請求發言權限');
        }
    };

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
        } catch (error) {
            console.error('Failed to send mic response:', error);
        }
    };

    const actuallyStartRecording = async () => {
        try {
            if (streamingMode) {
                await startWebRTCStreaming();
            } else {
                await startRecordingMode();
            }
        } catch (error) {
            console.error('Failed to start recording:', error);
            alert('無法存取麥克風，請確保已授予權限');
        }
    };

    const startRecordingMode = async () => {
        finalTranscriptRef.current = '';
        setCurrentTranscript('');

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 16000
            }
        });

        streamRef.current = stream;

        if (audioContextRef.current) {
            const source = audioContextRef.current.createMediaStreamSource(stream);
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 256;
            source.connect(analyserRef.current);
        }

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
            onAudioSend(arrayBuffer, false, undefined, undefined);

            audioChunksRef.current = [];
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
                streamRef.current = null;
            }
        };

        mediaRecorder.start(100);
        setIsRecording(true);
        isRecordingRef.current = true;
    };

    const stopGroupRecording = async () => {
        if (streamingMode) {
            stopWebRTCStreaming();
        } else {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
                mediaRecorderRef.current.stop();
                setIsRecording(false);
                isRecordingRef.current = false;
                setAudioLevel(0);

                if (silenceTimerRef.current) {
                    clearTimeout(silenceTimerRef.current);
                    silenceTimerRef.current = null;
                }
            }
        }

        setHasPermission(false);

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
        } catch (error) {
            console.error('Failed to send SPEECH_STOP:', error);
        }
    };

    const startPrivateCall = async () => {
        if (!privateTargetId.trim()) {
            alert('請輸入目標設備 ID');
            return;
        }

        const callTopicId = `PRIVATE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setRandomCallId(callTopicId);

        try {
            const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:4000' : `http://${window.location.hostname}:4000`;

            const tag = 'PRIVATE_SPK_REQ';
            const data = `${privateTargetId},${callTopicId}`;

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
            } else {
                throw new Error('Failed to send call request');
            }

        } catch (error) {
            console.error('Failed to start private call:', error);
            alert('發送通話請求失敗');
            setPrivateCallActive(false);
            setRandomCallId('');
        }
    };

    const endPrivateCall = async () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        isRecordingRef.current = false;

        try {
            const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:4000' : `http://${window.location.hostname}:4000`;

            const tag = 'PRIVATE_SPK_STOP';
            const data = privateTargetId;

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
        } catch (error) {
            console.error('Failed to send call stop:', error);
        }

        setPrivateCallActive(false);
        setRandomCallId('');
        setAudioLevel(0);
    };

    const toggleMute = () => {
        if (streamRef.current) {
            streamRef.current.getAudioTracks().forEach(track => {
                track.enabled = isMuted;
            });
            setIsMuted(!isMuted);
        }
    };

    return (
        <div className="space-y-3 bg-slate-900 p-4 rounded-xl">
            {/* 群組語音 PTT */}
            <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
                <h4 className="font-semibold text-sm text-slate-100 mb-3 flex items-center gap-2">
                    <Radio className="w-4 h-4 text-blue-400" />
                    群組語音 PTT
                </h4>

                <div className="space-y-3">
                    {/* 當前頻道 */}
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-400">目前頻道</span>
                        <span className="font-medium text-slate-200 font-mono">{channel}</span>
                    </div>

                    {/* 頻道狀態顯示 */}
                    {isRecording ? (
                        <div className="bg-red-950/50 border border-red-800/50 rounded-lg p-2.5">
                            <div className="flex items-center gap-2">
                                <Mic className="w-4 h-4 text-red-400 animate-pulse" />
                                <span className="text-sm font-medium text-red-300">您正在發話中</span>
                            </div>
                        </div>
                    ) : currentSpeaker && currentSpeaker !== deviceId ? (
                        <div className="bg-amber-950/50 border border-amber-800/50 rounded-lg p-2.5">
                            <div className="flex items-center gap-2">
                                <Mic className="w-4 h-4 text-amber-400 animate-pulse" />
                                <div className="text-sm">
                                    <span className="font-medium text-amber-300">{currentSpeaker}</span>
                                    <span className="text-amber-400/80"> 正在發話中</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-emerald-950/50 border border-emerald-800/50 rounded-lg p-2.5">
                            <div className="flex items-center gap-2">
                                <CheckCircle className="w-4 h-4 text-emerald-400" />
                                <span className="text-sm text-emerald-300">頻道空閒 - 可以發話</span>
                            </div>
                        </div>
                    )}

                    {/* 請求中狀態 */}
                    {requestingMic && !isRecording && (
                        <div className="bg-blue-950/50 border border-blue-800/50 rounded-lg p-2.5">
                            <div className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                                <span className="text-sm text-blue-300">正在請求發話權限...</span>
                            </div>
                        </div>
                    )}

                    {/* 模式切換 */}
                    <div className="flex items-center justify-between bg-slate-700/30 border border-slate-600/30 rounded-lg p-2.5">
                        <label className="text-sm font-medium text-slate-300 flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={streamingMode}
                                onChange={(e) => setStreamingMode(e.target.checked)}
                                disabled={isRecording}
                                className="sr-only"
                            />
                            <div className={`w-8 h-4 rounded-full transition-colors ${streamingMode ? 'bg-blue-600' : 'bg-slate-600'}`}>
                                <div className={`w-3 h-3 mt-0.5 rounded-full bg-white transition-transform ${streamingMode ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'}`} />
                            </div>
                            <span>即時串流模式</span>
                        </label>
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                            {streamingMode ? (
                                <>
                                    <Zap className="w-3 h-3 text-blue-400" />
                                    <span className="text-blue-400">低延遲 &lt; 100ms</span>
                                </>
                            ) : (
                                <>
                                    <Clock className="w-3 h-3" />
                                    <span>錄音模式</span>
                                </>
                            )}
                        </span>
                    </div>

                    {/* WebRTC 連線狀態 */}
                    {streamingMode && isStreaming && (
                        <div className="bg-emerald-950/30 border border-emerald-800/30 rounded-lg p-2">
                            <div className="flex items-center gap-2">
                                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-xs text-emerald-400 font-medium">WebRTC 連線中</span>
                            </div>
                        </div>
                    )}

                    {/* PTT 按鈕 */}
                    <button
                        onClick={() => {
                            if (isRecording && !privateCallActive) {
                                stopGroupRecording();
                            } else if (!privateCallActive) {
                                startGroupRecording();
                            }
                        }}
                        disabled={privateCallActive}
                        className={`w-full py-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
                            isRecording && !privateCallActive
                                ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/30'
                                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/30'
                        } disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed disabled:shadow-none`}
                    >
                        {isRecording && !privateCallActive ? (
                            <>
                                <MicOff className="w-5 h-5" />
                                <span>點擊停止發話</span>
                            </>
                        ) : (
                            <>
                                <Mic className="w-5 h-5" />
                                <span>點擊開始發話 (PTT)</span>
                            </>
                        )}
                    </button>

                    {/* 音訊電平指示器 */}
                    {isRecording && !privateCallActive && (
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-500 flex items-center gap-1">
                                    <Activity className="w-3 h-3" />
                                    音訊電平
                                </span>
                                <span className="text-slate-400 font-mono">{Math.round(audioLevel * 100)}%</span>
                            </div>
                            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-75"
                                    style={{ width: `${audioLevel * 100}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* 靜音按鈕 */}
                    <button
                        onClick={toggleMute}
                        disabled={!isRecording}
                        className={`w-full px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 border ${
                            isMuted
                                ? 'bg-red-950/50 text-red-400 border-red-800/50 hover:bg-red-900/50'
                                : 'bg-slate-700/50 text-slate-300 border-slate-600/50 hover:bg-slate-700'
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                        {isMuted ? (
                            <>
                                <VolumeX className="w-4 h-4" />
                                <span>已靜音</span>
                            </>
                        ) : (
                            <>
                                <Volume2 className="w-4 h-4" />
                                <span>靜音</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* 私人通話 */}
            <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
                <h4 className="font-semibold text-sm text-slate-100 mb-3 flex items-center gap-2">
                    <Phone className="w-4 h-4 text-emerald-400" />
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
                                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600/50 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50"
                            />
                            <button
                                onClick={startPrivateCall}
                                disabled={isRecording || !privateTargetId.trim()}
                                className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed"
                            >
                                <Phone className="w-4 h-4" />
                                發起通話
                            </button>
                        </>
                    ) : (
                        <div className="space-y-3">
                            <div className="bg-slate-700/30 rounded-lg p-3">
                                <div className="text-xs text-slate-500 mb-1">通話中</div>
                                <div className="font-medium text-slate-200 flex items-center gap-2">
                                    <Phone className="w-4 h-4 text-emerald-400 animate-pulse" />
                                    {privateTargetId}
                                </div>
                                <div className="text-xs text-slate-500 mt-1.5 font-mono">
                                    ID: {randomCallId}
                                </div>
                            </div>

                            {isRecording && (
                                <div className="space-y-1.5">
                                    <div className="text-xs text-slate-500 flex items-center gap-1">
                                        <Activity className="w-3 h-3" />
                                        音訊電平
                                    </div>
                                    <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-75"
                                            style={{ width: `${audioLevel * 100}%` }}
                                        />
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={endPrivateCall}
                                className="w-full px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                            >
                                <PhoneOff className="w-4 h-4" />
                                結束通話
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* 進階設定 */}
            <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-4">
                <h4 className="font-semibold text-sm text-slate-100 mb-3 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                        <Settings className="w-4 h-4 text-slate-400" />
                        進階設定
                    </span>
                    {speechRecognitionEnabled && (
                        <span className="text-xs text-emerald-400 flex items-center gap-1 font-normal">
                            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
                            STT 運作中
                        </span>
                    )}
                </h4>

                <div className="space-y-3">
                    {/* 語音識別狀態 */}
                    <div className="bg-slate-700/30 border border-slate-600/30 rounded-lg p-2.5 text-xs">
                        <div className="font-medium text-slate-400 mb-1">語音轉文字狀態</div>
                        <div className="flex items-center gap-1.5">
                            {speechRecognitionEnabled ? (
                                <>
                                    <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                                    <span className="text-emerald-400">語音識別已啟動</span>
                                </>
                            ) : (
                                <>
                                    <XCircle className="w-3.5 h-3.5 text-slate-500" />
                                    <span className="text-slate-500">語音識別未啟動</span>
                                </>
                            )}
                        </div>
                    </div>

                    {/* 自動發送開關 */}
                    <div className="flex items-center justify-between">
                        <label className="text-sm text-slate-400">自動斷句發送</label>
                        <label className="cursor-pointer">
                            <input
                                type="checkbox"
                                checked={autoSend}
                                onChange={(e) => setAutoSend(e.target.checked)}
                                className="sr-only"
                            />
                            <div className={`w-8 h-4 rounded-full transition-colors ${autoSend ? 'bg-blue-600' : 'bg-slate-600'}`}>
                                <div className={`w-3 h-3 mt-0.5 rounded-full bg-white transition-transform ${autoSend ? 'translate-x-4 ml-0.5' : 'translate-x-0.5'}`} />
                            </div>
                        </label>
                    </div>

                    {/* 靜音閾值 */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-sm text-slate-400">靜音閾值</label>
                            <span className="text-xs text-slate-500 font-mono">{(silenceThreshold * 100).toFixed(0)}%</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="0.1"
                            step="0.01"
                            value={silenceThreshold}
                            onChange={(e) => setSilenceThreshold(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500"
                        />
                    </div>

                    {/* 靜音持續時間 */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-sm text-slate-400">靜音持續時間</label>
                            <span className="text-xs text-slate-500 font-mono">{(silenceDuration / 1000).toFixed(1)} 秒</span>
                        </div>
                        <input
                            type="range"
                            min="500"
                            max="3000"
                            step="100"
                            value={silenceDuration}
                            onChange={(e) => setSilenceDuration(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500"
                        />
                    </div>

                    <div className="text-xs text-slate-500">
                        啟用自動斷句後，系統會偵測靜音並自動發送語音片段
                    </div>
                </div>
            </div>

            {/* 使用說明 */}
            <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
                    <Info className="w-3.5 h-3.5" />
                    <span className="font-medium">使用說明</span>
                </div>
                <ul className="space-y-1 text-xs text-slate-500">
                    <li className="flex items-start gap-1.5">
                        <Zap className="w-3 h-3 text-blue-400 mt-0.5 shrink-0" />
                        <span><strong className="text-slate-400">即時串流模式</strong>：使用 WebRTC 即時傳輸，延遲 &lt; 100ms（預設）</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                        <Clock className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />
                        <span><strong className="text-slate-400">錄音模式</strong>：錄完後發送，適合語音訊息</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                        <Radio className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />
                        <span>群組語音：點擊按鈕開始/停止發話</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                        <Phone className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />
                        <span>私人通話：輸入目標 ID，點擊發起通話</span>
                    </li>
                </ul>
            </div>
        </div>
    );
};

export default PTTAudio;
