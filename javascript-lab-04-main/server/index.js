import http from 'node:http';
import { config } from './config.js';
import { roomManager } from './rooms.js';
import { setupWebSocket } from './ws.js';

setInterval(() => {
  const memoryUsage = process.memoryUsage();
  console.log(`[Metrics] RSS пам'ять: ${Math.round(memoryUsage.rss / 1024 / 1024)} MB`);
}, 5000);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(roomManager.stats()));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(roomManager.list()));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/rooms') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) req.socket.destroy();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Room name is required' }));
        }
        roomManager.create(data.name);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, room: data.name }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

setupWebSocket(server);

server.listen(config.port, config.host, () => {
  console.log(`Server is running on http://${config.host}:${config.port}`);
});

const shutdown = () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);