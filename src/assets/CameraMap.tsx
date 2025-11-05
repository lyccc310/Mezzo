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

const CameraMap = () => {
  return (
    <MapContainer
      center={position as any}
      zoom={15}
      scrollWheelZoom={false}
      style={{ height: '100%', width: '100%' }}
      className="rounded-lg shadow"
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      <Marker position={position} icon={customIcon as any}>
        <Popup>Camera Location<br />Officer Rodriguez</Popup>
      </Marker>
    </MapContainer>
  );
};

export default CameraMap;