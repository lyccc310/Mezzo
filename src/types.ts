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