import React, { useState, useEffect } from 'react';
import CameraMap from './CameraMap';
import VideoPlayer from './VideoPlayer';
import { getFullStreamUrl } from '../config/api';
import { MapPin, Video, Wifi, Activity, Clock, Send, Users, MessageSquare } from 'lucide-react';

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

// ===== 設備介面 =====
interface Device {
    id: string;
    type: string;
    position: {
        lat: number;
        lng: number;
        alt?: number;
    };
    callsign?: string;
    status?: string;
    priority?: number;
    streamUrl?: string;
    rtspUrl?: string;
    lastUpdate?: string;
    battery?: number;
    signal?: number;
    source?: string;
    group?: string; // 設備群組
}

// ===== 訊息介面 =====
interface Message {
    id: string;
    from: string;
    to: string; // 'all', 'group:xxx', 'device:xxx'
    text: string;
    timestamp: string;
    priority?: number;
}

const GPSTracking: React.FC = () => {
    const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
    const [devices, setDevices] = useState<Device[]>([]);
    const [wsConnected, setWsConnected] = useState(false);

    // ===== 通訊相關狀態 =====
    const [messages, setMessages] = useState<Message[]>([]);
    const [messageText, setMessageText] = useState('');
    const [selectedRecipient, setSelectedRecipient] = useState<string>('all');
    const [showCommunication, setShowCommunication] = useState(false);

    // ===== 提取設備群組 =====
    const deviceGroups = Array.from(
        new Set(devices.map((d) => d.group || '未分組').filter(Boolean))
    );

    // ===== WebSocket 連接 =====
    useEffect(() => {
        let ws: WebSocket | null = null;
        let reconnectTimer: NodeJS.Timeout | null = null;

        const connectWebSocket = () => {
            try {
                console.log('🔌 Connecting to WebSocket:', WS_URL);
                ws = new WebSocket(WS_URL);

                ws.onopen = () => {
                    console.log('✅ WebSocket connected');
                    setWsConnected(true);

                    // 請求初始設備列表
                    ws?.send(JSON.stringify({ type: 'request_devices' }));
                };

                ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        console.log('📨 WebSocket message:', data.type);

                        // 處理初始設備列表
                        if (data.type === 'initial_state' && data.devices) {
                            console.log(`📋 Initial devices: ${data.devices.length}`);
                            setDevices(data.devices);

                            if (data.devices.length > 0 && !selectedDevice) {
                                setSelectedDevice(data.devices[0]);
                            }
                        }

                        // 處理設備列表更新
                        if (data.type === 'devices_update' && data.devices) {
                            console.log(`📋 Devices update: ${data.devices.length}`);
                            setDevices(data.devices);
                        }

                        // 處理單個設備更新
                        if (data.type === 'device_update' && data.device) {
                            console.log(`📱 Device update: ${data.device.id}`);
                            setDevices((prev) => {
                                const index = prev.findIndex((d) => d.id === data.device.id);
                                if (index !== -1) {
                                    const updated = [...prev];
                                    updated[index] = data.device;

                                    if (selectedDevice && selectedDevice.id === data.device.id) {
                                        setSelectedDevice(data.device);
                                    }

                                    return updated;
                                } else {
                                    return [...prev, data.device];
                                }
                            });
                        }

                        // 處理設備添加
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

                        // 處理設備移除
                        if (data.type === 'device_removed' && data.deviceId) {
                            console.log(`➖ Device removed: ${data.deviceId}`);
                            setDevices((prev) => prev.filter((d) => d.id !== data.deviceId));

                            if (selectedDevice && selectedDevice.id === data.deviceId) {
                                setSelectedDevice(null);
                            }
                        }

                        // ===== 處理接收訊息 =====
                        if (data.type === 'message' && data.message) {
                            console.log('💬 Received message:', data.message);
                            setMessages((prev) => [...prev, data.message]);
                        }

                        // 處理 MQTT 訊息
                        if (data.type === 'mqtt_message' && data.topic && data.data) {
                            console.log('📡 MQTT message:', data.topic);
                        }
                    } catch (error) {
                        console.error('❌ WebSocket message parse error:', error);
                    }
                };

                ws.onerror = (error) => {
                    console.error('❌ WebSocket error:', error);
                    setWsConnected(false);
                };

                ws.onclose = () => {
                    console.log('🔌 WebSocket disconnected');
                    setWsConnected(false);

                    reconnectTimer = setTimeout(() => {
                        console.log('🔄 Reconnecting WebSocket...');
                        connectWebSocket();
                    }, 5000);
                };
            } catch (error) {
                console.error('❌ WebSocket connection error:', error);
            }
        };

        connectWebSocket();

        return () => {
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
            }
            if (ws) {
                ws.close();
            }
        };
    }, []);

    // 定期從 API 重新載入設備（備用）
    useEffect(() => {
        const loadDevices = async () => {
            if (wsConnected) return;

            try {
                const response = await fetch(`${API_CONFIG.baseUrl}/devices`);
                if (response.ok) {
                    const data = await response.json();
                    setDevices(data.devices || []);
                }
            } catch (error) {
                console.error('❌ Failed to load devices:', error);
            }
        };

        const interval = setInterval(loadDevices, 10000);
        loadDevices();

        return () => clearInterval(interval);
    }, [wsConnected]);

    // ===== 發送訊息 =====
    const handleSendMessage = async () => {
        if (!messageText.trim()) return;

        try {
            const message = {
                from: 'COMMAND_CENTER',
                to: selectedRecipient,
                text: messageText,
                priority: selectedDevice?.priority || 3,
                timestamp: new Date().toISOString(),
            };

            console.log('📤 Sending message:', message);

            const response = await fetch(`${API_CONFIG.baseUrl}/send-message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(message),
            });

            if (response.ok) {
                console.log('✅ Message sent successfully');

                // 添加到本地訊息列表
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `msg-${Date.now()}`,
                        ...message,
                    },
                ]);

                // 清空輸入
                setMessageText('');
            } else {
                console.error('❌ Failed to send message');
            }
        } catch (error) {
            console.error('❌ Send message error:', error);
        }
    };

    // ===== 處理地圖選擇設備 =====
    const handleDeviceSelect = (device: Device) => {
        console.log('📍 Device selected:', device);
        setSelectedDevice(device);
    };

    // ===== 處理設備列表點擊 =====
    const handleDeviceClick = (device: Device) => {
        setSelectedDevice(device);
    };

    // ===== 格式化時間 =====
    const formatLastUpdate = (timestamp?: string) => {
        if (!timestamp) return '未知';

        const now = new Date();
        const update = new Date(timestamp);
        const diff = now.getTime() - update.getTime();

        if (diff < 60000) return '剛剛';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} 分鐘前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小時前`;
        return update.toLocaleDateString('zh-TW');
    };

    // ===== 格式化訊息時間 =====
    const formatMessageTime = (timestamp: string) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('zh-TW', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // ===== 篩選相關訊息 =====
    const relevantMessages = messages.filter((msg) => {
        if (!selectedDevice) return msg.to === 'all';

        return (
            msg.to === 'all' ||
            msg.to === `device:${selectedDevice.id}` ||
            (selectedDevice.group && msg.to === `group:${selectedDevice.group}`)
        );
    });

    return (
        <div className="flex h-full bg-gray-100">
            {/* 左側：地圖 (50%) */}
            <div className="w-1/2 h-full">
                <CameraMap onDeviceSelect={handleDeviceSelect} />
            </div>

            {/* 右側：設備資訊面板 (50%) */}
            <div className="w-1/2 flex flex-col h-full border-l border-gray-200">
                {/* 狀態欄 */}
                <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                            <span className="text-xs font-medium text-gray-700">
                                {wsConnected ? 'WebSocket 已連接' : 'WebSocket 未連接'}
                            </span>
                        </div>
                        <div className="text-xs text-gray-500">
                            設備總數: {devices.length}
                        </div>
                    </div>
                    <button
                        onClick={() => setShowCommunication(!showCommunication)}
                        className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1"
                    >
                        <MessageSquare className="w-3 h-3" />
                        {showCommunication ? '隱藏通訊' : '顯示通訊'}
                    </button>
                </div>

                {/* 選中設備的詳細資訊 */}
                {selectedDevice ? (
                    <div className="flex flex-col flex-1 overflow-hidden">
                        {/* 設備資訊卡片 */}
                        <div className="bg-white border-b border-gray-200 p-4">
                            <div className="flex items-start justify-between mb-3">
                                <div>
                                    <h3 className="text-lg font-bold text-gray-900">
                                        {selectedDevice.callsign || selectedDevice.id}
                                    </h3>
                                    <p className="text-sm text-gray-500 font-mono">
                                        {selectedDevice.id}
                                    </p>
                                    {selectedDevice.group && (
                                        <p className="text-xs text-blue-600 mt-1">
                                            群組: {selectedDevice.group}
                                        </p>
                                    )}
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span
                                        className={`text-xs px-2 py-1 rounded font-bold text-white ${selectedDevice.priority === 1
                                            ? 'bg-red-500'
                                            : selectedDevice.priority === 2
                                                ? 'bg-orange-500'
                                                : selectedDevice.priority === 3
                                                    ? 'bg-blue-500'
                                                    : 'bg-gray-500'
                                            }`}
                                    >
                                        P{selectedDevice.priority || 3}
                                    </span>
                                    <span
                                        className={`text-xs px-2 py-1 rounded ${selectedDevice.status === 'active'
                                            ? 'bg-green-100 text-green-800'
                                            : 'bg-gray-100 text-gray-600'
                                            }`}
                                    >
                                        {selectedDevice.status === 'active' ? '在線' : '離線'}
                                    </span>
                                </div>
                            </div>

                            {/* 詳細資訊網格 */}
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <div className="text-gray-500 text-xs mb-1 flex items-center gap-1">
                                        <MapPin className="w-3 h-3" />
                                        位置
                                    </div>
                                    <div className="font-mono text-xs text-gray-800">
                                        {selectedDevice.position.lat.toFixed(6)}, {selectedDevice.position.lng.toFixed(6)}
                                    </div>
                                    {selectedDevice.position.alt && (
                                        <div className="text-xs text-gray-500">
                                            海拔: {selectedDevice.position.alt}m
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <div className="text-gray-500 text-xs mb-1 flex items-center gap-1">
                                        <Activity className="w-3 h-3" />
                                        類型
                                    </div>
                                    <div className="text-gray-800">
                                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                                            {selectedDevice.type}
                                        </span>
                                    </div>
                                    {selectedDevice.source && (
                                        <div className="text-xs text-gray-500 mt-1">
                                            來源: {selectedDevice.source}
                                        </div>
                                    )}
                                </div>

                                {selectedDevice.battery !== undefined && (
                                    <div>
                                        <div className="text-gray-500 text-xs mb-1">電量</div>
                                        <div className="text-gray-800">{selectedDevice.battery}%</div>
                                    </div>
                                )}

                                {selectedDevice.signal !== undefined && (
                                    <div>
                                        <div className="text-gray-500 text-xs mb-1 flex items-center gap-1">
                                            <Wifi className="w-3 h-3" />
                                            訊號
                                        </div>
                                        <div className="text-gray-800">{selectedDevice.signal}%</div>
                                    </div>
                                )}

                                <div className="col-span-2">
                                    <div className="text-gray-500 text-xs mb-1 flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        最後更新
                                    </div>
                                    <div className="text-xs text-gray-600">
                                        {formatLastUpdate(selectedDevice.lastUpdate)}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 通訊面板 (可展開/收合) */}
                        {showCommunication && (
                            <div className="bg-white border-b border-gray-200 p-4">
                                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                    <MessageSquare className="w-4 h-4" />
                                    群組通訊
                                </h4>

                                {/* 訊息列表 */}
                                <div className="mb-3 max-h-32 overflow-y-auto bg-gray-50 rounded p-2 space-y-2">
                                    {relevantMessages.length === 0 ? (
                                        <div className="text-xs text-gray-500 text-center py-2">
                                            暫無訊息
                                        </div>
                                    ) : (
                                        relevantMessages.slice(-5).map((msg) => (
                                            <div
                                                key={msg.id}
                                                className={`text-xs p-2 rounded ${msg.from === 'COMMAND_CENTER'
                                                    ? 'bg-blue-100 ml-4'
                                                    : 'bg-white mr-4'
                                                    }`}
                                            >
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="font-semibold text-gray-700">
                                                        {msg.from}
                                                    </span>
                                                    <span className="text-gray-500">
                                                        {formatMessageTime(msg.timestamp)}
                                                    </span>
                                                </div>
                                                <div className="text-gray-800">{msg.text}</div>
                                                {msg.to !== 'all' && (
                                                    <div className="text-gray-500 text-xs mt-1">
                                                        → {msg.to}
                                                    </div>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>

                                {/* 收件人選擇 */}
                                <select
                                    value={selectedRecipient}
                                    onChange={(e) => setSelectedRecipient(e.target.value)}
                                    className="w-full mb-2 px-2 py-1.5 text-xs border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                                >
                                    <option value="all">📢 所有設備</option>
                                    {deviceGroups.map((group) => (
                                        <option key={group} value={`group:${group}`}>
                                            👥 群組: {group}
                                        </option>
                                    ))}
                                    {selectedDevice && (
                                        <option value={`device:${selectedDevice.id}`}>
                                            📱 單一設備: {selectedDevice.callsign || selectedDevice.id}
                                        </option>
                                    )}
                                </select>

                                {/* 訊息輸入 */}
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={messageText}
                                        onChange={(e) => setMessageText(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                        placeholder="輸入訊息..."
                                        className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                                    />
                                    <button
                                        onClick={handleSendMessage}
                                        disabled={!messageText.trim()}
                                        className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-1"
                                    >
                                        <Send className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* 影片播放器 (如果有串流) */}
                        {selectedDevice?.streamUrl ? (
                            <div className="bg-gray-900 flex-1 min-h-0">
                                <VideoPlayer
                                    streamUrl={getFullStreamUrl(selectedDevice.streamUrl)}
                                    cameraId={selectedDevice.id}
                                />
                            </div>
                        ) : (
                            <div className="bg-gray-900 flex-1 flex items-center justify-center">
                                <div className="text-center text-gray-400">
                                    <Video className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">此設備無影片串流</p>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center bg-white">
                        <div className="text-center text-gray-400">
                            <MapPin className="w-16 h-16 mx-auto mb-3 opacity-30" />
                            <p className="text-lg font-medium">尚未選擇設備</p>
                            <p className="text-sm mt-1">點擊地圖上的圖標或下方列表選擇設備</p>
                        </div>
                    </div>
                )}

                {/* 所有設備列表 */}
                <div className="bg-white border-t border-gray-200 max-h-64 overflow-y-auto">
                    <div className="p-3 border-b border-gray-100 bg-gray-50">
                        <h4 className="text-sm font-semibold text-gray-700">所有設備 ({devices.length})</h4>
                    </div>
                    <div className="divide-y divide-gray-100">
                        {devices.length === 0 ? (
                            <div className="p-4 text-center text-sm text-gray-500">
                                暫無設備
                                <br />
                                <span className="text-xs">請到 Device Management 註冊設備</span>
                            </div>
                        ) : (
                            devices.map((device) => (
                                <button
                                    key={device.id}
                                    onClick={() => handleDeviceClick(device)}
                                    className={`w-full text-left px-3 py-2 hover:bg-blue-50 transition ${selectedDevice && selectedDevice.id === device.id
                                        ? 'bg-blue-50 border-l-2 border-blue-500'
                                        : ''
                                        }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-sm text-gray-900 truncate">
                                                    {device.callsign || device.id}
                                                </span>
                                                <span
                                                    className={`text-xs px-1.5 py-0.5 rounded font-bold text-white ${device.priority === 1
                                                        ? 'bg-red-500'
                                                        : device.priority === 2
                                                            ? 'bg-orange-500'
                                                            : device.priority === 3
                                                                ? 'bg-blue-500'
                                                                : 'bg-gray-500'
                                                        }`}
                                                >
                                                    P{device.priority || 3}
                                                </span>
                                                {device.group && (
                                                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                                                        {device.group}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-xs text-gray-500 font-mono">
                                                    {device.id}
                                                </span>
                                                <span className="text-xs text-gray-400">•</span>
                                                <span className="text-xs text-gray-500">
                                                    {formatLastUpdate(device.lastUpdate)}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {device.streamUrl && (
                                                <Video className="w-4 h-4 text-blue-500" />
                                            )}
                                            <span
                                                className={`w-2 h-2 rounded-full ${device.status === 'active' ? 'bg-green-500' : 'bg-gray-400'
                                                    }`}
                                            />
                                        </div>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GPSTracking;