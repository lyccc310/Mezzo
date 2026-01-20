import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Volume2, VolumeX } from 'lucide-react';

interface PTTAudioProps {
    deviceId: string;
    channel: string;
    onAudioSend: (audioData: ArrayBuffer, isPrivate: boolean, targetId?: string) => void;
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

const PTTAudio = ({ deviceId, channel, onAudioSend }: PTTAudioProps) => {
    // 錄音狀態
    const [isRecording, setIsRecording] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [audioLevel, setAudioLevel] = useState(0);

    // 私人通話狀態
    const [privateCallActive, setPrivateCallActive] = useState(false);
    const [privateTargetId, setPrivateTargetId] = useState('');
    const [randomCallId, setRandomCallId] = useState('');

    // Refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);

    // 初始化音訊上下文
    useEffect(() => {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();

        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    // 監控音訊電平
    useEffect(() => {
        if (!isRecording || !analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        const updateLevel = () => {
            if (!analyserRef.current) return;

            analyserRef.current.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            setAudioLevel(average / 255);

            if (isRecording) {
                requestAnimationFrame(updateLevel);
            }
        };

        updateLevel();
    }, [isRecording]);

    // 開始群組錄音
    const startGroupRecording = async () => {
        try {
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

                // 發送音訊數據
                onAudioSend(arrayBuffer, false);

                // 清理
                audioChunksRef.current = [];
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                    streamRef.current = null;
                }
            };

            mediaRecorder.start(100);  // 每 100ms 收集一次數據
            setIsRecording(true);
            console.log('🎙️ Started group recording');

        } catch (error) {
            console.error('❌ Failed to start recording:', error);
            alert('無法訪問麥克風，請確保已授予權限');
        }
    };

    // 停止群組錄音
    const stopGroupRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            setAudioLevel(0);
            console.log('🎙️ Stopped group recording');
        }
    };

    // 開始私人通話
    const startPrivateCall = async () => {
        if (!privateTargetId.trim()) {
            alert('請輸入目標設備 ID');
            return;
        }

        // 生成隨機通話 ID
        const callId = `CALL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setRandomCallId(callId);
        setPrivateCallActive(true);

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 16000
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

                // 發送私人音訊數據
                onAudioSend(arrayBuffer, true, callId);

                audioChunksRef.current = [];
                if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                    streamRef.current = null;
                }
            };

            mediaRecorder.start(100);
            setIsRecording(true);
            console.log(`📞 Started private call: ${callId} → ${privateTargetId}`);

        } catch (error) {
            console.error('❌ Failed to start private call:', error);
            alert('無法訪問麥克風');
            setPrivateCallActive(false);
        }
    };

    // 結束私人通話
    const endPrivateCall = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
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

                    {/* PTT 按鈕 */}
                    <button
                        onMouseDown={startGroupRecording}
                        onMouseUp={stopGroupRecording}
                        onTouchStart={startGroupRecording}
                        onTouchEnd={stopGroupRecording}
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
                                正在發話...
                            </div>
                        ) : (
                            <div className="flex items-center justify-center gap-2">
                                <Mic className="w-5 h-5" />
                                按住發話 (PTT)
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

            {/* 使用說明 */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-gray-700">
                <div className="font-semibold mb-1">使用說明</div>
                <ul className="space-y-1 list-disc list-inside">
                    <li>群組語音：按住 PTT 按鈕發話，鬆開停止</li>
                    <li>私人通話：輸入目標 ID，點擊發起通話</li>
                    <li>通話中無法使用群組 PTT</li>
                </ul>
            </div>
        </div>
    );
};

export default PTTAudio;
