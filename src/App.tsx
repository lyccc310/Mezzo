import { useState, useRef } from 'react';
import {
  Shield,
  Video,
  Play as PlayIcon,
  MapPin,
  Users,
  Mic,
  Settings,
  UserLock,
  GaugeCircle,
  Calendar,
  UserCircle,
  Fullscreen,
  Camera,
  AlertCircle,
  HardDrive,
  Volume2,
  Maximize,
  Disc2,
} from 'lucide-react';
import CameraMap from './assets/CameraMap';
import VoiceControl from './assets/VoiceControl';
import Playback from './assets/Playback';
import Communication from './assets/Communication';
import Device from './assets/Device';

import type { TeamMember, Transcript } from './types';

// ---- LoginPage ----
const LoginPage = ({ onLogin }: { onLogin: (name: string, unit: string) => void }) => {
  const [inputName, setInputName] = useState('');
  const [inputUnit, setInputUnit] = useState('Patrol Unit 7A');
  const [error, setError] = useState('');


  const handleLogin = () => {
    if (!inputName.trim() || !inputUnit.trim()) {
      setError('Please enter both name and unit');
      return;
    }
    onLogin(inputName.trim(), inputUnit.trim());
  };


  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-indigo-900 to-blue-800">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        <div className="flex items-center justify-center mb-6">
          <Shield className="w-12 h-12 text-indigo-600 mr-3" />
          <h1 className="text-2xl font-bold text-gray-800">Police Body Camera System</h1>
        </div>
        <h2 className="text-xl font-semibold text-gray-700 mb-6 text-center">Welcome</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Enter Your Name</label>
            <input
              type="text"
              value={inputName}
              onChange={(e) => setInputName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="e.g., Rodriguez"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Enter Your Unit</label>
            <input
              type="text"
              value={inputUnit}
              onChange={(e) => setInputUnit(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="e.g., Patrol Unit 7A"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          {error && (
            <div className="text-red-600 text-sm text-center flex items-center justify-center gap-2">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}
          <button onClick={handleLogin} className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition">
            Enter System
          </button>
        </div>
      </div>
    </div>
  );
};

// ---- Sidebar ----
const Sidebar = ({ activeMenu, onMenuChange }: { activeMenu: string; onMenuChange: (menu: string) => void }) => {
  const menuItems = [
    { name: 'Dashboard', icon: GaugeCircle },
    { name: 'Live Feed', icon: Video },
    { name: 'Playback', icon: PlayIcon },
    { name: 'GPS Tracking', icon: MapPin },
    { name: 'Team Management', icon: Users },
    { name: 'Voice Communication', icon: Mic },
    { name: 'Device Management', icon: Settings },
    { name: 'User Accounts', icon: UserLock },
  ];

  return (
    <div className="w-60 bg-white border-r border-gray-200 flex flex-col">
      <nav className="mt-16">
        {menuItems.map((item) => (
          <button
            key={item.name}
            onClick={() => onMenuChange(item.name)}
            className={`w-full flex items-center space-x-3 px-4 py-3 text-sm transition ${activeMenu === item.name ? 'bg-indigo-50 text-indigo-600 border-r-2 border-indigo-600' : 'text-gray-700 hover:bg-gray-100'
              }`}
          >
            <item.icon className="w-4 h-4" />
            <span>{item.name}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};

const Dashboard = ({ teamStatus, transcripts, onTranscript }: { teamStatus: TeamMember[]; transcripts: Transcript[]; onTranscript: (t: Transcript) => void }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const handleTranscript = (entry: { time: string, officer: string, text: string }) => {
    onTranscript(entry);
  };

  // 全螢幕切換功能
  const toggleFullscreen = () => {
    const container = document.getElementById('video-container');
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        console.error('Error attempting to enable fullscreen:', err);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      });
    }
  };

  // 截圖功能
  const captureScreenshot = () => {
    const img = imgRef.current;
    if (!img) {
      alert('無法獲取影像');
      return;
    }

    try {
      // 創建 canvas
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 640;
      canvas.height = img.naturalHeight || 480;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        alert('無法創建 canvas');
        return;
      }

      // 繪製當前影像到 canvas
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // 轉換為圖片並下載
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          a.download = `police-camera-screenshot-${timestamp}.png`;
          a.click();
          URL.revokeObjectURL(url);
          console.log('✅ 截圖已保存');
        }
      }, 'image/png');
    } catch (error) {
      console.error('❌ 截圖失敗:', error);
      alert('截圖失敗: ' + error);
    }
  };

  // 錄影功能
  const startRecording = async () => {
    try {
      // 創建隱藏的 canvas 來捕捉影像串流
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        alert('無法獲取 canvas context');
        return;
      }

      // 獲取影像元素
      const img = imgRef.current;
      if (!img) {
        alert('找不到影像元素');
        return;
      }

      // 設定 canvas 尺寸以匹配影像
      canvas.width = img.naturalWidth || 640;
      canvas.height = img.naturalHeight || 480;

      // 持續繪製影像到 canvas 的函數
      const drawFrame = () => {
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
        animationIdRef.current = requestAnimationFrame(drawFrame);
      };

      // 開始繪製幀
      drawFrame();

      // 從 canvas 捕捉串流 (30 FPS)
      const stream = canvas.captureStream(30);
      streamRef.current = stream;

      // 創建 MediaRecorder
      const options = { mimeType: 'video/webm;codecs=vp9' };
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);

        // 創建下載連結
        const a = document.createElement('a');
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.download = `police-camera-recording-${timestamp}.webm`;
        a.click();

        // 清理
        URL.revokeObjectURL(url);
        recordedChunksRef.current = [];
      };

      mediaRecorder.start(1000); // 每秒收集資料
      setIsRecording(true);
      console.log('✅ 錄影已開始');
    } catch (error) {
      console.error('❌ 錄影啟動失敗:', error);
      alert('錄影啟動失敗: ' + error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }

    setIsRecording(false);
    console.log('⏹️ 錄影已停止');
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Page Title Bar */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-800">Dashboard</h1>
          <div className="flex items-center space-x-2">
            <button className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50">
              Export
            </button>
            <button className="flex px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50">
              <Calendar className="w-4 h-4" /> &nbsp;Today
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 p-6">
        <div className="bg-white p-4 rounded-lg shadow-sm">
          <div className="flex items-start justify-between">
            <h3 className="text-gray-600 text-sm">Active Devices</h3>
            <Video className="w-6 h-6 text-blue-500" />
          </div>
          <div className="text-3xl font-bold text-blue-600">24</div>
          <div className="text-xs text-green-600 mt-1">+2 from yesterday</div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm">
          <div className="flex items-start justify-between">
            <h3 className="text-gray-600 text-sm">Incidents Today</h3>
            <div className="w-6 h-6 text-blue-500">⚠️</div>
          </div>
          <div className="text-3xl font-bold text-yellow-600">7</div>
          <div className="text-xs text-red-600 mt-1">+3 from yesterday</div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm">
          <div className="flex items-start justify-between">
            <h3 className="text-gray-600 text-sm">Active Officers</h3>
            <div className="relative">
              <Users className="w-6 h-6 text-green-500" />
              <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white"></div>
            </div>
          </div>
          <div className="text-3xl font-bold text-green-600">18</div>
          <div className="text-xs text-green-600 mt-1">All teams operational</div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm">
          <div className="flex items-start justify-between">
            <h3 className="text-gray-600 text-sm">Storage Used</h3>
            <HardDrive className="w-6 h-6 text-cyan-500" />
          </div>
          <div className="text-3xl font-bold text-cyan-600">78%</div>
          <div className="text-xs text-gray-600 mt-1">2.3 TB of 3 TB</div>
        </div>
      </div>

      {/* Live Feed and GPS Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 px-6 pb-6">
        {/* Left Column - Live Feed + Voice Communication */}
        <div className="col-span-2 space-y-6">
          {/* Live Feed */}
          <div className="bg-white rounded-lg shadow-sm" id="video-container">
            <div className="p-3 border-b border-gray-200 flex justify-between items-center">
              <h2 className="font-semibold text-sm">Live Video Feed - Officer Rodriguez</h2>
              <span className="flex items-center text-red-600 text-xs">
                <span className="w-2 h-2 bg-red-600 rounded-full mr-2 animate-pulse"></span>
                {isRecording ? 'Recording to File' : 'Live'}
              </span>
            </div>
            <div className="bg-indigo-900 aspect-video flex items-center justify-center relative">
              <img
                ref={imgRef}
                src="http://220.135.209.219:8088/mjpeg_stream.cgi?Auth=QWRtaW46MTIzNA==&ch=1"
                alt="Live Feed"
                className="w-full h-full object-cover"
                crossOrigin="anonymous"
              />
              <div className="absolute bottom-4 flex w-full justify-between px-4">
                <div className="space-x-2">
                  <button onClick={toggleFullscreen} className="bg-white bg-opacity-20 hover:bg-opacity-30 p-2 rounded" title="Toggle Fullscreen">
                    <Fullscreen className="w-4 h-4 text-black" />
                  </button>
                  <button className="bg-white bg-opacity-20 hover:bg-opacity-30 p-2 rounded">
                    <Volume2 className="w-4 h-4 text-black" />
                  </button>
                </div>

                <div className="space-x-2">
                  <button
                    onClick={toggleRecording}
                    className={`${isRecording
                        ? 'bg-red-600 animate-pulse'
                        : 'bg-red-600 bg-opacity-70'
                      } hover:bg-red-700 p-2 rounded`}
                    title={isRecording ? '停止錄影' : '開始錄影'}
                  >
                    <Disc2 className="w-4 h-4 text-white" />
                  </button>
                  <button
                    onClick={captureScreenshot}
                    className="bg-white bg-opacity-20 hover:bg-opacity-30 p-2 rounded"
                    title="截圖"
                  >
                    <Camera className="w-4 h-4 text-black" />
                  </button>
                </div>
              </div>
            </div>
            <div className="p-3">
              <div className="relative w-full h-4 mb-1 bg-gray-200">
                <div className="absolute bg-blue-200 h-4 flex" style={{ left: '25%', width: '30%', top: '0' }}>
                  <div className="w-0.5 h-full bg-blue-600"></div>
                  <div className="flex-1 h-full bg-blue-200"></div>
                  <div className="w-0.5 h-full bg-blue-600"></div>
                </div>
              </div>
              <div className="flex justify-between text-xs text-black mb-2">
                <span>09:00 AM</span>
                <span className="text-blue-600 font-medium">Current Time</span>
                <span>05:00 PM</span>
              </div>
            </div>
          </div>

          {/* Voice Communication and Speech to Text */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <VoiceControl onTranscript={handleTranscript} />
            <div className="col-span-1 bg-white rounded-lg shadow-sm">
              <div className="p-4 border-b border-gray-200">
                <h2 className="font-semibold">Speech to Text</h2>
              </div>
              <div className="p-4 space-y-2 overflow-y-auto">
                {transcripts.map((item, index) => (
                  <div key={index} className="bg-gray-50 p-2 rounded">
                    <div className="flex items-start space-x-2">
                      <span className="text-blue-600 font-mono text-xs">{item.time}</span>
                      <span className="font-semibold text-xs text-green-600">{item.officer}:</span>
                      <span className="text-xs text-gray-700">{item.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - GPS Tracking */}
        <div className="col-span-1">
          <div className="bg-white rounded-lg shadow-sm">
            <CameraMap />
          </div>
          {/* Team Status */}
          <div className="bg-white rounded-lg shadow-sm mt-4">
            <div className="p-3 border-b border-gray-200">
              <h2 className="font-semibold text-sm">Team Status</h2>
            </div>
            <div className="p-3 space-y-2.5">
              {teamStatus.map((officer, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-xs">
                      {(officer.name.split(' ')[1] || officer.name).substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-xs">{officer.name}</div>
                      <div className="text-xs text-gray-500">{officer.unit}</div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${officer.color === 'red'
                        ? 'bg-red-500 animate-pulse'
                        : officer.color === 'green'
                          ? 'bg-green-500'
                          : 'bg-gray-400'
                        }`}
                    ></span>
                    <span className="text-xs">{officer.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Recent Alerts */}
          <div className="bg-white rounded-lg shadow-sm mt-4">
            <div className="p-3 border-b border-gray-200">
              <h2 className="font-semibold text-sm">Recent Alerts</h2>
            </div>
            <div className="p-3">
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-2 text-xs">
                <div className="font-semibold text-yellow-800">Battery Alert - Officer Garcia</div>
                <div className="text-yellow-700 mt-1">Device battery at 15%</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---- App Root ----
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userName, setUserName] = useState('');
  const [userUnit, setUserUnit] = useState('');
  const [activeMenu, setActiveMenu] = useState('Dashboard');
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [teamStatus, setTeamStatus] = useState<TeamMember[]>([
    { id: 1, name: 'Officer Rodriguez', unit: 'Patrol Unit 7A', status: 'Live', color: 'red' },
    { id: 2, name: 'Officer Santos', unit: 'Patrol Unit 5B', status: 'Active', color: 'green' },
    { id: 3, name: 'Officer Dela Cruz', unit: 'Dispatch', status: 'Active', color: 'green' },
    { id: 4, name: 'Officer Garcia', unit: 'Patrol Unit 3C', status: 'Offline', color: 'gray' },
    { id: 5, name: 'Officer Ramos', unit: 'Patrol Unit 2D', status: 'Active', color: 'green' },
  ]);


  const handleLogin = (name: string, unit: string) => {
    setUserName(name);
    setUserUnit(unit);
    setIsLoggedIn(true);
    setTeamStatus((prev) => [{ id: 1, name, unit, status: 'Live', color: 'red' }, ...prev.slice(1)]);
  };

  const handleTranscript = (entry: Transcript) => {
    setTranscripts((prev) => [entry, ...prev]);
  };


  if (!isLoggedIn) return <LoginPage onLogin={handleLogin} />;


  return (
    <div className="flex h-screen bg-gray-50 relative">
      {/* Sidebar */}
      <Sidebar activeMenu={activeMenu} onMenuChange={setActiveMenu} />

      {/* Top Header Bar */}
      <div className="absolute top-0 left-0 right-0 bg-indigo-900 text-white px-6 py-3 flex justify-between items-center z-10">
        <div className="flex items-center space-x-3">
          <Shield className="w-5 h-5" />
          <span className="font-semibold text-sm">
            Philippine Police Body Camera System
          </span>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <UserCircle className="w-4 h-4" />
            <span className="text-sm">
              {userName} • {userUnit}
            </span>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden mt-12">
        {activeMenu === 'Dashboard' && (
          <Dashboard
            teamStatus={teamStatus}
            transcripts={transcripts}
            onTranscript={handleTranscript}
          />
        )}

        {activeMenu === 'Playback' && <Playback />}

        {(activeMenu === 'Voice Communication' ||
          activeMenu === 'Team Management') && (
            <Communication
              currentUser={{ name: userName, unit: userUnit }}
              teamMembers={teamStatus}
            />
          )}

        {activeMenu === 'Device Management' && <Device />}

        {![
          'Dashboard',
          'Playback',
          'Voice Communication',
          'Team Management',
          'Device Management',
        ].includes(activeMenu) && (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Settings className="w-16 h-16 mx-auto mb-4" />
                <p className="text-lg">Feature under development</p>
                <p className="text-sm">{activeMenu} will be available soon</p>
              </div>
            </div>
          )}
      </div>
    </div> // ← 這個是原本少掉的最外層 div
  );
}
