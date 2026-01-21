
export interface Transcript {
    time: string; // e.g. 14:32:10
    officer: string; // e.g. Rodriguez
    text: string;
}


export interface BackupFile {
    channel: string; // DVR channel
    BeginTime: string; // ISO-like from API
    EndTime: string;
    FileName: string;
    Tag?: string;
}

export interface VideoPlayerProps {
    streamUrl: string;
    camera: {
        id: string;
        position: {
            lat: number;
            lng: number; 
        };
        priority: number;
    };
    autoPlay?: boolean;
    muted?: boolean;
}
export interface Device {
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
    streamUrl?: string;      // HLS 或轉換後的串流 URL
    rtspUrl?: string;        // 原始 RTSP URL (向後相容)
    sourceUrl?: string;      // 原始串流來源 URL (RTSP/HTTP/MJPEG)
    streamType?: 'hls' | 'mjpeg' | 'rtsp' | 'http';  // 串流類型
    lastUpdate?: string;
    battery?: number;
    signal?: number;
    source?: string;
    group?: string;
    role?: string;
    cotType?: string;
}

export interface CameraMapProps {
    devices: Device[];  // ← 加這個
    wsStatus?: 'connecting' | 'connected' | 'disconnected' | 'error';  // ← 加這個
    onDeviceSelect: (device: Device) => void;
}

export interface Message {
    id: string;
    from: string;
    to: string;
    text: string;
    timestamp: string;
    priority?: number;
    audioData?: string;  // Base64 encoded audio data for voice messages
}

export interface TeamMember {
    id: string;
    name: string;
    unit: string;
    status: 'Live' | 'Active' | 'Offline';
    color?: string;  // 新增 color 屬性
}