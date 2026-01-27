import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import * as L from 'leaflet';
import Hls from 'hls.js';
import 'leaflet/dist/leaflet.css';
import { CameraMapProps, Device } from '../types';
import { getFullStreamUrl } from '../config/api';
import {
  Video,
  User,
  Car,
  Plane,
  Home,
  MapPin,
  Circle as CircleIcon,
  X,
  Wifi,
  WifiOff,
  AlertCircle,
  Battery,
  Users,
  Monitor,
  Navigation,
  Signal,
  Play
} from 'lucide-react';

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

// 取得設備類型對應的 SVG 圖示
const getDeviceIconSVG = (type: string): string => {
  const iconMap: { [key: string]: string } = {
    'camera': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2" ry="2"/></svg>',
    'user': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>',
    'vehicle': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8A4 4 0 0 0 2 13v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>',
    'drone': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>',
    'base': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>',
    'friendly': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>',
    'hostile': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    'neutral': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
    'unknown': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>'
  };
  return iconMap[type] || iconMap['unknown'];
};

// 取得設備類型對應的 React 圖示組件
const DeviceIcon = ({ type, className = "w-5 h-5" }: { type: string; className?: string }) => {
  const iconProps = { className };
  switch (type) {
    case 'camera': return <Video {...iconProps} />;
    case 'user': return <User {...iconProps} />;
    case 'vehicle': return <Car {...iconProps} />;
    case 'drone': return <Plane {...iconProps} />;
    case 'base': return <Home {...iconProps} />;
    case 'friendly': return <CircleIcon {...iconProps} />;
    case 'hostile': return <AlertCircle {...iconProps} />;
    case 'neutral': return <CircleIcon {...iconProps} />;
    default: return <MapPin {...iconProps} />;
  }
};

// 建立不同類型的圖示
const createIcon = (type: string, color: string = '#3b82f6', priority?: number) => {
  const priorityBadge = priority ? `<div style="position: absolute; top: -6px; right: -6px; background: #0f172a; border: 1px solid ${color}; color: ${color}; border-radius: 4px; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 600; font-family: 'Inter', system-ui, sans-serif;">P${priority}</div>` : '';

  return new L.DivIcon({
    html: `<div style="position: relative; background-color: ${color}; width: 36px; height: 36px; border-radius: 8px; border: 2px solid rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.4); backdrop-filter: blur(4px);">
      <span style="color: white; display: flex; align-items: center; justify-content: center;">${getDeviceIconSVG(type)}</span>
      ${priorityBadge}
    </div>`,
    className: 'custom-marker',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
};

const getStatusColor = (status: string) => {
  const colors: { [key: string]: string } = {
    'active': '#22c55e',
    'idle': '#eab308',
    'offline': '#ef4444',
    'warning': '#f97316'
  };
  return colors[status] || '#64748b';
};

const getStatusText = (status: string) => {
  const texts: { [key: string]: string } = {
    'active': '運作中',
    'idle': '閒置',
    'offline': '離線',
    'warning': '警告',
    'unknown': '未知'
  };
  return texts[status] || '未知';
};

const getPriorityColor = (priority: number) => {
  const colors: { [key: number]: string } = {
    1: '#ef4444',
    2: '#f97316',
    3: '#3b82f6',
    4: '#64748b'
  };
  return colors[priority] || colors[3];
};

const getTypeText = (type: string) => {
  const texts: { [key: string]: string } = {
    'camera': '攝影機',
    'user': '使用者',
    'vehicle': '載具',
    'drone': '無人機',
    'base': '基地台',
    'friendly': '友軍',
    'hostile': '敵軍',
    'neutral': '中立',
    'unknown': '未知'
  };
  return texts[type] || '未知';
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
            console.warn('自動播放失敗，需要使用者互動:', e);
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
        setError('瀏覽器不支援 HLS 串流');
        setLoading(false);
      }
    }
    else if (streamType === 'mjpeg' && imgRef.current) {
      imgRef.current.onload = () => {
        setLoading(false);
      };
      imgRef.current.onerror = () => {
        setError('MJPEG 串流載入失敗');
        setLoading(false);
      };
      setLoading(false);
    }
    else if (streamType === 'video' && videoRef.current) {
      videoRef.current.src = streamUrl;
      videoRef.current.play().catch(e => console.warn('播放失敗:', e));
      setLoading(false);
    }
  }, [streamUrl, streamType]);

  return (
    <div className="relative bg-slate-950 rounded-lg overflow-hidden border border-slate-700/50" style={{ aspectRatio: '16/9' }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
            <span>載入視訊串流中...</span>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
          <div className="flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {streamType === 'mjpeg' ? (
        <img
          ref={imgRef}
          src={streamUrl}
          alt={cameraId}
          className="w-full h-full object-contain"
          style={{ display: loading ? 'none' : 'block' }}
        />
      ) : (
        <video
          ref={videoRef}
          className="w-full h-full object-contain"
          controls
          muted
          playsInline
          style={{ display: loading ? 'none' : 'block' }}
        />
      )}

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-950/90 to-transparent px-3 py-2">
        <div className="flex items-center gap-2 text-slate-200 text-xs font-medium">
          <Video className="w-3.5 h-3.5" />
          <span>{cameraId}</span>
          {streamType === 'mjpeg' && (
            <span className="px-1.5 py-0.5 bg-slate-700/60 rounded text-[10px] text-slate-400">MJPEG</span>
          )}
        </div>
      </div>
    </div>
  );
};


const CameraMap: React.FC<CameraMapProps> = ({
  devices: propsDevices = [],
  wsStatus = 'disconnected',
  onDeviceSelect
}) => {
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [showVideo, setShowVideo] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([25.0338, 121.5646]);
  const [zoom, setZoom] = useState(13);
  const [priorityFilter, setPriorityFilter] = useState<number[]>([1, 2, 3, 4]);

  const devices = propsDevices.filter(isValidDevice).map(device => ({
    ...device,
    lastUpdate: device.lastUpdate || new Date().toISOString()
  }));

  useEffect(() => {
    if (devices.length > 0 && !selectedDevice) {
      const avgLat = devices.reduce((sum, d) => sum + d.position.lat, 0) / devices.length;
      const avgLng = devices.reduce((sum, d) => sum + d.position.lng, 0) / devices.length;
      setMapCenter([avgLat, avgLng]);
    }
  }, [devices, selectedDevice]);

  const formatTime = (timestamp?: string) => {
    if (!timestamp) return '--';
    try {
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? '--' : date.toLocaleTimeString('zh-TW', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      });
    } catch { return '--'; }
  };

  const getTimeSince = (timestamp?: string) => {
    if (!timestamp) return '--';
    try {
      const diff = Date.now() - new Date(timestamp).getTime();
      if (isNaN(diff)) return '--';
      const seconds = Math.floor(diff / 1000);
      if (seconds < 60) return `${seconds} 秒前`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)} 分鐘前`;
      return `${Math.floor(seconds / 3600)} 小時前`;
    } catch { return '--'; }
  };

  useEffect(() => {
    if (selectedDevice) {
      const device = devices.find(d => d.id === selectedDevice);
      if (device?.position?.lat && device?.position?.lng) {
        setMapCenter([device.position.lat, device.position.lng]);
        setZoom(15);
      }
    }
  }, [selectedDevice, devices]);

  const filteredDevices = devices.filter(device =>
    priorityFilter.includes(device.priority || 3)
  );

  const sortedDevices = [...filteredDevices].sort((a, b) =>
    (a.priority || 3) - (b.priority || 3)
  );

  const selectedDeviceData = devices.find(d => d.id === selectedDevice);

  return (
    <div className="bg-slate-900 text-slate-100">
      {/* 狀態橫幅 */}
      {wsStatus === 'error' && (
        <div className="px-4 py-2.5 flex items-center justify-center gap-2 text-sm font-medium bg-red-950/80 text-red-300 border-b border-red-800/50">
          <AlertCircle className="w-4 h-4" />
          <span>連線失敗</span>
        </div>
      )}

      {/* 標題列 */}
      <div className="px-4 py-3 border-b border-slate-700/50 bg-slate-800/50">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4 text-slate-400" />
            <h2 className="font-semibold text-sm text-slate-100">即時追蹤地圖</h2>
          </div>
          <div className="flex gap-2 text-xs">
            <span className="px-2.5 py-1 bg-emerald-950/60 text-emerald-400 rounded border border-emerald-800/50 font-medium">
              {filteredDevices.filter(d => d.status === 'active').length} 運作中
            </span>
            <span className="px-2.5 py-1 bg-slate-800/60 text-slate-400 rounded border border-slate-700/50 font-medium">
              {filteredDevices.length} 總計
            </span>
          </div>
        </div>

        {/* 優先級篩選器 */}
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-500">優先級篩選：</span>
          <div className="flex gap-2">
            {[1, 2, 3, 4].map(p => (
              <label
                key={p}
                className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors border ${
                  priorityFilter.includes(p)
                    ? 'bg-slate-700/50 border-slate-600'
                    : 'bg-transparent border-slate-700/30 opacity-50'
                }`}
              >
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
                  className="sr-only"
                />
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: getPriorityColor(p) }}
                />
                <span style={{ color: getPriorityColor(p) }} className="font-medium">P{p}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* 視訊彈窗 */}
      {showVideo && selectedDeviceData?.streamUrl && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700/50 shadow-2xl max-w-4xl w-full">
            <div className="flex justify-between items-center px-4 py-3 border-b border-slate-700/50">
              <div>
                <h3 className="font-semibold text-slate-100">{selectedDeviceData.callsign || selectedDeviceData.id}</h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">
                  {selectedDeviceData.position.lat.toFixed(6)}, {selectedDeviceData.position.lng.toFixed(6)}
                </p>
              </div>
              <button
                onClick={() => setShowVideo(false)}
                className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
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

      {/* 地圖區域 */}
      <div className="relative h-96 bg-slate-800">
        <MapContainer
          center={mapCenter}
          zoom={zoom}
          scrollWheelZoom={true}
          style={{ height: '100%', width: '100%' }}
          className="z-0"
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
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
                      setSelectedDevice(device.id);
                      if (onDeviceSelect) {
                        onDeviceSelect(device);
                      }
                    }
                  }}
                >
                  <Popup className="dark-popup">
                    <div className="text-sm bg-slate-800 text-slate-100 rounded-lg p-3 min-w-[200px] -m-3">
                      <div className="font-semibold text-base mb-2 flex items-center gap-2">
                        <DeviceIcon type={device.type || 'unknown'} className="w-4 h-4" />
                        {device.callsign || device.id}
                      </div>
                      <div className="text-xs text-slate-400 space-y-1.5">
                        <div className="flex justify-between">
                          <span>類型</span>
                          <span className="text-slate-200 font-medium">{getTypeText(device.type || 'unknown')}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>優先級</span>
                          <span className="font-medium" style={{ color: getPriorityColor(device.priority || 3) }}>
                            P{device.priority || 3}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>狀態</span>
                          <span className="font-medium" style={{ color: getStatusColor(device.status || 'unknown') }}>
                            {getStatusText(device.status || 'unknown')}
                          </span>
                        </div>
                        {device.battery && (
                          <div className="flex justify-between">
                            <span>電量</span>
                            <span className="text-slate-200 font-medium">{device.battery}%</span>
                          </div>
                        )}
                        {device.group && (
                          <div className="flex justify-between">
                            <span>群組</span>
                            <span className="text-slate-200 font-medium">{device.group}</span>
                          </div>
                        )}
                        <div className="pt-1.5 border-t border-slate-700 font-mono text-[10px] text-slate-500">
                          {device.position.lat.toFixed(6)}, {device.position.lng.toFixed(6)}
                        </div>
                        {device.streamUrl && (
                          <button
                            onClick={() => setShowVideo(true)}
                            className="mt-2 w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Play className="w-3 h-3" />
                            開啟視訊串流
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
                    weight: 1.5
                  }}
                />
              </div>
            );
          })}
        </MapContainer>
      </div>

      {/* 設備清單 */}
      <div className="px-4 py-3 border-t border-slate-700/50 bg-slate-800/30 max-h-64 overflow-y-auto">
        <div className="flex items-center gap-2 mb-3">
          <Monitor className="w-4 h-4 text-slate-500" />
          <h3 className="font-semibold text-sm text-slate-300">已連線設備</h3>
          <span className="text-xs text-slate-500">（依優先級排序）</span>
        </div>
        {sortedDevices.length === 0 ? (
          <div className="text-center text-slate-500 py-6 text-sm">
            {wsStatus === 'connected' ? '無符合篩選條件的設備' : '等待連線至伺服器...'}
          </div>
        ) : (
          <div className="space-y-2">
            {sortedDevices.map((device) => (
              <div
                key={device.id}
                className={`p-3 rounded-lg cursor-pointer transition-all border ${
                  selectedDevice === device.id
                    ? 'bg-slate-700/50 border-blue-500/50'
                    : 'bg-slate-800/50 border-slate-700/30 hover:bg-slate-700/30 hover:border-slate-600/50'
                }`}
                style={{ borderLeftWidth: '3px', borderLeftColor: getPriorityColor(device.priority || 3) }}
                onClick={() => {
                  setSelectedDevice(device.id);
                  if (onDeviceSelect) {
                    onDeviceSelect(device);
                  }
                }}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="p-1.5 rounded-md"
                        style={{ backgroundColor: `${getPriorityColor(device.priority || 3)}20` }}
                      >
                        <DeviceIcon type={device.type || 'unknown'} className="w-4 h-4" style={{ color: getPriorityColor(device.priority || 3) }} />
                      </div>
                      <div>
                        <div className="font-medium text-sm text-slate-200 flex items-center gap-2">
                          {device.callsign || device.id}
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                            style={{
                              backgroundColor: `${getPriorityColor(device.priority || 3)}20`,
                              color: getPriorityColor(device.priority || 3)
                            }}
                          >
                            P{device.priority || 3}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">
                          {device.position.lat.toFixed(4)}, {device.position.lng.toFixed(4)}
                          {device.group && <span className="text-slate-600"> | {device.group}</span>}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5">
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-medium border"
                      style={{
                        backgroundColor: `${getStatusColor(device.status || 'unknown')}15`,
                        color: getStatusColor(device.status || 'unknown'),
                        borderColor: `${getStatusColor(device.status || 'unknown')}30`
                      }}
                    >
                      {getStatusText(device.status || 'unknown')}
                    </span>
                    {device.streamUrl && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDevice(device.id);
                          setShowVideo(true);
                        }}
                        className="px-2 py-0.5 bg-blue-900/40 text-blue-400 rounded text-[10px] hover:bg-blue-800/50 border border-blue-700/30 flex items-center gap-1 transition-colors"
                      >
                        <Video className="w-3 h-3" />
                        視訊
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部狀態列 */}
      <div className="px-4 py-2.5 bg-slate-800/50 border-t border-slate-700/50 flex justify-between items-center text-xs">
        <div className="flex items-center gap-2 text-slate-500">
          {wsStatus === 'connected' ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-emerald-500 font-medium">已連線</span>
            </>
          ) : wsStatus === 'connecting' ? (
            <>
              <Signal className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
              <span className="text-amber-500 font-medium">連線中...</span>
            </>
          ) : wsStatus === 'error' ? (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-red-500" />
              <span className="text-red-500 font-medium">連線失敗</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-slate-500 font-medium">已斷線</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3 text-slate-500">
          <span className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            {devices.length} 設備
          </span>
          <span className="text-slate-600">|</span>
          <span>顯示 {sortedDevices.length}</span>
        </div>
      </div>
    </div>
  );
};

export default CameraMap;
