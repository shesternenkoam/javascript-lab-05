import { decodeMessage } from 'shared';

export class Connection {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.isConnected = false;
    this.sendQueue = [];
    this.reconnectDelay = 1000;
    this.listeners = new Map();
    this.onClose = null; // called when the socket drops
    this.onTraffic = null;
    this.connect();
  }

  connect() {
    console.log(`Connecting to WS: ${this.url}...`);
    this.socket = new WebSocket(this.url);
    this.socket.binaryType = 'arraybuffer';

    this.socket.onopen = () => {
      console.log('WS Connected');
      this.isConnected = true;
      this.reconnectDelay = 1000;

      while (this.sendQueue.length > 0) {
        this.socket.send(this.sendQueue.shift());
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const bytes = typeof event.data === 'string' ? new TextEncoder().encode(event.data).length : event.data.byteLength;
        this.onTraffic?.('in', bytes);
        const msg = decodeMessage(event.data);
        const handler = this.listeners.get(msg.type);
        if (handler) handler(msg);
      } catch (err) {
        console.error('Failed to parse WS message', err);
      }
    };

    this.socket.onclose = () => {
      this.isConnected = false;
      this.onClose?.();
      console.log(`WS Closed. Reconnecting in ${this.reconnectDelay}ms...`);
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
    };
  }

  send(message) {
    this.sendRaw(JSON.stringify(message));
  }

  sendRaw(data) {
    if (this.isConnected) {
      this.socket.send(data);
      this.onTraffic?.('out', typeof data === 'string' ? data.length : data.byteLength);
    } else {
      this.sendQueue.push(data);
    }
  }

  on(type, callback) {
    this.listeners.set(type, callback);
  }
}


const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const passthrough = new URLSearchParams();
for (const key of ['lat', 'jitter', 'drop', 'codec']) {
  const v = new URLSearchParams(window.location.search).get(key);
  if (v !== null) passthrough.set(key, v);
}
const qs = passthrough.toString();
export const connection = new Connection(`${protocol}//${window.location.host}/ws${qs ? `?${qs}` : ''}`);

