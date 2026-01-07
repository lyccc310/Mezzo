// src/config/api.ts

// 自動偵測 API Base URL
export const getApiBaseUrl = (): string => {
  // 開發環境
  if (import.meta.env.DEV) {
    return 'http://localhost:4000';
  }
  
  // 生產環境：使用當前主機名
  return `${window.location.protocol}//${window.location.hostname}:4000`;
};

// 或手動設定（取消註解使用）
// export const API_BASE_URL = 'http://192.168.1.100:4000';

export const API_BASE_URL = getApiBaseUrl();

// API 端點
export const API_ENDPOINTS = {
  health: `${API_BASE_URL}/health`,
  devices: `${API_BASE_URL}/devices`,
  streams: `${API_BASE_URL}/api/streams`,
  rtspRegister: `${API_BASE_URL}/api/rtsp/register`,
  sendCot: `${API_BASE_URL}/send-cot`,
  takStatus: `${API_BASE_URL}/api/tak/status`,
};

// WebSocket URL
export const WS_URL = API_BASE_URL.replace('http', 'ws').replace(':4000', ':4001');

// 輔助函數
export const getStreamUrl = (relativeUrl: string): string => {
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl;
  }
  return `${API_BASE_URL}${relativeUrl.startsWith('/') ? relativeUrl : `/${relativeUrl}`}`;
};

/**
 * 確保 streamUrl 是完整的 URL
 * @param streamUrl - 可能是相對路徑或完整 URL
 * @returns 完整的 URL
 */
export const getFullStreamUrl = (streamUrl: string | undefined): string => {
  if (!streamUrl) return '';
  
  // 如果已經是完整 URL，直接返回
  if (streamUrl.startsWith('http://') || streamUrl.startsWith('https://')) {
    return streamUrl;
  }
  
  // 確保路徑以 / 開頭
  const path = streamUrl.startsWith('/') ? streamUrl : `/${streamUrl}`;
  
  // 添加 backend server URL
  // 在生產環境中，應該從環境變數讀取
  const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
  
  return `${backendUrl}${path}`;
};

/**
 * 檢查串流 URL 是否可用
 * @param streamUrl - 串流 URL
 * @returns Promise<boolean>
 */
export const checkStreamAvailable = async (streamUrl: string): Promise<boolean> => {
  try {
    const fullUrl = getFullStreamUrl(streamUrl);
    const response = await fetch(fullUrl, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
};