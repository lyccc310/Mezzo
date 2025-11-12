const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const app = express();

app.use(cors()); 
app.use(express.json());

app.post('/voice-message', (req, res) => {
  const { message } = req.body;
  console.log('🎤 Received voice message:', message);

  if (/向左|左邊/.test(message)) {
    console.log('➡️ 執行左轉指令');
    exec('python mqtt_publish.py left');
  } else if (/向右|右邊/.test(message)) {
    console.log('⬅️ 執行右轉指令');
    exec('python mqtt_publish.py right');
  } else if (message.includes('拍照')) {
    console.log('📸 執行拍照指令');
    exec('python mqtt_publish.py capture');
  } else {
    console.log('⚠️ 未識別的指令');
  }

  res.json({ success: true });
});

app.listen(4000, () => {
  console.log('🚀 Server running on http://localhost:4000');
});