import { useState } from 'react';
import {
  Shield,
  Video,
  Play,
  MapPin,
  Users,
  Mic,
  Settings,
  UserLock,
  HardDrive,
  Volume2,
  Fullscreen,
  UserCircle,
  Calendar,
  GaugeCircle, Disc2
} from 'lucide-react';
import CameraMap from './assets/CameraMap';
import VoiceControl from './assets/VoiceControl';
function App() {
  //login error(沒輸 Name 或 Unit)
  const [loginError, setLoginError] = useState('');
  const [activeMenu, setActiveMenu] = useState('Dashboard');
  const [transcripts, setTranscripts] = useState<
      { time: string, officer: string, text: string }[]
  >([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const videoContainerRef = useState<HTMLDivElement | null>(null)[0];
  // 使用者資訊(含登入狀態)
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userName, setUserName] = useState('');
  const [userUnit, setUserUnit] = useState('');
  const [inputName, setInputName] = useState('');
  const [inputUnit, setInputUnit] = useState('Patrol Unit 7A');
  const [teamStatus, setTeamStatus] = useState([
    { id: 1, name: 'Officer Rodriguez', unit: 'Patrol Unit 7A', status: 'Live', color: 'red' },
    { id: 2, name: 'Officer Santos', unit: 'Patrol Unit 5B', status: 'Active', color: 'green' },
    { id: 3, name: 'Officer Dela Cruz', unit: 'Dispatch', status: 'Active', color: 'green' },
    { id: 4, name: 'Officer Garcia', unit: 'Patrol Unit 3C', status: 'Offline', color: 'gray' },
    { id: 5, name: 'Officer Ramos', unit: 'Patrol Unit 2D', status: 'Active', color: 'green' },
  ]);

  const handleLogin = () => {
    if (!inputName.trim() || !inputUnit.trim()) {
      setLoginError('Please enter both name and unit');
      return;
    }
    setUserName(inputName.trim());
    setUserUnit(inputUnit.trim());
    setIsLoggedIn(true);

    // 更新第一個成員為登入使用者
    setTeamStatus(prev => [
        { id: 1, name: inputName.trim(), unit: inputUnit.trim(), status: 'Live', color: 'red' },
        ...prev.slice(1)
      ]);
  };

  const handleTranscript = (entry: { time: string, officer: string, text: string }) => {
    setTranscripts((prev) => [...prev, entry]);
  };

  // 新增全螢幕切換函數 For Video
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

  const menuItems = [
    { name: 'Dashboard', icon: GaugeCircle },
    { name: 'Live Feed', icon: Video },
    { name: 'Playback', icon: Play },
    { name: 'GPS Tracking', icon: MapPin },
    { name: 'Team Management', icon: Users },
    { name: 'Voice Communication', icon: Mic },
    { name: 'Device Management', icon: Settings },
    { name: 'User Accounts', icon: UserLock },
  ];

  if (!isLoggedIn) {
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Enter Your Name
                </label>
                <input
                    type="text"
                    value={inputName}
                    onChange={(e) => setInputName(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    placeholder="e.g., Rodriguez"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    autoFocus
                />
                <label className="block text-sm font-medium text-gray-700 mb-2 mt-2">
                  Enter Your Unit
                </label>
                <input
                    type="text"
                    value={inputUnit}
                    onChange={(e) => setInputUnit(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    placeholder="e.g., Patrol Unit 7A"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    autoFocus
                />
              </div>
              {/*沒輸 name or unit 顯示錯誤訊息*/}
              {loginError && (
                  <div className="text-red-600 text-sm text-center">
                    {loginError}
                  </div>
              )}
              <button
                  onClick={handleLogin}
                  className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition"
              >
                Enter System
              </button>
            </div>
          </div>
        </div>
    );
  }
  return (
      <div className="flex h-screen bg-gray-50 relative">
        {/* Sidebar */}
        <div className="w-60 bg-white border-r border-gray-200 flex flex-col">
          <nav className="mt-16">
            {menuItems.map((item) => (
                <button
                    key={item.name}
                    onClick={() => setActiveMenu(item.name)}
                    className={`w-full flex items-center space-x-3 px-4 py-3 text-sm transition ${
                        activeMenu === item.name
                            ? 'bg-indigo-50 text-indigo-700 border-l-4 border-indigo-600'
                            : 'text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.name}</span>
                </button>
            ))}
          </nav>
        </div>

        {/* Top Header Bar */}
        <div className="absolute top-0 left-0 right-0 bg-indigo-900 text-white px-6 py-3 flex justify-between items-center z-10">
          <div className="flex items-center space-x-3">
            <Shield className="w-5 h-5" />
            <span className="font-semibold text-sm">Philippine Police Body Camera System</span>
          </div>
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <UserCircle className="w-4 h-4 fill" />
              <span className="text-sm">{userName}</span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden mt-12">
          {/* Page Title Bar */}
          <div className="border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-semibold text-gray-800">Dashboard</h1>
              <div className="flex items-center space-x-2">
                <button className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50">
                  Export
                </button>
                <button className="flex px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50">
                  <Calendar className="w-4 h-4"/>&nbsp;Today
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4 p-6">
              <div className="bg-white p-4 rounded-lg shadow-sm h-26">
                <div className="flex items-start justify-between">
                  <h3 className="text-gray-600 text-sm">Active Devices</h3>
                  <Video className="w-6 h-6 text-blue-500 fill-blue-500" />
                </div>
                <div className="text-3xl font-bold text-blue-600">24</div>
                <div className="text-xs text-green-600 mt-1">+2 from yesterday</div>
              </div>

              <div className="bg-white p-4 rounded-lg shadow-sm h-26">
                <div className="flex items-start justify-between">
                  <h3 className="text-gray-600 text-sm">Incidents Today</h3>
                  <div className="w-6 h-6 text-blue-500">⚠️</div>
                </div>
                <div className="text-3xl font-bold text-yellow-600">7</div>
                <div className="text-xs text-red-600 mt-1">+3 from yesterday</div>
              </div>

              <div className="bg-white p-4 rounded-lg shadow-sm h-26">
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

              <div className="bg-white p-4 rounded-lg shadow-sm h-26">
                <div className="flex items-start justify-between">
                  <h3 className="text-gray-600 text-sm">Storage Used</h3>
                  <HardDrive className="w-6 h-6 text-cyan-500" />
                </div>
                <div className="text-3xl font-bold text-cyan-600">78%</div>
                <div className="text-xs text-gray-600 mt-1">2.3 TB of 3 TB</div>
              </div>
            </div>

            {/* Live Feed and GPS Section */}
            <div className="grid grid-cols-12 gap-4 px-4 pb-4">
              {/* Left Column - Live Feed + Voice Communication*/}
              <div className="col-span-8 space-y-4">
                {/* Live Feed */}
                <div className="bg-white rounded-lg shadow-sm" id="video-container">
                  <div className="p-3 border-b border-gray-200 flex justify-between items-center">
                    <h2 className="font-semibold text-sm">Live Video Feed - Officer Rodriguez</h2>
                    <span className="flex items-center text-red-600 text-xs">
                    <span className="w-2 h-2 bg-red-600 rounded-full mr-2 animate-pulse"></span>
                    Recording
                  </span>
                  </div>
                  <div className="bg-indigo-900 aspect-video flex items-center justify-center relative">
                    <img
                        src="http://220.135.209.219:8088/mjpeg_stream.cgi?Auth=QWRtaW46MTIzNA==&ch=1"
                        alt="Live Feed"
                        className="w-full h-full object-cover"
                        // style={{ borderRadius: '0.5rem' }}
                    />
                    <div className="absolute bottom-4 flex w-full justify-between px-4">
                      <div className="space-x-2">
                      <button onClick={toggleFullscreen}
                          className="bg-white bg-opacity-20 hover:bg-opacity-30 p-2 rounded"
                          title="Toggle Fullscreen">
                        <Fullscreen className="w-4 h-4 text-black" />
                      </button>
                      <button className="bg-white bg-opacity-20 hover:bg-opacity-30 p-2 rounded">
                        <Volume2 className="w-4 h-4 text-black" />
                      </button></div>

                      <div className="space-x-2">
                      <button className="bg-red-600 bg-opacity-20 hover:bg-opacity-30 p-2 rounded right-auto">
                        <Disc2 className="w-4 h-4 text-white" />
                      </button>
                      <button className="bg-white bg-opacity-20 hover:bg-opacity-30 p-2 rounded">
                        <Settings className="w-4 h-4 text-black" />
                      </button></div>
                    </div>
                  </div>
                  <div className="p-3">
                    {/* 錄影片段標記（在時間軸上方） */}
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
                <div className="grid grid-cols-2 gap-4">
                  {/* Voice Communication */}
                  <VoiceControl onTranscript={handleTranscript} />
                  <div className="col-span bg-white rounded-lg shadow">
                    <div className="p-4 border-b border-gray-200">
                      <h2 className="font-semibold">Speech to Text</h2>
                    </div>
                    <div className="p-4 space-y-1 overflow-y-auto">
                      {transcripts.map((item, index) => (
                          <div key={index} className="bg-gray-50 p-2 rounded">
                            <div className="flex items-start space-x-2">
                              <span className="text-blue-600 font-mono text-xs font-semibold whitespace-nowrap">{item.time}</span>
                              <span className="font-semibold text-xs text-green-600">{item.officer}:</span>
                              <span className="text-xs text-gray-700 ml-1">{item.text}</span>
                            </div>
                          </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column - GPS Tracking */}
              <div className="col-span-4">
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
                            className={`w-2 h-2 rounded-full ${
                                officer.color === 'red'
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
                  <div className="bg-white rounded-lg shadow-sm gap-4 mt-4">
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
        </div>
      </div>
  );
}

export default App;