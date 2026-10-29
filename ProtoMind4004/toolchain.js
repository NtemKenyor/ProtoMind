// ProtoMind toolchain manager: finds, downloads and installs arduino-cli + board cores
// in a per-user app folder, on Windows, macOS and Linux. No admin rights needed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const DEFAULT_CORES = ['arduino:avr']; // Uno, Nano, Mega. More (esp32, rp2040...) can be added later.

function appHome() {
  if (process.env.PROTOMIND_HOME) return process.env.PROTOMIND_HOME;
  const h = os.homedir();
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA || path.join(h, 'AppData', 'Roaming'), 'ProtoMind');
  if (process.platform === 'darwin') return path.join(h, 'Library', 'Application Support', 'ProtoMind');
  return path.join(process.env.XDG_DATA_HOME || path.join(h, '.local', 'share'), 'protomind');
}
const binDir = () => path.join(appHome(), 'bin');
const exeName = process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';
const managedPath = () => path.join(binDir(), exeName);

// Official download names from downloads.arduino.cc
function assetName() {
  const a = process.arch;
  switch (process.platform) {
    case 'win32': return 'Windows_64bit.zip'; // also runs on Windows-on-ARM via emulation
    case 'darwin': return a === 'arm64' ? 'macOS_ARM64.tar.gz' : 'macOS_64bit.tar.gz';
    case 'linux':
      if (a === 'arm64') return 'Linux_ARM64.tar.gz';
      if (a === 'arm') return 'Linux_ARMv7.tar.gz';
      if (a === 'ia32') return 'Linux_32bit.tar.gz';
      return 'Linux_64bit.tar.gz';
    default: return null;
  }
}

function exec(cmd, args, timeout = 60000) {
  return new Promise((resolve) =>
    execFile(cmd, args, { timeout, maxBuffer: 20 * 1024 * 1024 }, (e, out, err) =>
      resolve({ ok: !e, out: String(out || ''), err: String(err || (e && e.message) || '') })));
}

let cached = null;
async function resolveCli(force = false) {
  if (cached && !force) return cached;
  let found = null;
  if (process.env.ARDUINO_CLI) found = process.env.ARDUINO_CLI;
  else if (fs.existsSync(managedPath())) found = managedPath();
  else if ((await exec('arduino-cli', ['version'], 10000)).ok) found = 'arduino-cli';
  cached = found;
  return found;
}

function parseCores(json) {
  try {
    const d = JSON.parse(json);
    const list = Array.isArray(d) ? d : d.platforms || [];
    return list.map((p) => p.id).filter(Boolean);
  } catch { return []; }
}

async function status() {
  const base = { platform: `${process.platform}/${process.arch}`, home: appHome(), supported: !!assetName() };
  const cli = await resolveCli(true);
  if (!cli) return { ...base, cliInstalled: false, version: null, cores: [], ready: false };
  const v = await exec(cli, ['version', '--format', 'json'], 15000);
  let version = null;
  try { const j = JSON.parse(v.out); version = j.VersionString || j.version || null; } catch { /* ignore */ }
  const c = await exec(cli, ['core', 'list', '--format', 'json'], 30000);
  const cores = parseCores(c.out);
  return { ...base, cliInstalled: true, cli, version, cores, ready: DEFAULT_CORES.every((x) => cores.includes(x)) };
}

function runStreaming(cli, args, onLog) {
  return new Promise((resolve) => {
    const p = require('child_process').spawn(cli, args);
    p.stdout.on('data', (d) => onLog(d.toString()));
    p.stderr.on('data', (d) => onLog(d.toString()));
    p.on('error', (e) => { onLog(`${e.message}\n`); resolve(-1); });
    p.on('close', (code) => resolve(code));
  });
}

async function downloadCli(onLog) {
  const asset = assetName();
  if (!asset) throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
  // PROTOMIND_CLI_URL lets offline labs / schools point at an internal mirror.
  const url = process.env.PROTOMIND_CLI_URL || `https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_${asset}`;
  const tmp = path.join(appHome(), 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  fs.mkdirSync(binDir(), { recursive: true });
  const archive = path.join(tmp, asset);

  onLog(`Downloading arduino-cli (${asset})...\n`);
  // Fail fast instead of hanging forever (blocked network, captive portal, proxy).
  const ctl = new AbortController();
  let watchdog = setTimeout(() => ctl.abort(), 30000);
  const kick = () => { clearTimeout(watchdog); watchdog = setTimeout(() => ctl.abort(), 30000); };
  let res;
  try {
    res = await fetch(url, { signal: ctl.signal });
  } catch (e) {
    clearTimeout(watchdog);
    throw new Error(`Could not reach ${new URL(url).host} (${e.cause?.code || e.name}). Check your internet/proxy, or set PROTOMIND_CLI_URL to a mirror.`);
  }
  if (!res.ok || !res.body) { clearTimeout(watchdog); throw new Error(`Download failed: HTTP ${res.status}`); }
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0, lastPct = -10;
  const src = Readable.fromWeb(res.body);
  src.on('end', () => clearTimeout(watchdog));
  src.on('error', () => clearTimeout(watchdog));
  src.on('data', (chunk) => {
    kick();
    got += chunk.length;
    if (total) {
      const pct = Math.floor((got / total) * 100);
      if (pct >= lastPct + 10) { lastPct = pct; onLog(`  ${pct}%\n`); }
    }
  });
  await pipeline(src, fs.createWriteStream(archive));

  onLog('Extracting...\n');
  // bsdtar ships with macOS, Windows 10+ and most Linux distros; it reads both .zip and .tar.gz
  const x = await exec('tar', ['-xf', archive, '-C', binDir()], 120000);
  if (!x.ok) throw new Error(`Extraction failed: ${x.err}`);
  if (process.platform !== 'win32') fs.chmodSync(managedPath(), 0o755);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!fs.existsSync(managedPath())) throw new Error('arduino-cli was not found after extraction');
  cached = null;
}

let installing = false;
const isInstalling = () => installing;

async function install(onLog) {
  if (installing) throw new Error('An install is already running');
  installing = true;
  try {
    let cli = await resolveCli(true);
    if (!cli) { await downloadCli(onLog); cli = await resolveCli(true); }
    else onLog(`arduino-cli found: ${cli}\n`);

    onLog('\nUpdating board index...\n');
    if ((await runStreaming(cli, ['core', 'update-index'], onLog)) !== 0) throw new Error('core update-index failed');
    for (const core of DEFAULT_CORES) {
      onLog(`\nInstalling board support: ${core} (this can take a minute)...\n`);
      if ((await runStreaming(cli, ['core', 'install', core], onLog)) !== 0) throw new Error(`Installing ${core} failed`);
    }
    onLog('\nSetup complete.\n');
  } finally {
    installing = false;
  }
}

// Friendly, OS-specific hints for the most common first-run problems.
function hintFor(output) {
  if (/permission denied/i.test(output) && process.platform === 'linux')
    return '\nHint: your user cannot access the serial port. Run:  sudo usermod -aG dialout $USER  then log out and back in.\n';
  if (/(access is denied|could not open port)/i.test(output) && process.platform === 'win32')
    return '\nHint: close any other program using the port (Arduino IDE, serial monitor). Clone boards may need the CH340 driver.\n';
  if (/(resource busy|port is busy)/i.test(output))
    return '\nHint: another program is using this port. Close other serial monitors and try again.\n';
  return '';
}

module.exports = { resolveCli, status, install, isInstalling, hintFor, appHome };
