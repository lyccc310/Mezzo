// signaling-server/server.js
// WebRTC 信令伺服器 - 用於協調視訊通話連接

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

// 配置 Socket.IO with CORS
const io = new Server(server, {
    cors: {
        origin: "*", // 開發環境允許所有來源
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// 存儲房間和用戶信息
const rooms = new Map(); // roomId -> Set of socket.id
const users = new Map(); // socket.id -> { userName, userUnit, roomId }

// 媒體控制權管理
const mediaControl = new Map(); // roomId -> controlledBy (userName)

io.on('connection', (socket) => {
    console.log('✅ 新用戶連接:', socket.id);

    // 加入房間
    socket.on('join-room', ({ roomId, userName, userUnit }) => {
        console.log(`👤 ${userName} 加入房間 ${roomId}`);

        // 保存用戶信息
        users.set(socket.id, { userName, userUnit, roomId });
        
        // 加入 Socket.IO 房間
        socket.join(roomId);

        // 初始化房間用戶集合
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
        }
        
        // 獲取房間內現有用戶（排除自己）
        const existingUsers = Array.from(rooms.get(roomId))
            .filter(id => id !== socket.id)
            .map(id => {
                const user = users.get(id);
                return {
                    userId: id,
                    userName: user?.userName || 'Unknown',
                    userUnit: user?.userUnit || 'Unknown'
                };
            });

        // 添加當前用戶到房間
        rooms.get(roomId).add(socket.id);

        // 告訴新用戶房間內現有的用戶
        if (existingUsers.length > 0) {
            console.log(`📋 發送現有用戶列表給 ${userName}:`, existingUsers);
            socket.emit('room-users', existingUsers);
        }

        // 通知房間內其他用戶有新人加入
        socket.to(roomId).emit('user-joined', {
            userId: socket.id,
            userName,
            userUnit
        });

        console.log(`📊 房間 ${roomId} 現有 ${rooms.get(roomId).size} 人`);
    });

    // 轉發 WebRTC offer
    socket.on('offer', ({ offer, to }) => {
        const fromUser = users.get(socket.id);
        console.log(`📤 轉發 offer: ${fromUser?.userName} -> ${to}`);
        
        io.to(to).emit('offer', {
            offer,
            from: socket.id,
            fromUser: {
                userName: fromUser?.userName,
                userUnit: fromUser?.userUnit
            }
        });
    });

    // 轉發 WebRTC answer
    socket.on('answer', ({ answer, to }) => {
        const fromUser = users.get(socket.id);
        console.log(`📤 轉發 answer: ${fromUser?.userName} -> ${to}`);
        
        io.to(to).emit('answer', {
            answer,
            from: socket.id,
            fromUser: {
                userName: fromUser?.userName,
                userUnit: fromUser?.userUnit
            }
        });
    });

    // 轉發 ICE candidate
    socket.on('ice-candidate', ({ candidate, to }) => {
        // console.log(`🧊 轉發 ICE candidate: ${socket.id} -> ${to}`);
        io.to(to).emit('ice-candidate', {
            candidate,
            from: socket.id
        });
    });

    // 媒體控制權請求
    socket.on('request-media-control', () => {
        const user = users.get(socket.id);
        const roomId = user?.roomId;
        
        if (!roomId) return;

        const currentController = mediaControl.get(roomId);
        
        if (!currentController) {
            // 沒有人控制，授予控制權
            mediaControl.set(roomId, user.userName);
            
            // 通知所有人控制權狀態
            io.to(roomId).emit('media-control-status', {
                controlledBy: user.userName
            });
            
            console.log(`🔒 ${user.userName} 獲得媒體控制權`);
        } else {
            // 已有人控制，拒絕
            socket.emit('media-control-denied', {
                controlledBy: currentController
            });
            
            console.log(`❌ ${user.userName} 請求被拒絕，${currentController} 正在控制`);
        }
    });

    // 釋放媒體控制權
    socket.on('release-media-control', () => {
        const user = users.get(socket.id);
        const roomId = user?.roomId;
        
        if (!roomId) return;

        const currentController = mediaControl.get(roomId);
        
        if (currentController === user.userName) {
            mediaControl.delete(roomId);
            
            // 通知所有人控制權已釋放
            io.to(roomId).emit('media-control-status', {
                controlledBy: null
            });
            
            console.log(`🔓 ${user.userName} 釋放媒體控制權`);
        }
    });

    // 媒體來源變更
    socket.on('change-media-source', (source) => {
        const user = users.get(socket.id);
        const roomId = user?.roomId;
        
        if (!roomId) return;

        // 廣播給房間內所有人（包括自己）
        io.to(roomId).emit('media-source-changed', source);
        
        console.log(`📺 ${user.userName} 變更媒體來源:`, source.type);
    });

    // 離開房間
    socket.on('leave-room', () => {
        handleUserLeave(socket);
    });

    // 斷開連接
    socket.on('disconnect', () => {
        console.log('❌ 用戶斷開連接:', socket.id);
        handleUserLeave(socket);
    });

    // 處理用戶離開的通用函數
    function handleUserLeave(socket) {
        const user = users.get(socket.id);
        
        if (user) {
            const { roomId, userName } = user;
            
            // 從房間移除用戶
            if (rooms.has(roomId)) {
                rooms.get(roomId).delete(socket.id);
                
                // 如果房間空了，刪除房間
                if (rooms.get(roomId).size === 0) {
                    rooms.delete(roomId);
                    mediaControl.delete(roomId);
                    console.log(`🗑️ 房間 ${roomId} 已清空`);
                } else {
                    // 通知房間內其他人
                    io.to(roomId).emit('user-left', {
                        userId: socket.id,
                        userName
                    });
                }
                
                console.log(`👋 ${userName} 離開房間 ${roomId}`);
            }
            
            // 如果離開的用戶正在控制媒體，釋放控制權
            if (mediaControl.get(roomId) === userName) {
                mediaControl.delete(roomId);
                io.to(roomId).emit('media-control-status', {
                    controlledBy: null
                });
            }
            
            // 刪除用戶信息
            users.delete(socket.id);
        }
    }
});

// 健康檢查端點
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        connections: io.engine.clientsCount,
        rooms: rooms.size,
        users: users.size
    });
});

// 房間列表端點
app.get('/rooms', (req, res) => {
    const roomList = Array.from(rooms.entries()).map(([roomId, userIds]) => ({
        roomId,
        userCount: userIds.size,
        users: Array.from(userIds).map(id => users.get(id)?.userName)
    }));
    res.json(roomList);
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
    console.log('🚀 信令伺服器啟動在 port', PORT);
    console.log('📡 WebSocket 端點: ws://localhost:' + PORT);
    console.log('🏥 健康檢查: http://localhost:' + PORT + '/health');
});

// 優雅關閉
process.on('SIGTERM', () => {
    console.log('⚠️ 收到 SIGTERM 信號，準備關閉伺服器...');
    server.close(() => {
        console.log('✅ 伺服器已關閉');
        process.exit(0);
    });
});