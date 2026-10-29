// ProtoMind4004 - local engine between the web UI and arduino-cli.
// Web UI  <--WebSocket-->  this server  <--spawn-->  arduino-cli  <--USB-->  board
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');
const toolchain = require('./toolchain');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, app: 'ProtoMind4004' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const broadcast = (obj) => wss.clients.forEach((c) => c.readyState === 1 && c.send(JSON.stringify(obj)));

async function runCli(args, onData) {
  const cli = await toolchain.resolveCli();
  if (!cli) return { code: -1, out: '', err: 'Toolchain not installed. Use the Install button first.\n' };
  return new Promise((resolve) => {
    let out = '', err = '';
    const p = spawn(cli, args);
    p.stdout.on('data', (d) => { out += d; onData && onData(d.toString()); });
    p.stderr.on('data', (d) => { err += d; onData && onData(d.toString()); });
    p.on('error', (e) => resolve({ code: -1, out, err: `Could not run arduino-cli: ${e.message}\n` }));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

// arduino-cli's JSON shape differs between versions; normalise both.
function parseBoards(json) {
  let ports = [];
  try {
    const data = JSON.parse(json);
    ports = Array.isArray(data) ? data : data.detected_ports || [];
  } catch { return []; }
  return ports
    .map((e) => {
      const port = e.port || e;
      const match = (e.matching_boards || e.boards || [])[0];
      return {
        address: port.address,
        protocol: port.protocol,
        label: port.label || port.address,
        boardName: match ? match.name : null,
        fqbn: match ? match.fqbn : null,
      };
    })
    .filter((p) => p.address && p.protocol === 'serial');
}

async function sendSetup(send) {
  send({ type: 'setup', status: await toolchain.status(), installing: toolchain.isInstalling() });
}

wss.on('connection', (ws) => {
  let monitor = null;
  const send = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
  const log = (text) => send({ type: 'log', text });

  const stopMonitor = () => {
    if (monitor) { monitor.kill(); monitor = null; send({ type: 'monitorState', running: false }); }
  };

  sendSetup(send);

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'setupStatus') await sendSetup(send);

    if (msg.type === 'setupInstall') {
      if (toolchain.isInstalling()) return log('Install already in progress...\n');
      broadcast({ type: 'setup', status: null, installing: true });
      broadcast({ type: 'log', text: '--- Installing toolchain ---\n' });
      try {
        await toolchain.install((t) => broadcast({ type: 'log', text: t }));
      } catch (e) {
        broadcast({ type: 'log', text: `\nSetup failed: ${e.message}\n` });
      }
      broadcast({ type: 'setup', status: await toolchain.status(), installing: false });
      send({ type: 'refreshBoards' });
    }

    if (msg.type === 'listBoards') {
      const r = await runCli(['board', 'list', '--format', 'json']);
      if (r.code !== 0) { send({ type: 'boards', boards: [] }); return; }
      send({ type: 'boards', boards: parseBoards(r.out) });
    }

    if (msg.type === 'upload') {
      const { code, fqbn, port } = msg;
      if (!fqbn || !port) return log('Select a board/port first.\n');
      stopMonitor(); // the serial port must be free for upload
      // arduino-cli requires the folder name to match the .ino name
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protomind-'));
      const sketchDir = path.join(dir, 'sketch');
      fs.mkdirSync(sketchDir);
      fs.writeFileSync(path.join(sketchDir, 'sketch.ino'), code);

      send({ type: 'busy', busy: true });
      log('--- Compiling ---\n');
      const c = await runCli(['compile', '--fqbn', fqbn, sketchDir], log);
      if (c.code !== 0) {
        log('\nCompile failed.\n');
      } else {
        log('\n--- Uploading ---\n');
        const u = await runCli(['upload', '-p', port, '--fqbn', fqbn, sketchDir], log);
        log(u.code === 0 ? '\nUpload complete.\n' : `\nUpload failed.\n${toolchain.hintFor(u.out + u.err)}`);
      }
      send({ type: 'busy', busy: false });
      fs.rmSync(dir, { recursive: true, force: true });
    }

    if (msg.type === 'monitorStart') {
      stopMonitor();
      const cli = await toolchain.resolveCli();
      if (!cli) return log('Toolchain not installed.\n');
      monitor = spawn(cli, ['monitor', '-p', msg.port, '-c', `baudrate=${msg.baud || 9600}`]);
      monitor.stdout.on('data', (d) => send({ type: 'serial', text: d.toString() }));
      monitor.stderr.on('data', (d) => log(d.toString() + toolchain.hintFor(d.toString())));
      monitor.on('close', () => { monitor = null; send({ type: 'monitorState', running: false }); });
      send({ type: 'monitorState', running: true });
    }

    if (msg.type === 'monitorStop') stopMonitor();
  });

  ws.on('close', stopMonitor);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ProtoMind4004 running at http://localhost:${PORT}`);
  console.log(`Toolchain folder: ${toolchain.appHome()}`);
});
