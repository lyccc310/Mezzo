import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// 定義座標（直接用 [number, number]）
const position: [number, number] = [24.993861, 121.2995];

// 建立自訂圖示
const customIcon: L.Icon = new L.Icon({
  iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href,
  shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

//取現在時間
const now = new Date();
const time = now.toLocaleTimeString('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});

const CameraMap = () => {
  return (
      <>
        <div className="p-3 border-b border-gray-200">
          <h2 className="font-semibold text-sm">GPS Tracking</h2>
        </div>
        <div className="relative h-64 bg-blue-50">
          <div className="absolute inset-0 flex items-center justify-center text-gray-300">
            <MapContainer
                center={position as any}
                zoom={15}
                scrollWheelZoom={false}
                style={{height: '100%', width: '100%'}}
                className="rounded-lg shadow"
            >
              <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution="&copy; OpenStreetMap contributors"/>
              <Marker position={position} icon={customIcon as any}>
                <Popup>Officer Rodriguez<br/>Last updated: {time}</Popup>
              </Marker>
            </MapContainer>
          </div>
          </div>
          <div className="p-3 border-t border-gray-200">
            <div className="flex col-span-4 justify-between">
              <div>
                <div className="text-sm font-semibold mb-1">Officer Rodriguez</div>
                <div className="text-xs text-gray-600">Last updated: {time}</div>
              </div>
              <div>
                <div className="text-xs text-black">14.5995° N, 120.9842° E</div>
                <div className="text-xs text-black mb-3 text-right">Manila, Philippines</div>
              </div>
            </div>
            <div className="space-x-2 mt-1">
              <button
                  className="flex-1 px-1 py-1 text-blue-700 border border-blue-700 rounded text-xs hover:bg-gray-50">
                History
              </button>
              <button
                  className="flex-1 px-1 py-1 text-blue-700 border border-blue-700 rounded text-xs hover:bg-blue-700">
                Share Location
              </button>
            </div>
          </div>
      </>

  );
};

export default CameraMap;