const express = require('express');
const app = express();

app.use(express.json());

app.post('/voice-message', (req, res) => {
  const { message } = req.body;
  console.log('Received voice message:', message);
  res.json({ success: true });
});

app.listen(4000, () => {
  console.log('Server running on http://localhost:4000');
});