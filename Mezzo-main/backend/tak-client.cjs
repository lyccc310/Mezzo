const net = require('net');

// TAK Server 配置
const TAK_HOST = '137.184.101.250';
const TAK_PORT = 8087;

// 連接到 TAK Server
const client = net.createConnection({ host: TAK_HOST, port: TAK_PORT }, () => {
  console.log('✅ Connected to TAK Server');
  
  // 發送測試 CoT 訊息
  const now = new Date();
  const stale = new Date(now.getTime() + 300000);
  
  const cotXml = `<?xml version="1.0" encoding="UTF-8"?>
<event version="2.0" uid="TEST-DEVICE-12345" type="a-f-G-U-C" how="h-e" time="${now.toISOString()}" start="${now.toISOString()}" stale="${stale.toISOString()}">
  <point lat="25.0338" lon="121.5646" hae="10" ce="10.0" le="10.0"/>
  <detail>
    <contact callsign="測試設備 (PowerShell)"/>
    <remarks>從 Node.js 腳本發送的測試訊息</remarks>
  </detail>
</event>`;

  console.log('📤 Sending CoT message...');
  client.write(cotXml + '\n');
  
  console.log('✅ CoT sent!');
  console.log('');
  console.log('📋 訊息內容:');
  console.log(cotXml);
  console.log('');
  console.log('💡 現在檢查:');
  console.log('   1. server.js 是否收到訊息');
  console.log('   2. GPSTracking 地圖上是否出現設備');
  console.log('');
  
  // 保持連接 5 秒後關閉
  setTimeout(() => {
    console.log('👋 Closing connection...');
    client.end();
  }, 5000);
});

client.on('data', (data) => {
  console.log('📥 Received from TAK Server:');
  console.log(data.toString().substring(0, 200));
});

client.on('end', () => {
  console.log('🔌 Disconnected from TAK Server');
  process.exit(0);
});

client.on('error', (err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});