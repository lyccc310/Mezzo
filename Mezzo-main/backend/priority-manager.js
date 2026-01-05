class PriorityManager {
  constructor() {
    this.rules = new Map();
    this.loadDefaultRules();
  }

  loadDefaultRules() {
    // 預設優先順序規則
    this.rules.set('emergency', {
      priority: 1,
      color: '#ff0000',
      zIndex: 1000,
      alwaysVisible: true,
      description: '緊急事件'
    });

    this.rules.set('critical', {
      priority: 2,
      color: '#ff6600',
      zIndex: 900,
      alwaysVisible: true,
      description: '重要監控'
    });

    this.rules.set('normal', {
      priority: 3,
      color: '#0066ff',
      zIndex: 800,
      alwaysVisible: false,
      description: '一般監控'
    });

    this.rules.set('low', {
      priority: 4,
      color: '#999999',
      zIndex: 700,
      alwaysVisible: false,
      description: '低優先級'
    });
  }

  // 根據條件計算優先順序
  calculatePriority(device, context) {
    let basePriority = device.priority || 3;

    // 根據距離調整優先順序
    if (context.userLocation) {
      const distance = this.calculateDistance(
        context.userLocation.lat,
        context.userLocation.lon,
        device.position.lat,
        device.position.lon
      );

      // 距離越近，優先級越高
      if (distance < 1) basePriority -= 1; // 1公里內
      if (distance < 0.5) basePriority -= 1; // 500米內
    }

    // 根據設備狀態調整
    if (device.status === 'alert') basePriority = 1;
    if (device.status === 'offline') basePriority += 2;

    // 根據電量調整
    if (device.battery && device.battery < 20) basePriority -= 1;

    return Math.max(1, Math.min(4, basePriority));
  }

  // 過濾和排序設備
  filterAndSortDevices(devices, context) {
    return devices
      .map(device => ({
        ...device,
        calculatedPriority: this.calculatePriority(device, context),
        rule: this.getRuleForPriority(this.calculatePriority(device, context))
      }))
      .filter(device => {
        // 根據縮放等級過濾
        if (context.mapZoom < 12 && !device.rule.alwaysVisible) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.calculatedPriority - b.calculatedPriority);
  }

  getRuleForPriority(priority) {
    const ruleNames = ['emergency', 'critical', 'normal', 'low'];
    return this.rules.get(ruleNames[priority - 1]) || this.rules.get('normal');
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
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

module.exports = PriorityManager;