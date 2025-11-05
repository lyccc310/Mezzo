import React, { useState } from 'react';
import { Camera, Radio, MapPin, Users, HardDrive, Menu, Bell, Play, Volume2, Maximize, User, Video, Mic, Settings, Shield, Group, UserCog2Icon, UserLock } from 'lucide-react';

function App() {
  const [activeMenu, setActiveMenu] = useState('Dashboard');

  const menuItems = [
    { name: 'Dashboard', icon: Menu },
    { name: 'Live Feed', icon: Video },
    { name: 'Playback', icon: Play },
    { name: 'GPS Tracking', icon: MapPin },
    { name: 'Team Management', icon: Users },
    { name: 'Voice Communication', icon: Mic },
    { name: 'Device Management', icon: Settings },
    { name: 'User Accounts', icon: UserLock },
  ];

  const teamStatus = [
    { name: 'Officer Rodriguez', unit: 'Patrol Unit 7A', status: 'Live', color: 'red' },
    { name: 'Officer Santos', unit: 'Patrol Unit 5B', status: 'Active', color: 'green' },
    { name: 'Officer Dela Cruz', unit: 'Dispatch', status: 'Active', color: 'green' },
    { name: 'Officer Garcia', unit: 'Patrol Unit 3C', status: 'Offline', color: 'gray' },
    { name: 'Officer Ramos', unit: 'Patrol Unit 2D', status: 'Active', color: 'green' },
  ];

  const transcripts = [
    { time: '10:23:15', officer: 'Rodriguez', text: 'Requesting backup at corner of Mabini and Rizal streets.' },
    { time: '10:23:22', officer: 'Dispatch', text: 'Copy that Rodriguez, unit 5B is en route, ETA 3 minutes.' },
    { time: '10:24:05', officer: 'Rodriguez', text: 'Suspect is approximately 5\'10", wearing blue jacket and black pants.' },
    { time: '10:24:19', officer: 'Rodriguez', text: 'He\'s heading east on Rizal street on foot.' },
  ];

  return (
    <div className="flex h-screen bg-gray-50 relative">
      {/* Sidebar */}
      <div className="w-60 bg-white border-r border-gray-200 flex flex-col">
        <nav className="mt-16">
          {menuItems.map((item) => (
            <button
              key={item.name}
              onClick={() => setActiveMenu(item.name)}
              className={`w-full flex items-center space-x-3 px-6 py-3 text-sm transition ${
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
            <Bell className="w-4 h-4" />
            <span className="text-sm">Admin User</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden mt-12">
        {/* Page Title */}
        <div className="bg-white border-b px-6 py-4">
          <div className="flex items-center space-x-3">
          <h1 className="text-2xl font-semibold text-gray-800">Dashboard</h1>
            <button className="px-2 py-1 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-800">
              Export
            </button>
            <button className="px-2 py-1 border border-gray-300 text-gray-600 rounded text-sm hover:bg-gray-700">
              Today
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {/* Stats Cards */}
          <div className="grid grid-cols-4 gap-4 p-4">
            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-gray-600 text-sm">Active Devices</h3>
                <Video className="w-6 h-6 text-blue-500" />
              </div>
              <div className="text-3xl font-bold text-blue-600">24</div>
              <div className="text-xs text-green-600 mt-1">+2 from yesterday</div>
            </div>

            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-gray-600 text-sm">Incidents Today</h3>
                <div className="text-2xl">⚠️</div>
              </div>
              <div className="text-3xl font-bold text-yellow-600">7</div>
              <div className="text-xs text-red-600 mt-1">+3 from yesterday</div>
            </div>

            <div className="bg-white p-4 rounded-lg shadow-sm">
              <div className="flex items-start justify-between mb-2">
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
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-gray-600 text-sm">Storage Used</h3>
                <HardDrive className="w-6 h-6 text-cyan-500" />
              </div>
              <div className="text-3xl font-bold text-cyan-600">78%</div>
              <div className="text-xs text-gray-600 mt-1">2.3 TB of 3 TB</div>
            </div>
          </div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-12 gap-4 px-4 pb-4">
            {/* Left Column - Live Feed + Voice Communication */}
            <div className="col-span-8 space-y-4">
              {/* Live Feed */}
              <div className="bg-white rounded-lg shadow-sm">
                <div className="p-3 border-b flex justify-between items-center">
                  <h2 className="font-semibold text-sm">Live Video Feed - Officer Rodriguez</h2>
                  <span className="flex items-center text-red-600 text-xs">
                    <span className="w-2 h-2 bg-red-600 rounded-full mr-2 animate-pulse"></span>
                    Recording
                  </span>
                </div>
                <div className="bg-indigo-900 aspect-video flex items-center justify-center relative">
                  <div className="text-white text-3xl font-bold">LIVE FEED (RTSP Stream)</div>
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
                <div className="p-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-2">
                    <span>09:00 AM</span>
                    <span className="text-blue-600 font-medium">Current Time</span>
                    <span>05:00 PM</span>
                  </div>
                  <div className="w-full bg-gray-200 h-1.5 rounded-full">
                    <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: '45%' }}></div>
                  </div>
                </div>
              </div>

              {/* Voice Communication and Speech to Text */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <h2 className="font-semibold text-sm mb-4">Voice Communication</h2>
                  <div className="flex flex-col items-center space-y-3">
                    <button className="w-20 h-20 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-lg">
                      <Radio className="w-10 h-10 text-white" />
                    </button>
                    <div className="text-xs text-gray-600 text-center">Press and hold to talk</div>
                    <label className="flex items-center space-x-2 text-xs">
                      <input type="checkbox" className="rounded" />
                      <span>Voice Activation</span>
                    </label>
                  </div>
                </div>

                <div className="col-span-2 bg-white rounded-lg shadow-sm">
                  <div className="p-3 border-b">
                    <h2 className="font-semibold text-sm">Speech to Text</h2>
                  </div>
                  <div className="p-3 space-y-2 h-56 overflow-y-auto">
                    {transcripts.map((item, index) => (
                      <div key={index} className="text-xs">
                        <span className="text-blue-600 font-mono">{item.time}</span>{' '}
                        <span className="font-semibold">{item.officer}:</span>{' '}
                        <span className="text-gray-700">{item.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - GPS + Team Status */}
            <div className="col-span-4 space-y-4">
              {/* GPS Tracking */}
              <div className="bg-white rounded-lg shadow-sm">
                <div className="p-3 border-b">
                  <h2 className="font-semibold text-sm">GPS Tracking</h2>
                </div>
                <div className="relative h-64 bg-blue-50">
                  <div className="absolute inset-0 flex items-center justify-center text-gray-300">
                    <MapPin className="w-12 h-12" />
                  </div>
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                    <div className="w-10 h-10 bg-blue-600 rounded-full border-4 border-white shadow-lg animate-pulse"></div>
                  </div>
                </div>
                <div className="p-3 border-t">
                  <div className="text-sm font-semibold mb-1">Officer Rodriguez</div>
                  <div className="text-xs text-gray-600">Last updated: 10:25 AM</div>
                  <div className="text-xs text-gray-600">14.5995° N, 120.9842° E</div>
                  <div className="text-xs text-gray-600 mb-3">Manila, Philippines</div>
                  <div className="flex space-x-2">
                    <button className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-xs hover:bg-gray-50">
                      History
                    </button>
                    <button className="flex-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
                      Share Location
                    </button>
                  </div>
                </div>
              </div>

              {/* Team Status */}
              <div className="bg-white rounded-lg shadow-sm">
                <div className="p-3 border-b">
                  <h2 className="font-semibold text-sm">Team Status</h2>
                </div>
                <div className="p-3 space-y-2.5">
                  {teamStatus.map((officer, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-xs">
                          {officer.name.split(' ')[1].substring(0, 2).toUpperCase()}
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
              <div className="bg-white rounded-lg shadow-sm">
                <div className="p-3 border-b">
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