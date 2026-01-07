const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class RTSPConverter {
  constructor() {
    this.streams = new Map();
  }

  // RTSP → HLS 轉換（修復版）
  startHLSStream(streamId, rtspUrl, outputDir) {
    console.log(`🎥 Starting HLS stream: ${streamId}`);
    console.log(`   RTSP: ${rtspUrl}`);
    console.log(`   Output: ${outputDir}`);

    // 確保輸出目錄存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`✅ Created output directory: ${outputDir}`);
    }

    const outputPath = path.join(outputDir, `${streamId}.m3u8`);
    const segmentPath = path.join(outputDir, `${streamId}_%03d.ts`);

    // ✅ 修復：使用 copy 而不是重新編碼
    const ffmpegArgs = [
      '-rtsp_transport', 'tcp',
      '-i', rtspUrl,
      '-c:v', 'copy',          // ← 直接複製視訊（不重新編碼）
      '-c:a', 'aac',           // ← 音訊轉為 AAC
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '5',
      '-hls_flags', 'delete_segments+append_list',
      '-hls_segment_filename', segmentPath,
      outputPath
    ];

    console.log(`   FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`);

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      // ✅ 添加超時和錯誤處理
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let startupTimer = null;
    let isRunning = false;

    // 監聽 stdout（部分 FFmpeg 輸出到這裡）
    ffmpeg.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[${streamId}] FFmpeg stdout: ${output}`);
    });

    // 監聽 stderr（FFmpeg 主要輸出）
    ffmpeg.stderr.on('data', (data) => {
      const output = data.toString();
      
      // 檢查是否成功啟動
      if (!isRunning && (output.includes('muxing overhead') || output.includes('Opening'))) {
        isRunning = true;
        clearTimeout(startupTimer);
        console.log(`✅ [${streamId}] Stream started successfully`);
      }
      
      // 只記錄重要訊息
      if (output.includes('error') || 
          output.includes('Invalid') || 
          output.includes('Cannot') ||
          output.includes('Opening') ||
          output.includes('Input #0') ||
          output.includes('Output #0')) {
        console.log(`[${streamId}] FFmpeg: ${output.trim()}`);
      }
    });

    // 錯誤處理
    ffmpeg.on('error', (error) => {
      console.error(`❌ [${streamId}] FFmpeg error:`, error.message);
      this.streams.delete(streamId);
    });

    // 退出處理
    ffmpeg.on('close', (code, signal) => {
      console.log(`🛑 [${streamId}] FFmpeg exited with code ${code}, signal ${signal}`);
      this.streams.delete(streamId);
    });

    // ✅ 啟動超時檢查（30 秒）
    startupTimer = setTimeout(() => {
      if (!isRunning) {
        console.error(`❌ [${streamId}] FFmpeg startup timeout (30s)`);
        ffmpeg.kill('SIGTERM');
        this.streams.delete(streamId);
      }
    }, 30000);

    // 保存進程資訊
    this.streams.set(streamId, {
      ffmpeg,
      type: 'hls',
      rtspUrl,
      outputPath,
      startTime: new Date()
    });

    return `/streams/${streamId}.m3u8`;
  }

  // 停止串流
  stopStream(streamId) {
    const stream = this.streams.get(streamId);
    if (stream && stream.ffmpeg) {
      console.log(`🛑 Stopping stream: ${streamId}`);
      stream.ffmpeg.kill('SIGTERM');
      this.streams.delete(streamId);
      return true;
    }
    return false;
  }

  // 獲取所有活躍串流
  getActiveStreams() {
    return Array.from(this.streams.entries()).map(([id, info]) => ({
      streamId: id,
      type: info.type,
      rtspUrl: info.rtspUrl,
      outputPath: info.outputPath,
      startTime: info.startTime,
      uptime: Math.floor((new Date() - info.startTime) / 1000)
    }));
  }

  // 檢查串流是否活躍
  isStreamActive(streamId) {
    return this.streams.has(streamId);
  }
}

module.exports = RTSPConverter;