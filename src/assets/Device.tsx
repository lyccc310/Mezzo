// src/assets/Device.tsx
import { useEffect, useState } from 'react';
import {
  Server,
  HardDrive,
  Camera as CameraIcon,
  RefreshCcw,
  AlertCircle,
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

type NvrServer = {
  id: string;
  name: string;
  /** 給 fetch 用的 base path，走 Vite Proxy，例如 /nvr */
  apiBase: string;
  /** 只是顯示用的真實位址文字，不拿來 fetch */
  displayHost: string;
  auth?: string;
  note?: string;
};

// 如果以後有多台 NVR，可以在這裡繼續加
const NVR_SERVERS: NvrServer[] = [
  {
    id: 'guardeye',
    name: 'Guardeye',
    apiBase: '/nvr', // ✅ 這裡改成走 proxy，不要寫 http://220...
    displayHost: '220.135.209.219:8088',
    auth: 'QWRtaW46MTIzNA==', // Admin:1234
    note: 'Messo-NVR',
  },
];

const Device = () => {
  const [selectedServer, setSelectedServer] = useState<NvrServer | null>(
    NVR_SERVERS[0] ?? null,
  );

  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [cameraList, setCameraList] = useState<CameraInfo[]>([]);

  const [loadingInfo, setLoadingInfo] = useState(false);
  const [loadingCamera, setLoadingCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 取得 Server Info
  const fetchServerInfo = async (server: NvrServer) => {
    setLoadingInfo(true);
    setError(null);
    try {
      // 走 Vite proxy: /nvr/GetServerInfo.cgi -> 轉到 http://220.135.209.219:8088/GetServerInfo.cgi
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

  // 取得 Camera List
  const fetchCameraList = async (server: NvrServer) => {
    setLoadingCamera(true);
    setError(null);
    try {
      // 文件範例是 ch=1；如果要全部頻道，可以之後改參數
      const url = `${server.apiBase}/CameraList.cgi?Auth=${server.auth ?? ''}&ch=1`;

      // 同樣透過 proxy，不會直接跨網域打到 220.135.209.219
      const res = await fetch(url);
      if (!res.ok) throw new Error(`CameraList HTTP ${res.status}`);

      // 如果 NVR 回傳真的是 JSON，就直接 parse
      // 文件範例（你貼的）看起來怪怪的，如果不是合法 JSON
      // 這裡可能需要改成 res.text() 再自己 parse
      const data = await res.json();

      let list: CameraInfo[] = [];
      if (Array.isArray(data)) {
        list = data as CameraInfo[];
      } else if (data && Array.isArray((data as any).cameras)) {
        // 如果後端包在 { cameras: [...] }
        list = (data as any).cameras as CameraInfo[];
      } else {
        console.warn('未知的 CameraList 資料格式:', data);
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

  // 切換 NVR 或第一次載入時，抓一次資料
  useEffect(() => {
    if (!selectedServer) return;
    fetchServerInfo(selectedServer);
    fetchCameraList(selectedServer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServer?.id]);

  const handleRefresh = () => {
    if (!selectedServer) return;
    fetchServerInfo(selectedServer);
    fetchCameraList(selectedServer);
  };

  return (
    <div className="flex-1 overflow-auto">
      {/* 頁面標題列 */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-800">Device Management</h1>
          <button
            onClick={handleRefresh}
            className="flex items-center space-x-2 px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
          >
            <RefreshCcw className="w-4 h-4" />
            <span>重新整理</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6">
        {/* 左側：NVR 清單 */}
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm">
            <div className="p-4 border-b border-gray-200 flex items-center">
              <Server className="w-5 h-5 text-indigo-600 mr-2" />
              <h2 className="font-semibold text-sm text-gray-800">NVR Servers</h2>
            </div>
            <div className="p-3 space-y-2">
              {NVR_SERVERS.map((nvr) => {
                const isActive = selectedServer?.id === nvr.id;
                return (
                  <button
                    key={nvr.id}
                    onClick={() => setSelectedServer(nvr)}
                    className={`w-full text-left px-3 py-2 rounded-lg border flex flex-col text-sm transition ${
                      isActive
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-gray-800">{nvr.name}</span>
                      {nvr.note && (
                        <span className="text-xs text-gray-500 ml-2">{nvr.note}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {nvr.displayHost}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 提示 CORS / Proxy */}
          <div className="bg-yellow-50 border border-yellow-200 text-xs text-yellow-800 rounded-lg p-3">
            <p className="font-semibold flex items-center mb-1">
              <AlertCircle className="w-4 h-4 mr-1" />
              提醒
            </p>
            <p>
              前端直接呼叫 NVR 會遇到 CORS 問題，請透過 Vite Proxy
              <code className="mx-1">/nvr</code> 或後端轉發存取。
            </p>
          </div>
        </div>

        {/* 右側：NVR 資訊 + Camera List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Server Info 卡片 */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <HardDrive className="w-5 h-5 text-blue-600" />
                <h2 className="font-semibold text-sm text-gray-800">NVR Server Info</h2>
              </div>
              {loadingInfo && (
                <span className="text-xs text-gray-500">載入伺服器資訊中…</span>
              )}
            </div>
            <div className="p-4">
              {serverInfo ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-gray-500 text-xs uppercase tracking-wide">
                      Model
                    </div>
                    <div className="font-semibold text-gray-800">
                      {serverInfo.ModelName}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs uppercase tracking-wide">
                      Version
                    </div>
                    <div className="font-mono text-gray-800">
                      {serverInfo.Version}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs uppercase tracking-wide">
                      Host Name
                    </div>
                    <div className="text-gray-800">{serverInfo.HostName}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs uppercase tracking-wide">
                      HTTP Port
                    </div>
                    <div className="text-gray-800">{serverInfo.PortBase}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs uppercase tracking-wide">
                      RTSP Port
                    </div>
                    <div className="text-gray-800">{serverInfo.RTSPPort}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs uppercase tracking-wide">
                      Channels
                    </div>
                    <div className="text-gray-800">
                      {serverInfo.VideoCount} / {serverInfo.MaxVideoCount}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs uppercase tracking-wide">
                      Analog Cams
                    </div>
                    <div className="text-gray-800">
                      {serverInfo.AnalogCamCount}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-500">
                  尚未取得伺服器資訊，請確認 NVR 是否可連線。
                </div>
              )}
            </div>
          </div>

          {/* Camera List */}
          <div className="bg-white rounded-lg shadow-sm">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <CameraIcon className="w-5 h-5 text-green-600" />
                <h2 className="font-semibold text-sm text-gray-800">Camera List</h2>
              </div>
              {loadingCamera && (
                <span className="text-xs text-gray-500">載入攝影機列表中…</span>
              )}
            </div>

            <div className="p-4 overflow-auto">
              {cameraList.length === 0 && !loadingCamera ? (
                <div className="text-sm text-gray-500 text-center py-6">
                  目前沒有攝影機資料，或是 CameraList.cgi 回傳為空。
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
