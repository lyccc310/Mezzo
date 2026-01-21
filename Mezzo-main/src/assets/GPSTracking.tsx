import React, { useState, useEffect, useRef } from 'react';
import CameraMap from './CameraMap';
import VideoPlayer from './VideoPlayer';
import PTTAudio from './PTTAudio';
import { getFullStreamUrl } from '../config/api';
import { Device, Message } from '../types';
import { MapPin, Video, Wifi, Activity, Clock, Send, Users, MessageSquare, Radio, AlertCircle, Mic } from 'lucide-react';

// ===== 配置 =====
const API_CONFIG = {
    baseUrl: (() => {
        const hostname = window.location.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'http://localhost:4000';
        }
        return `http://${hostname}:4000`;
    })(),
};

const WS_URL = API_CONFIG.baseUrl.replace('http', 'ws').replace(':4000', ':4001');

console.log('📡 GPSTracking API Config:', API_CONFIG.baseUrl);
console.log('📡 GPSTracking WebSocket:', WS_URL);

interface GPSTrackingProps {
    userName?: string;
}

const GPSTracking: React.FC<GPSTrackingProps> = ({ userName }) => {
    const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
    const [devices, setDevices] = useState<Device[]>([]);
    const [wsConnected, setWsConnected] = useState(false);

    // ===== 通訊相關狀態 =====
    const [messages, setMessages] = useState<Message[]>([]);
    const [messageText, setMessageText] = useState('');
    const [showCommunication, setShowCommunication] = useState(false);
    const [selectedGroup, setSelectedGroup] = useState<string>('all');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // ===== PTT 控制狀態 =====
    const [showPTTControl, setShowPTTControl] = useState(false);
    const [pttChannel, setPttChannel] = useState('channel1');
    // 使用登入時的 userName，如果沒有則生成隨機 ID
    const pttDeviceId = userName || `USER-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const [gpsLat, setGpsLat] = useState('25.033964');
    const [gpsLon, setGpsLon] = useState('121.564472');
    const [sosLat, setSosLat] = useState('25.033964');
    const [sosLon, setSosLon] = useState('121.564472');
    const [broadcastMsg, setBroadcastMsg] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [pttStatus, setPttStatus] = useState('');
    const [pttStatusType, setPttStatusType] = useState<'success' | 'error' | 'info'>('info');
    const [selectedPTTFunction, setSelectedPTTFunction] = useState('');

    // ===== 使用 useRef 保存 WebSocket 和重連計時器 =====
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptsRef = useRef(0);

    // ===== 提取設備群組 =====
    const deviceGroups = Array.from(
        new Set(devices.map((d) => d.group || '未分組').filter(Boolean))
    );

    // ===== 提取 PTT 頻道列表 (包含固定頻道和動態群組) =====
    const pttChannels = Array.from(
        new Set([
            'channel1',
            'channel2',
            'channel3',
            'emergency',
            ...deviceGroups.filter(g => g !== '未分組')
        ])
    );

    // ===== PTT 功能列表 =====
    const pttFunctions = [
        { value: '', label: '請選擇 PTT 功能...' },
        { value: 'gps', label: '📍 GPS 位置發送' },
        { value: 'sos', label: '🆘 SOS 緊急警報' },
        { value: 'broadcast', label: '📢 廣播訊息' },
        { value: 'recording', label: '📹 錄影控制' },
        { value: 'audio', label: '🎙️ 語音通話' },
    ];

    // ===== PTT 函數 =====
    const showPTTStatus = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
        setPttStatus(msg);
        setPttStatusType(type);
        setTimeout(() => setPttStatus(''), 5000);
    };

    const createPTTMessage = (tag: string, uuid: string, data: string): number[] => {
        const tagBuffer = new Uint8Array(32);
        const tagBytes = new TextEncoder().encode(tag);
        tagBuffer.set(tagBytes.slice(0, 32));

        const uuidBuffer = new Uint8Array(128);
        const uuidBytes = new TextEncoder().encode(uuid);
        uuidBuffer.set(uuidBytes.slice(0, 128));

        const dataBytes = new TextEncoder().encode(data);
        const combined = new Uint8Array(160 + dataBytes.length);
        combined.set(tagBuffer, 0);
        combined.set(uuidBuffer, 32);
        combined.set(dataBytes, 160);

        return Array.from(combined);
    };

    // ===== PTT 通訊訊息發送 =====
    const sendPTTMessage = async (channel: string, text: string) => {
        try {
            const topic = `/WJI/PTT/${channel}/CHANNEL_ANNOUNCE`;
            const tag = 'TEXT_MESSAGE'; // 自定義 tag 用於文字訊息
            const message = createPTTMessage(tag, pttDeviceId, text);

            const response = await fetch(`${API_CONFIG.baseUrl}/ptt/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic, message, encoding: 'binary' })
            });

            if (response.ok) {
                console.log('💬 PTT Message sent:', { topic, text });
                return true;
            } else {
                throw new Error('Failed to send PTT message');
            }
        } catch (error) {
            console.error('❌ Send PTT Message error:', error);
            return false;
        }
    };

    const sendPTTGPS = async () => {
        try {
            const topic = `/WJI/PTT/${pttChannel}/GPS`;
            const data = `${pttDeviceId},${gpsLat},${gpsLon}`;
            const message = createPTTMessage('GPS', pttDeviceId, data);

            const response = await fetch(`${API_CONFIG.baseUrl}/ptt/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic, message, encoding: 'binary' })
            });

            if (response.ok) {
                showPTTStatus(`✅ GPS 已發送至 ${topic}`, 'success');
                console.log('📍 PTT GPS sent:', { topic, lat: gpsLat, lon: gpsLon });

                // 在通訊面板顯示 GPS 發送通知
                const notificationMessage: Message = {
                    id: `gps-${Date.now()}`,
                    from: pttDeviceId,
                    to: `group:${pttChannel}`,
                    text: `📍 發送了位置資訊 (${gpsLat}, ${gpsLon})`,
                    timestamp: new Date().toISOString(),
                    priority: 3
                };
                setMessages(prev => [...prev, notificationMessage]);
            } else {
                throw new Error('Failed to send GPS');
            }
        } catch (error) {
            console.error('❌ Send PTT GPS error:', error);
            showPTTStatus('❌ 發送 GPS 失敗', 'error');
        }
    };

    const sendPTTSOS = async () => {
        try {
            const topic = `/WJI/PTT/${pttChannel}/SOS`;
            const data = `${sosLat},${sosLon}`;
            const message = createPTTMessage('SOS', pttDeviceId, data);

            const response = await fetch(`${API_CONFIG.baseUrl}/ptt/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic, message, encoding: 'binary' })
            });

            if (response.ok) {
                showPTTStatus(`🆘 SOS 警報已發送至 ${topic}`, 'success');
                console.log('🆘 PTT SOS sent:', { topic, lat: sosLat, lon: sosLon });

                // 在通訊面板顯示 SOS 緊急通知
                const sosNotification: Message = {
                    id: `sos-${Date.now()}`,
                    from: pttDeviceId,
                    to: `group:${pttChannel}`,
                    text: `🆘 發送了緊急求救訊號！位置: (${sosLat}, ${sosLon})`,
                    timestamp: new Date().toISOString(),
                    priority: 1
                };
                setMessages(prev => [...prev, sosNotification]);
            } else {
                throw new Error('Failed to send SOS');
            }
        } catch (error) {
            console.error('❌ Send PTT SOS error:', error);
            showPTTStatus('❌ 發送 SOS 失敗', 'error');
        }
    };

    const sendPTTBroadcast = async () => {
        if (!broadcastMsg.trim()) {
            showPTTStatus('⚠️ 請輸入訊息內容', 'error');
            return;
        }

        try {
            const topic = `/WJI/PTT/${pttChannel}/CHANNEL_ANNOUNCE`;
            const message = createPTTMessage('BROADCAST', pttDeviceId, broadcastMsg);

            const response = await fetch(`${API_CONFIG.baseUrl}/ptt/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic, message, encoding: 'binary' })
            });

            if (response.ok) {
                showPTTStatus(`📢 廣播訊息已發送`, 'success');
                console.log('📢 PTT Broadcast sent:', { topic, message: broadcastMsg });

                // 在通訊面板顯示廣播訊息
                const broadcastNotification: Message = {
                    id: `broadcast-${Date.now()}`,
                    from: pttDeviceId,
                    to: `group:${pttChannel}`,
                    text: `📢 ${broadcastMsg}`,
                    timestamp: new Date().toISOString(),
                    priority: 3
                };
                setMessages(prev => [...prev, broadcastNotification]);

                setBroadcastMsg('');
            } else {
                throw new Error('Failed to send broadcast');
            }
        } catch (error) {
            console.error('❌ Send PTT Broadcast error:', error);
            showPTTStatus('❌ 發送廣播失敗', 'error');
        }
    };

    const toggleRecording = async () => {
        try {
            const topic = `/WJI/PTT/${pttChannel}/MARK`;
            const tag = isRecording ? 'MARK_STOP' : 'MARK_START';
            const message = createPTTMessage(tag, pttDeviceId, '');

            const response = await fetch(`${API_CONFIG.baseUrl}/ptt/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic, message, encoding: 'binary' })
            });

            if (response.ok) {
                const newState = !isRecording;
                setIsRecording(newState);
                const statusText = newState ? '📹 錄影已開始' : '⏹️ 錄影已停止';
                showPTTStatus(statusText, 'success');
                console.log('📹 PTT Recording:', newState);

                // 在通訊面板顯示錄影狀態
                const recordingNotification: Message = {
                    id: `recording-${Date.now()}`,
                    from: pttDeviceId,
                    to: `group:${pttChannel}`,
                    text: statusText,
                    timestamp: new Date().toISOString(),
                    priority: 3
                };
                setMessages(prev => [...prev, recordingNotification]);
            } else {
                throw new Error('Failed to toggle recording');
            }
        } catch (error) {
            console.error('❌ Toggle PTT Recording error:', error);
            showPTTStatus('❌ 錄影控制失敗', 'error');
        }
    };

    // ===== 音訊發送函數 =====
    const handleAudioSend = async (audioData: ArrayBuffer, isPrivate: boolean, targetId?: string, transcript?: string) => {
        try {
            // 將音訊數據轉換為數組
            const audioArray = Array.from(new Uint8Array(audioData));

            let topic: string;
            let tag: string;

            if (isPrivate && targetId) {
                // 私人通話
                topic = `/WJI/PTT/${pttChannel}/PRIVATE/${targetId}`;
                tag = 'PRIVATE_AUDIO';
            } else {
                // 群組語音
                topic = `/WJI/PTT/${pttChannel}/SPEECH`;
                tag = 'SPEECH_AUDIO';
            }

            // 創建 PTT 訊息（Tag + UUID + AudioData）
            const tagBuffer = new Uint8Array(32);
            const tagBytes = new TextEncoder().encode(tag);
            tagBuffer.set(tagBytes.slice(0, 32));

            const uuidBuffer = new Uint8Array(128);
            const uuidBytes = new TextEncoder().encode(pttDeviceId);
            uuidBuffer.set(uuidBytes.slice(0, 128));

            const audioBytes = new Uint8Array(audioData);
            const combined = new Uint8Array(160 + audioBytes.length);
            combined.set(tagBuffer, 0);
            combined.set(uuidBuffer, 32);
            combined.set(audioBytes, 160);

            const message = Array.from(combined);

            // 發送到後端（包含轉錄文字）
            const response = await fetch(`${API_CONFIG.baseUrl}/ptt/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic,
                    message,
                    encoding: 'binary',
                    transcript: transcript || ''  // 新增轉錄文字
                })
            });

            if (response.ok) {
                const typeText = isPrivate ? '📞 私人通話' : '🎙️ 群組語音';
                const transcriptInfo = transcript ? ` | 文字: "${transcript}"` : '';
                showPTTStatus(`${typeText} 已發送 (${audioData.byteLength} bytes)${transcriptInfo}`, 'success');
                console.log(`${typeText} sent:`, { topic, size: audioData.byteLength, transcript });
            } else {
                throw new Error('Failed to send audio');
            }
        } catch (error) {
            console.error('❌ Send audio error:', error);
            showPTTStatus('❌ 音訊發送失敗', 'error');
        }
    };

    // ===== 音訊播放函數 =====
    const handleAudioPlayback = async (packet: any) => {
        try {
            console.log('🔊 Playing audio from:', packet.from, 'Type:', packet.type);

            // 如果是自己發送的，不播放音訊（避免聽到自己的聲音）
            if (packet.from === pttDeviceId) {
                console.log('⏭️ Skipping own audio playback');
                // 不創建訊息，因為 ptt_transcript 會處理帶有文字的訊息
                // 避免重複
                return;
            }

            // 解碼 base64 音訊數據
            const audioData = atob(packet.audioData);
            const audioBytes = new Uint8Array(audioData.length);
            for (let i = 0; i < audioData.length; i++) {
                audioBytes[i] = audioData.charCodeAt(i);
            }

            // 創建 Blob 並播放 - 指定完整的 MIME type
            const audioBlob = new Blob([audioBytes], { type: 'audio/webm;codecs=opus' });
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);

            // 播放音訊
            audio.play().then(() => {
                console.log('✅ Audio playing');
                showPTTStatus(`🔊 正在播放來自 ${packet.from} 的語音`, 'info');
            }).catch(err => {
                console.error('❌ Audio play error:', err);
                // 嘗試使用不同的 MIME type
                console.log('🔄 Trying fallback audio format...');
                const fallbackBlob = new Blob([audioBytes], { type: 'audio/ogg;codecs=opus' });
                const fallbackUrl = URL.createObjectURL(fallbackBlob);
                const fallbackAudio = new Audio(fallbackUrl);

                fallbackAudio.play().then(() => {
                    console.log('✅ Audio playing (fallback format)');
                    showPTTStatus(`🔊 正在播放來自 ${packet.from} 的語音`, 'info');
                }).catch(err2 => {
                    console.error('❌ Audio play error (fallback):', err2);
                    showPTTStatus('❌ 音訊播放失敗 - 格式不支援', 'error');
                    URL.revokeObjectURL(fallbackUrl);
                });

                fallbackAudio.onended = () => {
                    URL.revokeObjectURL(fallbackUrl);
                };
            });

            // 清理資源
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                console.log('✅ Audio playback finished');
            };

            // 不在這裡創建訊息，因為 ptt_transcript 會處理
            // 如果有文字轉錄，會由 ptt_transcript 處理
            // 避免重複訊息

        } catch (error) {
            console.error('❌ Audio playback error:', error);
            showPTTStatus('❌ 音訊播放失敗', 'error');
        }
    };

    // ===== 語音轉文字處理函數（只用於即時顯示，不發送訊息）=====
    const handleSpeechToText = (transcript: string) => {
        // 只記錄日誌，不做任何操作
        // 最終的 transcript 會在停止錄音時隨音訊一起發送
        console.log('📝 Real-time transcription (display only):', transcript);
    };

    // ===== WebSocket 連接（改良版）=====
    useEffect(() => {
        const connectWebSocket = () => {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }

            try {
                console.log(`🔌 Connecting to WebSocket: ${WS_URL} (Attempt ${reconnectAttemptsRef.current + 1})`);
                const ws = new WebSocket(WS_URL);
                wsRef.current = ws;

                ws.onopen = () => {
                    console.log('✅ WebSocket connected');
                    setWsConnected(true);
                    reconnectAttemptsRef.current = 0;

                    // 註冊設備 ID（用於私人通話）
                    ws.send(JSON.stringify({
                        type: 'register_device',
                        deviceId: pttDeviceId
                    }));
                    console.log(`📱 Registering device: ${pttDeviceId}`);

                    ws.send(JSON.stringify({ type: 'request_devices' }));

                    const heartbeat = setInterval(() => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({ type: 'ping' }));
                        }
                    }, 30000);

                    (ws as any).heartbeatInterval = heartbeat;
                };

                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === 'pong') return;

                        console.log('📨 WebSocket message:', data.type);

                        if (data.type === 'initial_state' && data.devices) {
                            console.log(`📋 Initial devices: ${data.devices.length}`);
                            setDevices(data.devices);
                            if (data.devices.length > 0 && !selectedDevice) {
                                setSelectedDevice(data.devices[0]);
                            }
                        }

                        if (data.type === 'devices_update' && data.devices) {
                            console.log(`📋 Devices update: ${data.devices.length}`);
                            setDevices(data.devices);
                        }

                        if (data.type === 'device_update' && data.device) {
                            console.log(`📱 Device update: ${data.device.id}`);
                            setDevices((prev) => {
                                const index = prev.findIndex((d) => d.id === data.device.id);
                                if (index !== -1) {
                                    const updated = [...prev];
                                    updated[index] = data.device;
                                    return updated;
                                } else {
                                    return [...prev, data.device];
                                }
                            });

                            setSelectedDevice((current) => {
                                if (current && current.id === data.device.id) {
                                    return data.device;
                                }
                                return current;
                            });
                        }

                        if (data.type === 'device_added' && data.device) {
                            console.log(`➕ Device added: ${data.device.id}`);
                            setDevices((prev) => {
                                if (prev.find((d) => d.id === data.device.id)) {
                                    return prev;
                                }
                                const newDevices = [...prev, data.device];
                                if (newDevices.length === 1) {
                                    setSelectedDevice(data.device);
                                }
                                return newDevices;
                            });
                        }

                        if (data.type === 'device_removed' && data.deviceId) {
                            console.log(`➖ Device removed: ${data.deviceId}`);
                            setDevices((prev) => prev.filter((d) => d.id !== data.deviceId));
                            setSelectedDevice((current) => {
                                if (current && current.id === data.deviceId) {
                                    return null;
                                }
                                return current;
                            });
                        }

                        if (data.type === 'messages_history' && data.messages) {
                            console.log(`📜 Messages history: ${data.messages.length}`);
                            setMessages(data.messages);
                        }

                        // 處理 PTT 訊息廣播 (統一處理所有 PTT 訊息)
                        if (data.type === 'ptt_broadcast' && data.message) {
                            console.log('💬 Received PTT broadcast:', data.message);
                            setMessages((prev) => {
                                // 避免重複訊息
                                if (prev.find(m => m.id === data.message.id)) {
                                    return prev;
                                }
                                return [...prev, data.message];
                            });
                        }

                        // 處理 PTT 音訊封包
                        if (data.type === 'ptt_audio' && data.packet) {
                            console.log('🎙️ Received PTT audio:', data.packet);
                            handleAudioPlayback(data.packet);
                        }

                        // 處理 PTT 轉錄文字
                        if (data.type === 'ptt_transcript' && data.message) {
                            console.log('📝 Received PTT transcript:', data.message);
                            setMessages((prev) => {
                                // 避免重複訊息
                                if (prev.find(m => m.id === data.message.id)) {
                                    return prev;
                                }
                                return [...prev, data.message];
                            });
                        }

                        // 處理 PTT GPS 更新
                        if (data.type === 'device_update' && data.device && data.device.source?.includes('ptt')) {
                            const device = data.device;
                            // 過濾掉無效的 GPS 座標 (0,0) 避免洗版
                            const isValidGPS = device.position.lat !== 0 || device.position.lng !== 0;

                            // 跳過自己發送的 GPS 更新（避免重複顯示，因為 sendPTTGPS 已經添加過本地通知）
                            if (isValidGPS && device.id !== pttDeviceId) {
                                const gpsNotification: Message = {
                                    id: `gps-update-${Date.now()}`,
                                    from: device.id,
                                    to: `group:${device.group || 'PTT'}`,
                                    text: `📍 更新了位置資訊 (${device.position.lat.toFixed(6)}, ${device.position.lng.toFixed(6)})`,
                                    timestamp: new Date().toISOString(),
                                    priority: 3
                                };
                                setMessages((prev) => [...prev, gpsNotification]);
                            } else if (!isValidGPS) {
                                console.log('⏭️ Skipping invalid GPS update (0,0) from', device.id);
                            } else {
                                console.log('⏭️ Skipping own GPS update from', pttDeviceId);
                            }
                        }

                        // 處理 SOS 警報
                        if (data.type === 'sos_alert' && data.event) {
                            const event = data.event;
                            const sosAlert: Message = {
                                id: `sos-alert-${Date.now()}`,
                                from: event.deviceId || event.id,
                                to: `group:${event.group || 'PTT'}`,
                                text: `🆘 緊急求救！位置: (${event.position.lat.toFixed(6)}, ${event.position.lng.toFixed(6)})`,
                                timestamp: event.timestamp,
                                priority: 1
                            };
                            setMessages((prev) => [...prev, sosAlert]);
                        }

                        // 處理錄影標記
                        if (data.type === 'ptt_mark' && data.event) {
                            const event = data.event;
                            const action = event.action === 'start' ? '📹 開始錄影' : '⏹️ 停止錄影';
                            const markNotification: Message = {
                                id: `mark-${Date.now()}`,
                                from: event.deviceId,
                                to: `group:${event.channel || 'PTT'}`,
                                text: action,
                                timestamp: event.timestamp,
                                priority: 3
                            };
                            setMessages((prev) => [...prev, markNotification]);
                        }

                        // 處理私人通話請求
                        if (data.type === 'private_call_request') {
                            console.log('📞 Incoming private call from:', data.from);
                            const accept = window.confirm(`收到來自 ${data.from} 的通話請求，是否接受？`);
                            if (accept) {
                                // TODO: 通知 PTTAudio 組件接受通話
                                showPTTStatus(`📞 已接受來自 ${data.from} 的通話`, 'success');
                            } else {
                                showPTTStatus(`📞 已拒絕來自 ${data.from} 的通話`, 'info');
                            }
                        }

                        // 處理私人通話結束
                        if (data.type === 'private_call_stop') {
                            console.log('📞 Private call ended by:', data.from);
                            showPTTStatus(`📞 ${data.from} 已結束通話`, 'info');
                            // TODO: 通知 PTTAudio 組件結束通話
                        }

                        if (data.type === 'mqtt_message' && data.topic && data.data) {
                            console.log('📡 MQTT message:', data.topic);
                        }
                    } catch (error) {
                        console.error('❌ WebSocket message parse error:', error);
                    }
                };

                ws.onerror = (error) => {
                    console.error('❌ WebSocket error:', error);
                };

                ws.onclose = (event) => {
                    console.log('🔌 WebSocket disconnected', {
                        code: event.code,
                        reason: event.reason || 'No reason provided',
                        wasClean: event.wasClean
                    });
                    
                    setWsConnected(false);

                    if ((ws as any).heartbeatInterval) {
                        clearInterval((ws as any).heartbeatInterval);
                    }

                    if (event.code !== 1000) {
                        reconnectAttemptsRef.current++;
                        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
                        console.log(`🔄 Reconnecting in ${delay / 1000}s...`);
                        reconnectTimerRef.current = setTimeout(() => {
                            connectWebSocket();
                        }, delay);
                    }
                };
            } catch (error) {
                console.error('❌ WebSocket connection error:', error);
                setWsConnected(false);
            }
        };

        connectWebSocket();

        return () => {
            console.log('🧹 Cleaning up WebSocket');
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            if (wsRef.current) {
                wsRef.current.close(1000, 'Component unmounted');
                wsRef.current = null;
            }
        };
    }, []);

    // ===== 定期從 API 重新載入設備（備用）=====
    useEffect(() => {
        if (wsConnected) {
            console.log('✅ WebSocket active, skipping API polling');
            return;
        }

        console.log('⚠️ WebSocket inactive, starting API polling');

        const loadDevices = async () => {
            try {
                const response = await fetch(`${API_CONFIG.baseUrl}/devices`);
                if (response.ok) {
                    const data = await response.json();
                    console.log(`📋 Loaded ${data.devices?.length || 0} devices from API`);
                    setDevices(data.devices || []);
                }
            } catch (error) {
                console.error('❌ Failed to load devices from API:', error);
            }
        };

        loadDevices();
        const interval = setInterval(loadDevices, 10000);

        return () => {
            console.log('🧹 Stopping API polling');
            clearInterval(interval);
        };
    }, [wsConnected]);

    // ===== 發送訊息 (使用 PTT MQTT) =====
    const handleSendMessage = async () => {
        if (!messageText.trim()) return;

        try {
            // 決定要發送到哪個頻道
            let channel = pttChannel; // 預設使用當前 PTT 頻道

            // 如果選擇了特定群組，使用該群組名稱作為頻道
            if (selectedGroup !== 'all') {
                channel = selectedGroup;
            }

            // 使用 PTT MQTT 發送訊息
            const success = await sendPTTMessage(channel, messageText);

            if (success) {
                // 本地顯示已發送的訊息
                const localMessage: Message = {
                    id: `msg-${Date.now()}`,
                    from: 'COMMAND_CENTER',
                    to: selectedGroup === 'all' ? 'all' : `group:${selectedGroup}`,
                    text: messageText,
                    timestamp: new Date().toISOString(),
                    priority: 3
                };

                setMessages(prev => [...prev, localMessage]);
                setMessageText('');

                showPTTStatus(`✅ 訊息已發送至頻道 ${channel}`, 'success');
            } else {
                showPTTStatus('❌ 發送訊息失敗', 'error');
            }
        } catch (error) {
            console.error('❌ Send message error:', error);
            showPTTStatus('❌ 發送訊息失敗', 'error');
        }
    };

    // ===== 處理地圖選擇設備 =====
    const handleDeviceSelect = (device: Device) => {
        console.log('📍 Device selected from map:', device.id);
        setSelectedDevice(device);
    };

    // ===== 處理設備列表點擊 =====
    const handleDeviceClick = (device: Device) => {
        console.log('📍 Device selected from list:', device.id);
        setSelectedDevice(device);
    };

    // ===== 格式化時間 =====
    const formatLastUpdate = (timestamp?: string) => {
        if (!timestamp) return '未知';

        try {
            const now = new Date();
            const update = new Date(timestamp);
            const diff = now.getTime() - update.getTime();

            if (diff < 0) return '剛剛';
            if (diff < 60000) return '剛剛';
            if (diff < 3600000) return `${Math.floor(diff / 60000)} 分鐘前`;
            if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小時前`;
            return update.toLocaleDateString('zh-TW');
        } catch {
            return '未知';
        }
    };

    // ===== 格式化訊息時間 =====
    const formatMessageTime = (timestamp: string) => {
        try {
            const date = new Date(timestamp);
            return date.toLocaleTimeString('zh-TW', {
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return '--:--';
        }
    };

    // ===== 渲染 PTT 功能內容 =====
    const renderPTTFunctionContent = () => {
        if (selectedPTTFunction === 'gps') {
            return (
                <div className="border border-green-200 rounded-lg p-4 space-y-3 bg-green-50">
                    <div className="flex items-center gap-2 text-base font-semibold text-green-700">
                        <MapPin className="w-5 h-5" />
                        GPS 位置發送
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">緯度</label>
                            <input
                                type="text"
                                value={gpsLat}
                                onChange={(e) => setGpsLat(e.target.value)}
                                placeholder="25.033964"
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">經度</label>
                            <input
                                type="text"
                                value={gpsLon}
                                onChange={(e) => setGpsLon(e.target.value)}
                                placeholder="121.564472"
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                            />
                        </div>
                    </div>
                    <button onClick={sendPTTGPS} className="w-full bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-3 rounded-lg flex items-center justify-center gap-2">
                        <MapPin className="w-4 h-4" />
                        發送 GPS 位置
                    </button>
                </div>
            );
        }

        if (selectedPTTFunction === 'sos') {
            return (
                <div className="border border-red-300 rounded-lg p-4 space-y-3 bg-red-50">
                    <div className="flex items-center gap-2 text-base font-semibold text-red-700">
                        <AlertCircle className="w-5 h-5" />
                        SOS 緊急警報
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">緯度</label>
                            <input
                                type="text"
                                value={sosLat}
                                onChange={(e) => setSosLat(e.target.value)}
                                placeholder="25.033964"
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">經度</label>
                            <input
                                type="text"
                                value={sosLon}
                                onChange={(e) => setSosLon(e.target.value)}
                                placeholder="121.564472"
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500"
                            />
                        </div>
                    </div>
                    <button onClick={sendPTTSOS} className="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-3 rounded-lg flex items-center justify-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        發送 SOS 警報
                    </button>
                </div>
            );
        }

        if (selectedPTTFunction === 'broadcast') {
            return (
                <div className="border border-blue-200 rounded-lg p-4 space-y-3 bg-blue-50">
                    <div className="flex items-center gap-2 text-base font-semibold text-blue-700">
                        <MessageSquare className="w-4 h-4" />
                        廣播訊息
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">訊息內容</label>
                        <textarea
                            value={broadcastMsg}
                            onChange={(e) => setBroadcastMsg(e.target.value)}
                            placeholder="輸入要廣播的訊息..."
                            rows={3}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <button onClick={sendPTTBroadcast} className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-3 rounded-lg flex items-center justify-center gap-2">
                        <Send className="w-4 h-4" />
                        發送廣播訊息
                    </button>
                </div>
            );
        }

        if (selectedPTTFunction === 'recording') {
            return (
                <div className="border border-purple-200 rounded-lg p-4 space-y-3 bg-purple-50">
                    <div className="flex items-center gap-2 text-base font-semibold text-purple-700">
                        <Video className="w-5 h-5" />
                        錄影控制
                    </div>
                    <button
                        onClick={toggleRecording}
                        className={`w-full text-white text-sm font-semibold py-3 rounded-lg flex items-center justify-center gap-2 ${isRecording ? 'bg-gray-600 hover:bg-gray-700' : 'bg-purple-600 hover:bg-purple-700'}`}
                    >
                        <Video className="w-4 h-4" />
                        {isRecording ? '⏹️ 停止錄影' : '📹 開始錄影'}
                    </button>
                    {isRecording && (
                        <div className="flex items-center justify-center gap-2 text-red-600 bg-red-50 py-2 rounded-lg">
                            <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                            <span className="text-sm font-medium">錄影進行中...</span>
                        </div>
                    )}
                </div>
            );
        }

        if (selectedPTTFunction === 'audio') {
            return (
                <div className="border border-purple-200 rounded-lg p-4 bg-purple-50">
                    <PTTAudio
                        deviceId={pttDeviceId}
                        channel={pttChannel}
                        onAudioSend={handleAudioSend}
                        onSpeechToText={handleSpeechToText}
                    />
                </div>
            );
        }

        return null;
    };

    // ===== 篩選相關訊息 =====
    const relevantMessages = messages.filter((msg) => {
        // 如果選擇了特定群組，只顯示該群組的訊息
        if (selectedGroup !== 'all') {
            return (
                msg.to === 'all' ||
                msg.to === `group:${selectedGroup}` ||
                msg.from === selectedGroup
            );
        }

        // 如果選擇了特定設備，顯示該設備相關的訊息
        if (selectedDevice) {
            return (
                msg.to === 'all' ||
                msg.to === `device:${selectedDevice.id}` ||
                msg.from === selectedDevice.id ||
                (selectedDevice.group && msg.to === `group:${selectedDevice.group}`)
            );
        }

        // 預設顯示所有訊息
        return msg.to === 'all';
    });

    // ===== 自動滾動到最新訊息 =====
    // 使用 ref 來追蹤上一次的訊息數量
    const prevMessagesLengthRef = useRef(messages.length);

    useEffect(() => {
        // 只在通訊面板開啟時，且訊息數量真的增加時才滾動
        if (showCommunication && messagesEndRef.current && messages.length > prevMessagesLengthRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
        prevMessagesLengthRef.current = messages.length;
    }, [messages.length, showCommunication]);

    return (
        <div className="flex overflow-auto bg-gray-100">
            {/* 左側：地圖 (50%) - 固定 */}
            <div className="w-1/2 h-full">
                <CameraMap
                    devices={devices}
                    wsStatus={wsConnected ? 'connected' : 'disconnected'}
                    onDeviceSelect={handleDeviceSelect}
                />
            </div>

            {/* 右側：設備資訊面板 (50%) - 獨立滾動 */}
            <div className="w-1/2 h-full flex flex-col border-l border-gray-200 overflow-hidden">
                {/* 固定的狀態欄和按鈕 */}
                <div className="flex-shrink-0 bg-white border-b border-gray-200">
                    {/* 狀態欄 */}
                    <div className="px-4 py-2 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                                <span className="text-xs font-medium text-gray-700">
                                    {wsConnected ? 'WebSocket 已連接' : 'WebSocket 未連接'}
                                </span>
                            </div>
                            <div className="text-xs text-gray-500">
                                設備總數: {devices.length}
                            </div>
                        </div>
                    </div>

                    {/* 固定按鈕 */}
                    <div className="px-4 py-2 flex gap-2 border-t border-gray-100">
                        <button
                            onClick={() => {
                                setShowCommunication(!showCommunication);
                                if (!showCommunication) setShowPTTControl(false);
                            }}
                            className={`text-xs px-3 py-1.5 rounded flex items-center gap-1 transition-colors ${
                                showCommunication
                                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                            }`}
                        >
                            <MessageSquare className="w-3 h-3" />
                            通訊
                        </button>
                        <button
                            onClick={() => {
                                setShowPTTControl(!showPTTControl);
                                if (!showPTTControl) setShowCommunication(false);
                            }}
                            className={`text-xs px-3 py-1.5 rounded flex items-center gap-1 transition-colors ${
                                showPTTControl
                                    ? 'bg-purple-600 text-white hover:bg-purple-700'
                                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                            }`}
                        >
                            <Radio className="w-3 h-3" />
                            PTT
                        </button>
                    </div>
                </div>

                {/* 主要內容區域 - 可滾動 */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* 連線狀態卡片 */}
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <div className="text-xs text-gray-600 mb-1">WebSocket 狀態</div>
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                                    <span className="text-sm font-medium">{wsConnected ? '已連接' : '未連接'}</span>
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-600 mb-1">連接設備</div>
                                <span className="text-lg font-bold text-blue-600">{devices.length}</span>
                            </div>
                            <div>
                                <div className="text-xs text-gray-600 mb-1">PTT 頻道</div>
                                <select
                                    value={pttChannel}
                                    onChange={(e) => setPttChannel(e.target.value)}
                                    className="text-sm border border-gray-300 rounded px-2 py-1"
                                >
                                    {pttChannels.map((channel) => (
                                        <option key={channel} value={channel}>
                                            {channel === 'emergency' ? '🆘 緊急' :
                                             channel.startsWith('channel') ? `頻道 ${channel.slice(-1)}` :
                                             channel}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* 通訊面板 */}
                    {showCommunication && (
                        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-3">
                            <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                <MessageSquare className="w-4 h-4" />
                                通訊面板
                            </h3>

                            {/* 頻道選擇 */}
                            <select
                                value={selectedGroup}
                                onChange={(e) => setSelectedGroup(e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
                            >
                                <option value="all">📢 全體廣播</option>
                                {pttChannels.map((channel) => {
                                    const count = devices.filter(d => d.group === channel).length;
                                    return (
                                        <option key={channel} value={channel}>
                                            {channel} {count > 0 ? `(${count})` : ''}
                                        </option>
                                    );
                                })}
                            </select>

                            {/* 訊息列表 */}
                            <div className="bg-white rounded-lg p-3 min-h-32 space-y-2 border border-gray-200">
                                {relevantMessages.length === 0 ? (
                                    <div className="flex items-center justify-center py-8 text-gray-400">
                                        <span className="text-sm">尚無訊息</span>
                                    </div>
                                ) : (
                                    relevantMessages.map((msg) => {
                                        // Check if message is from current user
                                        const isFromMe = msg.from === pttDeviceId || msg.from === 'COMMAND_CENTER';
                                        // Check if it's a voice message (has audioData or starts with voice emoji)
                                        const isVoiceMessage = !!msg.audioData || msg.text.includes('💬') || msg.text.includes('🎙️');

                                        return (
                                            <div
                                                key={msg.id}
                                                className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}
                                            >
                                                <div
                                                    className={`max-w-[80%] rounded-lg p-3 ${
                                                        isFromMe
                                                            ? 'bg-blue-600 text-white'
                                                            : 'bg-white border border-gray-200'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-xs font-semibold">
                                                            {msg.from}
                                                        </span>
                                                        {msg.to !== 'all' && (
                                                            <span className={`text-xs ${isFromMe ? 'text-blue-200' : 'text-gray-500'}`}>
                                                                → {msg.to.replace('group:', '群組:').replace('device:', '')}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Voice message with playback button */}
                                                    {isVoiceMessage && msg.audioData ? (
                                                        <div className="flex flex-col gap-2">
                                                            {/* 顯示文字轉錄結果 */}
                                                            <p className="text-sm">{msg.text}</p>
                                                            {/* 播放按鈕 */}
                                                            <button
                                                                onClick={async () => {
                                                                    try {
                                                                        const audioBytes = Uint8Array.from(atob(msg.audioData!), c => c.charCodeAt(0));
                                                                        const audioBlob = new Blob([audioBytes], { type: 'audio/webm;codecs=opus' });
                                                                        const audioUrl = URL.createObjectURL(audioBlob);
                                                                        const audio = new Audio(audioUrl);

                                                                        audio.onended = () => URL.revokeObjectURL(audioUrl);

                                                                        try {
                                                                            await audio.play();
                                                                            console.log('✅ Audio playing successfully');
                                                                        } catch (playErr) {
                                                                            console.warn('⚠️ Primary format failed, trying fallback...', playErr);
                                                                            // 嘗試使用備用格式
                                                                            URL.revokeObjectURL(audioUrl);
                                                                            const fallbackBlob = new Blob([audioBytes], { type: 'audio/ogg;codecs=opus' });
                                                                            const fallbackUrl = URL.createObjectURL(fallbackBlob);
                                                                            const fallbackAudio = new Audio(fallbackUrl);
                                                                            fallbackAudio.onended = () => URL.revokeObjectURL(fallbackUrl);
                                                                            await fallbackAudio.play();
                                                                            console.log('✅ Audio playing with fallback format');
                                                                        }
                                                                    } catch (err) {
                                                                        console.error('❌ Failed to play audio:', err);
                                                                        alert('無法播放音訊，瀏覽器可能不支援此格式');
                                                                    }
                                                                }}
                                                                className={`flex items-center gap-1 text-sm px-2 py-1 rounded self-start ${
                                                                    isFromMe
                                                                        ? 'bg-blue-700 hover:bg-blue-800'
                                                                        : 'bg-gray-100 hover:bg-gray-200'
                                                                }`}
                                                            >
                                                                <Mic className="w-3 h-3" />
                                                                <span>播放語音訊息</span>
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <p className="text-sm">{msg.text}</p>
                                                    )}

                                                    <div className={`text-xs mt-1 ${isFromMe ? 'text-blue-200' : 'text-gray-500'}`}>
                                                        {formatMessageTime(msg.timestamp)}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* 訊息輸入 */}
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={messageText}
                                    onChange={(e) => setMessageText(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSendMessage();
                                        }
                                    }}
                                    placeholder="輸入訊息..."
                                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg"
                                />
                                <button
                                    onClick={handleSendMessage}
                                    disabled={!messageText.trim()}
                                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-medium"
                                >
                                    <Send className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* PTT 功能選擇器 */}
                    {showPTTControl && (
                        <>
                            <div className="space-y-3">
                                <label className="block text-sm font-semibold text-gray-800">PTT 功能選擇</label>
                                <select
                                    value={selectedPTTFunction}
                                    onChange={(e) => setSelectedPTTFunction(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                >
                                    {pttFunctions.map((func) => (
                                        <option key={func.value} value={func.value}>
                                            {func.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* 狀態訊息 */}
                            {pttStatus && (
                                <div className={`p-3 rounded-lg text-sm border ${
                                    pttStatusType === 'success' ? 'bg-green-50 text-green-800 border-green-200' :
                                    pttStatusType === 'error' ? 'bg-red-50 text-red-800 border-red-200' :
                                    'bg-blue-50 text-blue-800 border-blue-200'
                                }`}>
                                    {pttStatus}
                                </div>
                            )}

                            {/* 當前用戶顯示 */}
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                                <div className="text-xs text-gray-600 mb-1">當前 PTT 用戶</div>
                                <div className="text-sm font-bold text-blue-900">{pttDeviceId}</div>
                                <div className="text-xs text-gray-500 mt-1">
                                    {userName ? '登入用戶名稱' : '訪客模式（隨機 ID）'}
                                </div>
                            </div>

                            {/* PTT 功能內容 */}
                            {selectedPTTFunction && renderPTTFunctionContent()}

                            {/* 設備詳細資訊 */}
                            {selectedDevice && !selectedPTTFunction && (
                                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-3">
                                    <h3 className="font-bold text-gray-800">{selectedDevice.callsign || selectedDevice.id}</h3>
                                    <div className="grid grid-cols-2 gap-3 text-sm">
                                        <div>
                                            <div className="text-gray-600">類型</div>
                                            <div className="font-medium">{selectedDevice.type}</div>
                                        </div>
                                        <div>
                                            <div className="text-gray-600">狀態</div>
                                            <div className="font-medium text-green-600">{selectedDevice.status}</div>
                                        </div>
                                        <div>
                                            <div className="text-gray-600">群組</div>
                                            <div className="font-medium">{selectedDevice.group || '未分組'}</div>
                                        </div>
                                        <div>
                                            <div className="text-gray-600">更新時間</div>
                                            <div className="font-medium text-sm">{formatLastUpdate(selectedDevice.lastUpdate)}</div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GPSTracking;