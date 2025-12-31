import { useMemo, useState } from 'react';
import type { BackupFile } from '../types.ts';

// ✅ 改成走 Vite Proxy
const API_BASE = '/nvr';
const API_AUTH = 'QWRtaW46MTIzNA=='; // base64(Admin:1234)
const DEFAULT_CHANNELS = '0, 1, 2, 3, 4';

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
  const [downloading, setDownloading] = useState<string | null>(null);

  const canSearch = useMemo(
      () => Boolean(startTime && endTime),
      [startTime, endTime],
  );

  async function handleSearch() {
    if (!canSearch) {
      setError('請輸入起始與結束時間');
      return;
    }

    // 基本邏輯檢查
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

      // ✅ 透過 Vite Proxy：/nvr/GetBackupList.cgi -> http://220.135.209.219:8088/GetBackupList.cgi
      const url = `${API_BASE}/GetBackupList.cgi?${qs.toString()}`;

      console.log('=== 查詢資訊 ===');
      console.log('完整 URL:', url);
      console.log('開始時間:', begin);
      console.log('結束時間:', end);
      console.log('頻道:', channels);

      const res = await fetch(url);

      // 檢查 HTTP 狀態碼
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} - ${res.statusText}`);
      }

      // 先取得完整回應文字
      const text = await res.text();
      console.log('API 原始回應:', text);

      // 檢查返回的是否為 JSON 格式
      const contentType = res.headers.get('Content-Type');
      if (!contentType?.includes('application/json')) {
        console.error('API returned non-JSON:', text);
        throw new Error('返回的不是 JSON 格式');
      }

      // 解析 JSON
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        console.error('JSON 解析失敗:', parseErr);
        throw new Error('無法解析伺服器回應');
      }

      console.log('解析後的資料:', data);

      if (!data?.success) {
        throw new Error(data?.message ?? '查詢失敗');
      }

      // 組織所有的文件結果
      const allFiles: BackupFile[] = (data.data ?? []).flatMap((ch: any) => {
        console.log(`頻道 ${ch.Ch} 的檔案:`, ch.FileList);
        return (ch.FileList ?? []).map((file: any) => ({
          channel: ch.Ch,
          BeginTime: file.BeginTime,
          EndTime: file.EndTime,
          FileName: file.FileName,
          Tag: file.Tag ?? '-',
        }));
      });

      console.log('總共找到檔案數:', allFiles.length);
      setResults(allFiles);

      if (allFiles.length === 0) {
        setError('查無符合條件的錄影檔案。建議：\n1. 確認 NVR 在此時間範圍內有錄影\n2. 嘗試更大的時間範圍（例如：整天）\n3. 檢查頻道編號是否正確（0,1 或 1,2）');
      }
    } catch (err: any) {
      console.error('查詢錯誤:', err);
      setError(err?.message ?? '無法取得錄影紀錄');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  // 下載 AVI 檔案
  async function downloadAVI(tag: string, fileName: string) {
    if (!tag || tag === '-') {
      alert('無效的 Tag');
      return;
    }

    const downloadKey = `avi-${tag}`;
    setDownloading(downloadKey);

    try {
      const qs = new URLSearchParams({
        Tag: tag,
        Auth: API_AUTH,
      });

      const url = `${API_BASE}/GetAVIMedia.cgi?${qs.toString()}`;
      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(`下載失敗: HTTP ${res.status}`);
      }

      // 取得檔案 blob
      const blob = await res.blob();

      // 建立下載連結
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = fileName.replace('.avs', '.avi');
      document.body.appendChild(a);
      a.click();

      // 清理
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error('Download AVI error:', err);
      alert(`下載 AVI 失敗: ${err.message}`);
    } finally {
      setDownloading(null);
    }
  }

  // 下載原始 RAW 檔案
  async function downloadRAW(tag: string, fileName: string) {
    if (!tag || tag === '-') {
      alert('無效的 Tag');
      return;
    }

    const downloadKey = `raw-${tag}`;
    setDownloading(downloadKey);

    try {
      const qs = new URLSearchParams({
        Tag: tag,
        Auth: API_AUTH,
      });

      const url = `${API_BASE}/BackupMedia.cgi?${qs.toString()}`;
      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(`下載失敗: HTTP ${res.status}`);
      }

      // 取得檔案 blob
      const blob = await res.blob();

      // 建立下載連結
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();

      // 清理
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error('Download RAW error:', err);
      alert(`下載 RAW 失敗: ${err.message}`);
    } finally {
      setDownloading(null);
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
            <label className="block text-sm font-medium">
              頻道選擇
            </label>
            <select
                value={channels}
                onChange={(e) => setChannels(e.target.value)}
                className="mt-1 w-full border rounded px-3 py-2"
            >
              <option value="1">頻道 1</option>
              <option value="2">頻道 2</option>
              <option value="3">頻道 3</option>
              <option value="4">頻道 4</option>
              <option value="5">頻道 5</option>
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
              const isDownloadingAvi = downloading === aviKey;
              const isDownloadingRaw = downloading === rawKey;

              return (
                  <tr
                      key={`${item.channel}-${item.FileName}-${idx}`}
                      className="odd:bg-white even:bg-gray-50"
                  >
                    <td className="px-3 py-2 font-mono">{item.channel}</td>
                    <td className="px-3 py-2">{item.BeginTime}</td>
                    <td className="px-3 py-2">{item.EndTime}</td>
                    <td className="px-3 py-2 break-all">{item.FileName}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button
                            onClick={() => downloadAVI(item.Tag, item.FileName)}
                            disabled={isDownloadingAvi || isDownloadingRaw}
                            className="bg-green-600 disabled:bg-gray-300 text-white text-xs px-3 py-1 rounded hover:bg-green-700"
                            title="下載 AVI 格式"
                        >
                          {isDownloadingAvi ? '下載中...' : 'AVI'}
                        </button>
                        <button
                            onClick={() => downloadRAW(item.Tag, item.FileName)}
                            disabled={isDownloadingAvi || isDownloadingRaw}
                            className="bg-purple-600 disabled:bg-gray-300 text-white text-xs px-3 py-1 rounded hover:bg-purple-700"
                            title="下載原始 RAW 檔案"
                        >
                          {isDownloadingRaw ? '下載中...' : 'RAW'}
                        </button>
                      </div>
                    </td>
                  </tr>
              );
            })}
            {!loading && results.length === 0 && (
                <tr>
                  <td
                      className="px-3 py-6 text-center text-gray-500"
                      colSpan={5}
                  >
                    無資料
                  </td>
                </tr>
            )}
            </tbody>
          </table>
        </div>
      </div>
  );
}