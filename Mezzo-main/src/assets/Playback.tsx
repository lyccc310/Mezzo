import { useMemo, useState } from 'react';
import type { BackupFile } from '../types.ts';

// ✅ 配置資訊
const API_BASE = '/nvr';
const API_AUTH = 'QWRtaW46MTIzNA=='; // base64(Admin:1234)

// 將時間轉換為 API 所需的格式 'YYYY-MM-DD HH:mm:00'
function toApiDateTime(dtLocal: string) {
  return dtLocal.replace('T', ' ') + ':00';
}

export default function Playback() {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [channels, setChannels] = useState('0, 1');
  const [results, setResults] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- 新增：支援多檔案下載的狀態 ---
  const [activeDownloads, setActiveDownloads] = useState<Set<string>>(new Set());
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});

  const canSearch = useMemo(
    () => Boolean(startTime && endTime),
    [startTime, endTime],
  );

  async function handleSearch() {
    if (!canSearch) {
      setError('請輸入起始與結束時間');
      return;
    }

    const s = new Date(startTime);
    const e = new Date(endTime);
    if (s >= e) {
      setError('結束時間必須晚於起始時間');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const begin = toApiDateTime(startTime);
      const end = toApiDateTime(endTime);

      const qs = new URLSearchParams({
        BeginTime: begin,
        EndTime: end,
        Channels: channels,
        Auth: API_AUTH,
      });

      const url = `${API_BASE}/GetBackupList.cgi?${qs.toString()}`;
      const res = await fetch(url);

      if (!res.ok) throw new Error(`HTTP ${res.status} - ${res.statusText}`);

      const text = await res.text();
      const contentType = res.headers.get('Content-Type');
      if (!contentType?.includes('application/json')) {
        throw new Error('返回的不是 JSON 格式');
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        throw new Error('無法解析伺服器回應');
      }

      if (!data?.success) throw new Error(data?.message ?? '查詢失敗');

      const allFiles: BackupFile[] = (data.data ?? []).flatMap((ch: any) => {
        return (ch.FileList ?? []).map((file: any) => ({
          channel: ch.Ch,
          BeginTime: file.BeginTime,
          EndTime: file.EndTime,
          FileName: file.FileName,
          Tag: file.Tag ?? '-',
        }));
      });

      setResults(allFiles);

      if (allFiles.length === 0) {
        setError('查無符合條件的錄影檔案。建議：\n1. 確認 NVR 在此時間範圍內有錄影\n2. 嘗試更大的時間範圍\n3. 檢查頻道編號');
      }
    } catch (err: any) {
      setError(err?.message ?? '無法取得錄影紀錄');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  // --- 核心下載函式：支援併發與進度條 ---
  async function downloadFile(type: 'avi' | 'raw', tag: string, fileName: string) {
    if (!tag || tag === '-') {
      alert('無效的 Tag');
      return;
    }

    const downloadKey = `${type}-${tag}`;
    
    // 開始下載：更新狀態
    setActiveDownloads(prev => new Set(prev).add(downloadKey));
    setDownloadProgress(prev => ({ ...prev, [downloadKey]: 0 }));

    try {
      const endpoint = type === 'avi' ? 'GetAVIMedia.cgi' : 'BackupMedia.cgi';
      const qs = new URLSearchParams({ Tag: tag, Auth: API_AUTH });
      const url = `${API_BASE}/${endpoint}?${qs.toString()}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`下載失敗: HTTP ${res.status}`);

      const contentLength = res.headers.get('content-length');
      const total = parseInt(contentLength || '0', 10);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('無法讀取回應');

      const chunks: Uint8Array[] = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        chunks.push(value);
        loaded += value.length;
        
        if (total > 0) {
          const progress = Math.round((loaded / total) * 100);
          // 使用 Functional Update 避免多個下載同時更新時發生覆蓋
          setDownloadProgress(prev => ({ ...prev, [downloadKey]: progress }));
        }
      }

      const blob = new Blob(chunks);
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = type === 'avi' ? fileName.replace('.avs', '.avi') : fileName;
      document.body.appendChild(a);
      a.click();

      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error(`Download ${type} error:`, err);
      alert(`下載 ${type.toUpperCase()} 失敗: ${err.message}`);
    } finally {
      // 結束下載：從集合中移除
      setActiveDownloads(prev => {
        const next = new Set(prev);
        next.delete(downloadKey);
        return next;
      });
    }
  }

  return (
    <div className="h-screen flex flex-col p-6">
      <h2 className="text-xl font-semibold mb-4">Playback 查詢</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4 flex-shrink-0">
        <div>
          <label className="block text-sm font-medium">起始時間</label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="mt-1 w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">結束時間</label>
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="mt-1 w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">頻道選擇</label>
          <select
            value={channels}
            onChange={(e) => setChannels(e.target.value)}
            className="mt-1 w-full border rounded px-3 py-2"
          >
            <option value="0">頻道 0</option>
            <option value="1">頻道 1</option>
            <option value="2">頻道 2</option>
            <option value="3">頻道 3</option>
            <option value="4">頻道 4</option>
            <option value="5">頻道 5</option>
            <option value="6">頻道 6</option>
            <option value="7">頻道 7</option>
            <option value="8">頻道 8</option>
            <option value="9">頻道 9</option>
            <option value="10">頻道 10</option>
            <option value="11">頻道 11</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4 flex-shrink-0">
        <button
          onClick={handleSearch}
          disabled={!canSearch || loading}
          className="bg-blue-600 disabled:bg-blue-300 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          {loading ? '查詢中…' : '查詢錄影紀錄'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 flex-shrink-0">
          <p className="text-red-800 text-sm whitespace-pre-line">{error}</p>
        </div>
      )}

      {/* Results - 可捲動區域 */}
      <div className="flex-1 overflow-auto border rounded min-h-0">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">頻道</th>
              <th className="px-3 py-2 text-left font-semibold">開始</th>
              <th className="px-3 py-2 text-left font-semibold">結束</th>
              <th className="px-3 py-2 text-left font-semibold">檔名</th>
              <th className="px-3 py-2 text-left font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {results.map((item, idx) => {
              const aviKey = `avi-${item.Tag}`;
              const rawKey = `raw-${item.Tag}`;
              const isDownloadingAvi = activeDownloads.has(aviKey);
              const isDownloadingRaw = activeDownloads.has(rawKey);

              return (
                <tr key={`${item.channel}-${item.FileName}-${idx}`} className="odd:bg-white even:bg-gray-50 border-b">
                  <td className="px-3 py-2 font-mono">{item.channel}</td>
                  <td className="px-3 py-2">{item.BeginTime}</td>
                  <td className="px-3 py-2">{item.EndTime}</td>
                  <td className="px-3 py-2 break-all">{item.FileName}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2 flex-col min-w-[120px]">
                      <div className="flex gap-2">
                        <button
                          onClick={() => downloadFile('avi', item.Tag, item.FileName)}
                          disabled={isDownloadingAvi || !item.Tag}
                          className="bg-green-600 disabled:bg-gray-300 text-white text-xs px-3 py-1 rounded hover:bg-green-700 flex-1"
                        >
                          {isDownloadingAvi ? 'Downloading...' : 'AVI'}
                        </button>
                        <button
                          onClick={() => downloadFile('raw', item.Tag, item.FileName)}
                          disabled={isDownloadingRaw || !item.Tag}
                          className="bg-purple-600 disabled:bg-gray-300 text-white text-xs px-3 py-1 rounded hover:bg-purple-700 flex-1"
                        >
                          {isDownloadingRaw ? 'Downloading...' : 'RAW'}
                        </button>
                      </div>

                      {/* AVI 進度條 */}
                      {isDownloadingAvi && (
                        <div className="w-full">
                          <div className="bg-gray-200 rounded h-1.5 w-full">
                            <div
                              className="bg-green-500 h-1.5 rounded transition-all"
                              style={{ width: `${downloadProgress[aviKey] || 0}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-gray-500 text-right">AVI: {downloadProgress[aviKey] || 0}%</div>
                        </div>
                      )}

                      {/* RAW 進度條 */}
                      {isDownloadingRaw && (
                        <div className="w-full">
                          <div className="bg-gray-200 rounded h-1.5 w-full">
                            <div
                              className="bg-purple-500 h-1.5 rounded transition-all"
                              style={{ width: `${downloadProgress[rawKey] || 0}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-gray-500 text-right">RAW: {downloadProgress[rawKey] || 0}%</div>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && results.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>無資料</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}