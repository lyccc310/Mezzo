/**
 * WebRTC PTT 通話管理器
 *
 * 負責處理 WebRTC 連線、音訊串流和 ICE 處理
 */

export interface WebRTCConfig {
    iceServers: RTCIceServer[];
    iceCandidatePoolSize?: number;
}

export interface AudioConstraints {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
    sampleRate?: number;
    channelCount?: number;
}

export interface WebRTCCallbacks {
    onRemoteStream?: (stream: MediaStream) => void;
    onIceCandidate?: (candidate: RTCIceCandidate) => void;
    onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
    onError?: (error: Error) => void;
}

export class WebRTCManager {
    private peerConnection: RTCPeerConnection | null = null;
    private localStream: MediaStream | null = null;
    private config: WebRTCConfig;
    private callbacks: WebRTCCallbacks;
    private audioConstraints: AudioConstraints;

    constructor(
        config?: Partial<WebRTCConfig>,
        audioConstraints?: Partial<AudioConstraints>,
        callbacks?: WebRTCCallbacks
    ) {
        this.config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10,
            ...config
        };

        this.audioConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 1,
            ...audioConstraints
        };

        this.callbacks = callbacks || {};
    }

    /**
     * 初始化作為發送者（說話者）
     */
    async initializeAsSender(): Promise<RTCSessionDescriptionInit> {
        try {
            console.log('🎙️ Initializing WebRTC as sender...');

            // 獲取麥克風
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: this.audioConstraints,
                video: false
            });

            console.log('✅ Got local stream:', this.localStream.id);

            // 創建 PeerConnection
            this.createPeerConnection();

            // 添加本地音軌
            this.localStream.getTracks().forEach(track => {
                if (this.peerConnection && this.localStream) {
                    console.log('📤 Adding track:', track.kind);
                    this.peerConnection.addTrack(track, this.localStream);
                }
            });

            // 創建 Offer
            const offer = await this.peerConnection!.createOffer({
                offerToReceiveAudio: false,  // 發送者不接收音訊
                offerToReceiveVideo: false
            });

            await this.peerConnection!.setLocalDescription(offer);
            console.log('✅ Created offer and set local description');

            return offer;
        } catch (error) {
            console.error('❌ Failed to initialize as sender:', error);
            this.callbacks.onError?.(error as Error);
            throw error;
        }
    }

    /**
     * 初始化作為接收者（監聽者）
     */
    async initializeAsReceiver(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
        try {
            console.log('👂 Initializing WebRTC as receiver...');

            // 創建 PeerConnection
            this.createPeerConnection();

            // 設置遠端描述（offer）
            await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offer));
            console.log('✅ Set remote description (offer)');

            // 創建 Answer
            const answer = await this.peerConnection!.createAnswer();
            await this.peerConnection!.setLocalDescription(answer);
            console.log('✅ Created answer and set local description');

            return answer;
        } catch (error) {
            console.error('❌ Failed to initialize as receiver:', error);
            this.callbacks.onError?.(error as Error);
            throw error;
        }
    }

    /**
     * 處理遠端 Answer（發送者接收）
     */
    async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
        try {
            if (!this.peerConnection) {
                throw new Error('PeerConnection not initialized');
            }

            console.log('📥 Setting remote description (answer)...');
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('✅ Remote description set');
        } catch (error) {
            console.error('❌ Failed to handle answer:', error);
            this.callbacks.onError?.(error as Error);
            throw error;
        }
    }

    /**
     * 添加 ICE Candidate
     */
    async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        try {
            if (!this.peerConnection) {
                console.warn('⚠️ PeerConnection not initialized, ignoring ICE candidate');
                return;
            }

            console.log('🧊 Adding ICE candidate');
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            console.error('❌ Failed to add ICE candidate:', error);
            // ICE candidate 失敗不是致命錯誤，繼續嘗試其他候選
        }
    }

    /**
     * 關閉連線並清理資源
     */
    close(): void {
        console.log('🔌 Closing WebRTC connection...');

        // 停止本地串流
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
                console.log('🛑 Stopped track:', track.kind);
            });
            this.localStream = null;
        }

        // 關閉 PeerConnection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
            console.log('✅ PeerConnection closed');
        }
    }

    /**
     * 獲取連線狀態
     */
    getConnectionState(): RTCPeerConnectionState | null {
        return this.peerConnection?.connectionState || null;
    }

    /**
     * 獲取統計資訊
     */
    async getStats(): Promise<RTCStatsReport | null> {
        if (!this.peerConnection) {
            return null;
        }
        return await this.peerConnection.getStats();
    }

    /**
     * 創建 PeerConnection 並設置事件監聽器
     */
    private createPeerConnection(): void {
        this.peerConnection = new RTCPeerConnection(this.config);

        // ICE Candidate 事件
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('🧊 ICE candidate generated:', event.candidate.candidate);
                this.callbacks.onIceCandidate?.(event.candidate);
            } else {
                console.log('✅ ICE gathering complete');
            }
        };

        // ICE 連線狀態變化
        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('🧊 ICE connection state:', this.peerConnection?.iceConnectionState);
        };

        // 連線狀態變化
        this.peerConnection.onconnectionstatechange = () => {
            const state = this.peerConnection?.connectionState;
            console.log('🔗 Connection state:', state);

            this.callbacks.onConnectionStateChange?.(state!);

            if (state === 'failed' || state === 'disconnected') {
                console.error('❌ Connection failed or disconnected');
                this.callbacks.onError?.(new Error(`Connection ${state}`));
            }
        };

        // 接收遠端音軌（監聽者用）
        this.peerConnection.ontrack = (event) => {
            console.log('🎵 Received remote track:', event.track.kind);
            if (event.streams && event.streams[0]) {
                console.log('🎵 Received remote stream:', event.streams[0].id);
                this.callbacks.onRemoteStream?.(event.streams[0]);
            }
        };

        console.log('✅ PeerConnection created');
    }
}

/**
 * 管理多個 PeerConnection（用於 Mesh 架構）
 */
export class WebRTCMeshManager {
    private connections: Map<string, WebRTCManager> = new Map();
    private config: Partial<WebRTCConfig>;
    private audioConstraints: Partial<AudioConstraints>;
    private callbacks: WebRTCCallbacks;

    constructor(
        config?: Partial<WebRTCConfig>,
        audioConstraints?: Partial<AudioConstraints>,
        callbacks?: WebRTCCallbacks
    ) {
        this.config = config || {};
        this.audioConstraints = audioConstraints || {};
        this.callbacks = callbacks || {};
    }

    /**
     * 為指定用戶創建連線
     */
    createConnection(peerId: string): WebRTCManager {
        if (this.connections.has(peerId)) {
            console.warn(`⚠️ Connection for ${peerId} already exists`);
            return this.connections.get(peerId)!;
        }

        const manager = new WebRTCManager(
            this.config,
            this.audioConstraints,
            this.callbacks
        );

        this.connections.set(peerId, manager);
        console.log(`✅ Created connection for peer: ${peerId}`);

        return manager;
    }

    /**
     * 獲取指定用戶的連線
     */
    getConnection(peerId: string): WebRTCManager | undefined {
        return this.connections.get(peerId);
    }

    /**
     * 移除指定用戶的連線
     */
    removeConnection(peerId: string): void {
        const manager = this.connections.get(peerId);
        if (manager) {
            manager.close();
            this.connections.delete(peerId);
            console.log(`✅ Removed connection for peer: ${peerId}`);
        }
    }

    /**
     * 關閉所有連線
     */
    closeAll(): void {
        console.log(`🔌 Closing all connections (${this.connections.size})...`);
        this.connections.forEach((manager, peerId) => {
            console.log(`🔌 Closing connection for ${peerId}`);
            manager.close();
        });
        this.connections.clear();
        console.log('✅ All connections closed');
    }

    /**
     * 獲取所有連線的狀態
     */
    getAllStates(): Map<string, RTCPeerConnectionState | null> {
        const states = new Map<string, RTCPeerConnectionState | null>();
        this.connections.forEach((manager, peerId) => {
            states.set(peerId, manager.getConnectionState());
        });
        return states;
    }
}
