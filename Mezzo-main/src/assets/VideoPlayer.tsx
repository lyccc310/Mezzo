// 改進的 VideoPlayer 組件
// 替換 CameraMap.tsx 中的 VideoPlayer 組件

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface VideoPlayerProps {
  streamUrl: string;
  cameraId: string;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ streamUrl, cameraId }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [debugInfo, setDebugInfo] = useState<string[]>([]);

  const addDebugInfo = (message: string) => {
    console.log(`[VideoPlayer] ${message}`);
    setDebugInfo(prev => [...prev.slice(-4), `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  useEffect(() => {
    if (!videoRef.current || !streamUrl) {
      addDebugInfo('❌ 缺少 video 元素或 streamUrl');
      return;
    }

    const video = videoRef.current;
    addDebugInfo(`🎬 開始載入: ${streamUrl}`);

    // 檢查是否為 HLS 串流
    if (streamUrl.endsWith('.m3u8')) {
      if (Hls.isSupported()) {
        addDebugInfo('✅ HLS.js 支援');
        
        const hls = new Hls({
          debug: false,
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          maxBufferLength: 30,
          maxMaxBufferLength: 600,
          // 增加重試次數
          manifestLoadingTimeOut: 10000,
          manifestLoadingMaxRetry: 3,
          manifestLoadingRetryDelay: 1000,
          levelLoadingTimeOut: 10000,
          levelLoadingMaxRetry: 4,
          fragLoadingTimeOut: 20000,
          fragLoadingMaxRetry: 6,
        });

        hlsRef.current = hls;

        // 載入來源
        hls.loadSource(streamUrl);
        hls.attachMedia(video);

        // 事件監聽
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          addDebugInfo('📎 媒體已附加');
        });

        hls.on(Hls.Events.MANIFEST_LOADING, () => {
          addDebugInfo('📥 正在載入播放列表...');
          setLoading(true);
        });

        hls.on(Hls.Events.MANIFEST_LOADED, () => {
          addDebugInfo('✅ 播放列表已載入');
        });

        hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
          addDebugInfo(`✅ 解析成功 (${data.levels.length} 品質)`);
          setLoading(false);
          setError(null);
          
          // 嘗試自動播放
          video.play()
            .then(() => {
              addDebugInfo('▶️ 自動播放成功');
            })
            .catch(e => {
              addDebugInfo(`⚠️ 自動播放失敗: ${e.message}`);
              console.warn('需要用戶點擊播放:', e);
            });
        });

        hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
          addDebugInfo(`📊 載入品質: ${data.details.totalduration.toFixed(1)}s`);
        });

        hls.on(Hls.Events.FRAG_LOADED, () => {
          if (retryCount > 0) {
            setRetryCount(0);
            addDebugInfo('✅ 片段載入恢復正常');
          }
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          console.error('HLS 錯誤:', data);
          
          if (data.fatal) {
            addDebugInfo(`❌ 嚴重錯誤: ${data.type} - ${data.details}`);
            
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                addDebugInfo('🔄 網路錯誤，嘗試恢復...');
                setError('網路錯誤，正在重試...');
                
                if (retryCount < 3) {
                  setTimeout(() => {
                    addDebugInfo(`🔄 重試 ${retryCount + 1}/3`);
                    setRetryCount(prev => prev + 1);
                    hls.startLoad();
                  }, 1000 * (retryCount + 1));
                } else {
                  setError('網路連接失敗，請檢查串流是否可用');
                  setLoading(false);
                }
                break;
                
              case Hls.ErrorTypes.MEDIA_ERROR:
                addDebugInfo('🔄 媒體錯誤，嘗試恢復...');
                setError('媒體錯誤，正在重試...');
                hls.recoverMediaError();
                break;
                
              default:
                setError(`播放錯誤: ${data.details}`);
                setLoading(false);
                break;
            }
          } else {
            // 非嚴重錯誤
            addDebugInfo(`⚠️ ${data.type}: ${data.details}`);
          }
        });

        return () => {
          addDebugInfo('🧹 清理 HLS');
          hls.destroy();
          hlsRef.current = null;
        };
        
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari 原生支援
        addDebugInfo('🍎 使用 Safari 原生 HLS');
        video.src = streamUrl;
        video.addEventListener('loadedmetadata', () => {
          addDebugInfo('✅ 媒體已載入');
          setLoading(false);
        });
        video.play().catch(e => {
          addDebugInfo(`⚠️ 播放失敗: ${e.message}`);
        });
        
      } else {
        addDebugInfo('❌ 瀏覽器不支援 HLS');
        setError('瀏覽器不支援 HLS 播放');
        setLoading(false);
      }
    } else {
      // 直接串流（MP4 等）
      addDebugInfo('📹 直接串流模式');
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        addDebugInfo('✅ 媒體已載入');
        setLoading(false);
      });
      video.play().catch(e => {
        addDebugInfo(`⚠️ 播放失敗: ${e.message}`);
      });
    }
  }, [streamUrl]);

  return (
    <div className="relative bg-black rounded overflow-hidden" style={{ aspectRatio: '16/9' }}>
      {/* 載入中 */}
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-3"></div>
          <div className="text-sm">載入視訊中...</div>
          {debugInfo.length > 0 && (
            <div className="mt-3 text-xs text-gray-400 max-w-md">
              {debugInfo[debugInfo.length - 1]}
            </div>
          )}
        </div>
      )}

      {/* 錯誤訊息 */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 text-white p-4">
          <div className="text-red-400 text-lg mb-2">❌</div>
          <div className="text-red-400 text-sm text-center mb-3">{error}</div>
          
          {/* 調試資訊 */}
          <div className="mt-3 p-3 bg-black/50 rounded text-xs text-left max-w-md w-full">
            <div className="font-bold mb-2">調試資訊：</div>
            {debugInfo.map((info, i) => (
              <div key={i} className="text-gray-400 mb-1">{info}</div>
            ))}
          </div>
          
          {/* 重試按鈕 */}
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              setRetryCount(0);
              if (hlsRef.current) {
                hlsRef.current.startLoad();
              }
            }}
            className="mt-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded text-sm"
          >
            🔄 重試
          </button>
          
          {/* 手動測試連結 */}
          <a
            href={streamUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-xs"
          >
            🔗 在新視窗測試
          </a>
        </div>
      )}

      {/* 影片元素 */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        controls
        muted
        playsInline
        style={{ display: loading || error ? 'none' : 'block' }}
      />

      {/* 攝像頭資訊 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
        <div className="text-white text-xs font-medium flex justify-between items-center">
          <span>{cameraId}</span>
          {retryCount > 0 && (
            <span className="text-yellow-400">重試 {retryCount}/3</span>
          )}
        </div>
      </div>
      
      {/* 調試面板（開發模式） */}
      {process.env.NODE_ENV === 'development' && debugInfo.length > 0 && (
        <div className="absolute top-0 left-0 right-0 bg-black/70 p-2 text-xs text-white max-h-24 overflow-y-auto">
          {debugInfo.map((info, i) => (
            <div key={i} className="mb-1">{info}</div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;