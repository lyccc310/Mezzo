const net = require('net');

// ==========================================
// 🔴 請確保這裡的 IP 跟你的 WinTAK 連線設定一模一樣！
// 如果 WinTAK 連的是 172.20.10.2，這裡就要填 172.20.10.2
const HOST = '172.20.10.2'; 
const PORT = 8087;
// ==========================================

const client = new net.Socket();

console.log(`🔌 嘗試連線到 FTS (${HOST}:${PORT})...`);

client.connect(PORT, HOST, function() {
    console.log('✅ TCP 連線成功！準備發送數據...');
    
    // 產生時間 (UTC)
    const now = new Date();
    const timeStr = now.toISOString();
    const staleStr = new Date(now.getTime() + 10 * 60 * 1000).toISOString(); // 10分鐘後過期

    // 📦 建構一個最乾淨的 Payload (沒有 Header, 沒有多餘空格)
    // 座標設在：台北市政府捷運站 (確保你在地圖上找對地方)
    // 類型：a-f-G (藍色友軍)
    const payload = `<event version="2.0" uid="FINAL-DEBUG-999" type="a-f-G" how="m-g" time="${timeStr}" start="${timeStr}" stale="${staleStr}">
    <point lat="25.0410" lon="121.5650" hae="0" ce="10" le="10"/>
    <detail>
        <contact callsign="終極測試點"/>
        <remarks>如果看到這個，代表 Node.js 沒壞，是 XML 格式問題</remarks>
    </detail>
</event>`; // 👈 注意：這裡沒有換行符號

    // 🚀 發送！ (強制加上換行符號 \n，這是 TCP CoT 的分隔符)
    client.write(payload + '\n');
    console.log('📤 數據已發送 (長度: ' + payload.length + ')');
    console.log('------------------------------------------------');
    console.log(payload);
    console.log('------------------------------------------------');
});

client.on('data', function(data) {
    console.log('📩 收到伺服器回應: ' + data);
    // client.destroy(); // 收到回應後關閉
});

client.on('close', function() {
    console.log('🔌 連線已關閉');
});

client.on('error', function(err) {
    console.error('❌ 連線錯誤:', err.message);
    console.log('💡 提示：請確認 FTS IP 是否正確，或防火牆是否擋住 8087');
});