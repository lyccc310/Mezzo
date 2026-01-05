class CameraManager {
  constructor(takServerClient, rtspConverter) {
    this.takClient = takServerClient;
    this.rtspConverter = rtspConverter;
    this.cameras = new Map();
  }

  registerCamera(config) {
    const camera = {
      id: config.id,
      rtspUrl: config.rtspUrl,
      position: config.position, // { lat, lon, alt }
      priority: config.priority,
      status: 'offline',
      streamUrl: null,
      lastUpdate: new Date()
    };

    // 啟動視訊串流
    const streamUrl = this.rtspConverter.startHLSStream(
      camera.id,
      camera.rtspUrl,
      '/var/www/html/streams'
    );
    camera.streamUrl = streamUrl;
    camera.status = 'online';

    // 發送 CoT 訊息到 TAK Server
    this.sendCameraCoT(camera);

    this.cameras.set(camera.id, camera);
    return camera;
  }

  sendCameraCoT(camera) {
    const cotMessage = this.generateCameraCoT(camera);
    this.takClient.sendCoT(cotMessage);
  }

  generateCameraCoT(camera) {
    const now = new Date();
    const stale = new Date(now.getTime() + 300000);

    return `<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="${camera.id}" type="b-m-p-s-p-loc" how="m-g" time="${now.toISOString()}" start="${now.toISOString()}" stale="${stale.toISOString()}">
  <point lat="${camera.position.lat}" lon="${camera.position.lon}" hae="${camera.position.alt || 0}" ce="10.0" le="10.0"/>
  <detail>
    <contact callsign="${camera.id}"/>
    <__video url="${camera.streamUrl}"/>
    <remarks>RTSP Camera - Priority ${camera.priority}</remarks>
    <priority>${camera.priority}</priority>
    <status>${camera.status}</status>
  </detail>
</event>`;
  }

  // 根據優先級獲取攝像頭
  getCamerasByPriority() {
    return Array.from(this.cameras.values())
      .sort((a, b) => a.priority - b.priority);
  }

  // 獲取特定區域的攝像頭
  getCamerasInArea(centerLat, centerLon, radiusKm) {
    return Array.from(this.cameras.values()).filter(camera => {
      const distance = this.calculateDistance(
        centerLat, centerLon,
        camera.position.lat, camera.position.lon
      );
      return distance <= radiusKm;
    });
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    // Haversine 公式計算距離
    const R = 6371; // 地球半徑（公里）
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
}

module.exports = CameraManager;