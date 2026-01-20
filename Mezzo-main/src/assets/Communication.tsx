// 這個版本修正了本地視訊黑屏問題
// 主要修改: 添加 useEffect 來同步視訊流到本地視訊元素

import { useState, useEffect, useRef } from 'react';
import {
    Phone,
    PhoneOff,
    Mic,
    MicOff,
    Volume2,
    VolumeX,
    Users,
    Signal,
    MonitorPlay,
    Upload,
    Video as VideoIcon,
    Image as ImageIcon,
    Lock,
    Unlock,
    Camera,
    CameraOff,
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import type { TeamMember } from '../types.ts';

interface CommunicationProps {
    currentUser: { name: string; unit: string };
    teamMembers: TeamMember[];
}

interface PeerConnection {
    userId: string;
    userName: string;
    connection: RTCPeerConnection;
}

interface MediaSource {
    type: 'stream' | 'image' | 'video';
    url: string;
    controlledBy: string;
}

const SIGNALING_SERVER = 'http://localhost:3001';
const ROOM_ID = 'police-team-call';
const DEFAULT_STREAM_URL = 'http://220.135.209.219:8088/mjpeg_stream.cgi?Auth=QWRtaW46MTIzNA==&ch=1';

const Communication = ({ currentUser, teamMembers }: CommunicationProps) => {
    const [isInCall, setIsInCall] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isSpeakerOn, setIsSpeakerOn] = useState(true);
    const [isVideoEnabled, setIsVideoEnabled] = useState(false);
    const [participantsInCall, setParticipantsInCall] = useState<
        Array<{ userId: string; userName: string }>
    >([]);
    const [connectionStatus, setConnectionStatus] = useState<
        'disconnected' | 'connecting' | 'connected'
    >('disconnected');

    const [mediaSource, setMediaSource] = useState<MediaSource>({
        type: 'stream',
        url: DEFAULT_STREAM_URL,
        controlledBy: '',
    });
    const [showMediaSelector, setShowMediaSelector] = useState(false);
    const [isMediaController, setIsMediaController] = useState(false);
    
    // Draggable control panel state
    const [controlPanelPosition, setControlPanelPosition] = useState({ x: 0, y: window.innerHeight - 120 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const controlPanelRef = useRef<HTMLDivElement>(null);

    const localStreamRef = useRef<MediaStream | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const peerConnectionsRef = useRef<Map<string, PeerConnection>>(new Map());
    const socketRef = useRef<Socket | null>(null);
    const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
    const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
    const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());

    const rtcConfig: RTCConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ],
    };

    // Socket.io initialization
    useEffect(() => {
        // 檢查是否需要啟用 WebRTC 功能
        const enableWebRTC = false;  // 設為 false 禁用 WebRTC 功能

        if (!enableWebRTC) {
            console.log('ℹ️ WebRTC 功能已禁用，Communication 組件將以基本模式運行');
            setConnectionStatus('disconnected');
            return;
        }

        socketRef.current = io(SIGNALING_SERVER, {
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5,
            timeout: 5000,  // 5秒超時
        });

        socketRef.current.on('connect', () => {
            console.log('✅ 已連接到信令服務器');
        });

        socketRef.current.on('disconnect', () => {
            console.log('❌ 已斷開信令服務器連接');
            if (isInCall) {
                setConnectionStatus('disconnected');
            }
        });

        socketRef.current.on('media-source-changed', (source: MediaSource) => {
            console.log('📺 媒體來源已變更:', source);
            setMediaSource(source);
        });

        socketRef.current.on('media-control-status', ({ controlledBy }: { controlledBy: string }) => {
            console.log('🔒 媒體控制權狀態:', controlledBy);
            setIsMediaController(controlledBy === currentUser.name);
        });

        socketRef.current.on(
            'room-users',
            (users: Array<{ userId: string; userName: string; userUnit: string }>) => {
                console.log('📋 收到房間用戶列表:', users);

                setParticipantsInCall((prev) => {
                    const others = users.map((u) => ({ userId: u.userId, userName: u.userName }));
                    // 去重合併
                    const map = new Map<string, { userId: string; userName: string }>();
                    [...prev, ...others].forEach((u) => map.set(u.userId, u));
                    return Array.from(map.values());
                });

                // ❌ 不要在這裡 createAndSendOffer
            },
        );


        socketRef.current.on(
            'user-joined',
            async ({ userId, userName }: { userId: string; userName: string }) => {
                console.log('👤 新用戶加入:', userName);
                setParticipantsInCall((prev) => [...prev, { userId, userName }]);

                // 只有原本在房間的人（收到這個事件的）來發 offer
                await createAndSendOffer(userId, userName);
            },
        );


        socketRef.current.on('offer', async ({ offer, from, fromUser }: any) => {
            console.log('📥 收到 offer 來自:', fromUser?.userName || from);
            await handleReceiveOffer(offer, from, fromUser?.userName || 'Unknown');
        });

        socketRef.current.on('answer', async ({ answer, from }: any) => {
            console.log('📥 收到 answer 來自:', from);
            await handleReceiveAnswer(answer, from);
        });

        socketRef.current.on('ice-candidate', async ({ candidate, from }: any) => {
            console.log('🧊 收到 ICE candidate 來自:', from);
            await handleReceiveIceCandidate(candidate, from);
        });

        socketRef.current.on(
            'user-left',
            ({ userId, userName }: { userId: string; userName: string }) => {
                console.log('👋 用戶離開:', userName);
                handleUserLeft(userId);
            },
        );

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        };
    }, [currentUser.name]);

    // ✅ 關鍵修正: 同步本地視訊流到視訊元素
    useEffect(() => {
        const updateLocalVideo = () => {
            if (!localVideoRef.current || !localStreamRef.current || !isVideoEnabled) {
                return;
            }

            const videoTracks = localStreamRef.current.getVideoTracks();

            if (videoTracks.length === 0) {
                console.warn('⚠️ 沒有視訊軌道可用');
                return;
            }

            // 創建只包含視訊的新流
            // const videoOnlyStream = new MediaStream(videoTracks);

            // 只在需要時更新
            if (localVideoRef.current.srcObject !== localStreamRef.current) {
                localVideoRef.current.srcObject = localStreamRef.current;

                // 確保播放
                const playPromise = localVideoRef.current.play();

                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            console.log('✅ 本地視訊播放成功');
                        })
                        .catch(error => {
                            console.error('❌ 本地視訊播放失敗:', error);
                            // 嘗試重新播放
                            setTimeout(() => {
                                localVideoRef.current?.play();
                            }, 100);
                        });
                }

                console.log('✅ 本地視訊流已更新:', {
                    videoTracks: videoTracks.length,
                    trackLabel: videoTracks[0].label,
                    trackEnabled: videoTracks[0].enabled,
                    trackState: videoTracks[0].readyState
                });
            }
        };

        // 立即更新
        updateLocalVideo();

        // 設置定時器確保更新 (每秒檢查一次)
        // const intervalId = setInterval(updateLocalVideo, 1000);
    }, [isVideoEnabled, isInCall]);

    const initializeLocalStream = async (includeVideo: boolean = false) => {
        try {
            const constraints: MediaStreamConstraints = {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
                video: includeVideo
                    ? {
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        facingMode: 'user',
                    }
                    : false,
            };

            // ✅ 用完整的 constraints，這樣 audio+video 都會拿到
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            localStreamRef.current = stream;

            console.log('🎤📹 取得本地媒體流:', {
                audioTracks: stream.getAudioTracks().length,
                videoTracks: stream.getVideoTracks().length,
            });

            stream.getVideoTracks().forEach((track) => {
                console.log('📹 Video track:', track.label, 'enabled:', track.enabled, 'readyState:', track.readyState);
                track.enabled = true;
            });

            return stream;
        } catch (error: any) {
            console.error('❌ 無法訪問麥克風/相機:', error);
            if (error.name === 'NotAllowedError') {
                alert('相機/麥克風權限被拒絕\n請在瀏覽器設置中允許訪問相機和麥克風');
            } else if (error.name === 'NotFoundError') {
                alert('未找到相機/麥克風設備\n請確保設備已連接');
            } else if (error.name === 'NotReadableError') {
                alert('相機/麥克風被其他應用程式占用\n請關閉其他使用相機的應用程式');
            } else {
                alert('無法訪問麥克風/相機: ' + error.message);
            }
            throw error;
        }
    };

    // 讓控制面板可在畫面中拖移
    const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!(e.target as HTMLElement).closest('button')) {
            setIsDragging(true);
            setDragOffset({
                x: e.clientX - controlPanelPosition.x,
                y: e.clientY - controlPanelPosition.y,
            });
        }
    };

    const handleDragMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (isDragging) {
            setControlPanelPosition({
                x: e.clientX - dragOffset.x,
                y: e.clientY - dragOffset.y,
            });
        }
    };

    const handleDragEnd = () => {
        setIsDragging(false);
    };

    const createPeerConnection = (userId: string, userName: string): RTCPeerConnection => {
        const pc = new RTCPeerConnection(rtcConfig);

        // 監聽 ICE candidate 事件
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('🧊 發送 ICE candidate 給:', userName);
                socketRef.current?.emit('ice-candidate', {
                    candidate: event.candidate,
                    to: userId,
                });
            }
        };

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track) => {
                pc.addTrack(track, localStreamRef.current!);
                console.log(`📡 已將 ${track.kind} track 加入到 PC for ${userName}:`, {
                    trackId: track.id,
                    enabled: track.enabled,
                    readyState: track.readyState,
                });
            });
        } else {
            console.warn('⚠️ localStreamRef.current 為 null，無法添加軌道');
        }

        pc.ontrack = (event) => {
            console.log(`📻 收到遠程 ${event.track.kind} 流來自:`, userName, {
                trackId: event.track.id,
                streamId: event.streams[0]?.id,
                trackEnabled: event.track.enabled,
                trackState: event.track.readyState,
            });

            const remoteStream = event.streams[0];
            if (!remoteStream) {
                console.error('❌ 沒有收到 remoteStream');
                return;
            }

            // ✅ 先把整個 stream 存起來，給 <video> ref callback 用
            remoteStreamsRef.current.set(userId, remoteStream);

            if (event.track.kind === 'audio') {
                let audioElement = audioElementsRef.current.get(userId);
                if (!audioElement) {
                    audioElement = new Audio();
                    audioElement.autoplay = true;
                    audioElement.volume = isSpeakerOn ? 1 : 0;
                    audioElementsRef.current.set(userId, audioElement);
                }
                audioElement.srcObject = remoteStream;
                console.log('✅ 音訊已設置 for:', userName);
            }

            if (event.track.kind === 'video') {
                const videoElement = videoElementsRef.current.get(userId);
                if (videoElement) {
                    videoElement.srcObject = remoteStream;
                    videoElement.autoplay = true;
                    videoElement.playsInline = true;
                    videoElement.muted = false;

                    videoElement
                        .play()
                        .then(() => console.log('✅ 遠端視訊播放成功 for:', userName))
                        .catch((err) => {
                            console.error('❌ 播放遠端視訊失敗:', err);
                            setTimeout(() => videoElement.play().catch((e) => console.error('重試播放失敗:', e)), 500);
                        });
                } else {
                    console.warn('⚠️ ontrack 時還沒有 videoElement，已先儲存 stream，等 ref 再綁:', userName);
                }
            }
        };

        pc.onconnectionstatechange = () => {
            console.log(`🔗 連接狀態 with ${userName}:`, pc.connectionState);
            if (pc.connectionState === 'connected') {
                setConnectionStatus('connected');
            } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                console.warn(`⚠️ 與 ${userName} 的連接失敗`);
                handleUserLeft(userId);
            }
        };

        pc.oniceconnectionstatechange = () => {
            console.log(`🧊 ICE 狀態 with ${userName}:`, pc.iceConnectionState);
        };

        return pc;
    };

    const createAndSendOffer = async (userId: string, userName: string) => {
        try {
            const pc = createPeerConnection(userId, userName);
            peerConnectionsRef.current.set(userId, { userId, userName, connection: pc });

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socketRef.current?.emit('offer', {
                offer,
                to: userId,
            });

            console.log('📤 已發送 offer 給:', userName);
        } catch (error) {
            console.error('❌ 創建 offer 失敗:', error);
        }
    };

    const handleReceiveOffer = async (
        offer: RTCSessionDescriptionInit,
        from: string,
        userName: string,
    ) => {
        try {
            const pc = createPeerConnection(from, userName);
            peerConnectionsRef.current.set(from, { userId: from, userName, connection: pc });

            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socketRef.current?.emit('answer', {
                answer,
                to: from,
            });

            setParticipantsInCall((prev) => {
                if (!prev.some((p) => p.userId === from)) {
                    return [...prev, { userId: from, userName }];
                }
                return prev;
            });

            console.log('📤 已發送 answer 給:', userName);
        } catch (error) {
            console.error('❌ 處理 offer 失敗:', error);
        }
    };

    const handleReceiveAnswer = async (answer: RTCSessionDescriptionInit, from: string) => {
        try {
            const peer = peerConnectionsRef.current.get(from);
            if (peer) {
                await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
                console.log('✅ 已設置 remote description for:', peer.userName);
            }
        } catch (error) {
            console.error('❌ 處理 answer 失敗:', error);
        }
    };

    const handleReceiveIceCandidate = async (
        candidate: RTCIceCandidateInit,
        from: string,
    ) => {
        try {
            const peer = peerConnectionsRef.current.get(from);
            if (peer && candidate) {
                await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (error) {
            console.error('❌ 添加 ICE candidate 失敗:', error);
        }
    };

    const joinCall = async () => {

        try {
            setConnectionStatus('connecting');

            await initializeLocalStream(true);  // 必須是 true!
            setIsVideoEnabled(true);

            socketRef.current?.emit('join-room', {
                roomId: ROOM_ID,
                userName: currentUser.name,
                userUnit: currentUser.unit,
            });

            setIsInCall(true);
            setParticipantsInCall([{ userId: socketRef.current?.id || 'me', userName: currentUser.name }]);

            console.log('✅ 已加入通話房間');
        } catch (error) {
            console.error('❌ 加入通話失敗:', error);
            setConnectionStatus('disconnected');
        }
    };

    const leaveCall = () => {
        console.log('👋 離開通話');
        socketRef.current?.emit('leave-room');

        peerConnectionsRef.current.forEach((peer) => {
            peer.connection.close();
        });
        peerConnectionsRef.current.clear();

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach((track) => track.stop());
            localStreamRef.current = null;
        }

        audioElementsRef.current.forEach((audio) => {
            audio.pause();
            audio.srcObject = null;
        });
        audioElementsRef.current.clear();
        videoElementsRef.current.clear();

        setIsInCall(false);
        setIsVideoEnabled(false);
        setParticipantsInCall([]);
        setConnectionStatus('disconnected');
        setIsMediaController(false);
        setControlPanelPosition({ x: 0, y: 0 }); // Reset panel position
    };

    const handleUserLeft = (userId: string) => {
        const peer = peerConnectionsRef.current.get(userId);
        if (peer) {
            peer.connection.close();
            peerConnectionsRef.current.delete(userId);
        }

        const audioElement = audioElementsRef.current.get(userId);
        if (audioElement) {
            audioElement.pause();
            audioElement.srcObject = null;
            audioElementsRef.current.delete(userId);
        }

        videoElementsRef.current.delete(userId);
        setParticipantsInCall((prev) => prev.filter((p) => p.userId !== userId));
    };

    const toggleMute = () => {
        if (localStreamRef.current) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsMuted(!audioTrack.enabled);
            }
        }
    };

    const toggleSpeaker = () => {
        const newVolume = isSpeakerOn ? 0 : 1;
        audioElementsRef.current.forEach((audio) => {
            audio.volume = newVolume;
        });
        setIsSpeakerOn(!isSpeakerOn);
    };

    const toggleVideo = async () => {
        if (!localStreamRef.current) return;

        const videoTrack = localStreamRef.current.getVideoTracks()[0];

        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            setIsVideoEnabled(videoTrack.enabled);
            console.log('📹 視訊已', videoTrack.enabled ? '啟用' : '停用');
        } else {
            try {
                const videoStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        facingMode: 'user',
                    }
                });

                const newVideoTrack = videoStream.getVideoTracks()[0];
                localStreamRef.current.addTrack(newVideoTrack);

                peerConnectionsRef.current.forEach((peer) => {
                    const sender = peer.connection.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(newVideoTrack);
                    } else {
                        peer.connection.addTrack(newVideoTrack, localStreamRef.current!);
                    }
                });

                setIsVideoEnabled(true);
                console.log('✅ 相機已啟動');
            } catch (error) {
                console.error('❌ 無法啟動相機:', error);
                alert('無法啟動相機,請檢查權限設置');
            }
        }
    };

    const requestMediaControl = () => {
        socketRef.current?.emit('request-media-control');
    };

    const releaseMediaControl = () => {
        socketRef.current?.emit('release-media-control');
        setIsMediaController(false);
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const fileType = file.type.startsWith('image/') ? 'image' : 'video';
        const url = URL.createObjectURL(file);

        const newSource: MediaSource = {
            type: fileType,
            url: url,
            controlledBy: currentUser.name,
        };

        setMediaSource(newSource);
        socketRef.current?.emit('change-media-source', newSource);
        setShowMediaSelector(false);

        console.log(`📁 上傳 ${fileType}:`, file.name);
    };

    const switchToStream = () => {
        const newSource: MediaSource = {
            type: 'stream',
            url: DEFAULT_STREAM_URL,
            controlledBy: currentUser.name,
        };

        setMediaSource(newSource);
        socketRef.current?.emit('change-media-source', newSource);
        setShowMediaSelector(false);
    };

    const renderMediaContent = () => {
        if (mediaSource.type === 'stream') {
            return (
                <img
                    src={mediaSource.url}
                    alt="Live Stream"
                    className="w-full h-full object-contain"
                />
            );
        }

        if (mediaSource.type === 'image') {
            return (
                <img
                    src={mediaSource.url}
                    alt="Shared Image"
                    className="w-full h-full object-contain"
                />
            );
        }

        if (mediaSource.type === 'video') {
            return (
                <video
                    src={mediaSource.url}
                    controls
                    autoPlay
                    loop
                    className="w-full h-full object-contain"
                />
            );
        }

        return null;
    };

    const otherParticipants = participantsInCall.filter(
        p => p.userName !== currentUser.name
    );

    useEffect(() => {
        return () => {
            if (isInCall) {
                leaveCall();
            }
        };
    }, []);

    return (
        <div className="flex-1 overflow-auto">
            <audio
                autoPlay
                muted={true}
                style={{ display: 'none' }}
                ref={(el) => {
                    if (el && localStreamRef.current) {
                        if (el.srcObject !== localStreamRef.current) {
                            el.srcObject = localStreamRef.current;
                        }
                    }
                }}
            />

            <div className="border-b border-gray-200 px-6 py-4">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-semibold text-gray-800">Group Communication</h1>
                    <div className="flex items-center space-x-2">
                        <div
                            className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-sm ${connectionStatus === 'connected'
                                ? 'bg-green-100 text-green-700'
                                : connectionStatus === 'connecting'
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : 'bg-gray-100 text-gray-700'
                                }`}
                        >
                            <Signal className="w-4 h-4" />
                            <span className="capitalize">{connectionStatus}</span>
                        </div>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 px-6 pb-6">
            <div className="col-span-2 space-y-6">
                <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                            <MonitorPlay className="w-5 h-5 text-indigo-600" />
                            <h2 className="font-semibold text-sm text-gray-800">
                                Shared Incident View
                            </h2>
                            <span className="text-xs text-gray-500 ml-2">
                                ({mediaSource.type === 'stream' ? 'Live Stream' :
                                    mediaSource.type === 'image' ? 'Image' : 'Video'})
                            </span>
                            {mediaSource.controlledBy && (
                                <span className="text-xs text-blue-600 flex items-center ml-2">
                                    <Lock className="w-3 h-3 mr-1" />
                                    {mediaSource.controlledBy}
                                </span>
                            )}
                        </div>

                        <div className="relative">
                            {!isMediaController ? (
                                <button
                                    onClick={requestMediaControl}
                                    disabled={!isInCall || !!mediaSource.controlledBy}
                                    className="flex items-center space-x-2 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <Unlock className="w-4 h-4" />
                                    <span>Request Control</span>
                                </button>
                            ) : (
                                <div className="flex items-center space-x-2">
                                    <button
                                        onClick={() => setShowMediaSelector(!showMediaSelector)}
                                        className="flex items-center space-x-2 px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition text-xs"
                                    >
                                        <Upload className="w-4 h-4" />
                                        <span>Change Source</span>
                                    </button>
                                    <button
                                        onClick={releaseMediaControl}
                                        className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition text-xs"
                                    >
                                        Release
                                    </button>
                                </div>
                            )}

                            {showMediaSelector && isMediaController && (
                                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                                    <button
                                        onClick={switchToStream}
                                        className="w-full flex items-center space-x-2 px-4 py-2 hover:bg-gray-50 text-left text-sm"
                                    >
                                        <VideoIcon className="w-4 h-4 text-blue-600" />
                                        <span>Live Stream</span>
                                    </button>
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-full flex items-center space-x-2 px-4 py-2 hover:bg-gray-50 text-left text-sm"
                                    >
                                        <ImageIcon className="w-4 h-4 text-green-600" />
                                        <span>Upload Image</span>
                                    </button>
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-full flex items-center space-x-2 px-4 py-2 hover:bg-gray-50 text-left text-sm"
                                    >
                                        <VideoIcon className="w-4 h-4 text-purple-600" />
                                        <span>Upload Video</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,video/*"
                        onChange={handleFileUpload}
                        className="hidden"
                    />

                    <div className="bg-black aspect-video flex items-center justify-center">
                        {renderMediaContent()}
                    </div>
                </div>

                {/*Group Communication 使用解釋 */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                    <h3 className="font-semibold text-blue-900 mb-3 flex items-center">
                        <Phone className="w-5 h-5 mr-2" />
                        How to Use Group Communication
                    </h3>
                    <ul className="space-y-2 text-sm text-blue-800">
                        <li>• 確保信令服務器正在運行 (http://localhost:3001)</li>
                        <li>• 點擊「Join Call」加入語音頻道(自動開啟相機)</li>
                        <li>• 使用相機按鈕切換視訊開/關</li>
                        <li>• 點擊「Request Control」請求共享畫面控制權</li>
                        <li>• 獲得控制權後可切換串流/上傳圖片/影片</li>
                        <li>• 右側顯示參與者的相機畫面</li>
                        <li>• 使用麥克風/喇叭圖示控制音訊</li>
                    </ul>
                </div>
            </div>

            <div className="col-span-1">
                <div className="lg:col-span-2 space-y-6">
                    {/* Control Panel - Floating when video is enabled */}
                    {isInCall && isVideoEnabled ? (
                        // Video with floating control panel
                        <div 
                            className="bg-white rounded-lg shadow-sm overflow-hidden relative"
                            onMouseMove={handleDragMove}
                            onMouseUp={handleDragEnd}
                            onMouseLeave={handleDragEnd}
                        >
                            <div className="bg-gray-900 rounded-lg overflow-hidden">
                                <video
                                    ref={localVideoRef}
                                    style={{ transform: 'scaleX(-1)' }}
                                    autoPlay
                                    playsInline
                                    muted
                                    className="w-full aspect-video object-cover"
                                    onLoadedMetadata={() => {
                                        console.log('✅ 本地視訊元數據已加載');
                                    }}
                                    onCanPlay={() => {
                                        console.log('✅ 本地視訊可以播放');
                                    }}
                                    onError={(e) => {
                                        console.error('❌ 本地視訊錯誤:', e);
                                    }}
                                />
                                <div className="bg-gray-800 px-3 py-2 text-center">
                                    <div className="font-semibold text-sm text-white flex items-center">
                                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-2"></span>
                                        {currentUser.name} (You)
                                    </div>
                                </div>
                            </div>

                            {/* Floating Control Panel - Draggable */}
                            <div
                                ref={controlPanelRef}
                                onMouseDown={handleDragStart}
                                style={{
                                    position: 'fixed',
                                    top: `${controlPanelPosition.y}px`,
                                    left: `${controlPanelPosition.x}px`,
                                    cursor: isDragging ? 'grabbing' : 'grab',
                                    zIndex: 50,
                                }}
                                className="bg-white rounded-lg shadow-xl p-4 w-80 ring ring-gray-300"
                            >
                               
                                {/* Status Indicators */}
                                <div className="flex justify-center space-x-6 text-xs mb-4 pb-4 border-b border-gray-200">
                                    <div className={`flex items-center space-x-1 ${isMuted ? 'text-red-600' : 'text-green-600'}`}>
                                        {isMuted ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                                        <span>{isMuted ? 'Muted' : 'Mic On'}</span>
                                    </div>
                                    <div className={`flex items-center space-x-1 ${isVideoEnabled ? 'text-green-600' : 'text-red-600'}`}>
                                        {isVideoEnabled ? <Camera className="w-3 h-3" /> : <CameraOff className="w-3 h-3" />}
                                        <span>Camera On</span>
                                    </div>
                                    <div className={`flex items-center space-x-1 ${isSpeakerOn ? 'text-green-600' : 'text-red-600'}`}>
                                        {isSpeakerOn ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                                        <span>{isSpeakerOn ? 'Speaker On' : 'Off'}</span>
                                    </div>
                                </div>

                                {/* Control Buttons */}
                                <div className="flex justify-center gap-2 flex-wrap">
                                    <button
                                        onClick={toggleMute}
                                        className={`${isMuted
                                            ? 'bg-red-500 hover:bg-red-600 text-white'
                                            : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                                            } p-2 rounded-full transition shadow`}
                                        title={isMuted ? 'Unmute' : 'Mute'}
                                    >
                                        {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                                    </button>

                                    <button
                                        onClick={toggleVideo}
                                        className={`${!isVideoEnabled
                                            ? 'bg-red-500 hover:bg-red-600 text-white'
                                            : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                                            } p-2 rounded-full transition shadow`}
                                        title={isVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
                                    >
                                        {isVideoEnabled ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
                                    </button>

                                    <button
                                        onClick={toggleSpeaker}
                                        className={`${!isSpeakerOn
                                            ? 'bg-red-500 hover:bg-red-600 text-white'
                                            : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                                            } p-2 rounded-full transition shadow`}
                                        title={isSpeakerOn ? 'Mute Speaker' : 'Unmute Speaker'}
                                    >
                                        {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
                                    </button>

                                    <button
                                        onClick={leaveCall}
                                        className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-full shadow transition"
                                    >
                                        <PhoneOff className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        // Static control panel when video is off
                        <div className="bg-white rounded-lg shadow-sm p-8">
                            <div className="text-center space-y-6">
                                <div className="flex justify-center">
                                    <div
                                        className={`w-32 h-32 rounded-full flex items-center justify-center ${isInCall ? 'bg-green-500 animate-pulse' : 'bg-gray-200'
                                            }`}
                                    >
                                        <Users
                                            className={`w-16 h-16 ${isInCall ? 'text-white' : 'text-gray-400'
                                                }`}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <h2 className="text-2xl font-bold text-gray-800">
                                        {isInCall ? 'Group Call Active' : 'No Active Call'}
                                    </h2>
                                    <p className="text-gray-600 mt-2">
                                        {isInCall
                                            ? otherParticipants.length === 0
                                                ? 'You are alone in the call'
                                                : `${otherParticipants.length} other participant${otherParticipants.length > 1 ? 's' : ''
                                                } in call`
                                            : 'Start a group call and discuss the shared incident view together'}
                                    </p>
                                </div>

                                <div className="flex justify-center space-x-4">
                                    {!isInCall ? (
                                        <button
                                            onClick={joinCall}
                                            disabled={connectionStatus === 'connecting'}
                                            className="bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white px-8 py-4 rounded-full flex items-center space-x-2 shadow-lg transition"
                                        >
                                            <Phone className="w-6 h-6" />
                                            <span className="font-semibold">
                                                {connectionStatus === 'connecting' ? 'Connecting...' : 'Join Call'}
                                            </span>
                                        </button>
                                    ) : (
                                        <>
                                            <button
                                                onClick={toggleMute}
                                                className={`${isMuted
                                                    ? 'bg-red-500 hover:bg-red-600 text-white'
                                                    : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                                                    } px-6 py-4 rounded-full transition shadow`}
                                                title={isMuted ? 'Unmute' : 'Mute'}
                                            >
                                                {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                                            </button>

                                            <button
                                                onClick={toggleVideo}
                                                className={`${!isVideoEnabled
                                                    ? 'bg-red-500 hover:bg-red-600 text-white'
                                                    : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                                                    } px-6 py-4 rounded-full transition shadow`}
                                                title={isVideoEnabled ? 'Turn Off Camera' : 'Turn On Camera'}
                                            >
                                                {isVideoEnabled ? <Camera className="w-6 h-6" /> : <CameraOff className="w-6 h-6" />}
                                            </button>

                                            <button
                                                onClick={toggleSpeaker}
                                                className={`${!isSpeakerOn
                                                    ? 'bg-red-500 hover:bg-red-600 text-white'
                                                    : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                                                    } px-6 py-4 rounded-full transition shadow`}
                                                title={isSpeakerOn ? 'Mute Speaker' : 'Unmute Speaker'}
                                            >
                                                {isSpeakerOn ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
                                            </button>

                                            <button
                                                onClick={leaveCall}
                                                className="bg-red-500 hover:bg-red-600 text-white px-8 py-4 rounded-full flex items-center space-x-2 shadow-lg transition"
                                            >
                                                <PhoneOff className="w-6 h-6" />
                                                <span className="font-semibold">Leave Call</span>
                                            </button>
                                        </>
                                    )}
                                </div>

                                {isInCall && (
                                    <div className="flex justify-center space-x-6 text-sm">
                                        <div className={`flex items-center space-x-2 ${isMuted ? 'text-red-600' : 'text-green-600'}`}>
                                            {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                                            <span>{isMuted ? 'Muted' : 'Mic Active'}</span>
                                        </div>
                                        <div className={`flex items-center space-x-2 ${isVideoEnabled ? 'text-green-600' : 'text-red-600'}`}>
                                            {isVideoEnabled ? <Camera className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
                                            <span>{isVideoEnabled ? 'Camera On' : 'Camera Off'}</span>
                                        </div>
                                        <div className={`flex items-center space-x-2 ${isSpeakerOn ? 'text-green-600' : 'text-red-600'}`}>
                                            {isSpeakerOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                                            <span>{isSpeakerOn ? 'Speaker On' : 'Speaker Off'}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="space-y-6 mt-6">
                    <div className="bg-white rounded-lg shadow-sm">
                        <div className="p-4 border-b border-gray-200">
                            <h2 className="font-semibold flex items-center">
                                <Users className="w-5 h-5 mr-2 text-green-600" />
                                Participants ({otherParticipants.length})
                            </h2>
                        </div>
                        <div className="p-4 space-y-3">
                            {otherParticipants.length === 0 ? (
                                <p className="text-gray-500 text-sm text-center py-4">
                                    No other participants
                                </p>
                            ) : (
                                otherParticipants.map((participant) => (
                                    <div
                                        key={participant.userId}
                                        className="bg-gray-900 rounded-lg overflow-hidden"
                                    >
                                        <video
                                            ref={(el) => {
                                                const userId = participant.userId;

                                                if (el) {
                                                    // 記錄這個 user 對應的 video 元素
                                                    videoElementsRef.current.set(userId, el);
                                                    el.autoplay = true;
                                                    el.playsInline = true;
                                                    el.muted = false;

                                                    // ✅ 如果 ontrack 早就收到了 remoteStream，在這裡立刻綁上去
                                                    const cachedStream = remoteStreamsRef.current.get(userId);
                                                    if (cachedStream && !el.srcObject) {
                                                        el.srcObject = cachedStream;
                                                        el
                                                            .play()
                                                            .then(() => console.log('✅ 透過 ref 啟動遠端視訊:', participant.userName))
                                                            .catch((err) => console.error('❌ 透過 ref 播放遠端視訊失敗:', err));
                                                    }
                                                } else {
                                                    // 元素 unmount 時清掉
                                                    videoElementsRef.current.delete(userId);
                                                }
                                            }}
                                            style={{ transform: 'scaleX(-1)' }}
                                            autoPlay
                                            playsInline
                                            className="w-full aspect-video object-cover bg-gray-800"
                                        />
                                        <div className="bg-gray-800 px-3 py-2">
                                            <div className="font-semibold text-sm text-white flex items-center justify-between">
                                                <span>{participant.userName}</span>
                                                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="bg-white rounded-lg shadow-sm">
                        <div className="p-4 border-b border-gray-200">
                            <h2 className="font-semibold">Team Members</h2>
                        </div>
                        <div className="p-4 space-y-3">
                            {teamMembers.map((member) => {
                                const isInCurrentCall = participantsInCall.some(
                                    (p) => p.userName === member.name,
                                );
                                return (
                                    <div
                                        key={member.id}
                                        className={`flex items-center justify-between p-3 rounded-lg ${isInCurrentCall ? 'bg-green-50' : 'bg-gray-50'
                                            }`}
                                    >
                                        <div className="flex items-center space-x-3">
                                            <div
                                                className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${member.status === 'Live'
                                                    ? 'bg-red-500'
                                                    : member.status === 'Active'
                                                        ? 'bg-green-500'
                                                        : 'bg-gray-400'
                                                    }`}
                                            >
                                                {member.name.split(' ').pop()?.substring(0, 2).toUpperCase() || 'NA'}
                                            </div>
                                            <div>
                                                <div className="font-semibold text-sm">{member.name}</div>
                                                <div className="text-xs text-gray-600">{member.unit}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <span
                                                className={`w-2 h-2 rounded-full ${member.status === 'Live'
                                                    ? 'bg-red-500 animate-pulse'
                                                    : member.status === 'Active'
                                                        ? 'bg-green-500'
                                                        : 'bg-gray-400'
                                                    }`}
                                            />
                                            <span className="text-xs text-gray-600">{member.status}</span>
                                            {isInCurrentCall && (
                                                <span className="text-xs text-green-700 font-medium ml-2">
                                                    In Call
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
        </div>
    );
};

export default Communication;