import { useMemo, useState } from 'react';
import type { BackupFile } from '../types.ts';

// ✅ 改成走 Vite Proxy
const API_BASE = '/nvr';
const API_AUTH = 'QWRtaW46MTIzNA=='; // base64(Admin:1234)
const DEFAULT_CHANNELS = '0,1';

// 將時間轉換為 API 所需的格式 'YYYY-MM-DD HH:mm:00'
function toApiDateTime(dtLocal: string) {
  return dtLocal.replace('T', ' ') + ':00';
}

export default function Playback() {
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [results, setResults] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        BeginTime: begin,       // URLSearchParams 會自動幫你 encode
        EndTime: end,
        Channels: DEFAULT_CHANNELS,
        Auth: API_AUTH,
      });

      // ✅ 透過 Vite Proxy：/nvr/GetBackupList.cgi -> http://220.135.209.219:8088/GetBackupList.cgi
      const url = `${API_BASE}/GetBackupList.cgi?${qs.toString()}`;
      const res = await fetch(url);

      // 檢查 HTTP 狀態碼
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} - ${res.statusText}`);
      }

      // 檢查返回的是否為 JSON 格式
      const contentType = res.headers.get('Content-Type');
      if (!contentType?.includes('application/json')) {
        const text = await res.text(); // 方便 debug
        console.error('API returned non-JSON:', text);
        throw new Error('返回的不是 JSON 格式');
      }

      // 解析 JSON
      const data = await res.json();

      if (!data?.success) {
        throw new Error(data?.message ?? '查詢失敗');
      }

      // 組織所有的文件結果
      const allFiles: BackupFile[] = (data.data ?? []).flatMap((ch: any) =>
        (ch.FileList ?? []).map((file: any) => ({
          channel: ch.Ch,
          BeginTime: file.BeginTime,
          EndTime: file.EndTime,
          FileName: file.FileName,
          Tag: file.Tag ?? '-',
        })),
      );

      setResults(allFiles);
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? '無法取得錄影紀錄');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-semibold">Playback 查詢</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSearch}
          disabled={!canSearch || loading}
          className="bg-blue-600 disabled:bg-blue-300 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          {loading ? '查詢中…' : '查詢錄影紀錄'}
        </button>
        {error && <span className="text-red-600 text-sm">{error}</span>}
      </div>

      {/* Results */}
      <div className="overflow-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">頻道</th>
              <th className="px-3 py-2 text-left font-semibold">開始</th>
              <th className="px-3 py-2 text-left font-semibold">結束</th>
              <th className="px-3 py-2 text-left font-semibold">檔名</th>
              <th className="px-3 py-2 text-left font-semibold">Tag</th>
            </tr>
          </thead>
          <tbody>
            {results.map((item, idx) => (
              <tr
                key={`${item.channel}-${item.FileName}-${idx}`}
                className="odd:bg-white even:bg-gray-50"
              >
                <td className="px-3 py-2 font-mono">{item.channel}</td>
                <td className="px-3 py-2">{item.BeginTime}</td>
                <td className="px-3 py-2">{item.EndTime}</td>
                <td className="px-3 py-2 break-all">{item.FileName}</td>
                <td className="px-3 py-2 text-gray-500">{item.Tag}</td>
              </tr>
            ))}
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
