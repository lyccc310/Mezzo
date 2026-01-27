// src/assets/Device.tsx
import { useEffect, useState } from 'react';
import {
  Server,
  HardDrive,
  Camera as CameraIcon,
  RefreshCcw,
  AlertCircle,
  MapPin,
  Wifi,
  Plus,
  X,
} from 'lucide-react';

// === 型別定義 ===
type ServerInfo = {
  Version: string;
  ModelName: string;
  HostName: string;
  PortBase: number;
  RTSPPort: number;
  MaxVideoCount: number;
  VideoCount: number;
  AnalogCamCount: number;
};

type CameraInfo = {
  channelID: number;
  Enable: string;
  desc: string;
};

// GPSTracking 設備
type GPSDevice = {
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
};

type NvrServer = {
  id: string;
  name: string;
  type: 'nvr' | 'tak';
  apiBase: string;
  displayHost: string;
  auth?: string;
  note?: string;
};

// NVR 和 ATAK Server 清單
const SERVERS: NvrServer[] = [
  {
    id: 'guardeye',
    name: 'Guardeye NVR',
    type: 'nvr',
    apiBase: '/nvr',
    displayHost: '220.135.209.219:8088',
    auth: 'QWRtaW46MTIzNA==',
    note: 'Messo-NVR',
  },
  {
    id: 'atak',
    name: 'ATAK Server',
    type: 'tak',
    apiBase: 'http://localhost:4000',
    displayHost: 'localhost:4000',
    note: 'GPS Tracking',
  },
];

const Device = () => {
  const [selectedServer, setSelectedServer] = useState<NvrServer>(SERVERS[0]);

  // NVR 相關狀態
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [cameraList, setCameraList] = useState<CameraInfo[]>([]);

  // ATAK 相關狀態
  const [gpsDevices, setGpsDevices] = useState<GPSDevice[]>([]);
  const [atakStatus, setAtakStatus] = useState<{
    connected: boolean;
    deviceCount: number;
    lastUpdate?: string;
  } | null>(null);

  const [loadingInfo, setLoadingInfo] = useState(false);
  const [loadingCamera, setLoadingCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ===== 註冊表單狀態 =====
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerMessage, setRegisterMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [formData, setFormData] = useState({
    streamId: '',
    callsign: '',
    streamType: 'rtsp',  // 'rtsp', 'http', 'mjpeg'
    streamUrl: '',       // 統一使用 streamUrl
    lat: '25.0338',
    lon: '121.5646',
    alt: '0',
    priority: '3',
    group: 'Cameras',
    directStream: true,  // 預設使用直接串流（MJPEG 不轉換）
  });

  // 取得 NVR Server Info
  const fetchServerInfo = async (server: NvrServer) => {
    setLoadingInfo(true);
    setError(null);
    try {
      const res = await fetch(`${server.apiBase}/GetServerInfo.cgi`);
      if (!res.ok) throw new Error(`GetServerInfo HTTP ${res.status}`);
      const data: ServerInfo = await res.json();
      setServerInfo(data);
    } catch (e: any) {
      console.error('GetServerInfo error:', e);
      setServerInfo(null);
      setError(e?.message ?? '無法取得 NVR 伺服器資訊');
    } finally {
      setLoadingInfo(false);
    }
  };

  // 取得 NVR Camera List
  const fetchCameraList = async (server: NvrServer) => {
    setLoadingCamera(true);
    setError(null);
    try {
      const url = `${server.apiBase}/CameraList.cgi?Auth=${server.auth ?? ''}&ch=1`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`CameraList HTTP ${res.status}`);

      const data = await res.json();
      let list: CameraInfo[] = [];
      if (Array.isArray(data)) {
        list = data as CameraInfo[];
      } else if (data && Array.isArray((data as any).cameras)) {
        list = (data as any).cameras as CameraInfo[];
      }

      setCameraList(list);
    } catch (e: any) {
      console.error('CameraList error:', e);
      setCameraList([]);
      setError(e?.message ?? '無法取得攝影機列表');
    } finally {
      setLoadingCamera(false);
    }
  };

  // 取得 ATAK/GPS 設備列表
  const fetchGPSDevices = async () => {
    setLoadingCamera(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:4000/devices');
      if (!res.ok) throw new Error(`Failed to fetch devices: ${res.status}`);

      const data = await res.json();
      const devices = (data.devices || []) as GPSDevice[];

      setGpsDevices(devices);
      setAtakStatus({
        connected: true,
        deviceCount: devices.length,
        lastUpdate: new Date().toISOString(),
      });
    } catch (e: any) {
      console.error('GPS Devices error:', e);
      setGpsDevices([]);
      setAtakStatus({
        connected: false,
        deviceCount: 0,
      });
      setError(e?.message ?? '無法取得 GPS 設備列表');
    } finally {
      setLoadingCamera(false);
    }
  };

  // ===== 處理設備註冊 =====
  const handleRegisterDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegistering(true);
    setRegisterMessage(null);

    try {
      // 統一使用後端的串流註冊 API，支援 RTSP 和 HTTP/MJPEG
      const response = await fetch('http://localhost:4000/api/rtsp/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamId: formData.streamId,
          streamUrl: formData.streamUrl,  // 統一使用 streamUrl
          position: {
            lat: parseFloat(formData.lat),
            lon: parseFloat(formData.lon),
            alt: parseFloat(formData.alt),
          },
          priority: parseInt(formData.priority),
          callsign: formData.callsign || formData.streamId,
          group: formData.group || 'Cameras',
          directStream: formData.directStream,  // 是否使用直接串流
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || '註冊失敗');
      }

      const result = await response.json();
      const streamTypeText = formData.streamType === 'rtsp' ? 'RTSP' : 'HTTP/MJPEG';

      setRegisterMessage({
        type: 'success',
        text: `✅ ${streamTypeText} 串流註冊成功！${result.message || '設備已加入系統'}`,
      });

      console.log('註冊成功，返回資料:', result);

      // 重置表單
      setFormData({
        streamId: '',
        callsign: '',
        streamType: 'rtsp',
        streamUrl: '',
        lat: '25.0338',
        lon: '121.5646',
        alt: '0',
        priority: '3',
        group: 'Cameras',
        directStream: true,
      });

      // 3 秒後清除訊息並重新載入列表
      setTimeout(() => {
        setRegisterMessage(null);
        setShowRegisterForm(false);
        fetchGPSDevices(); // 重新抓取列表以更新 UI
      }, 3000);

    } catch (error) {
      console.error('註冊錯誤:', error);
      setRegisterMessage({
        type: 'error',
        text: '❌ 註冊失敗: ' + (error instanceof Error ? error.message : String(error)),
      });
    } finally {
      setRegistering(false);
    }
  };

  // 切換伺服器時載入對應資料
  useEffect(() => {
    if (!selectedServer) return;

    if (selectedServer.type === 'nvr') {
      fetchServerInfo(selectedServer);
      fetchCameraList(selectedServer);
      setGpsDevices([]);
      setAtakStatus(null);
      setShowRegisterForm(false);
    } else if (selectedServer.type === 'tak') {
      fetchGPSDevices();
      setServerInfo(null);
      setCameraList([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer.id]);

  const handleRefresh = () => {
    if (selectedServer.type === 'nvr') {
      fetchServerInfo(selectedServer);
      fetchCameraList(selectedServer);
    } else if (selectedServer.type === 'tak') {
      fetchGPSDevices();
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-slate-900">
      {/* 頁面標題列 */}
      <div className="border-b border-slate-700/50 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-100">Device Management</h1>
          <div className="flex gap-2">
            {selectedServer.type === 'tak' && (
              <button
                onClick={() => setShowRegisterForm(!showRegisterForm)}
                className="flex items-center space-x-2 px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
              >
                {showRegisterForm ? (
                  <>
                    <X className="w-4 h-4" />
                    <span>關閉表單</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>註冊設備</span>
                  </>
                )}
              </button>
            )}
            <button
              onClick={handleRefresh}
              className="flex items-center space-x-2 px-3 py-1.5 border border-slate-600 rounded text-sm text-slate-300 hover:bg-slate-800"
            >
              <RefreshCcw className="w-4 h-4" />
              <span>重新整理</span>
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
        {/* 左側：Server 清單 */}
        <div className="space-y-4">
          <div className="bg-slate-800/50 rounded-lg border border-slate-700/50">
            <div className="p-4 border-b border-slate-700/50 flex items-center">
              <Server className="w-5 h-5 text-indigo-400 mr-2" />
              <h2 className="font-semibold text-sm text-slate-100">Servers</h2>
            </div>
            <div className="p-3 space-y-2">
              {SERVERS.map((server) => {
                const isActive = selectedServer?.id === server.id;
                return (
                  <button
                    key={server.id}
                    onClick={() => setSelectedServer(server)}
                    className={`w-full text-left px-3 py-2 rounded-lg border flex flex-col text-sm transition ${
                      isActive
                        ? 'border-indigo-500 bg-indigo-950/50'
                        : 'border-slate-600 bg-slate-700/50 hover:bg-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {server.type === 'nvr' ? (
                          <CameraIcon className="w-4 h-4 text-blue-400" />
                        ) : (
                          <MapPin className="w-4 h-4 text-emerald-400" />
                        )}
                        <span className="font-semibold text-slate-200">{server.name}</span>
                      </div>
                      {server.note && (
                        <span className="text-xs text-slate-400">{server.note}</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-1 ml-6">
                      {server.displayHost}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 提示 */}
          <div className="bg-amber-950/50 border border-amber-800/50 text-xs text-amber-300 rounded-lg p-3">
            <p className="font-semibold flex items-center mb-1">
              <AlertCircle className="w-4 h-4 mr-1" />
              提醒
            </p>
            <p>
              {selectedServer.type === 'nvr' ? (
                <>
                  NVR 請透過 Vite Proxy <code className="mx-1 bg-amber-900/50 px-1 rounded">/nvr</code> 存取
                </>
              ) : (
                <>
                  ATAK Server 管理 GPS 設備與影像串流
                </>
              )}
            </p>
          </div>
        </div>

        {/* 右側：伺服器資訊 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 註冊表單（僅 ATAK Server） */}
          {selectedServer.type === 'tak' && showRegisterForm && (
            <div className="bg-slate-800/50 rounded-lg border-2 border-blue-700/50">
              <div className="p-4 border-b border-slate-700/50 bg-blue-950/50">
                <h2 className="font-semibold text-sm text-slate-100 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-blue-400" />
                  註冊新設備
                </h2>
              </div>
              <div className="p-4">
                {registerMessage && (
                  <div
                    className={`mb-3 p-3 rounded text-sm ${
                      registerMessage.type === 'success'
                        ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/50'
                        : 'bg-red-950/50 text-red-300 border border-red-800/50'
                    }`}
                  >
                    {registerMessage.text}
                  </div>
                )}

                <form onSubmit={handleRegisterDevice} className="space-y-3">
                  {/* 串流類型 */}
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center cursor-pointer text-slate-200">
                      <input
                        type="radio"
                        value="rtsp"
                        checked={formData.streamType === 'rtsp'}
                        onChange={(e) =>
                          setFormData({ ...formData, streamType: e.target.value })
                        }
                        className="mr-2"
                      />
                      <span className="font-medium">RTSP 串流</span>
                    </label>
                    <label className="flex items-center cursor-pointer text-slate-200">
                      <input
                        type="radio"
                        value="http"
                        checked={formData.streamType === 'http'}
                        onChange={(e) =>
                          setFormData({ ...formData, streamType: e.target.value })
                        }
                        className="mr-2"
                      />
                      <span className="font-medium">HTTP/MJPEG 串流</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* 設備 ID */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">
                        設備 ID *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="CAM-001"
                        value={formData.streamId}
                        onChange={(e) =>
                          setFormData({ ...formData, streamId: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-400 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    {/* 顯示名稱 */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">
                        顯示名稱
                      </label>
                      <input
                        type="text"
                        placeholder="前門攝像頭"
                        value={formData.callsign}
                        onChange={(e) =>
                          setFormData({ ...formData, callsign: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-400 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    {/* 串流 URL */}
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-slate-300 mb-1">
                        {formData.streamType === 'rtsp' ? 'RTSP URL *' : 'HTTP/MJPEG URL *'}
                      </label>
                      <input
                        type="text"
                        required
                        placeholder={
                          formData.streamType === 'rtsp'
                            ? 'rtsp://admin:1234@192.168.1.100:554/stream1'
                            : 'http://118.163.141.80:80/mjpeg_stream.cgi?Auth=QWRtaW46MTIzNA==&ch=0'
                        }
                        value={formData.streamUrl}
                        onChange={(e) =>
                          setFormData({ ...formData, streamUrl: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-400 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">
                        {formData.streamType === 'rtsp'
                          ? '支援 RTSP 協議的攝像頭串流 URL'
                          : '支援 HTTP MJPEG 串流，例如 IP 攝像頭的 MJPEG 端點'}
                      </p>
                    </div>

                    {/* 緯度 */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">
                        緯度 *
                      </label>
                      <input
                        type="number"
                        step="0.000001"
                        required
                        value={formData.lat}
                        onChange={(e) => setFormData({ ...formData, lat: e.target.value })}
                        className="w-full px-3 py-2 text-sm bg-slate-700 border border-slate-600 text-slate-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    {/* 經度 */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">
                        經度 *
                      </label>
                      <input
                        type="number"
                        step="0.000001"
                        required
                        value={formData.lon}
                        onChange={(e) => setFormData({ ...formData, lon: e.target.value })}
                        className="w-full px-3 py-2 text-sm bg-slate-700 border border-slate-600 text-slate-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    {/* 海拔 */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">
                        海拔 (m)
                      </label>
                      <input
                        type="number"
                        value={formData.alt}
                        onChange={(e) => setFormData({ ...formData, alt: e.target.value })}
                        className="w-full px-3 py-2 text-sm bg-slate-700 border border-slate-600 text-slate-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    {/* 優先級 */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">
                        優先級
                      </label>
                      <select
                        value={formData.priority}
                        onChange={(e) =>
                          setFormData({ ...formData, priority: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm bg-slate-700 border border-slate-600 text-slate-200 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="1">P1 - 最高</option>
                        <option value="2">P2 - 高</option>
                        <option value="3">P3 - 一般</option>
                        <option value="4">P4 - 低</option>
                      </select>
                    </div>

                    {/* 群組 */}
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">
                        群組
                      </label>
                      <input
                        type="text"
                        placeholder="Cameras"
                        value={formData.group}
                        onChange={(e) =>
                          setFormData({ ...formData, group: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm bg-slate-700 border border-slate-600 text-slate-200 placeholder-slate-400 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  {/* 串流模式選項 (僅 HTTP/MJPEG 顯示) */}
                  {formData.streamType === 'http' && (
                    <div className="bg-blue-950/50 border border-blue-800/50 rounded p-3">
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.directStream}
                          onChange={(e) =>
                            setFormData({ ...formData, directStream: e.target.checked })
                          }
                          className="mr-2 w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                        />
                        <div>
                          <span className="text-sm font-medium text-slate-200">
                            使用直接串流（推薦）
                          </span>
                          <p className="text-xs text-slate-400 mt-1">
                            MJPEG 可直接顯示，無需轉換，立即可用<br/>
                            取消勾選將使用 FFmpeg 轉換為 HLS（需等待數秒）
                          </p>
                        </div>
                      </label>
                    </div>
                  )}

                  {/* 提交按鈕 */}
                  <button
                    type="submit"
                    disabled={registering}
                    className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {registering ? '註冊中...' : '註冊設備'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* NVR Server Info */}
          {selectedServer.type === 'nvr' && (
            <div className="bg-slate-800/50 rounded-lg border border-slate-700/50">
              <div className="p-4 border-b border-slate-700/50 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <HardDrive className="w-5 h-5 text-blue-400" />
                  <h2 className="font-semibold text-sm text-slate-100">NVR Server Info</h2>
                </div>
                {loadingInfo && <span className="text-xs text-slate-400">載入中…</span>}
              </div>
              <div className="p-4">
                {serverInfo ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide">Model</div>
                      <div className="font-semibold text-slate-200">{serverInfo.ModelName}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide">Version</div>
                      <div className="font-mono text-slate-200">{serverInfo.Version}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide">Host Name</div>
                      <div className="text-slate-200">{serverInfo.HostName}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide">HTTP Port</div>
                      <div className="text-slate-200">{serverInfo.PortBase}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide">RTSP Port</div>
                      <div className="text-slate-200">{serverInfo.RTSPPort}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide">Channels</div>
                      <div className="text-slate-200">
                        {serverInfo.VideoCount} / {serverInfo.MaxVideoCount}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">尚未取得伺服器資訊</div>
                )}
              </div>
            </div>
          )}

          {/* ATAK Server Info */}
          {selectedServer.type === 'tak' && (
            <div className="bg-slate-800/50 rounded-lg border border-slate-700/50">
              <div className="p-4 border-b border-slate-700/50 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Wifi className="w-5 h-5 text-emerald-400" />
                  <h2 className="font-semibold text-sm text-slate-100">ATAK Server Status</h2>
                </div>
                {loadingCamera && <span className="text-xs text-slate-400">載入中…</span>}
              </div>
              <div className="p-4">
                {atakStatus ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide">狀態</div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            atakStatus.connected ? 'bg-emerald-500' : 'bg-red-500'
                          }`}
                        />
                        <span className="font-semibold text-slate-200">
                          {atakStatus.connected ? '已連接' : '未連接'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide">設備數量</div>
                      <div className="font-semibold text-slate-200">
                        {atakStatus.deviceCount} 個設備
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide">伺服器</div>
                      <div className="text-slate-200">{selectedServer.displayHost}</div>
                    </div>
                    {atakStatus.lastUpdate && (
                      <div>
                        <div className="text-slate-400 text-xs uppercase tracking-wide">
                          最後更新
                        </div>
                        <div className="text-slate-300 text-xs">
                          {new Date(atakStatus.lastUpdate).toLocaleString('zh-TW')}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">載入伺服器狀態中…</div>
                )}
              </div>
            </div>
          )}

          {/* Camera/Device List */}
          <div className="bg-slate-800/50 rounded-lg border border-slate-700/50">
            <div className="p-4 border-b border-slate-700/50 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CameraIcon className="w-5 h-5 text-emerald-400" />
                <h2 className="font-semibold text-sm text-slate-100">
                  {selectedServer.type === 'nvr' ? 'Camera List' : 'GPS Devices'}
                </h2>
              </div>
              {loadingCamera && <span className="text-xs text-slate-400">載入中…</span>}
            </div>

            <div className="p-4 overflow-auto">
              {/* NVR Camera List */}
              {selectedServer.type === 'nvr' && (
                <>
                  {cameraList.length === 0 && !loadingCamera ? (
                    <div className="text-sm text-slate-400 text-center py-6">
                      目前沒有攝影機資料
                    </div>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-700/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-slate-200">Channel</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-200">Status</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-200">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cameraList.map((cam) => (
                          <tr key={cam.channelID} className="odd:bg-slate-800/30 even:bg-slate-700/30 border-b border-slate-700/30">
                            <td className="px-3 py-2 font-mono text-slate-300">{cam.channelID}</td>
                            <td className="px-3 py-2">
                              {cam.Enable === '1' ? (
                                <span className="inline-flex items-center text-xs text-emerald-400">
                                  <span className="w-2 h-2 rounded-full bg-emerald-500 mr-1" />
                                  Enabled
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-xs text-slate-400">
                                  <span className="w-2 h-2 rounded-full bg-slate-500 mr-1" />
                                  Disabled
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-300">{cam.desc}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}

              {/* GPS Devices List */}
              {selectedServer.type === 'tak' && (
                <>
                  {gpsDevices.length === 0 && !loadingCamera ? (
                    <div className="text-sm text-slate-400 text-center py-6">
                      目前沒有 GPS 設備
                      <br />
                      點擊上方「註冊設備」按鈕新增設備
                    </div>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-700/50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-slate-200">設備 ID</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-200">名稱</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-200">類型</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-200">位置</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-200">優先級</th>
                          <th className="px-3 py-2 text-left font-semibold text-slate-200">狀態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gpsDevices.map((device) => (
                          <tr key={device.id} className="odd:bg-slate-800/30 even:bg-slate-700/30 border-b border-slate-700/30">
                            <td className="px-3 py-2 font-mono text-slate-300">{device.id}</td>
                            <td className="px-3 py-2 text-slate-300">{device.callsign || '-'}</td>
                            <td className="px-3 py-2">
                              <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded border border-blue-700/50">
                                {device.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-400">
                              {device.position.lat.toFixed(4)}, {device.position.lng.toFixed(4)}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`text-xs px-2 py-0.5 rounded font-bold text-white ${
                                  device.priority === 1
                                    ? 'bg-red-600'
                                    : device.priority === 2
                                    ? 'bg-orange-600'
                                    : device.priority === 3
                                    ? 'bg-blue-600'
                                    : 'bg-slate-600'
                                }`}
                              >
                                P{device.priority || 3}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              {device.status === 'active' ? (
                                <span className="inline-flex items-center text-xs text-emerald-400">
                                  <span className="w-2 h-2 rounded-full bg-emerald-500 mr-1" />
                                  在線
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-xs text-slate-400">
                                  <span className="w-2 h-2 rounded-full bg-slate-500 mr-1" />
                                  離線
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>

            {error && (
              <div className="border-t border-slate-700/50 bg-red-950/50 text-xs text-red-300 px-4 py-2 flex items-center">
                <AlertCircle className="w-4 h-4 mr-1" />
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Device;