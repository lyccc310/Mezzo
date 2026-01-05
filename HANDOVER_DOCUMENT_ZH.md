# Mezzo - TAK Server 整合與 RTSP 視訊串流系統

## 📋 目錄

1. [專案概述](#專案概述)
2. [系統架構](#系統架構)
3. [核心功能](#核心功能)
4. [技術棧](#技術棧)
5. [安裝與部署](#安裝與部署)
6. [測試步驟](#測試步驟)
7. [故障排除](#故障排除)
8. [API 文件](#api-文件)
9. [開發日誌](#開發日誌)

---

## 專案概述

### 目的
建立一個整合 TAK Server、MQTT 通訊和 RTSP 視訊串流的即時監控系統，用於警用執法記錄器的集中管理與監控。

### 主要目標
1. ✅ 整合 TAK Server 進行位置共享和態勢感知
2. ✅ 支援 RTSP 即時視訊串流並轉換為 HLS
3. ✅ 提供 WebSocket 即時通訊
4. ✅ 實現設備管理與群組功能
5. ✅ 支援優先級管理和篩選

### 應用場景
- 警用執法記錄器即時監控
- 多設備位置追蹤
- 即時視訊串流與回放
- 團隊協作與通訊

---

## 系統架構

### 整體架構圖

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  地圖顯示   │  │  視訊播放   │  │  通訊面板   │        │
│  │  Leaflet    │  │  HLS.js     │  │  WebSocket  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└────────────┬────────────────────────────────────────────────┘
             │ HTTP/WebSocket
             ↓
┌─────────────────────────────────────────────────────────────┐
│                    後端 (Node.js)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Express API │  │  WebSocket   │  │  FFmpeg      │     │
│  │  服務器      │  │  服務器      │  │  轉換器      │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│         │                  │                  │             │
│         ↓                  ↓                  ↓             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ TAK Client   │  │ MQTT Client  │  │ Stream Mgr   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└────────┬───────────────────┬───────────────────┬───────────┘
         │                   │                   │
         ↓                   ↓                   ↓
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│  TAK Server    │  │  MQTT Broker   │  │  RTSP Camera   │
│  CoT 訊息      │  │  test.mosquitto│  │  或 MediaMTX   │
└────────────────┘  └────────────────┘  └────────────────┘
```

### 資料流程

1. **設備註冊流程**
   ```
   前端 → POST /api/rtsp/register → 後端
   後端 → 啟動 FFmpeg 轉換 RTSP → HLS
   後端 → 發送 CoT 到 TAK Server
   後端 → 發布到 MQTT
   後端 → 推送到 WebSocket 客戶端
   ```

2. **位置更新流程**
   ```
   設備 → MQTT (myapp/camera/gps) → 後端
   後端 → 更新內部狀態
   後端 → 發送 CoT 到 TAK Server
   後端 → WebSocket 推送到所有客戶端
   ```

3. **視訊串流流程**
   ```
   RTSP 來源 → FFmpeg → HLS (.m3u8 + .ts)
   前端 → GET /streams/CAM-XXX.m3u8 → 後端靜態文件
   前端 → HLS.js 播放器 → 解碼並播放
   ```

---

## 核心功能

### 1. TAK Server 整合

**CoT (Cursor on Target) 訊息格式**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="CAM-001" type="b-m-p-s-p-loc" how="m-g" 
       time="2026-01-06T00:00:00.000Z" 
       start="2026-01-06T00:00:00.000Z" 
       stale="2026-01-06T00:05:00.000Z">
  <point lat="25.0338" lon="121.5646" hae="10" ce="10.0" le="10.0"/>
  <detail>
    <contact callsign="Camera 001"/>
    <__video url="http://localhost:4000/streams/CAM-001.m3u8"/>
    <__group name="Alpha Team" role="Team Leader"/>
    <remarks>camera - Priority 1</remarks>
    <priority>1</priority>
    <status>active</status>
  </detail>
</event>
```

**功能說明**
- ✅ 自動發送設備位置到 TAK Server
- ✅ 包含視訊串流 URL
- ✅ 支援群組和角色
- ✅ 支援優先級標記
- ✅ 5 分鐘自動刷新 (stale time)

**實作檔案**
- `backend/tak-client.js` - TAK Server 連接和 CoT 生成

---

### 2. RTSP 視訊串流

**轉換流程**
```
RTSP 串流 → FFmpeg → HLS (HTTP Live Streaming)
                      ↓
              .m3u8 (播放列表)
                   +
            多個 .ts (視訊片段)
```

**FFmpeg 參數**
```bash
ffmpeg \
  -rtsp_transport tcp \           # 使用 TCP 傳輸（更穩定）
  -i rtsp://example.com/stream \  # RTSP 來源
  -c:v copy \                     # 複製視訊流（不重新編碼）
  -c:a aac \                      # 音訊轉為 AAC
  -f hls \                        # 輸出為 HLS 格式
  -hls_time 2 \                   # 每個片段 2 秒
  -hls_list_size 5 \              # 播放列表保留 5 個片段
  -hls_flags delete_segments+append_list \  # 刪除舊片段
  output.m3u8
```

**關鍵優化**
- ✅ 使用 `-c:v copy` 避免重新編碼（降低 CPU 使用）
- ✅ 使用 TCP 傳輸提高穩定性
- ✅ 自動刪除舊片段節省空間
- ✅ 2 秒片段降低延遲

**實作檔案**
- `backend/rtsp-converter.js` - RTSP 到 HLS 轉換器
- `backend/camera-manager.js` - 串流管理

---

### 3. WebSocket 即時通訊

**訊息類型**
```javascript
// 1. 客戶端請求設備列表
{
  type: "request_devices"
}

// 2. 伺服器返回初始狀態
{
  type: "initial_state",
  devices: [...],
  groups: [...]
}

// 3. 設備更新通知
{
  type: "devices_update",
  devices: [...]
}

// 4. MQTT 訊息轉發
{
  type: "mqtt_message",
  topic: "myapp/camera/gps",
  message: {...}
}

// 5. 控制命令
{
  type: "send_command",
  topic: "camera/control",
  payload: {
    action: "left",
    deviceId: "CAM-001",
    timestamp: "..."
  }
}
```

**實作檔案**
- `backend/server.js` - WebSocket 服務器 (Port 4001)
- `src/components/CameraMap.tsx` - WebSocket 客戶端

---

### 4. 設備管理

**設備資料結構**
```javascript
{
  id: "CAM-001",              // 唯一識別碼
  type: "camera",             // 設備類型
  callsign: "Camera 001",     // 顯示名稱
  position: {                 // GPS 位置
    lat: 25.0338,
    lng: 121.5646,
    alt: 10
  },
  priority: 1,                // 優先級 (1-4)
  status: "active",           // 狀態
  group: "Alpha Team",        // 群組
  role: "Team Leader",        // 角色
  streamUrl: "/streams/CAM-001.m3u8",  // HLS URL
  rtspUrl: "rtsp://...",      // RTSP 來源
  battery: 85,                // 電量（選填）
  lastUpdate: "2026-01-06..." // 最後更新時間
}
```

**API 端點**
- `POST /api/rtsp/register` - 註冊新攝像頭
- `DELETE /api/rtsp/:streamId` - 刪除串流
- `GET /devices` - 獲取所有設備
- `GET /groups` - 獲取所有群組

---

### 5. 優先級系統

**優先級定義**
- **P1 (紅色)** - 最高優先級，緊急事件
- **P2 (橙色)** - 高優先級，重要任務
- **P3 (藍色)** - 一般優先級，常規巡邏
- **P4 (灰色)** - 低優先級，備用設備

**前端篩選**
- 可勾選多個優先級同時顯示
- 地圖圖標顏色對應優先級
- 設備列表按優先級排序

---

## 技術棧

### 前端
```json
{
  "核心框架": "React 18 + TypeScript",
  "建置工具": "Vite 6",
  "地圖": "Leaflet + React-Leaflet",
  "視訊播放": "HLS.js",
  "樣式": "Tailwind CSS 4",
  "即時通訊": "WebSocket (原生)"
}
```

### 後端
```json
{
  "運行環境": "Node.js 18+",
  "框架": "Express.js",
  "即時通訊": {
    "WebSocket": "ws 庫",
    "MQTT": "mqtt 庫"
  },
  "視訊轉換": "FFmpeg",
  "TAK Server": "原生 TCP Socket"
}
```

### 外部服務
- **TAK Server** - 137.184.101.250:8087 (TCP, 無 TLS)
- **MQTT Broker** - test.mosquitto.org:1883
- **RTSP 來源** - 支援任何標準 RTSP 串流

---

## 安裝與部署

### 系統需求

**硬體需求**
- CPU: 4 核心以上
- RAM: 8GB 以上
- 硬碟: 20GB 可用空間（用於 HLS 片段）
- 網路: 穩定的網際網路連接

**軟體需求**
- Windows 10/11 或 Ubuntu 20.04+
- Node.js 18+ 
- FFmpeg 最新版本
- Git

---

### Windows 安裝步驟

#### 1. 安裝 Node.js

```powershell
# 下載並安裝 Node.js 18 LTS
# https://nodejs.org/

# 驗證安裝
node --version  # 應顯示 v18.x.x 或更高
npm --version
```

#### 2. 安裝 FFmpeg

```powershell
# 方法 A: 使用 Chocolatey
choco install ffmpeg

# 方法 B: 手動安裝
# 1. 下載 FFmpeg: https://www.gyan.dev/ffmpeg/builds/
# 2. 解壓到 C:\ffmpeg
# 3. 添加到 PATH

# 添加到當前 PowerShell 會話
$env:Path = "C:\ffmpeg\bin;" + $env:Path

# 永久添加（需要管理員權限）
[Environment]::SetEnvironmentVariable(
  "Path",
  "C:\ffmpeg\bin;" + [Environment]::GetEnvironmentVariable("Path", "Machine"),
  "Machine"
)

# 驗證安裝
ffmpeg -version
```

#### 3. 克隆專案

```powershell
# 克隆倉庫
git clone https://github.com/lyccc310/Mezzo.git
cd Mezzo

# 切換到開發分支
git checkout feature/mqtt-websocket
```

#### 4. 安裝依賴

```powershell
# 安裝前端依賴
npm install

# 安裝後端依賴
cd backend
npm install
cd ..
```

#### 5. 配置環境

**後端配置 (`backend/.env`)**
```env
# TAK Server
TAK_SERVER_HOST=137.184.101.250
TAK_SERVER_PORT=8087
TAK_USE_TLS=false

# MQTT
MQTT_BROKER=mqtt://test.mosquitto.org:1883

# 服務器端口
HTTP_PORT=4000
WS_PORT=4001

# FFmpeg（選填，如果不在 PATH 中）
FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
```

**前端配置 (`src/config/api.ts`)**
```typescript
export const API_BASE_URL = 'http://localhost:4000';
export const WS_URL = 'ws://localhost:4001';

export const getFullStreamUrl = (streamUrl: string): string => {
  if (!streamUrl) return '';
  if (streamUrl.startsWith('http')) return streamUrl;
  return `${API_BASE_URL}${streamUrl}`;
};
```

#### 6. 啟動服務

**終端 1 - 啟動後端**
```powershell
# 確保 FFmpeg 在 PATH 中
$env:Path = "C:\ffmpeg\bin;" + $env:Path

# 啟動後端
cd backend
node server.js
```

**終端 2 - 啟動前端**
```powershell
# 啟動開發服務器
npm run dev
```

**訪問應用**
- 前端: http://localhost:5173
- 後端 API: http://localhost:4000
- WebSocket: ws://localhost:4001

---

### Linux (Ubuntu) 安裝步驟

```bash
# 1. 更新系統
sudo apt update && sudo apt upgrade -y

# 2. 安裝 Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 3. 安裝 FFmpeg
sudo apt install -y ffmpeg

# 4. 克隆專案
git clone https://github.com/lyccc310/Mezzo.git
cd Mezzo
git checkout feature/mqtt-websocket

# 5. 安裝依賴
npm install
cd backend && npm install && cd ..

# 6. 配置（同 Windows）

# 7. 使用 PM2 啟動（生產環境）
sudo npm install -g pm2

# 啟動後端
pm2 start backend/server.js --name mezzo-backend

# 建置並啟動前端
npm run build
pm2 serve dist 5173 --name mezzo-frontend

# 保存 PM2 配置
pm2 save
pm2 startup
```

---

## 測試步驟

### 測試 1: 本地 RTSP 串流（推薦）

這是最完整的測試，模擬真實 RTSP 攝像頭。

#### 準備工作

1. **下載測試影片**
```powershell
Invoke-WebRequest -Uri "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" -OutFile "test.mp4"
```

2. **下載 MediaMTX (RTSP 服務器)**
```powershell
# 下載
Invoke-WebRequest -Uri "https://github.com/bluenviron/mediamtx/releases/download/v1.9.3/mediamtx_v1.9.3_windows_amd64.zip" -OutFile "mediamtx.zip"

# 解壓
Expand-Archive mediamtx.zip -DestinationPath mediamtx -Force
```

#### 執行測試

**步驟 1: 啟動 MediaMTX（終端 1）**
```powershell
cd mediamtx
.\mediamtx.exe

# 應該看到:
# INF [RTSP] listener opened on :8554
```

**步驟 2: 推送影片到 RTSP（終端 2）**
```powershell
ffmpeg -re -stream_loop -1 -i test.mp4 -c copy -f rtsp rtsp://localhost:8554/test

# 應該看到:
# Output #0, rtsp, to 'rtsp://localhost:8554/test':
#   Stream mapping:
#     Stream #0:0 -> #0:0 (copy)
```

**步驟 3: 啟動後端（終端 3）**
```powershell
$env:Path = "C:\ffmpeg\bin;" + $env:Path
cd backend
node server.js

# 應該看到:
# ✅ Connected to TAK Server
# ✅ MQTT Connected
# 🚀 Server running on http://localhost:4000
# 🔌 WebSocket server listening on port 4001
```

**步驟 4: 啟動前端（終端 4）**
```powershell
npm run dev

# 訪問: http://localhost:5173
```

**步驟 5: 註冊攝像頭（終端 5 或 Postman）**
```powershell
$camera = @{
    streamId = "CAM-LOCAL-001"
    rtspUrl = "rtsp://localhost:8554/test"
    position = @{
        lat = 25.0338
        lon = 121.5646
        alt = 10
    }
    callsign = "Local Test Camera"
    priority = 1
    group = "Test Group"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/rtsp/register" `
  -Method POST `
  -ContentType "application/json" `
  -Body $camera
```

**步驟 6: 驗證**

等待 10-15 秒後：

```powershell
# 檢查 HLS 文件
Get-ChildItem backend/streams/CAM-LOCAL-001*

# 應該看到:
# CAM-LOCAL-001.m3u8
# CAM-LOCAL-001_000.ts
# CAM-LOCAL-001_001.ts
# ...

# 測試 HTTP 訪問
Invoke-WebRequest -Uri "http://localhost:4000/streams/CAM-LOCAL-001.m3u8"

# 應該返回 200 OK
```

**步驟 7: 前端測試**

1. 打開瀏覽器訪問 http://localhost:5173
2. 應該在地圖上看到「Local Test Camera」
3. 點擊攝像頭圖標
4. 點擊「📹 視訊」按鈕
5. 應該開始播放 Big Buck Bunny 影片

**預期結果**
- ✅ 地圖上顯示攝像頭位置
- ✅ WebSocket 狀態顯示「已連接」
- ✅ 影片流暢播放
- ✅ 設備列表顯示「有視訊」標籤
- ✅ TAK Server 收到 CoT 訊息

---

### 測試 2: 外部 RTSP 來源

如果你有真實的 RTSP 攝像頭：

```powershell
$camera = @{
    streamId = "CAM-REAL-001"
    rtspUrl = "rtsp://username:password@192.168.1.100:554/stream"
    position = @{
        lat = 25.0338
        lon = 121.5646
        alt = 10
    }
    callsign = "Real Camera 001"
    priority = 2
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:4000/api/rtsp/register" `
  -Method POST `
  -ContentType "application/json" `
  -Body $camera
```

---

### 測試 3: API 端點測試

```powershell
# 1. 健康檢查
Invoke-RestMethod -Uri "http://localhost:4000/health"

# 2. 獲取所有設備
Invoke-RestMethod -Uri "http://localhost:4000/devices"

# 3. 獲取所有群組
Invoke-RestMethod -Uri "http://localhost:4000/groups"

# 4. 獲取串流列表
Invoke-RestMethod -Uri "http://localhost:4000/api/streams"

# 5. TAK Server 狀態
Invoke-RestMethod -Uri "http://localhost:4000/api/tak/status"

# 6. 刪除串流
Invoke-RestMethod -Uri "http://localhost:4000/api/rtsp/CAM-LOCAL-001" -Method DELETE
```

---

### 測試 4: WebSocket 測試

使用瀏覽器控制台：

```javascript
// 連接 WebSocket
const ws = new WebSocket('ws://localhost:4001');

ws.onopen = () => {
  console.log('✅ WebSocket 連接成功');
  
  // 請求設備列表
  ws.send(JSON.stringify({ type: 'request_devices' }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('📥 收到訊息:', data);
};

ws.onerror = (error) => {
  console.error('❌ WebSocket 錯誤:', error);
};

// 發送控制命令
ws.send(JSON.stringify({
  type: 'send_command',
  topic: 'camera/control',
  payload: {
    action: 'left',
    deviceId: 'CAM-LOCAL-001',
    timestamp: new Date().toISOString()
  }
}));
```

---

### 測試 5: MQTT 測試

使用 MQTT 客戶端（如 MQTT Explorer）：

**訂閱主題**
```
myapp/camera/gps
myapp/cot/message
myapp/camera/status
camera/control
```

**發布 GPS 更新**
```json
Topic: myapp/camera/gps
Payload:
{
  "deviceId": "CAM-LOCAL-001",
  "lat": 25.0400,
  "lon": 121.5700,
  "alt": 15,
  "timestamp": "2026-01-06T10:00:00Z"
}
```

---

### 測試 6: TAK Server 驗證

在 ATAK/WinTAK 中：

1. 連接到 TAK Server (137.184.101.250:8087)
2. 應該看到攝像頭圖標出現在地圖上
3. 點擊圖標應該顯示：
   - Callsign
   - 視訊 URL
   - 群組資訊
   - 優先級
4. 如果支援，可以直接播放視訊

---

## 故障排除

### 問題 1: FFmpeg 找不到

**症狀**
```
Error: spawn ffmpeg ENOENT
```

**解決方法**
```powershell
# 確認 FFmpeg 安裝
ffmpeg -version

# 如果找不到，添加到 PATH
$env:Path = "C:\ffmpeg\bin;" + $env:Path

# 永久添加（需要管理員）
[Environment]::SetEnvironmentVariable(
  "Path",
  "C:\ffmpeg\bin;" + [Environment]::GetEnvironmentVariable("Path", "Machine"),
  "Machine"
)

# 重啟 server.js
```

---

### 問題 2: RTSP 連接超時

**症狀**
```
[CAM-XXX] FFmpeg: Connection timed out
```

**檢查清單**
- ✅ RTSP URL 格式正確
- ✅ 網路可以訪問 RTSP 來源
- ✅ 防火牆未阻擋 RTSP 端口（通常 554）
- ✅ RTSP 服務器正在運行

**測試 RTSP 連接**
```powershell
# 使用 FFmpeg 測試
ffmpeg -rtsp_transport tcp -i "rtsp://your-rtsp-url" -t 5 -f null -

# 使用 VLC 測試
vlc rtsp://your-rtsp-url
```

---

### 問題 3: HLS 文件 404

**症狀**
```
GET http://localhost:4000/streams/CAM-XXX.m3u8 404 (Not Found)
```

**檢查步驟**

1. **確認文件存在**
```powershell
Get-ChildItem backend/streams/
```

2. **檢查靜態文件中間件**
```javascript
// 在 backend/server.js 中應該有：
app.use('/streams', express.static(path.join(__dirname, 'streams')));
```

3. **檢查 Vite 代理**
```javascript
// vite.config.js
export default defineConfig({
  server: {
    proxy: {
      '/streams': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      }
    }
  }
});
```

4. **重啟前後端**

---

### 問題 4: WebSocket 無法連接

**症狀**
```
WebSocket connection to 'ws://localhost:4001' failed
```

**檢查清單**
- ✅ server.js 正在運行
- ✅ Port 4001 未被佔用
- ✅ 防火牆允許 Port 4001

**測試端口**
```powershell
# 檢查端口是否被佔用
netstat -ano | findstr :4001

# 如果被佔用，更改端口
# 在 backend/server.js 中修改 WS_PORT
```

---

### 問題 5: 前端無法載入地圖

**症狀**
- 地圖區域顯示灰色
- 控制台錯誤: `Failed to load tile`

**解決方法**

1. **檢查網路連接**（OpenStreetMap 需要網際網路）

2. **更換地圖源**
```typescript
// 在 CameraMap.tsx 中
<TileLayer
  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  // 或使用其他源:
  // url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
/>
```

---

### 問題 6: TypeScript 錯誤

**症狀**
```
Property 'xxx' does not exist on type 'yyy'
```

**常見解決**
```powershell
# 清除快取並重新安裝
rm -rf node_modules
rm package-lock.json
npm install

# 重啟 TypeScript 服務器（VSCode）
Ctrl+Shift+P → "TypeScript: Restart TS Server"
```

---

### 問題 7: TAK Server 連接失敗

**症狀**
```
❌ TAK Server connection error
```

**檢查清單**
- ✅ TAK Server 地址正確
- ✅ Port 8087 開放
- ✅ 無需 TLS (useTLS: false)
- ✅ 網路可以訪問 137.184.101.250

**測試連接**
```powershell
# 使用 Test-NetConnection
Test-NetConnection -ComputerName 137.184.101.250 -Port 8087

# 如果成功應該顯示:
# TcpTestSucceeded : True
```

---

## API 文件

### RESTful API

#### 健康檢查
```http
GET /health
```

**響應**
```json
{
  "status": "ok",
  "timestamp": "2026-01-06T00:00:00.000Z",
  "mqtt": {
    "connected": true,
    "broker": "mqtt://test.mosquitto.org:1883"
  },
  "takServer": {
    "connected": true,
    "host": "137.184.101.250",
    "port": 8087
  },
  "devices": { "total": 5, "active": 4 },
  "streams": { "total": 3, "active": 3 }
}
```

---

#### 獲取所有設備
```http
GET /devices
```

**響應**
```json
{
  "devices": [
    {
      "id": "CAM-001",
      "type": "camera",
      "callsign": "Camera 001",
      "position": { "lat": 25.0338, "lng": 121.5646, "alt": 10 },
      "priority": 1,
      "status": "active",
      "group": "Alpha Team",
      "streamUrl": "/streams/CAM-001.m3u8",
      "rtspUrl": "rtsp://...",
      "lastUpdate": "2026-01-06T00:00:00.000Z"
    }
  ],
  "count": 1,
  "groups": ["Alpha Team"]
}
```

---

#### 註冊 RTSP 攝像頭
```http
POST /api/rtsp/register
Content-Type: application/json

{
  "streamId": "CAM-001",
  "rtspUrl": "rtsp://example.com/stream",
  "position": {
    "lat": 25.0338,
    "lon": 121.5646,
    "alt": 10
  },
  "callsign": "Camera 001",
  "priority": 1,
  "group": "Alpha Team",
  "role": "Team Leader"
}
```

**響應**
```json
{
  "success": true,
  "message": "Stream registered successfully",
  "streamId": "CAM-001",
  "hlsUrl": "/streams/CAM-001.m3u8",
  "device": { /* 設備資訊 */ }
}
```

---

#### 刪除串流
```http
DELETE /api/rtsp/:streamId
```

**響應**
```json
{
  "success": true,
  "message": "Stream stopped successfully",
  "streamId": "CAM-001"
}
```

---

#### 獲取串流列表
```http
GET /api/streams
```

**響應**
```json
{
  "streams": [
    {
      "streamId": "CAM-001",
      "hlsUrl": "/streams/CAM-001.m3u8",
      "rtspUrl": "rtsp://...",
      "status": "active",
      "startTime": "2026-01-06T00:00:00.000Z"
    }
  ],
  "count": 1
}
```

---

#### TAK Server 狀態
```http
GET /api/tak/status
```

**響應**
```json
{
  "connected": true,
  "host": "137.184.101.250",
  "port": 8087,
  "useTLS": false,
  "queuedMessages": 0
}
```

---

### WebSocket API

**連接**
```
ws://localhost:4001
```

**訊息格式**

1. **請求設備列表**
```json
{ "type": "request_devices" }
```

2. **初始狀態**
```json
{
  "type": "initial_state",
  "devices": [/* ... */],
  "groups": [/* ... */]
}
```

3. **設備更新**
```json
{
  "type": "devices_update",
  "devices": [/* ... */]
}
```

4. **發送命令**
```json
{
  "type": "send_command",
  "topic": "camera/control",
  "payload": {
    "action": "left",
    "deviceId": "CAM-001",
    "timestamp": "2026-01-06T00:00:00.000Z"
  }
}
```

---

## 開發日誌

### 2026-01-05: 初始開發
- ✅ 建立基礎 Express 服務器
- ✅ 整合 MQTT 客戶端
- ✅ 實作 WebSocket 服務器
- ✅ 建立前端 React 應用

### 2026-01-06: TAK Server 整合
- ✅ 實作 TAK Client (tak-client.js)
- ✅ CoT 訊息生成和發送
- ✅ 支援視訊 URL、群組、優先級
- ✅ 自動重連機制

### 2026-01-06: RTSP 串流功能
- ✅ 實作 RTSP Converter (rtsp-converter.js)
- ✅ FFmpeg 參數優化（使用 copy 模式）
- ✅ HLS 文件生成和管理
- ✅ 靜態文件服務
- ✅ 串流生命週期管理

### 2026-01-06: 前端優化
- ✅ Leaflet 地圖整合
- ✅ HLS.js 視訊播放器
- ✅ WebSocket 即時更新
- ✅ 優先級篩選功能
- ✅ 設備詳情面板
- ✅ 響應式設計

### 2026-01-06: 測試與除錯
- ✅ FFmpeg 路徑配置問題解決
- ✅ RTSP 連接超時處理
- ✅ HLS 404 錯誤修復
- ✅ WebSocket 重連機制
- ✅ 本地 RTSP 測試環境建立

### 2026-01-06: 文件撰寫
- ✅ 完整安裝指南
- ✅ 測試步驟文件
- ✅ API 文件
- ✅ 故障排除指南
- ✅ 交接文件

---

## 後續改進建議

### 短期 (1-2 週)
- [ ] 添加使用者認證（JWT）
- [ ] 實作設備電量監控
- [ ] 添加警報和通知系統
- [ ] 支援視訊錄影和回放

### 中期 (1-2 月)
- [ ] 實作資料庫持久化（PostgreSQL/MongoDB）
- [ ] 添加歷史軌跡回放
- [ ] 支援多語言（i18n）
- [ ] 實作權限管理系統

### 長期 (3-6 月)
- [ ] 移動端 App（React Native）
- [ ] AI 視訊分析（物件偵測）
- [ ] 支援 WebRTC 低延遲串流
- [ ] 分散式部署和負載平衡

---

## 貢獻者

- **開發**: Claude AI Assistant
- **測試**: lyccc310
- **專案維護**: lyccc310

---

## 授權

MIT License

---

## 聯絡方式

- **GitHub**: https://github.com/lyccc310/Mezzo
- **Issues**: https://github.com/lyccc310/Mezzo/issues

---

**最後更新**: 2026-01-06
**版本**: 1.0.0
