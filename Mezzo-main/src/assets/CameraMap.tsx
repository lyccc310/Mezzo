import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import * as L from 'leaflet';
import Hls from 'hls.js';
import 'leaflet/dist/leaflet.css';
import { CameraMapProps, Device } from '../types';  // ← 使用統一的類型
import { getFullStreamUrl } from '../config/api';

// 驗證設備數據是否有效
const isValidDevice = (device: any): device is Device => {
  return (
    device &&
    typeof device.id === 'string' &&
    device.position &&
    typeof device.position.lat === 'number' &&
    typeof device.position.lng === 'number' &&
    !isNaN(device.position.lat) &&
    !isNaN(device.position.lng)
  );
};

// 建立不同類型的圖示
const createIcon = (type: string, color: string = 'blue', priority?: number) => {
  const priorityBadge = priority ? `<div style="position: absolute; top: -5px; right: -5px; background: red; color: white; border-radius: 50%; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">P${priority}</div>` : '';

  return new L.DivIcon({
    html: `<div style="position: relative; background-color: ${color}; width: 35px; height: 35px; border-radius: 50%; border: 3px solid white; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,0.4);">
      <span style="color: white; font-size: 18px;">${getIconSymbol(type)}</span>
      ${priorityBadge}
    </div>`,
    className: 'custom-marker',
    iconSize: [35, 35],
    iconAnchor: [17.5, 17.5],
  });
};

const getIconSymbol = (type: string) => {
  const symbols: { [key: string]: string } = {
    'camera': '📹',
    'user': '👤',
    'vehicle': '🚗',
    'drone': '🚁',
    'base': '🏠',
    'unknown': '📍',
    'friendly': '🟢',
    'hostile': '🔴',
    'neutral': '⚪'
  };
  return symbols[type] || symbols['unknown'];
};

const getStatusColor = (status: string) => {
  const colors: { [key: string]: string } = {
    'active': '#10b981',
    'idle': '#f59e0b',
    'offline': '#ef4444',
    'warning': '#f59e0b'
  };
  return colors[status] || '#6b7280';
};

const getPriorityColor = (priority: number) => {
  const colors: { [key: number]: string } = {
    1: '#ef4444',  // 紅色 - 最高優先級
    2: '#f59e0b',  // 橙色 - 高優先級
    3: '#3b82f6',  // 藍色 - 一般優先級
    4: '#6b7280'   // 灰色 - 低優先級
  };
  return colors[priority] || colors[3];
};

// 視訊播放器組件
const VideoPlayer = ({ streamUrl, cameraId }: { streamUrl: string; cameraId: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streamType, setStreamType] = useState<'hls' | 'mjpeg' | 'video'>('video');

  useEffect(() => {
    if (!streamUrl) return;

    // 判斷串流類型
    if (streamUrl.endsWith('.m3u8')) {
      setStreamType('hls');
    } else if (streamUrl.includes('mjpeg') || streamUrl.includes('.cgi')) {
      setStreamType('mjpeg');
    } else {
      setStreamType('video');
    }
  }, [streamUrl]);

  useEffect(() => {
    if (!streamUrl) return;

    // HLS 串流處理
    if (streamType === 'hls' && videoRef.current) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90
        });

        hls.loadSource(streamUrl);
        hls.attachMedia(videoRef.current);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setLoading(false);
          videoRef.current?.play().catch(e => {
            console.warn('自動播放失敗，需要用戶互動:', e);
          });
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          console.error('HLS 錯誤:', data);
          if (data.fatal) {
            setError(`串流錯誤: ${data.type}`);
            setLoading(false);
          }
        });

        return () => {
          hls.destroy();
        };
      } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        videoRef.current.src = streamUrl;
        videoRef.current.play().catch(e => console.warn('播放失敗:', e));
        setLoading(false);
      } else {
        setError('瀏覽器不支援 HLS');
        setLoading(false);
      }
    }
    // MJPEG 串流處理 - 使用 img 標籤
    else if (streamType === 'mjpeg' && imgRef.current) {
      imgRef.current.onload = () => {
        setLoading(false);
      };
      imgRef.current.onerror = () => {
        setError('MJPEG 串流載入失敗');
        setLoading(false);
      };
      setLoading(false); // MJPEG 通常會立即開始顯示
    }
    // 一般視訊檔案
    else if (streamType === 'video' && videoRef.current) {
      videoRef.current.src = streamUrl;
      videoRef.current.play().catch(e => console.warn('播放失敗:', e));
      setLoading(false);
    }
  }, [streamUrl, streamType]);

  return (
    <div className="relative bg-black rounded overflow-hidden" style={{ aspectRatio: '16/9' }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <div className="text-white text-sm">載入視訊中...</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <div className="text-red-400 text-sm">{error}</div>
        </div>
      )}

      {/* MJPEG 使用 img 標籤 */}
      {streamType === 'mjpeg' ? (
        <img
          ref={imgRef}
          src={streamUrl}
          alt={cameraId}
          className="w-full h-full object-contain"
          style={{ display: loading ? 'none' : 'block' }}
        />
      ) : (
        /* HLS 和一般視訊使用 video 標籤 */
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          controls
          muted
          playsInline
          style={{ display: loading ? 'none' : 'block' }}
        />
      )}

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
        <div className="text-white text-xs font-medium">
          {cameraId} {streamType === 'mjpeg' && <span className="text-xs opacity-75">(MJPEG)</span>}
        </div>
      </div>
    </div>
  );
};


const CameraMap: React.FC<CameraMapProps> = ({
  devices: propsDevices = [],  // ← 加上預設值 = []
  wsStatus = 'disconnected',
  onDeviceSelect
}) => {
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [showVideo, setShowVideo] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([25.0338, 121.5646]);
  const [zoom, setZoom] = useState(13);
  const [priorityFilter, setPriorityFilter] = useState<number[]>([1, 2, 3, 4]);

  // ❌ 完全移除 WebSocket 相關的 state 和 useEffect
  // const [devices, setDevices] = useState<Device[]>([]);
  // const [ws, setWs] = useState<WebSocket | null>(null);
  // const [wsStatus, setWsStatus] = useState<...>(...);
  // useEffect(() => { ... WebSocket 連線 ... }, []);

  // ✅ 直接使用從 props 傳入的 devices
  const devices = propsDevices.filter(isValidDevice).map(device => ({
    ...device,
    lastUpdate: device.lastUpdate || new Date().toISOString()
  }));

  console.log(`📍 [CameraMap] Received ${devices.length} devices from props`);
  // 當收到新設備時，更新地圖中心
  useEffect(() => {
    if (devices.length > 0 && !selectedDevice) {
      const avgLat = devices.reduce((sum, d) => sum + d.position.lat, 0) / devices.length;
      const avgLng = devices.reduce((sum, d) => sum + d.position.lng, 0) / devices.length;
      setMapCenter([avgLat, avgLng]);
    }
  }, [devices, selectedDevice]);

  // ❌ 移除 sendCommand（應該由父組件處理）
  // const sendCommand = (action: string, deviceId?: string) => { ... };

  const formatTime = (timestamp?: string) => {
    if (!timestamp) return 'N/A';
    try {
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? 'N/A' : date.toLocaleTimeString('zh-TW', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
      });
    } catch { return 'N/A'; }
  };

  const getTimeSince = (timestamp?: string) => {
    if (!timestamp) return 'N/A';
    try {
      const diff = Date.now() - new Date(timestamp).getTime();
      if (isNaN(diff)) return 'N/A';
      const seconds = Math.floor(diff / 1000);
      if (seconds < 60) return `${seconds}秒前`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)}分鐘前`;
      return `${Math.floor(seconds / 3600)}小時前`;
    } catch { return 'N/A'; }
  };

  // Focus on selected device
  useEffect(() => {
    if (selectedDevice) {
      const device = devices.find(d => d.id === selectedDevice);
      if (device?.position?.lat && device?.position?.lng) {
        setMapCenter([device.position.lat, device.position.lng]);
        setZoom(15);
      }
    }
  }, [selectedDevice, devices]);

  // 過濾設備
  const filteredDevices = devices.filter(device =>
    priorityFilter.includes(device.priority || 3)
  );

  // 按優先級排序
  const sortedDevices = [...filteredDevices].sort((a, b) =>
    (a.priority || 3) - (b.priority || 3)
  );

  const selectedDeviceData = devices.find(d => d.id === selectedDevice);

  return (
    <>
      {/* Status Banner */}
      {wsStatus === 'error' && (
        <div className="p-3 text-center text-sm font-medium bg-red-100 text-red-800">
          ❌ 連接失敗
        </div>
      )}

      {/* Header */}
      <div className="p-3 border-b border-gray-200 bg-white">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-semibold text-sm">即時追蹤地圖</h2>
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 bg-green-100 text-green-700 rounded">
              {filteredDevices.filter(d => d.status === 'active').length} 活躍
            </span>
            <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded">
              {filteredDevices.length} 總計
            </span>
          </div>
        </div>

        {/* Priority Filter */}
        <div className="flex gap-2 text-xs">
          {[1, 2, 3, 4].map(p => (
            <label key={p} className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={priorityFilter.includes(p)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setPriorityFilter([...priorityFilter, p]);
                  } else {
                    setPriorityFilter(priorityFilter.filter(pf => pf !== p));
                  }
                }}
              />
              <span style={{ color: getPriorityColor(p) }}>P{p}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Video Modal */}
      {showVideo && selectedDeviceData?.streamUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full">
            <div className="flex justify-between items-center p-3 border-b">
              <div>
                <h3 className="font-semibold">{selectedDeviceData.callsign || selectedDeviceData.id}</h3>
                <p className="text-xs text-gray-500">
                  {selectedDeviceData.position.lat.toFixed(6)}, {selectedDeviceData.position.lng.toFixed(6)}
                </p>
              </div>
              <button
                onClick={() => setShowVideo(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              >
                ✕
              </button>
            </div>
            <div className="p-4">
              <VideoPlayer
                streamUrl={getFullStreamUrl(selectedDeviceData?.streamUrl || '')}
                cameraId={selectedDeviceData?.id || ''}
              />
            </div>
          </div>
        </div>
      )}

      {/* Map */}
      <div className="relative h-96 bg-gray-100">
        <MapContainer
          center={mapCenter}
          zoom={zoom}
          scrollWheelZoom={true}
          style={{ height: '100%', width: '100%' }}
          className="z-0"
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />

          {sortedDevices.map((device) => {
            if (!device.position || !device.position.lat || !device.position.lng) return null;

            return (
              <div key={device.id}>
                <Marker
                  position={[device.position.lat, device.position.lng]}
                  icon={createIcon(
                    device.type || 'unknown',
                    getPriorityColor(device.priority || 3),
                    device.priority
                  )}
                  eventHandlers={{
                    click: () => {
                      console.log('📍 [CameraMap] Marker clicked:', device.id);
                      setSelectedDevice(device.id);
                      if (onDeviceSelect) {
                        onDeviceSelect(device);
                      }
                    }
                  }}
                >
                  <Popup>
                    <div className="text-sm">
                      <div className="font-bold text-base mb-1">
                        {device.callsign || device.id}
                      </div>
                      <div className="text-xs text-gray-600 space-y-1">
                        <div>類型: <span className="font-medium">{device.type || 'unknown'}</span></div>
                        <div>優先級: <span className="font-medium" style={{ color: getPriorityColor(device.priority || 3) }}>
                          P{device.priority || 3}
                        </span></div>
                        <div>狀態: <span className="font-medium" style={{ color: getStatusColor(device.status || 'unknown') }}>
                          {device.status || 'unknown'}
                        </span></div>
                        {device.battery && <div>電量: <span className="font-medium">{device.battery}%</span></div>}
                        {device.group && <div>群組: <span className="font-medium">{device.group}</span></div>}
                        <div>位置: {device.position.lat.toFixed(6)}, {device.position.lng.toFixed(6)}</div>
                        {device.streamUrl && (
                          <button
                            onClick={() => setShowVideo(true)}
                            className="mt-2 w-full px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
                          >
                            📹 查看視訊
                          </button>
                        )}
                      </div>
                    </div>
                  </Popup>
                </Marker>

                <Circle
                  center={[device.position.lat, device.position.lng]}
                  radius={50}
                  pathOptions={{
                    color: getPriorityColor(device.priority || 3),
                    fillColor: getPriorityColor(device.priority || 3),
                    fillOpacity: 0.1,
                    weight: 2
                  }}
                />
              </div>
            );
          })}
        </MapContainer>
      </div>

      {/* Device List */}
      <div className="p-3 border-t border-gray-200 bg-white max-h-64 overflow-y-auto">
        <h3 className="font-semibold text-sm mb-2">已連接設備 (按優先級排序)</h3>
        {sortedDevices.length === 0 ? (
          <div className="text-center text-gray-400 py-4 text-sm">
            {wsStatus === 'connected' ? '沒有符合篩選條件的設備' : '等待連接到服務器...'}
          </div>
        ) : (
          <div className="space-y-2">
            {sortedDevices.map((device) => (
              <div
                key={device.id}
                className={`p-2 border-2 rounded cursor-pointer transition-colors ${selectedDevice === device.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:bg-gray-50'
                  }`}
                style={{ borderLeftColor: getPriorityColor(device.priority || 3), borderLeftWidth: '4px' }}
                onClick={() => {
                  console.log('📍 [CameraMap] Device clicked:', device.id);
                  setSelectedDevice(device.id);
                  if (onDeviceSelect) {
                    onDeviceSelect(device);
                  }
                }}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{getIconSymbol(device.type || 'unknown')}</span>
                      <div>
                        <div className="font-semibold text-sm flex items-center gap-2">
                          {device.callsign || device.id}
                          <span
                            className="text-xs px-1.5 py-0.5 rounded font-bold"
                            style={{
                              backgroundColor: getPriorityColor(device.priority || 3),
                              color: 'white'
                            }}
                          >
                            P{device.priority || 3}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {device.position.lat.toFixed(4)}, {device.position.lng.toFixed(4)}
                          {device.group && ` • ${device.group}`}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <span
                      className="px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: `${getStatusColor(device.status || 'unknown')}20`,
                        color: getStatusColor(device.status || 'unknown')
                      }}
                    >
                      {device.status || 'unknown'}
                    </span>
                    {device.streamUrl && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDevice(device.id);
                          setShowVideo(true);
                        }}
                        className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs hover:bg-purple-200"
                      >
                        📹 視訊
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 bg-gray-50 border-t border-gray-200 flex justify-between items-center text-xs">
        <span className="text-gray-600">
          狀態: {wsStatus === 'connected' ? (
            <span className="text-green-600 font-medium">● 已連接</span>
          ) : wsStatus === 'connecting' ? (
            <span className="text-yellow-600 font-medium">● 連接中...</span>
          ) : wsStatus === 'error' ? (
            <span className="text-red-600 font-medium">● 連接失敗</span>
          ) : (
            <span className="text-gray-600 font-medium">● 已斷線</span>
          )}
        </span>
        <span className="text-gray-600">
          設備: {devices.length} | 顯示: {sortedDevices.length}
        </span>
      </div>
    </>
  );
};

export default CameraMap;