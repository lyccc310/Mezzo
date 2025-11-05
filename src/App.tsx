import { useState, useRef } from 'react';
import { Camera, Radio, MapPin, Users, HardDrive, Menu, Bell, Play, Volume2, Maximize, User } from 'lucide-react';
import CameraMap from './assets/CameraMap';
import VoiceControl from './assets/VoiceControl';

function App() {
  const [activeMenu, setActiveMenu] = useState('Dashboard');
  const [transcripts, setTranscripts] = useState<
    { time: string, officer: string, text: string }[]
  >([]);

  const handleTranscript = (entry: { time: string, officer: string, text: string }) => {
    setTranscripts((prev) => [...prev, entry]);
  };

  const menuItems = [
    { name: 'Dashboard', icon: Menu },
    { name: 'Live Feed', icon: Camera },
    { name: 'Playback', icon: Play },
    { name: 'GPS Tracking', icon: MapPin },
    { name: 'Team Management', icon: Users },
    { name: 'Voice Communication', icon: Radio },
    { name: 'Device Management', icon: HardDrive },
    { name: 'User Accounts', icon: User },
  ];

  const teamStatus = [
    { name: 'Officer Rodriguez', unit: 'Patrol Unit 7A', status: 'Live', color: 'red' },
    { name: 'Officer Santos', unit: 'Patrol Unit 5B', status: 'Active', color: 'green' },
    { name: 'Officer Dela Cruz', unit: 'Dispatch', status: 'Active', color: 'green' },
    { name: 'Officer Garcia', unit: 'Patrol Unit 3C', status: 'Offline', color: 'gray' },
    { name: 'Officer Ramos', unit: 'Patrol Unit 2D', status: 'Active', color: 'green' },
  ];

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-64 bg-indigo-900 text-white">
        <div className="p-4 flex items-center space-x-2 border-b border-indigo-800">
          <Camera className="w-6 h-6" />
          <span className="font-semibold text-sm">Philippine Police Body Camera System</span>
        </div>
        <nav className="mt-4">
          {menuItems.map((item) => (
            <button
              key={item.name}
              onClick={() => setActiveMenu(item.name)}
              className={`w-full flex items-center space-x-3 px-4 py-3 hover:bg-indigo-800 transition ${activeMenu === item.name ? 'bg-indigo-800 border-l-4 border-white' : ''
                }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-sm">{item.name}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {/* Header */}
        <div className="bg-white border-b px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-semibold text-gray-800">Dashboard</h1>
          <div className="flex items-center space-x-4">
            <button className="px-4 py-2 border border-gray-300 rounded text-sm hover:bg-gray-50">
              Export
            </button>
            <button className="px-4 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700">
              📅 Today
            </button>
            <div className="flex items-center space-x-2">
              <Bell className="w-5 h-5 text-gray-600" />
              <span className="text-sm text-gray-600">Admin User</span>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-6 p-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-gray-600 text-sm">Active Devices</h3>
              <Camera className="w-8 h-8 text-blue-500" />
            </div>
            <div className="text-3xl font-bold text-blue-600">24</div>
            <div className="text-xs text-green-600 mt-1">+2 from yesterday</div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-gray-600 text-sm">Incidents Today</h3>
              <div className="text-yellow-500 text-2xl">⚠️</div>
            </div>
            <div className="text-3xl font-bold text-yellow-600">7</div>
            <div className="text-xs text-red-600 mt-1">+3 from yesterday</div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-gray-600 text-sm">Active Officers</h3>
              <div className="relative">
                <Users className="w-8 h-8 text-green-500" />
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full"></div>
              </div>
            </div>
            <div className="text-3xl font-bold text-green-600">18</div>
            <div className="text-xs text-green-600 mt-1">All teams operational</div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-gray-600 text-sm">Storage Used</h3>
              <HardDrive className="w-8 h-8 text-cyan-500" />
            </div>
            <div className="text-3xl font-bold text-cyan-600">78%</div>
            <div className="text-xs text-gray-600 mt-1">2.3 TB of 3 TB</div>
          </div>
        </div>

        {/* Live Feed and GPS Section */}
        <div className="grid grid-cols-3 gap-6 px-6 pb-6">
          {/* Live Feed */}
          <div className="col-span-2 bg-white rounded-lg shadow">
            <div className="p-4 border-b flex justify-between items-center">
              <h2 className="font-semibold">Live Video Feed - Officer Rodriguez</h2>
              <span className="flex items-center text-red-600 text-sm">
                <span className="w-2 h-2 bg-red-600 rounded-full mr-2 animate-pulse"></span>
                Recording
              </span>
            </div>
            <div className="bg-indigo-900 aspect-video flex items-center justify-center relative">
              <img
                src="http://220.135.209.219:8088/mjpeg_stream.cgi?Auth=QWRtaW46MTIzNA==&ch=1"
                alt="Live Feed"
                className="w-full h-full object-cover"
                style={{ borderRadius: '0.5rem' }}
              />
              <div className="absolute bottom-4 left-4 flex space-x-2">
                <button className="bg-white bg-opacity-20 hover:bg-opacity-30 p-2 rounded">
                  <Play className="w-4 h-4 text-white" />
                </button>
                <button className="bg-white bg-opacity-20 hover:bg-opacity-30 p-2 rounded">
                  <Volume2 className="w-4 h-4 text-white" />
                </button>
              </div>
              <div className="absolute bottom-4 right-4 flex space-x-2">
                <button className="bg-red-600 hover:bg-red-700 p-2 rounded-full">
                  <div className="w-3 h-3 bg-white rounded-full"></div>
                </button>
                <button className="bg-white bg-opacity-20 hover:bg-opacity-30 p-2 rounded">
                  <Maximize className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
            <div className="p-4">
              <div className="flex justify-between text-xs text-gray-600 mb-2">
                <span>09:00 AM</span>
                <span className="text-blue-600">Current Time</span>
                <span>05:00 PM</span>
              </div>
              <div className="w-full bg-gray-200 h-2 rounded">
                <div className="bg-blue-500 h-2 rounded" style={{ width: '45%' }}></div>
              </div>
            </div>
          </div>

          {/* GPS Tracking */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b">
              <h2 className="font-semibold">GPS Tracking</h2>
            </div>
            <div className="p-4 h-64">
              <CameraMap />
            </div>
            <div className="p-4 border-t">
              <div className="text-sm font-semibold mb-1">Officer Rodriguez</div>
              <div className="text-xs text-gray-600">Last updated: 10:25 AM</div>
              <div className="text-xs text-gray-600">14.5995° N, 120.9842° E</div>
              <div className="text-xs text-gray-600 mb-3">Manila, Philippines</div>
              <div className="flex space-x-2">
                <button className="flex-1 px-3 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">
                  History
                </button>
                <button className="flex-1 px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
                  Share Location
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6 px-6 pb-6">
          <VoiceControl onTranscript={handleTranscript} />
          <div className="col-span-2 bg-white rounded-lg shadow">
            <div className="p-4 border-b">
              <h2 className="font-semibold">Speech to Text</h2>
            </div>
            <div className="p-4 space-y-3 h-64 overflow-y-auto">
              {transcripts.map((item, index) => (
                <div key={index} className="flex space-x-2">
                  <span className="text-blue-600 font-mono text-xs">{item.time}</span>
                  <span className="font-semibold text-xs">{item.officer}:</span>
                  <span className="text-sm text-gray-700">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Team Status */}
        <div className="px-6 pb-6">
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b">
              <h2 className="font-semibold">Team Status</h2>
            </div>
            <div className="p-4 space-y-3">
              {teamStatus.map((officer, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold`}>
                      {officer.name.split(' ')[1].substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{officer.name}</div>
                      <div className="text-xs text-gray-600">{officer.unit}</div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span
                      className={`w-2 h-2 rounded-full ${officer.color === 'red'
                        ? 'bg-red-500'
                        : officer.color === 'green'
                          ? 'bg-green-500'
                          : 'bg-gray-400'
                        }`}
                    ></span>
                    <span className="text-sm">{officer.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;