import { useState, useEffect, useRef } from 'react';
import { Radio, Send, MapPin, AlertTriangle, Volume2, Wifi, WifiOff } from 'lucide-react';

interface Message {
    text: string;
    isSent: boolean;
    timestamp: Date;
}

interface Stats {
    sent: number;
    received: number;
    errors: number;
}

const PTTCommunication = () => {
    // 狀態管理
    const [serverUrl, setServerUrl] = useState('http://localhost:4000');
    const [deviceId, setDeviceId] = useState('TEST-USER-001');
    const [channel, setChannel] = useState('channel1');
    const [messageText, setMessageText] = useState('');
    const [broadcastText, setBroadcastText] = useState('');
    const [gpsLat, setGpsLat] = useState('25.033964');
    const [gpsLon, setGpsLon] = useState('121.564472');
    const [sosLat, setSosLat] = useState('25.033964');
    const [sosLon, setSosLon] = useState('121.564472');

    const [wsConnected, setWsConnected] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const [stats, setStats] = useState<Stats>({ sent: 0, received: 0, errors: 0 });

    const wsRef = useRef<WebSocket | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const logsEndRef = useRef<HTMLDivElement>(null);

    // 自動滾動
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    // 建立 PTT 訊息格式
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

    // 記錄日誌
    const addLog = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
        const prefix = {
            info: '[INFO]',
            success: '[OK]',
            error: '[ERR]',
            warning: '[WARN]'
        };
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, `${prefix[type]} [${time}] ${message}`]);
    };

    // 發送 PTT 訊息到後端
    const publishPTT = async (topic: string, tag: string, data: string): Promise<boolean> => {
        const message = createPTTMessage(tag, deviceId, data);

        try {
            const response = await fetch(`${serverUrl}/ptt/publish`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topic, message, encoding: 'binary' })
            });

            if (response.ok) {
                addLog(`發送成功: ${topic}`, 'success');
                setStats(prev => ({ ...prev, sent: prev.sent + 1 }));
                return true;
            } else {
                const error = await response.text();
                addLog(`發送失敗: ${error}`, 'error');
                setStats(prev => ({ ...prev, errors: prev.errors + 1 }));
                return false;
            }
        } catch (error) {
            addLog(`網路錯誤: ${error}`, 'error');
            setStats(prev => ({ ...prev, errors: prev.errors + 1 }));
            return false;
        }
    };

    // 發送文字訊息
    const sendTextMessage = async () => {
        if (!messageText.trim()) {
            alert('請輸入訊息內容');
            return;
        }

        const topic = `/WJI/PTT/${channel}/CHANNEL_ANNOUNCE`;
        const success = await publishPTT(topic, 'TEXT_MESSAGE', messageText);

        if (success) {
            setMessages(prev => [...prev, { text: messageText, isSent: true, timestamp: new Date() }]);
            setMessageText('');
        }
    };

    // 發送 GPS
    const sendGPS = async () => {
        const topic = `/WJI/PTT/${channel}/GPS`;
        const data = `${deviceId},${gpsLat},${gpsLon}`;
        await publishPTT(topic, 'GPS', data);
    };

    // 發送 SOS
    const sendSOS = async () => {
        const topic = `/WJI/PTT/${channel}/SOS`;
        const data = `${sosLat},${sosLon}`;
        await publishPTT(topic, 'SOS', data);
    };

    // 發送廣播
    const sendBroadcast = async () => {
        if (!broadcastText.trim()) {
            alert('請輸入廣播內容');
            return;
        }

        const topic = `/WJI/PTT/${channel}/CHANNEL_ANNOUNCE`;
        const success = await publishPTT(topic, 'BROADCAST', broadcastText);

        if (success) {
            setBroadcastText('');
        }
    };

    // 連接 WebSocket
    const connectWebSocket = () => {
        const wsUrl = serverUrl.replace('http', 'ws').replace(':4000', ':4001');
        addLog(`正在連接 WebSocket: ${wsUrl}`, 'info');

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            addLog('WebSocket 已連接', 'success');
            setWsConnected(true);
            ws.send(JSON.stringify({ type: 'request_messages' }));
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'pong') return;

                addLog(`收到訊息: ${data.type}`, 'info');

                if (data.type === 'message' || data.type === 'ptt_broadcast') {
                    const msg = data.message;
                    setMessages(prev => [...prev, {
                        text: `[${msg.from}] ${msg.text}`,
                        isSent: false,
                        timestamp: new Date(msg.timestamp)
                    }]);
                    setStats(prev => ({ ...prev, received: prev.received + 1 }));
                }

                if (data.type === 'messages_history') {
                    addLog(`載入歷史訊息: ${data.messages.length} 則`, 'info');
                }
            } catch (error: any) {
                addLog(`解析錯誤: ${error.message}`, 'error');
            }
        };

        ws.onerror = () => {
            addLog('WebSocket 錯誤', 'error');
            setWsConnected(false);
        };

        ws.onclose = () => {
            addLog('WebSocket 已斷開', 'warning');
            setWsConnected(false);
        };
    };

    // 斷開 WebSocket
    const disconnectWebSocket = () => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
            addLog('已主動斷開連接', 'info');
        }
    };

    // 清空記錄
    const clearLogs = () => setLogs([]);
    const clearMessages = () => setMessages([]);

    return (
        <div className="min-h-screen bg-slate-900 p-6">
            <div className="max-w-7xl mx-auto bg-slate-800/50 rounded-lg border border-slate-700/50 overflow-hidden">
                {/* Header */}
                <div className="bg-slate-800 border-b border-slate-700/50 text-white px-8 py-6">
                    <h1 className="text-3xl font-bold flex items-center gap-3 text-slate-100">
                        <Radio className="w-8 h-8 text-purple-400" />
                        PTT 通訊系統測試工具
                    </h1>
                    <p className="mt-2 text-slate-400">測試 /WJI/PTT/* MQTT 通訊協議</p>
                </div>

                {/* Main Content */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
                    {/* 左側：控制面板 */}
                    <div className="space-y-6">
                        <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700/50">
                            <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-slate-100">
                                {wsConnected ? (
                                    <Wifi className="w-5 h-5 text-emerald-400 animate-pulse" />
                                ) : (
                                    <WifiOff className="w-5 h-5 text-red-400" />
                                )}
                                控制面板
                            </h2>

                            {/* 基本設定 */}
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">
                                        伺服器位址
                                    </label>
                                    <input
                                        type="text"
                                        value={serverUrl}
                                        onChange={(e) => setServerUrl(e.target.value)}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 text-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">
                                        PTT 設備 ID (UUID)
                                    </label>
                                    <input
                                        type="text"
                                        value={deviceId}
                                        onChange={(e) => setDeviceId(e.target.value)}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 text-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-slate-300 mb-1">
                                        PTT 頻道 (Channel)
                                    </label>
                                    <select
                                        value={channel}
                                        onChange={(e) => setChannel(e.target.value)}
                                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 text-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500"
                                    >
                                        <option value="channel1">頻道 1</option>
                                        <option value="channel2">頻道 2</option>
                                        <option value="channel3">頻道 3</option>
                                        <option value="emergency">緊急頻道</option>
                                        <option value="test">測試頻道</option>
                                    </select>
                                </div>

                                <div className="flex gap-2">
                                    <button
                                        onClick={connectWebSocket}
                                        disabled={wsConnected}
                                        className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
                                    >
                                        連接 WebSocket
                                    </button>
                                    <button
                                        onClick={disconnectWebSocket}
                                        disabled={!wsConnected}
                                        className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
                                    >
                                        斷開連接
                                    </button>
                                </div>
                            </div>

                            <hr className="my-6 border-slate-700" />

                            {/* 發送文字訊息 */}
                            <div className="space-y-3">
                                <h3 className="font-semibold flex items-center gap-2 text-slate-200">
                                    <Send className="w-4 h-4 text-emerald-400" />
                                    發送文字訊息
                                </h3>
                                <textarea
                                    value={messageText}
                                    onChange={(e) => setMessageText(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            sendTextMessage();
                                        }
                                    }}
                                    placeholder="輸入要發送的訊息..."
                                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-400 rounded-lg focus:ring-2 focus:ring-purple-500"
                                    rows={3}
                                />
                                <button
                                    onClick={sendTextMessage}
                                    className="w-full px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                                >
                                    發送文字訊息
                                </button>
                            </div>

                            <hr className="my-6 border-slate-700" />

                            {/* 發送 GPS */}
                            <div className="space-y-3">
                                <h3 className="font-semibold flex items-center gap-2 text-slate-200">
                                    <MapPin className="w-4 h-4 text-blue-400" />
                                    發送 GPS
                                </h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">緯度</label>
                                        <input
                                            type="text"
                                            value={gpsLat}
                                            onChange={(e) => setGpsLat(e.target.value)}
                                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 text-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">經度</label>
                                        <input
                                            type="text"
                                            value={gpsLon}
                                            onChange={(e) => setGpsLon(e.target.value)}
                                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 text-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                </div>
                                <button
                                    onClick={sendGPS}
                                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                    發送 GPS
                                </button>
                            </div>

                            <hr className="my-6 border-slate-700" />

                            {/* 緊急功能 */}
                            <div className="space-y-3">
                                <h3 className="font-semibold flex items-center gap-2 text-red-400">
                                    <AlertTriangle className="w-4 h-4" />
                                    緊急功能
                                </h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">SOS 緯度</label>
                                        <input
                                            type="text"
                                            value={sosLat}
                                            onChange={(e) => setSosLat(e.target.value)}
                                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 text-slate-200 rounded-lg focus:ring-2 focus:ring-red-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">SOS 經度</label>
                                        <input
                                            type="text"
                                            value={sosLon}
                                            onChange={(e) => setSosLon(e.target.value)}
                                            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 text-slate-200 rounded-lg focus:ring-2 focus:ring-red-500"
                                        />
                                    </div>
                                </div>
                                <button
                                    onClick={sendSOS}
                                    className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                                >
                                    發送 SOS
                                </button>
                            </div>

                            <hr className="my-6 border-slate-700" />

                            {/* 廣播訊息 */}
                            <div className="space-y-3">
                                <h3 className="font-semibold flex items-center gap-2 text-slate-200">
                                    <Volume2 className="w-4 h-4 text-amber-400" />
                                    廣播訊息
                                </h3>
                                <textarea
                                    value={broadcastText}
                                    onChange={(e) => setBroadcastText(e.target.value)}
                                    placeholder="輸入廣播訊息..."
                                    className="w-full px-3 py-2 bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-400 rounded-lg focus:ring-2 focus:ring-amber-500"
                                    rows={3}
                                />
                                <button
                                    onClick={sendBroadcast}
                                    className="w-full px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                                >
                                    發送廣播
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 右側：訊息與日誌 */}
                    <div className="space-y-6">
                        {/* 統計資訊 */}
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-emerald-950/50 border border-emerald-800/50 rounded-lg p-4 text-center">
                                <div className="text-3xl font-bold text-emerald-400">{stats.sent}</div>
                                <div className="text-sm text-slate-400">已發送</div>
                            </div>
                            <div className="bg-blue-950/50 border border-blue-800/50 rounded-lg p-4 text-center">
                                <div className="text-3xl font-bold text-blue-400">{stats.received}</div>
                                <div className="text-sm text-slate-400">已接收</div>
                            </div>
                            <div className="bg-red-950/50 border border-red-800/50 rounded-lg p-4 text-center">
                                <div className="text-3xl font-bold text-red-400">{stats.errors}</div>
                                <div className="text-sm text-slate-400">錯誤數</div>
                            </div>
                        </div>

                        {/* 即時訊息 */}
                        <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700/50">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xl font-bold text-slate-100">即時訊息</h2>
                                <button
                                    onClick={clearMessages}
                                    className="text-sm text-slate-400 hover:text-slate-200"
                                >
                                    清空
                                </button>
                            </div>
                            <div className="h-64 overflow-y-auto bg-slate-900/50 rounded-lg p-4 space-y-2 border border-slate-700/50">
                                {messages.length === 0 ? (
                                    <p className="text-center text-slate-500">尚無訊息</p>
                                ) : (
                                    messages.map((msg, idx) => (
                                        <div
                                            key={idx}
                                            className={`flex ${msg.isSent ? 'justify-end' : 'justify-start'}`}
                                        >
                                            <div
                                                className={`max-w-xs px-4 py-2 rounded-lg ${
                                                    msg.isSent
                                                        ? 'bg-purple-600 text-white'
                                                        : 'bg-slate-700/50 text-slate-200 border border-slate-600/50'
                                                }`}
                                            >
                                                <div className="text-sm">{msg.text}</div>
                                                <div className="text-xs opacity-70 mt-1">
                                                    {msg.timestamp.toLocaleTimeString()}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        </div>

                        {/* 系統日誌 */}
                        <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700/50">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xl font-bold text-slate-100">系統日誌</h2>
                                <button
                                    onClick={clearLogs}
                                    className="text-sm text-slate-400 hover:text-slate-200"
                                >
                                    清空
                                </button>
                            </div>
                            <div className="h-64 overflow-y-auto bg-slate-950 rounded-lg p-4 font-mono text-xs text-emerald-400 border border-slate-700/50">
                                {logs.length === 0 ? (
                                    <p className="text-slate-600">等待日誌...</p>
                                ) : (
                                    logs.map((log, idx) => (
                                        <div key={idx} className="mb-1">
                                            {log}
                                        </div>
                                    ))
                                )}
                                <div ref={logsEndRef} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PTTCommunication;
