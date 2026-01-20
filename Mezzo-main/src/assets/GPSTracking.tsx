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

const GPSTracking: React.FC = () => {
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
    const [pttDeviceId, setPttDeviceId] = useState('USER-001');
    const [gpsLat, setGpsLat] = useState('25.033964');
    const [gpsLon, setGpsLon] = useState('121.564472');
    const [sosLat, setSosLat] = useState('25.033964');
    const [sosLon, setSosLon] = useState('121.564472');
    const [broadcastMsg, setBroadcastMsg] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const [pttStatus, setPttStatus] = useState('');
    const [pttStatusType, setPttStatusType] = useState<'success' | 'error' | 'info'>('info');

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
    const handleAudioSend = async (audioData: ArrayBuffer, isPrivate: boolean, targetId?: string) => {
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

            // 發送到後端
            const response = await fetch(`${API_CONFIG.baseUrl}/ptt/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic, message, encoding: 'binary' })
            });

            if (response.ok) {
                const typeText = isPrivate ? '📞 私人通話' : '🎙️ 群組語音';
                showPTTStatus(`${typeText} 已發送 (${audioData.byteLength} bytes)`, 'success');
                console.log(`${typeText} sent:`, { topic, size: audioData.byteLength });
            } else {
                throw new Error('Failed to send audio');
            }
        } catch (error) {
            console.error('❌ Send audio error:', error);
            showPTTStatus('❌ 音訊發送失敗', 'error');
        }
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

                        // 處理 PTT GPS 更新
                        if (data.type === 'device_update' && data.device && data.device.source?.includes('ptt')) {
                            const device = data.device;
                            const gpsNotification: Message = {
                                id: `gps-update-${Date.now()}`,
                                from: device.id,
                                to: `group:${device.group || 'PTT'}`,
                                text: `📍 更新了位置資訊 (${device.position.lat.toFixed(6)}, ${device.position.lng.toFixed(6)})`,
                                timestamp: new Date().toISOString(),
                                priority: 3
                            };
                            setMessages((prev) => [...prev, gpsNotification]);
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
    useEffect(() => {
        if (showCommunication && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, showCommunication]);

    return (
        <div className="flex h-screen bg-gray-100 overflow-hidden">
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
                            onClick={() => setShowCommunication(!showCommunication)}
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
                            onClick={() => setShowPTTControl(!showPTTControl)}
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
                    {/* PTT 控制面板 */}
                    {showPTTControl && (
                        <div className="bg-white rounded-lg shadow-lg p-4 space-y-4">
                            <div className="flex items-center justify-between border-b pb-3">
                                <h3 className="text-lg font-bold flex items-center gap-2">
                                    <Radio className="w-5 h-5 text-purple-600" />
                                    PTT 控制面板
                                </h3>
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                    <span className="text-xs text-gray-600">已連接</span>
                                </div>
                            </div>

                            {/* 狀態訊息 */}
                            {pttStatus && (
                                <div className={`p-2 rounded text-sm ${
                                    pttStatusType === 'success' ? 'bg-green-50 text-green-800 border border-green-200' :
                                    pttStatusType === 'error' ? 'bg-red-50 text-red-800 border border-red-200' :
                                    'bg-blue-50 text-blue-800 border border-blue-200'
                                }`}>
                                    {pttStatus}
                                </div>
                            )}

                            {/* 基本設定 */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                        PTT 頻道
                                    </label>
                                    <select
                                        value={pttChannel}
                                        onChange={(e) => setPttChannel(e.target.value)}
                                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500"
                                    >
                                        {pttChannels.map((channel) => (
                                            <option key={channel} value={channel}>
                                                {channel === 'emergency' ? '🆘 緊急頻道' :
                                                 channel.startsWith('channel') ? `頻道 ${channel.slice(-1)}` :
                                                 `📻 ${channel}`}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                        設備 ID
                                    </label>
                                    <input
                                        type="text"
                                        value={pttDeviceId}
                                        onChange={(e) => setPttDeviceId(e.target.value)}
                                        placeholder="USER-001"
                                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>
                            </div>

                            {/* GPS 發送 */}
                            <div className="border border-gray-200 rounded p-3 space-y-2">
                                <div className="flex items-center gap-2 text-sm font-semibold">
                                    <MapPin className="w-4 h-4 text-green-600" />
                                    GPS 位置發送
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        type="text"
                                        value={gpsLat}
                                        onChange={(e) => setGpsLat(e.target.value)}
                                        placeholder="緯度"
                                        className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded"
                                    />
                                    <input
                                        type="text"
                                        value={gpsLon}
                                        onChange={(e) => setGpsLon(e.target.value)}
                                        placeholder="經度"
                                        className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded"
                                    />
                                </div>
                                <button
                                    onClick={sendPTTGPS}
                                    className="w-full bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2 rounded flex items-center justify-center gap-2"
                                >
                                    <MapPin className="w-4 h-4" />
                                    發送 GPS
                                </button>
                            </div>

                            {/* SOS 警報 */}
                            <div className="border border-red-200 rounded p-3 space-y-2 bg-red-50">
                                <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                                    <AlertCircle className="w-4 h-4" />
                                    SOS 緊急警報
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <input
                                        type="text"
                                        value={sosLat}
                                        onChange={(e) => setSosLat(e.target.value)}
                                        placeholder="緯度"
                                        className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded"
                                    />
                                    <input
                                        type="text"
                                        value={sosLon}
                                        onChange={(e) => setSosLon(e.target.value)}
                                        placeholder="經度"
                                        className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded"
                                    />
                                </div>
                                <button
                                    onClick={sendPTTSOS}
                                    className="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 rounded flex items-center justify-center gap-2"
                                >
                                    <AlertCircle className="w-4 h-4" />
                                    發送 SOS
                                </button>
                            </div>

                            {/* 廣播訊息 */}
                            <div className="border border-gray-200 rounded p-3 space-y-2">
                                <div className="flex items-center gap-2 text-sm font-semibold">
                                    <MessageSquare className="w-4 h-4 text-blue-600" />
                                    廣播訊息
                                </div>
                                <textarea
                                    value={broadcastMsg}
                                    onChange={(e) => setBroadcastMsg(e.target.value)}
                                    placeholder="輸入要廣播的訊息..."
                                    rows={2}
                                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded resize-none"
                                />
                                <button
                                    onClick={sendPTTBroadcast}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 rounded flex items-center justify-center gap-2"
                                >
                                    <Send className="w-4 h-4" />
                                    發送廣播
                                </button>
                            </div>

                            {/* 錄影控制 */}
                            <div className="border border-gray-200 rounded p-3 space-y-2">
                                <div className="flex items-center gap-2 text-sm font-semibold">
                                    <Video className="w-4 h-4 text-purple-600" />
                                    錄影控制
                                </div>
                                <button
                                    onClick={toggleRecording}
                                    className={`w-full ${
                                        isRecording 
                                            ? 'bg-gray-600 hover:bg-gray-700' 
                                            : 'bg-purple-600 hover:bg-purple-700'
                                    } text-white text-sm font-semibold py-2 rounded flex items-center justify-center gap-2`}
                                >
                                    <Video className="w-4 h-4" />
                                    {isRecording ? '⏹️ 停止錄影' : '📹 開始錄影'}
                                </button>
                                {isRecording && (
                                    <div className="flex items-center justify-center gap-2 text-red-600">
                                        <div className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                                        <span className="text-xs font-medium">錄影中...</span>
                                    </div>
                                )}
                            </div>

                            {/* PTT 語音通話 */}
                            <PTTAudio
                                deviceId={pttDeviceId}
                                channel={pttChannel}
                                onAudioSend={handleAudioSend}
                            />
                        </div>
                    )}

                    {/* 通訊面板 */}
                    {showCommunication && (
                        <div className="bg-white rounded-lg shadow-lg p-4 space-y-4 flex flex-col h-[600px]">
                            <div className="flex items-center justify-between border-b pb-3">
                                <h3 className="text-lg font-bold flex items-center gap-2">
                                    <MessageSquare className="w-5 h-5 text-blue-600" />
                                    通訊面板
                                </h3>
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                    <span className="text-xs text-gray-600">已連接</span>
                                </div>
                            </div>

                            {/* 頻道/群組選擇器 */}
                            <div className="space-y-2">
                                <label className="block text-xs font-medium text-gray-700">
                                    選擇 PTT 頻道/群組
                                </label>
                                <select
                                    value={selectedGroup}
                                    onChange={(e) => setSelectedGroup(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                >
                                    <option value="all">📢 全體廣播 (使用當前 PTT 頻道: {pttChannel})</option>
                                    {pttChannels.map((channel) => {
                                        const deviceCount = devices.filter(d => d.group === channel).length;
                                        return (
                                            <option key={channel} value={channel}>
                                                📻 {channel} 頻道 {deviceCount > 0 ? `(${deviceCount} 人)` : ''}
                                            </option>
                                        );
                                    })}
                                </select>
                                <div className="text-xs text-gray-500 flex items-center gap-1">
                                    <Radio className="w-3 h-3" />
                                    當前 PTT 設備: {pttDeviceId}
                                </div>
                            </div>

                            {/* 訊息列表 */}
                            <div className="flex-1 overflow-y-auto bg-gray-50 rounded-lg p-3 space-y-2 min-h-0">
                                {relevantMessages.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                                        <MessageSquare className="w-12 h-12 mb-2" />
                                        <p className="text-sm">尚無訊息</p>
                                    </div>
                                ) : (
                                    relevantMessages.map((msg) => {
                                        const isFromCommandCenter = msg.from === 'COMMAND_CENTER';
                                        return (
                                            <div
                                                key={msg.id}
                                                className={`flex ${isFromCommandCenter ? 'justify-end' : 'justify-start'}`}
                                            >
                                                <div
                                                    className={`max-w-[80%] rounded-lg p-3 ${
                                                        isFromCommandCenter
                                                            ? 'bg-blue-600 text-white'
                                                            : 'bg-white border border-gray-200'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-xs font-semibold">
                                                            {msg.from}
                                                        </span>
                                                        {msg.to !== 'all' && (
                                                            <span className={`text-xs ${isFromCommandCenter ? 'text-blue-200' : 'text-gray-500'}`}>
                                                                → {msg.to.replace('group:', '群組:').replace('device:', '')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-sm">{msg.text}</p>
                                                    <div className={`text-xs mt-1 ${isFromCommandCenter ? 'text-blue-200' : 'text-gray-500'}`}>
                                                        {formatMessageTime(msg.timestamp)}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* 訊息輸入區 */}
                            <div className="border-t pt-3 space-y-2">
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
                                        placeholder={
                                            selectedGroup === 'all'
                                                ? `發送到 PTT 頻道 ${pttChannel}...`
                                                : `發送到頻道 ${selectedGroup}...`
                                        }
                                        className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    />
                                    <button
                                        onClick={handleSendMessage}
                                        disabled={!messageText.trim()}
                                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
                                    >
                                        <Send className="w-4 h-4" />
                                        發送
                                    </button>
                                </div>
                                <div className="text-xs text-gray-500">
                                    按 Enter 發送，Shift+Enter 換行
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 設備資訊 */}
                    {selectedDevice && !showPTTControl && !showCommunication && (
                        <div className="bg-white rounded-lg shadow p-4">
                            <h3 className="text-lg font-bold mb-3">{selectedDevice.callsign || selectedDevice.id}</h3>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-600">類型:</span>
                                    <span className="font-medium">{selectedDevice.type}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">狀態:</span>
                                    <span className="font-medium">{selectedDevice.status}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">群組:</span>
                                    <span className="font-medium">{selectedDevice.group || '未分組'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">最後更新:</span>
                                    <span className="font-medium">{formatLastUpdate(selectedDevice.lastUpdate)}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GPSTracking;