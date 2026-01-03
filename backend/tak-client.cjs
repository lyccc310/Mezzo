const net = require('net');
const tls = require('tls');
const fs = require('fs');
const xml2js = require('xml2js');

class TAKServerClient {
  constructor(config) {
    this.host = config.host || 'localhost';
    this.port = config.port || 8087;
    this.useTLS = config.useTLS || false;
    this.certPath = config.certPath;
    this.keyPath = config.keyPath;
    this.caPath = config.caPath;
    
    this.socket = null;
    this.connected = false;
    this.pingInterval = null; // [新增] 心跳計時器

    // [修正] 優化解析器設定：不使用陣列包裝，合併屬性 (讓 server.cjs 好處理)
    this.parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
    
    this.callbacks = {
      onConnect: [],
      onMessage: [],
      onDisconnect: [],
      onError: []
    };
  }

  connect() {
    console.log(`🔌 Connecting to TAK Server: ${this.host}:${this.port}`);

    const onConnectHandler = () => {
        console.log(`✅ Connected to TAK Server (${this.useTLS ? 'TLS' : 'TCP'})`);
        this.connected = true;
        this.startPing(); // [新增] 連線成功後開始 Ping
        this.callbacks.onConnect.forEach(cb => cb());
    };

    if (this.useTLS) {
      const options = {
        host: this.host,
        port: this.port,
        cert: fs.readFileSync(this.certPath),
        key: fs.readFileSync(this.keyPath),
        ca: fs.readFileSync(this.caPath),
        rejectUnauthorized: false
      };
      this.socket = tls.connect(options, onConnectHandler);
    } else {
      this.socket = net.connect({
        host: this.host,
        port: this.port
      }, onConnectHandler);
    }

    this.socket.on('data', (data) => {
      this.handleData(data);
    });

    this.socket.on('error', (error) => {
      console.error('❌ TAK Server connection error:', error.message);
      this.callbacks.onError.forEach(cb => cb(error));
      this.connected = false;
    });

    this.socket.on('close', () => {
      console.log('🔌 Disconnected from TAK Server');
      this.connected = false;
      this.stopPing(); // [新增] 斷線停止 Ping
      this.callbacks.onDisconnect.forEach(cb => cb());
      
      console.log('⏳ Reconnecting in 5 seconds...');
      setTimeout(() => this.connect(), 5000);
    });
  }

  handleData(data) {
    const dataStr = data.toString();
    // 簡單過濾心跳包
    if (!dataStr.includes('<event')) return;

    // 解析 CoT XML
    this.parser.parseString(dataStr, (err, result) => {
      if (!err && result) {
        this.callbacks.onMessage.forEach(cb => cb(result));
      }
    });
  }

  sendCoT(cotXml) {
    if (!this.connected || !this.socket) {
      return false;
    }
    try {
      this.socket.write(cotXml + (cotXml.endsWith('\n') ? '' : '\n'));
      return true;
    } catch (error) {
      console.error('❌ Error sending CoT:', error);
      return false;
    }
  }

  // [新增] 心跳機制：每 20 秒告訴 Server 我還活著 (防止 FTS 斷線)
  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
        if (this.connected && this.socket) {
            const now = new Date().toISOString();
            const ping = `<event version="2.0" uid="NodeJS-Ping" type="t-x-c-t" time="${now}" start="${now}" stale="${now}" how="m-g"><point lat="0" lon="0" hae="0" ce="99" le="99"/><detail/></event>\n`;
            this.socket.write(ping);
        }
    }, 20000);
  }

  stopPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
  }

  on(event, callback) {
    if (this.callbacks[event]) {
      this.callbacks[event].push(callback);
    }
  }

  disconnect() {
    this.stopPing();
    if (this.socket) {
      this.socket.end();
    }
  }
}

module.exports = TAKServerClient;