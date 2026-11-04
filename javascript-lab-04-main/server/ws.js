import { WebSocketServer } from 'ws';
import { roomManager } from './rooms.js';
import { LinkSim } from './netsim.js';
import { decodeMessage, sanitizeInput, MAX_PLAYERS, TICK_RATE, WORLD_W, WORLD_H } from 'shared';

const INPUT_BUCKET_CAPACITY = 60;
const INPUT_BUCKET_REFILL_PER_SEC = 45;

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 15000);

  wss.on('close', () => clearInterval(interval));

  wss.on('connection', (socket, req) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });

    const query = new URL(req.url, 'http://localhost').searchParams;
    const link = new LinkSim({ lat: query.get('lat'), jitter: query.get('jitter'), drop: query.get('drop') });
    const codec = query.get('codec') === 'json' ? 'json' : 'binary';

    let currentPlayer = null;
    let currentRoom = null;

    let messageCount = 0;
    const rateLimitInterval = setInterval(() => {
      messageCount = 0;
    }, 1000);

    let inputTokens = INPUT_BUCKET_CAPACITY;
    let lastRefill = performance.now();

    const sendJson = (msg) => {
      if (socket.readyState !== socket.OPEN) return;
      link.deliver(() => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      });
    };

    const broadcastPlayers = () => {
      if (!currentRoom) return;
      const players = [...currentRoom.players.values()].map((p) => ({ id: p.id, name: p.name }));
      for (const p of currentRoom.players.values()) p.sendJson({ type: 'players', players });
    };

    const handleInput = (msg) => {
      if (!currentPlayer) return;
      const now = performance.now();
      inputTokens = Math.min(INPUT_BUCKET_CAPACITY, inputTokens + ((now - lastRefill) / 1000) * INPUT_BUCKET_REFILL_PER_SEC);
      lastRefill = now;
      const match = currentRoom.match;
      if (inputTokens < 1) {
        match.stats.droppedInputs++;
        return;
      }
      inputTokens -= 1;
      const input = sanitizeInput(msg);
      if (!input) {
        match.stats.invalidInputs++;
        return;
      }
      match.receiveInput(currentPlayer, input);
    };

    const handleControl = (msg) => {
      if (msg.type === 'join') {
        if (currentPlayer) return;
        if (!msg.room || !msg.name) {
          return socket.close(1003, 'Invalid join payload');
        }

        currentRoom = roomManager.get(msg.room);
        if (!currentRoom) {
          return socket.close(1008, 'Room not found');
        }
        if (currentRoom.players.size >= MAX_PLAYERS) {
          currentRoom = null;
          return socket.close(1008, 'Room full');
        }

        let name = String(msg.name).slice(0, 24);
        const taken = new Set([...currentRoom.players.values()].map((p) => p.name));
        for (let n = 2; taken.has(name); n++) name = `${String(msg.name).slice(0, 20)} (${n})`;

        currentPlayer = {
          name, socket, link, codec,
          sendJson,
          sendRaw(data) {
            if (socket.readyState !== socket.OPEN || socket.bufferedAmount > 1 << 20) return;
            link.deliver(() => {
              if (socket.readyState !== socket.OPEN) return;
              socket.send(data, { binary: typeof data !== 'string' });
              this.bytesOut += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
            });
          },
        };
        const ship = currentRoom.match.addPlayer(currentPlayer);
        currentRoom.emit('join', currentPlayer);
        console.log(`${name} joined room ${msg.room}`);
        sendJson({
          type: 'welcome', id: ship.id, seed: currentRoom.match.seed,
          tickRate: TICK_RATE, world: { w: WORLD_W, h: WORLD_H },
          codec, net: link.settings,
        });
        broadcastPlayers();
        return;
      }

      if (msg.type === 'ping') {
        return sendJson({ type: 'pong', t: msg.t });
      }

      if (msg.type === 'config') {
        link.set(msg);
        if (currentPlayer && (msg.codec === 'json' || msg.codec === 'binary')) currentPlayer.codec = msg.codec;
        return sendJson({ type: 'config', net: link.settings, codec: currentPlayer?.codec ?? codec });
      }

      socket.close(1003, 'Unknown message type');
    };

    socket.on('message', (data, isBinary) => {
      if (data.length > 1024) {
        return socket.close(1009, 'Message too large');
      }

      link.deliver(() => {
        try {
          const msg = decodeMessage(isBinary ? data : data.toString());

          if (!msg || typeof msg.type !== 'string') {
            return socket.close(1003, 'Invalid message format');
          }

          if (currentPlayer) currentPlayer.bytesIn += data.length;

          if (msg.type === 'input') return handleInput(msg);

          messageCount++;
          if (messageCount > 20) {
            return socket.close(1008, 'Rate limit exceeded');
          }
          handleControl(msg);
        } catch (err) {
          socket.close(1003, 'Invalid message');
        }
      });
    });

    socket.on('close', () => {
      clearInterval(rateLimitInterval);
      link.close();
      if (currentRoom && currentPlayer) {
        currentRoom.match.removePlayer(currentPlayer);
        broadcastPlayers();
        if (currentRoom.players.size === 0) currentRoom.emit('empty');
      }
      console.log('WebSocket connection closed');
    });
  });
}
