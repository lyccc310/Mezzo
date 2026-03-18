// src/config/api.ts

import { getAuthHeaders } from '../auth/authService';

export const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

// API 端點
export const API_ENDPOINTS = {
  health: `${API_BASE_URL}/health`,
  devices: `${API_BASE_URL}/devices`,
  streams: `${API_BASE_URL}/api/streams`,
  rtspRegister: `${API_BASE_URL}/api/rtsp/register`,
  // sendCot: `${API_BASE_URL}/send-cot`,  // 已棄用：TAK Server 已停用
  takStatus: `${API_BASE_URL}/api/tak/status`,
  // PTT API 端點
  pttPublish: `${API_BASE_URL}/ptt/publish`,
};

// WebSocket URL
export const WS_URL = import.meta.env.VITE_WS_URL || API_BASE_URL.replace('http', 'ws').replace(':4000', ':4001');

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

/**
 * Authenticated fetch wrapper.
 * Automatically attaches JWT Authorization header if available.
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const headers = {
    ...options.headers,
    ...authHeaders,
  };
  return fetch(url, { ...options, headers });
}