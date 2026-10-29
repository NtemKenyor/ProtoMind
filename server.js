// ProtoMind - tiny launcher.
// Serves the hub at /, and mounts each sub-project under its own path:
//   /            -> public/index.html            (hub)
//   /protomind   -> projects/ProtoMind4004       (router + WebSocket at /protomind/ws)
//   /protoweb    -> projects/ProtoWeb            (static)
//   /protogame   -> projects/ProtoGame           (static)
const express = require('express');
const http = require('http');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1'; // local-only on purpose: this server can flash boards over USB

const protomind = require('./projects/ProtoMind4004/server');

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true, app: 'ProtoMind' }));

app.use('/protomind', protomind.router);
app.use('/protoweb', express.static(path.join(__dirname, 'projects', 'ProtoWeb')));
app.use('/protogame', express.static(path.join(__dirname, 'projects', 'ProtoGame')));
app.use(express.static(path.join(__dirname, 'public'))); // hub, last so it never shadows a project

const server = http.createServer(app);

// One HTTP server, one upgrade handler: route WebSockets to the right project by path.
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === protomind.WS_PATH) return protomind.handleUpgrade(req, socket, head);
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`ProtoMind hub        http://localhost:${PORT}/`);
  console.log(`  ProtoMind4004      http://localhost:${PORT}/protomind`);
  console.log(`  ProtoWeb           http://localhost:${PORT}/protoweb`);
  console.log(`  ProtoGame          http://localhost:${PORT}/protogame`);
  console.log(`Toolchain folder:    ${protomind.toolchain.appHome()}`);
});
