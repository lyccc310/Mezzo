# RTSP Diagnosis Script - Stable Version
$rtspUrl = "rtsp://localhost:8554/mystream"

Write-Host "--- 1. Checking FFmpeg ---" -ForegroundColor Cyan
try {
    $ffmpegVer = ffmpeg -version
    Write-Host "OK: FFmpeg is ready." -ForegroundColor Green
} catch {
    Write-Host "FAIL: FFmpeg not found." -ForegroundColor Red
    exit
}

Write-Host "`n--- 2. Testing RTSP Source ---" -ForegroundColor Cyan
Write-Host "Connecting to: $rtspUrl" -ForegroundColor Gray

# 我們使用 -t 5 限制 ffmpeg 執行 5 秒，如果不成功會自動結束
ffmpeg -rtsp_transport tcp -i $rtspUrl -t 5 -f null - 2>$null

if ($LASTEXITCODE -eq 0) {
    Write-Host "OK: RTSP source is reachable and valid." -ForegroundColor Green
} else {
    Write-Host "FAIL: RTSP source could not be opened." -ForegroundColor Red
}

Write-Host "`n--- 3. Checking Network Port (1935) ---" -ForegroundColor Cyan
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("wowzaec2demo.streamlock.net", 1935)
    $tcp.Close()
    Write-Host "OK: Port 1935 is open (Firewall clear)." -ForegroundColor Green
} catch {
    Write-Host "FAIL: Could not connect to Port 1935." -ForegroundColor Red
}

Write-Host "`n--- 4. HLS Directory Check ---" -ForegroundColor Cyan
if (!(Test-Path "./streams")) {
    New-Item -ItemType Directory -Path "./streams"
    Write-Host "Created './streams' folder." -ForegroundColor Yellow
} else {
    Write-Host "Folder './streams' exists." -ForegroundColor Green
}

Write-Host "`nDiagnosis Complete. Press Enter to exit."
Read-Host