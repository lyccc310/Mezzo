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
    streamType: 'rtsp',
    rtspUrl: '',
    lat: '25.0338',
    lon: '121.5646',
    alt: '0',
    priority: '3',
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
      if (formData.streamType === 'rtsp') {
        // 註冊 RTSP 攝像頭
        // ==========================================
        // 情況 A: RTSP 攝像頭 (交給後端處理)
        // ==========================================
        
        // 1. 呼叫後端註冊 API
        // 後端會自動產生 CoT 並帶有 <__video> 標籤發送給 WinTAK
        const response = await fetch('http://localhost:4000/api/rtsp/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            streamId: formData.streamId,
            rtspUrl: formData.rtspUrl,
            position: {
              lat: parseFloat(formData.lat),
              lon: parseFloat(formData.lon),
              alt: parseFloat(formData.alt),
            },
            priority: parseInt(formData.priority),
            callsign: formData.callsign || formData.streamId,
            // 可以在這裡帶入 group 參數
            group: 'Cameras' 
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || '註冊失敗');
        }

        // ⚠️ 修正：這裡 "不要" 再手動呼叫 /send-cot
        // 因為後端已經送出過一次 "完美的" CoT (包含影片連結)
        // 如果這裡再送一次，會把原本的影片連結覆蓋掉

        setRegisterMessage({
          type: 'success',
          text: '✅ RTSP 攝像頭註冊成功！WinTAK 應已出現攝影機圖示。',
        });

      } else {
        // ==========================================
        // 情況 B: MJPEG 或其他類型 (前端手動發送)
        // ==========================================
        const response = await fetch('http://localhost:4000/send-cot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: formData.streamId,
            // 建議改用 b-m-p-s-p-loc (感測器/攝影機) 而不是 a-f-G (友軍)
            type: 'b-m-p-s-p-loc', 
            lat: parseFloat(formData.lat),
            lon: parseFloat(formData.lon),
            hae: parseFloat(formData.alt),
            callsign: formData.callsign || formData.streamId,
            // 將 MJPEG 網址放入 remarks，方便在 WinTAK 查看
            remarks: `MJPEG Stream: ${formData.rtspUrl}`,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || '註冊失敗');
        }

        setRegisterMessage({
          type: 'success',
          text: '✅ MJPEG 設備已發送訊號至 WinTAK！',
        });
      }

      // 重置表單
      setFormData({
        streamId: '',
        callsign: '',
        streamType: 'rtsp',
        rtspUrl: '',
        lat: '25.0338',
        lon: '121.5646',
        alt: '0',
        priority: '3',
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
    <div className="flex-1 overflow-auto">
      {/* 頁面標題列 */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-800">Device Management</h1>
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
              className="flex items-center space-x-2 px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
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
          <div className="bg-white rounded-lg shadow-sm">
            <div className="p-4 border-b border-gray-200 flex items-center">
              <Server className="w-5 h-5 text-indigo-600 mr-2" />
              <h2 className="font-semibold text-sm text-gray-800">Servers</h2>
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
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {server.type === 'nvr' ? (
                          <CameraIcon className="w-4 h-4 text-blue-600" />
                        ) : (
                          <MapPin className="w-4 h-4 text-green-600" />
                        )}
                        <span className="font-semibold text-gray-800">{server.name}</span>
                      </div>
                      {server.note && (
                        <span className="text-xs text-gray-500">{server.note}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 ml-6">
                      {server.displayHost}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 提示 */}
          <div className="bg-yellow-50 border border-yellow-200 text-xs text-yellow-800 rounded-lg p-3">
            <p className="font-semibold flex items-center mb-1">
              <AlertCircle className="w-4 h-4 mr-1" />
              提醒
            </p>
            <p>
              {selectedServer.type === 'nvr' ? (
                <>
                  NVR 請透過 Vite Proxy <code className="mx-1">/nvr</code> 存取
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
            <div className="bg-white rounded-lg shadow-sm border-2 border-blue-200">
              <div className="p-4 border-b border-gray-200 bg-blue-50">
                <h2 className="font-semibold text-sm text-gray-800 flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  註冊新設備
                </h2>
              </div>
              <div className="p-4">
                {registerMessage && (
                  <div
                    className={`mb-3 p-3 rounded text-sm ${
                      registerMessage.type === 'success'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {registerMessage.text}
                  </div>
                )}

                <form onSubmit={handleRegisterDevice} className="space-y-3">
                  {/* 串流類型 */}
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center cursor-pointer">
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
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        value="mjpeg"
                        checked={formData.streamType === 'mjpeg'}
                        onChange={(e) =>
                          setFormData({ ...formData, streamType: e.target.value })
                        }
                        className="mr-2"
                      />
                      <span className="font-medium">MJPEG 串流</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* 設備 ID */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
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
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    {/* 顯示名稱 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        顯示名稱
                      </label>
                      <input
                        type="text"
                        placeholder="前門攝像頭"
                        value={formData.callsign}
                        onChange={(e) =>
                          setFormData({ ...formData, callsign: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    {/* 串流 URL */}
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {formData.streamType === 'rtsp' ? 'RTSP URL *' : 'MJPEG URL *'}
                      </label>
                      <input
                        type="text"
                        required
                        placeholder={
                          formData.streamType === 'rtsp'
                            ? 'rtsp://wowzaec2demo.streamlock.net/vod/mp4:BigBuckBunny_115k.mp4'
                            : 'http://example.com/mjpeg_stream.cgi'
                        }
                        value={formData.rtspUrl}
                        onChange={(e) =>
                          setFormData({ ...formData, rtspUrl: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    {/* 緯度 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        緯度 *
                      </label>
                      <input
                        type="number"
                        step="0.000001"
                        required
                        value={formData.lat}
                        onChange={(e) => setFormData({ ...formData, lat: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    {/* 經度 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        經度 *
                      </label>
                      <input
                        type="number"
                        step="0.000001"
                        required
                        value={formData.lon}
                        onChange={(e) => setFormData({ ...formData, lon: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    {/* 海拔 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        海拔 (m)
                      </label>
                      <input
                        type="number"
                        value={formData.alt}
                        onChange={(e) => setFormData({ ...formData, alt: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    {/* 優先級 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        優先級
                      </label>
                      <select
                        value={formData.priority}
                        onChange={(e) =>
                          setFormData({ ...formData, priority: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="1">P1 - 最高</option>
                        <option value="2">P2 - 高</option>
                        <option value="3">P3 - 一般</option>
                        <option value="4">P4 - 低</option>
                      </select>
                    </div>
                  </div>

                  {/* 提交按鈕 */}
                  <button
                    type="submit"
                    disabled={registering}
                    className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {registering ? '註冊中...' : '✅ 註冊設備'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* NVR Server Info */}
          {selectedServer.type === 'nvr' && (
            <div className="bg-white rounded-lg shadow-sm">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <HardDrive className="w-5 h-5 text-blue-600" />
                  <h2 className="font-semibold text-sm text-gray-800">NVR Server Info</h2>
                </div>
                {loadingInfo && <span className="text-xs text-gray-500">載入中…</span>}
              </div>
              <div className="p-4">
                {serverInfo ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-gray-500 text-xs uppercase tracking-wide">Model</div>
                      <div className="font-semibold text-gray-800">{serverInfo.ModelName}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs uppercase tracking-wide">Version</div>
                      <div className="font-mono text-gray-800">{serverInfo.Version}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs uppercase tracking-wide">Host Name</div>
                      <div className="text-gray-800">{serverInfo.HostName}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs uppercase tracking-wide">HTTP Port</div>
                      <div className="text-gray-800">{serverInfo.PortBase}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs uppercase tracking-wide">RTSP Port</div>
                      <div className="text-gray-800">{serverInfo.RTSPPort}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs uppercase tracking-wide">Channels</div>
                      <div className="text-gray-800">
                        {serverInfo.VideoCount} / {serverInfo.MaxVideoCount}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">尚未取得伺服器資訊</div>
                )}
              </div>
            </div>
          )}

          {/* ATAK Server Info */}
          {selectedServer.type === 'tak' && (
            <div className="bg-white rounded-lg shadow-sm">
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Wifi className="w-5 h-5 text-green-600" />
                  <h2 className="font-semibold text-sm text-gray-800">ATAK Server Status</h2>
                </div>
                {loadingCamera && <span className="text-xs text-gray-500">載入中…</span>}
              </div>
              <div className="p-4">
                {atakStatus ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-gray-500 text-xs uppercase tracking-wide">狀態</div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            atakStatus.connected ? 'bg-green-500' : 'bg-red-500'
                          }`}
                        />
                        <span className="font-semibold text-gray-800">
                          {atakStatus.connected ? '已連接' : '未連接'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs uppercase tracking-wide">設備數量</div>
                      <div className="font-semibold text-gray-800">
                        {atakStatus.deviceCount} 個設備
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs uppercase tracking-wide">伺服器</div>
                      <div className="text-gray-800">{selectedServer.displayHost}</div>
                    </div>
                    {atakStatus.lastUpdate && (
                      <div>
                        <div className="text-gray-500 text-xs uppercase tracking-wide">
                          最後更新
                        </div>
                        <div className="text-gray-800 text-xs">
                          {new Date(atakStatus.lastUpdate).toLocaleString('zh-TW')}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">載入伺服器狀態中…</div>
                )}
              </div>
            </div>
          )}

          {/* Camera/Device List */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CameraIcon className="w-5 h-5 text-green-600" />
                <h2 className="font-semibold text-sm text-gray-800">
                  {selectedServer.type === 'nvr' ? 'Camera List' : 'GPS Devices'}
                </h2>
              </div>
              {loadingCamera && <span className="text-xs text-gray-500">載入中…</span>}
            </div>

            <div className="p-4 overflow-auto">
              {/* NVR Camera List */}
              {selectedServer.type === 'nvr' && (
                <>
                  {cameraList.length === 0 && !loadingCamera ? (
                    <div className="text-sm text-gray-500 text-center py-6">
                      目前沒有攝影機資料
                    </div>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">Channel</th>
                          <th className="px-3 py-2 text-left font-semibold">Status</th>
                          <th className="px-3 py-2 text-left font-semibold">Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cameraList.map((cam) => (
                          <tr key={cam.channelID} className="odd:bg-white even:bg-gray-50">
                            <td className="px-3 py-2 font-mono">{cam.channelID}</td>
                            <td className="px-3 py-2">
                              {cam.Enable === '1' ? (
                                <span className="inline-flex items-center text-xs text-green-700">
                                  <span className="w-2 h-2 rounded-full bg-green-500 mr-1" />
                                  Enabled
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-xs text-gray-600">
                                  <span className="w-2 h-2 rounded-full bg-gray-400 mr-1" />
                                  Disabled
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-800">{cam.desc}</td>
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
                    <div className="text-sm text-gray-500 text-center py-6">
                      目前沒有 GPS 設備
                      <br />
                      點擊上方「註冊設備」按鈕新增設備
                    </div>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold">設備 ID</th>
                          <th className="px-3 py-2 text-left font-semibold">名稱</th>
                          <th className="px-3 py-2 text-left font-semibold">類型</th>
                          <th className="px-3 py-2 text-left font-semibold">位置</th>
                          <th className="px-3 py-2 text-left font-semibold">優先級</th>
                          <th className="px-3 py-2 text-left font-semibold">狀態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gpsDevices.map((device) => (
                          <tr key={device.id} className="odd:bg-white even:bg-gray-50">
                            <td className="px-3 py-2 font-mono">{device.id}</td>
                            <td className="px-3 py-2">{device.callsign || '-'}</td>
                            <td className="px-3 py-2">
                              <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                                {device.type}
                              </span>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {device.position.lat.toFixed(4)}, {device.position.lng.toFixed(4)}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`text-xs px-2 py-0.5 rounded font-bold text-white ${
                                  device.priority === 1
                                    ? 'bg-red-500'
                                    : device.priority === 2
                                    ? 'bg-orange-500'
                                    : device.priority === 3
                                    ? 'bg-blue-500'
                                    : 'bg-gray-500'
                                }`}
                              >
                                P{device.priority || 3}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              {device.status === 'active' ? (
                                <span className="inline-flex items-center text-xs text-green-700">
                                  <span className="w-2 h-2 rounded-full bg-green-500 mr-1" />
                                  在線
                                </span>
                              ) : (
                                <span className="inline-flex items-center text-xs text-gray-600">
                                  <span className="w-2 h-2 rounded-full bg-gray-400 mr-1" />
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
              <div className="border-t border-gray-100 bg-red-50 text-xs text-red-700 px-4 py-2 flex items-center">
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