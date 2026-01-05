export interface TeamMember {
    id: number;
    name: string;
    unit: string;
    status: 'Live' | 'Active' | 'Offline';
    color: 'red' | 'green' | 'gray';
}


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
    battery?: number;
    signal?: number;
    priority?: number;
    streamUrl?: string;  // RTSP/HLS 串流 URL
    rtspUrl?: string;    // 原始 RTSP URL
    lastUpdate: string;
}

export interface CameraMapProps {
    onDeviceSelect?: (device: Device) => void;
}