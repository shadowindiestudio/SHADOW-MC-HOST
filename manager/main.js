'use strict';

const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec, execSync } = require('child_process');
const { Rcon } = require('rcon-client');
const pidusage = require('pidusage');
const https = require('https');

// ---------------------------------------------------------------------------
// Paths (all relative to manager/ dir so the project stays portable)
// ---------------------------------------------------------------------------
const SERVER_ROOT = path.resolve(__dirname, '../');
const BOT_DIR     = path.resolve(__dirname, '../mc-bot');
const SERVER_DIR   = path.join(SERVER_ROOT, 'server');
const SERVER_PROPERTIES_PATH = path.join(SERVER_DIR, 'server.properties');
const BOT_ENV_PATH   = path.join(BOT_DIR,    '.env');
const START_BAT_PATH = path.join(SERVER_ROOT, 'start.bat');
const SERVER_PID_PATH = path.join(__dirname, '.server.pid');
const BOT_PID_PATH    = path.join(__dirname, '.bot.pid');
const SERVER_LOG_PATH = path.join(SERVER_DIR, 'logs', 'latest.log');
const BOT_LOG_PATH    = path.join(BOT_DIR,    'bot.log');
const SETUP_LOCK_PATH = path.join(__dirname, '.setup-complete');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let mainWindow    = null;
let rcon          = null;
let rconConnected = false;
let rconRetryCount = 0;
let rconTimeoutId  = null;
let ramPollId      = null;
let botRamPollId   = null;
let activeTailers  = [];
let lastCommand    = 'None';
let tray           = null;
let forceQuit      = false;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Send a message to the renderer (safe — checks window alive) */
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/** Parse a key=value properties file (skipping # comments) */
function parseProperties(content) {
  const props = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    props[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return props;
}

/** Parse a .env file (KEY=VALUE, # comments, blank lines ignored) */
function parseEnv(content) {
  return parseProperties(content); // same format
}

/**
 * Update a key=value file in-place, preserving comments and ordering.
 * Creates the file if it does not exist.
 */
function updatePropertiesFile(filePath, updates) {
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = content.split(/\r?\n/);
  const touched = new Set();

  const newLines = lines.map(raw => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return raw;
    const idx = line.indexOf('=');
    if (idx === -1) return raw;
    const key = line.slice(0, idx).trim();
    if (key in updates) {
      touched.add(key);
      return `${key}=${updates[key]}`;
    }
    return raw;
  });

  // Append any keys that were not already present
  for (const [key, val] of Object.entries(updates)) {
    if (!touched.has(key)) {
      newLines.push(`${key}=${val}`);
    }
  }

  fs.writeFileSync(filePath, newLines.join('\r\n'), 'utf8');
}

// ===========================================================================
// Auto-Setup Functions
// ===========================================================================

/** Check if all prerequisites are installed */
async function checkPrerequisites() {
  const checks = {
    node: false,
    java: false,
    serverJar: false,
    dependencies: false
  };

  // Check Node.js
  try {
    execSync('node -v', { encoding: 'utf8' });
    checks.node = true;
  } catch (_) {}

  // Check Java 25+
  try {
    const output = execSync('java -version 2>&1', { encoding: 'utf8' });
    checks.java = output.includes('version "25') || output.includes('version "26');
  } catch (_) {}

  // Check server.jar
  checks.serverJar = fs.existsSync(path.join(SERVER_DIR, 'server.jar'));

  // Check npm dependencies
  checks.dependencies = fs.existsSync(path.join(__dirname, 'node_modules')) &&
                       fs.existsSync(path.join(BOT_DIR, 'node_modules'));

  return checks;
}

/** Download a file from URL */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(true);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

/** Auto-setup the server */
async function autoSetupServer() {
  const setupSteps = [];

  // Create server directory
  if (!fs.existsSync(SERVER_DIR)) {
    fs.mkdirSync(SERVER_DIR, { recursive: true });
    setupSteps.push('Created server directory');
  }

  // Create eula.txt
  if (!fs.existsSync(path.join(SERVER_DIR, 'eula.txt'))) {
    fs.writeFileSync(path.join(SERVER_DIR, 'eula.txt'), 'eula=true', 'utf8');
    setupSteps.push('Created eula.txt');
  }

  // Create server.properties
  if (!fs.existsSync(SERVER_PROPERTIES_PATH)) {
    const defaultProps = `server-port=25565
enable-rcon=true
rcon.port=25575
rcon.password=change-this-password
gamemode=survival
difficulty=normal
max-players=20
view-distance=10
simulation-distance=10
motd=A Shadow MC Host Server
online-mode=false
level-name=world
level-type=minecraft:normal`;
    fs.writeFileSync(SERVER_PROPERTIES_PATH, defaultProps, 'utf8');
    setupSteps.push('Created server.properties');
  }

  // Download PaperMC if missing
  if (!fs.existsSync(path.join(SERVER_DIR, 'server.jar'))) {
    try {
      const paperUrl = 'https://papermc.io/api/v2/projects/paper/versions/1.21.4/builds/191/downloads/paper-1.21.4-191.jar';
      const tempJar = path.join(SERVER_DIR, 'paper-temp.jar');
      await downloadFile(paperUrl, tempJar);
      fs.renameSync(tempJar, path.join(SERVER_DIR, 'server.jar'));
      setupSteps.push('Downloaded PaperMC server');
    } catch (e) {
      console.error('Failed to download PaperMC:', e.message);
      setupSteps.push('ERROR: Failed to download PaperMC - manual download required');
    }
  }

  // Create .env for bot
  if (!fs.existsSync(BOT_ENV_PATH)) {
    const envContent = `# Discord Bot Configuration
TOKEN=your-bot-token-here
GUILD_ID=your-server-id-here
CLIENT_ID=your-application-id-here
SERVER_PATH=../server
SERVER_JAR=server.jar
JAVA_PATH=java
RCON_HOST=127.0.0.1
RCON_PORT=25575
RCON_PASSWORD=change-this-local-password`;
    fs.writeFileSync(BOT_ENV_PATH, envContent, 'utf8');
    setupSteps.push('Created bot .env file');
  }

  // Update servers.json
  updateServersConfig();
  setupSteps.push('Updated server configuration');

  return setupSteps;
}

/** Update servers.json with correct paths */
function updateServersConfig() {
  const configPath = path.join(__dirname, 'servers.json');
  const defaultConfig = {
    servers: {
      default: {
        name: 'Main Server',
        rootPath: '../server',
        botDir: '../mc-bot',
        serverJar: 'server.jar',
        javaPath: null,
        rconHost: '127.0.0.1',
        rconPort: 25575,
        rconPassword: '',
        autoStart: false,
        maxRam: '4G',
        notes: 'Primary Minecraft server'
      }
    },
    settings: {
      defaultServer: 'default',
      showTerminal: false,
      closeToTray: true,
      autoStartDefaultServer: false,
      autoStartDefaultBot: false
    }
  };

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
  } else {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!config.servers.default.rootPath.includes('server')) {
        config.servers.default.rootPath = '../server';
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      }
    } catch (_) {
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
    }
  }
}

// ===========================================================================
// Server Configuration Helpers (Multi-Server Support)
// ===========================================================================
const SERVERS_CONFIG_PATH = path.join(__dirname, 'servers.json');

function loadServersConfig() {
  try {
    if (fs.existsSync(SERVERS_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(SERVERS_CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading servers config:', e.message);
  }
  return {
    servers: {
      default: {
        name: 'Default Server',
        rootPath: '../server',
        botDir: '../mc-bot',
        serverJar: 'server.jar',
        javaPath: null,
        rconHost: '127.0.0.1',
        rconPort: 25575,
        rconPassword: '',
        autoStart: false,
        maxRam: '4G',
        notes: 'Primary server'
      }
    },
    settings: {
      defaultServer: 'default',
      showTerminal: false,
      closeToTray: true,
      autoStartDefaultServer: false,
      autoStartDefaultBot: false
    }
  };
}

function saveServersConfig(config) {
  try {
    fs.writeFileSync(SERVERS_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving servers config:', e.message);
    return false;
  }
}

const MANAGER_SETTINGS_PATH = path.join(__dirname, 'manager-settings.json');

function readManagerSettings() {
  const defaults = {
    showTerminal: false,
    closeToTray: true,
    autoStartServer: false,
    autoStartBot: false
  };
  try {
    if (fs.existsSync(MANAGER_SETTINGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(MANAGER_SETTINGS_PATH, 'utf8'));
      return { ...defaults, ...data };
    }
  } catch (e) {
    console.error('Error reading manager settings:', e);
  }
  return defaults;
}

function saveManagerSettings(settings) {
  try {
    const current = readManagerSettings();
    const updated = {
      showTerminal: settings.showTerminal !== undefined ? !!settings.showTerminal : current.showTerminal,
      closeToTray: settings.closeToTray !== undefined ? !!settings.closeToTray : current.closeToTray,
      autoStartServer: settings.autoStartServer !== undefined ? !!settings.autoStartServer : current.autoStartServer,
      autoStartBot: settings.autoStartBot !== undefined ? !!settings.autoStartBot : current.autoStartBot
    };
    fs.writeFileSync(MANAGER_SETTINGS_PATH, JSON.stringify(updated, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving manager settings:', e);
    return false;
  }
}

/** Read current config values for the Settings panel */
function readConfig() {
  const result = {
    maxPlayers: 10,
    viewDistance: 10,
    simulationDistance: 10,
    motd: '',
    rconPassword: '',
    discordToken: '',
    maxRam: '4G'
  };

  // server.properties
  if (fs.existsSync(SERVER_PROPERTIES_PATH)) {
    try {
      const props = parseProperties(fs.readFileSync(SERVER_PROPERTIES_PATH, 'utf8'));
      result.maxPlayers        = parseInt(props['max-players']         || '10', 10);
      result.viewDistance      = parseInt(props['view-distance']       || '10', 10);
      result.simulationDistance = parseInt(props['simulation-distance'] || '10', 10);
      // Decode unicode escapes for display
      result.motd = (props['motd'] || '').replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\n/g, '\n');
      result.rconPassword = props['rcon.password'] || '';
    } catch (e) {
      console.error('readConfig: error reading server.properties:', e.message);
    }
  }

  // .env
  if (fs.existsSync(BOT_ENV_PATH)) {
    try {
      const env = parseEnv(fs.readFileSync(BOT_ENV_PATH, 'utf8'));
      result.discordToken  = env['TOKEN']         || '';
      if (!result.rconPassword) result.rconPassword = env['RCON_PASSWORD'] || '';
    } catch (e) {
      console.error('readConfig: error reading .env:', e.message);
    }
  }

  // RAM from start.bat
  if (fs.existsSync(START_BAT_PATH)) {
    try {
      const content = fs.readFileSync(START_BAT_PATH, 'utf8');
      const m = content.match(/-Xmx(\d+[GgMm])/);
      if (m) result.maxRam = m[1].toUpperCase();
    } catch (e) {
      console.error('readConfig: error reading start.bat:', e.message);
    }
  }

  return result;
}

function ramToMB(str) {
  if (!str) return 0;
  const m = String(str).trim().match(/^(\d+)([GgMm])$/);
  if (!m) return 0;
  const num = parseInt(m[1], 10);
  return m[2].toUpperCase() === 'G' ? num * 1024 : num;
}

function getConfiguredServerRamMB() {
  return ramToMB(readConfig().maxRam);
}

/** Encode a MOTD string for server.properties (non-ASCII => \uXXXX, newline => \n) */
function encodeMotd(motd) {
  let out = '';
  for (let i = 0; i < motd.length; i++) {
    const ch = motd.charCodeAt(i);
    if (ch > 127) {
      out += '\\u' + ch.toString(16).toUpperCase().padStart(4, '0');
    } else if (motd[i] === '\n') {
      out += '\\n';
    } else {
      out += motd[i];
    }
  }
  return out;
}

/** Safely resolve an executable's full path on Windows to avoid spawn ENOENT with shell: false */
function resolveExecutable(name) {
  try {
    const out = execSync(`where ${name}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = out.split(/\r?\n/).filter(Boolean);
    if (lines.length > 0) return lines[0].trim();
  } catch (e) {}
  // Fallback to explicitly adding .exe so Node can sometimes find it better
  if (process.platform === 'win32' && !name.toLowerCase().endsWith('.exe')) {
    return name + '.exe';
  }
  return name;
}

/**
 * Resolve java executable.
 * Priority: JAVA_HOME env var => JAVA_PATH in .env => absolute path via `where`
 */
function getJavaPath() {
  if (process.env.JAVA_HOME) {
    return path.join(process.env.JAVA_HOME, 'bin', 'java.exe');
  }
  // Check .env for JAVA_PATH
  if (fs.existsSync(BOT_ENV_PATH)) {
    try {
      const env = parseEnv(fs.readFileSync(BOT_ENV_PATH, 'utf8'));
      if (env['JAVA_PATH'] && env['JAVA_PATH'] !== 'java') {
        return env['JAVA_PATH'];
      }
    } catch (_) {}
  }
  return resolveExecutable('java');
}

/** Check if a PID is alive and belongs to the given image name */
function isPidRunning(pid, imageName) {
  return new Promise(resolve => {
    if (!pid || isNaN(pid)) return resolve(false);
    exec(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, (err, stdout) => {
      if (err) return resolve(false);
      // stdout line looks like: "java.exe","12345","Console","1","10,240 K"
      resolve(stdout.toLowerCase().includes(imageName.toLowerCase()));
    });
  });
}

/** Get memory usage of a PID in MB */
function getProcessRam(pid) {
  return new Promise(resolve => {
    if (!pid || isNaN(pid)) return resolve(0);
    exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, (err, stdout) => {
      if (err) return resolve(0);
      // CSV: "image","pid","session","num","mem K"
      const parts = stdout.split(',');
      if (parts.length >= 5) {
        const memStr = parts[4].replace(/"/g, '').replace(/[^0-9]/g, '');
        const kb = parseInt(memStr, 10);
        return resolve(isNaN(kb) ? 0 : Math.round(kb / 1024));
      }
      resolve(0);
    });
  });
}

/** Safely read PID from a file; returns null on any error */
function readPid(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const n = parseInt(fs.readFileSync(filePath, 'utf8').trim(), 10);
    return isNaN(n) ? null : n;
  } catch (_) { return null; }
}

async function getPidRamMB(pid) {
  if (!pid || isNaN(pid)) return 0;
  try {
    const stats = await pidusage(pid);
    return Math.round(stats.memory / 1024 / 1024);
  } catch (_) {
    return 0;
  }
}

async function publishRamUsage() {
  const total = getConfiguredServerRamMB();
  const pid = readPid(SERVER_PID_PATH);
  if (!pid || !(await isPidRunning(pid, 'java.exe'))) {
    send('ram-update', { used: 0, total });
    return;
  }

  const used = await getPidRamMB(pid);
  send('ram-update', { used, total });
}

function startRamPolling() {
  if (ramPollId) clearInterval(ramPollId);
  publishRamUsage();
  ramPollId = setInterval(publishRamUsage, 5000);
}

function stopRamPolling() {
  if (ramPollId) {
    clearInterval(ramPollId);
    ramPollId = null;
  }
  send('ram-update', { used: 0, total: getConfiguredServerRamMB() });
}

async function publishBotRamUsage() {
  const pid = readPid(BOT_PID_PATH);
  if (!pid || !(await isPidRunning(pid, 'node.exe'))) {
    send('bot-ram-update', { used: 0 });
    return;
  }
  const used = await getPidRamMB(pid);
  send('bot-ram-update', { used });
}

function startBotRamPolling() {
  if (botRamPollId) clearInterval(botRamPollId);
  publishBotRamUsage();
  botRamPollId = setInterval(publishBotRamUsage, 5000);
}

function stopBotRamPolling() {
  if (botRamPollId) {
    clearInterval(botRamPollId);
    botRamPollId = null;
  }
  send('bot-ram-update', { used: 0 });
}

async function sendRconCommand(command) {
  try {
    return await rcon.send(command);
  } catch (e) {
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Log Tailer
// ---------------------------------------------------------------------------
class LogTailer {
  constructor(filePath, channel) {
    this.filePath = filePath;
    this.channel  = channel;
    this.position = 0;
    this.watcher  = null;
    this.pollId   = null;
  }

  start() {
    // Ensure file exists so we can stat it
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir))  fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, '', 'utf8');
      this.position = fs.statSync(this.filePath).size;
    } catch (e) {
      console.error(`LogTailer.start: cannot initialise ${this.filePath}:`, e.message);
      this.position = 0;
    }

    // Watch for changes (fires quickly on Windows)
    try {
      this.watcher = fs.watch(this.filePath, () => this._read());
    } catch (e) {
      console.error(`LogTailer.start: fs.watch failed, falling back to polling:`, e.message);
    }

    // Polling fallback / safety net (1s)
    this.pollId = setInterval(() => this._read(), 1000);
  }

  _read() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const stat = fs.statSync(this.filePath);
      if (stat.size < this.position) this.position = 0; // log rotated
      if (stat.size === this.position) return;

      const fd  = fs.openSync(this.filePath, 'r');
      const len = stat.size - this.position;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, this.position);
      fs.closeSync(fd);

      this.position = stat.size;
      const text = buf.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) send(this.channel, line);
      }
    } catch (e) {
      console.error(`LogTailer._read error on ${this.filePath}:`, e.message);
    }
  }

  stop() {
    if (this.watcher)  { this.watcher.close();        this.watcher = null; }
    if (this.pollId)   { clearInterval(this.pollId);  this.pollId  = null; }
  }
}

/** Read last N lines from a file without loading it entirely */
function readLastLines(filePath, maxLines = 100) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const stat  = fs.statSync(filePath);
    const bytes = Math.min(stat.size, 80 * 1024);
    if (bytes === 0) return [];
    const buf = Buffer.alloc(bytes);
    const fd  = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, bytes, stat.size - bytes);
    fs.closeSync(fd);
    return buf.toString('utf8').split(/\r?\n/).filter(l => l.trim()).slice(-maxLines);
  } catch (e) {
    console.error('readLastLines error:', e.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// RCON
// ---------------------------------------------------------------------------
function scheduleRconConnect(delayMs = 15000) {
  if (rconTimeoutId) { clearTimeout(rconTimeoutId); rconTimeoutId = null; }

  rconTimeoutId = setTimeout(async () => {
    // Always reset flag before attempting
    rconConnected = false;

    // Reload .env so credentials are fresh (user might have updated them)
    let host = '127.0.0.1', port = 25575, password = '';
    if (fs.existsSync(BOT_ENV_PATH)) {
      try {
        const env = parseEnv(fs.readFileSync(BOT_ENV_PATH, 'utf8'));
        host     = env['RCON_HOST']     || host;
        port     = parseInt(env['RCON_PORT']     || String(port), 10);
        password = env['RCON_PASSWORD'] || password;
      } catch (_) {}
    }

    // Also check server.properties for RCON settings
    if (fs.existsSync(SERVER_PROPERTIES_PATH)) {
      try {
        const props = parseProperties(fs.readFileSync(SERVER_PROPERTIES_PATH, 'utf8'));
        if (!password) password = props['rcon.password'] || '';
        if (port === 25575) port = parseInt(props['rcon.port'] || '25575', 10);
        if (host === '127.0.0.1') host = props['server-ip'] || '127.0.0.1';
      } catch (_) {}
    }

    // Tear down old client
    if (rcon) {
      try { await rcon.end(); } catch (_) {}
      rcon = null;
    }

    try {
      rcon = new Rcon({ host, port, password, timeout: 5000 });

      // rcon-client v4: 'end' fires when connection closes
      rcon.on('end', () => {
        rconConnected = false;
        console.log('RCON connection closed.');
      });
      rcon.on('error', err => {
        rconConnected = false;
        console.error('RCON error:', err.message);
      });

      await rcon.connect();          // throws if server not ready
      rconConnected = true;          // => set HERE, after successful connect
      rconRetryCount = 0;
      console.log(`RCON connected to ${host}:${port}`);

    } catch (e) {
      rconConnected = false;
      rcon = null;
      rconRetryCount++;
      const max = 20;
      console.log(`RCON attempt ${rconRetryCount}/${max} failed: ${e.message}`);
      if (rconRetryCount < max) {
        scheduleRconConnect(10000);
      } else {
        console.log('RCON: giving up after max retries.');
      }
    }
  }, delayMs);
}

// ---------------------------------------------------------------------------
// Server spawn helpers
// ---------------------------------------------------------------------------

/** Extract args from start.bat java line; returns string[] without 'java' */
function getServerArgs() {
  const config = loadServersConfig();
  const serverConfig = config.servers[config.settings.defaultServer] || config.servers.default;
  const maxRam = serverConfig.maxRam || '4G';
  
  return [
    `-Xms${maxRam}`,
    `-Xmx${maxRam}`,
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:G1NewSizePercent=30',
    '-XX:G1MaxNewSizePercent=40',
    '-XX:G1HeapRegionSize=8M',
    '-XX:G1ReservePercent=20',
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=15',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:+PerfDisableSharedMem',
    '-XX:MaxTenuringThreshold=1',
    '-Dusing.aikars.flags=https://mcflags.emc.gs',
    '-Daikars.new.flags=true',
    '-jar',
    serverConfig.serverJar || 'server.jar',
    'nogui'
  ];
}

// ---------------------------------------------------------------------------
// System Tray
// ---------------------------------------------------------------------------

async function updateTrayMenu() {
  if (!tray) return;

  let serverState = 'offline';
  const sPid = readPid(SERVER_PID_PATH);
  if (sPid) {
    const running = await isPidRunning(sPid, 'java.exe');
    if (running) serverState = 'online';
  }

  let botState = 'offline';
  const bPid = readPid(BOT_PID_PATH);
  if (bPid) {
    const running = await isPidRunning(bPid, 'node.exe');
    if (running) botState = 'online';
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Start Server',
      enabled: serverState === 'offline',
      click: async () => {
        await startServerProcess();
      }
    },
    {
      label: 'Stop Server',
      enabled: serverState === 'online',
      click: async () => {
        await stopServerProcess();
      }
    },
    { type: 'separator' },
    {
      label: 'Start Bot',
      enabled: botState === 'offline',
      click: async () => {
        await startBotProcess();
      }
    },
    {
      label: 'Stop Bot',
      enabled: botState === 'online',
      click: async () => {
        await stopBotProcess();
      }
    },
    { type: 'separator' },
    {
      label: 'Auto-Setup Server',
      click: async () => {
        send('server-log', '[System] Running auto-setup...');
        const steps = await autoSetupServer();
        steps.forEach(step => send('server-log', `[Setup] ${step}`));
        send('server-log', '[System] Auto-setup complete!');
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        forceQuit = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function createTray() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('Shadow MC Host');

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  updateTrayMenu();
  setInterval(updateTrayMenu, 5000);
}

// ---------------------------------------------------------------------------
// Electron window
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100, height: 750,
    minWidth: 900, minHeight: 650,
    title: 'Shadow MC Host',
    backgroundColor: '#0D0D0D',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Intercept close — minimize to tray if setting is on
  mainWindow.on('close', (e) => {
    if (forceQuit) return; // let it close
    const s = readManagerSettings();
    if (s.closeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Start log tailers immediately (they create the files if missing)
  const st = new LogTailer(SERVER_LOG_PATH, 'server-log');
  st.start();
  activeTailers.push(st);

  const bt = new LogTailer(BOT_LOG_PATH, 'bot-log');
  bt.start();
  activeTailers.push(bt);
}

app.whenReady().then(async () => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (mainWindow) {
      mainWindow.show();
    } else {
      createWindow();
    }
  });

  const managerSettings = readManagerSettings();

  // Run auto-setup on first launch
  if (!fs.existsSync(SETUP_LOCK_PATH)) {
    console.log('[First Launch] Running auto-setup...');
    send('server-log', '[System] First launch detected - running auto-setup...');
    const steps = await autoSetupServer();
    steps.forEach(step => send('server-log', `[Setup] ${step}`));
    send('server-log', '[System] Auto-setup complete!');
    fs.writeFileSync(SETUP_LOCK_PATH, 'setup completed at ' + new Date().toISOString(), 'utf8');
  }

  // Detect already-running server
  const savedPid = readPid(SERVER_PID_PATH);
  if (savedPid) {
    const running = await isPidRunning(savedPid, 'java.exe');
    if (running) {
      console.log(`Detected running server PID ${savedPid} on startup.`);
      startRamPolling();
      scheduleRconConnect(2000);
    } else {
      // Auto-start if setting is on and server wasn't already running
      if (managerSettings.autoStartServer) {
        console.log('[Auto-Start] Starting server...');
        send('server-log', '[System] Auto-starting Minecraft server...');
        startServerProcess();
      }
    }
  } else {
    const detected = await detectServerStatus();
    if (detected) {
      console.log(`Auto-detected running server PID ${detected.pid} via ${detected.source}.`);
      startRamPolling();
      scheduleRconConnect(2000);
    } else if (managerSettings.autoStartServer) {
      console.log('[Auto-Start] Starting server...');
      send('server-log', '[System] Auto-starting Minecraft server...');
      startServerProcess();
    }
  }

  // Detect already-running bot
  const botPid = readPid(BOT_PID_PATH);
  if (botPid) {
    const running = await isPidRunning(botPid, 'node.exe');
    if (running) {
      console.log(`Detected running bot PID ${botPid} on startup.`);
      startBotRamPolling();
    } else if (managerSettings.autoStartBot) {
      console.log('[Auto-Start] Starting bot...');
      send('bot-log', '[System] Auto-starting Discord bot...');
      startBotProcess();
    }
  } else if (managerSettings.autoStartBot) {
    console.log('[Auto-Start] Starting bot...');
    send('bot-log', '[System] Auto-starting Discord bot...');
    startBotProcess();
  }
});

app.on('window-all-closed', () => {
  const s = readManagerSettings();
  // If minimize-to-tray is on and this wasn't a forced quit, don't actually quit
  if (s.closeToTray && !forceQuit) return;

  activeTailers.forEach(t => t.stop());
  activeTailers = [];
  stopRamPolling();
  stopBotRamPolling();
  if (rconTimeoutId) clearTimeout(rconTimeoutId);
  if (rcon) { try { rcon.end(); } catch (_) {} }
  if (tray) { tray.destroy(); tray = null; }
  if (process.platform !== 'darwin') app.quit();
});

// ===========================================================================
// IPC handlers - Server Profile Management (Multi-Server Support)
// ===========================================================================

ipcMain.handle('get-server-profiles', () => {
  try {
    const config = loadServersConfig();
    return { success: true, profiles: config.servers, active: config.settings.defaultServer };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-active-server-id', () => {
  try {
    const config = loadServersConfig();
    return { success: true, serverId: config.settings.defaultServer };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('set-active-server', (_, serverId) => {
  try {
    const config = loadServersConfig();
    if (!config.servers[serverId]) {
      return { success: false, error: 'Server profile not found' };
    }
    config.settings.defaultServer = serverId;
    saveServersConfig(config);
    return { success: true, serverId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('add-server-profile', (_, profile) => {
  try {
    const config = loadServersConfig();
    const id = profile.id || Object.keys(config.servers).length + 1;
    config.servers[id] = { ...profile, id };
    if (!config.settings.defaultServer) {
      config.settings.defaultServer = id;
    }
    saveServersConfig(config);
    return { success: true, profile: config.servers[id] };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('remove-server-profile', (_, serverId) => {
  try {
    const config = loadServersConfig();
    if (!config.servers[serverId]) {
      return { success: false, error: 'Server profile not found' };
    }
    delete config.servers[serverId];
    if (config.settings.defaultServer === serverId) {
      config.settings.defaultServer = Object.keys(config.servers)[0] || null;
    }
    saveServersConfig(config);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===========================================================================
// IPC handlers - Manager Settings
// ===========================================================================

ipcMain.handle('read-manager-settings', () => readManagerSettings());
ipcMain.handle('save-manager-settings', (_, settings) => {
  const ok = saveManagerSettings(settings);
  return { success: ok };
});

// ===========================================================================
// IPC handlers - Auto-Setup
// ===========================================================================

ipcMain.handle('run-auto-setup', async () => {
  try {
    const steps = await autoSetupServer();
    return { success: true, steps };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('check-prerequisites', async () => {
  try {
    const checks = await checkPrerequisites();
    return { success: true, checks };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('download-papermc', async (_, version = '1.21.4', build = '191') => {
  try {
    const url = `https://papermc.io/api/v2/projects/paper/versions/${version}/builds/${build}/downloads/paper-${version}-${build}.jar`;
    const dest = path.join(SERVER_DIR, 'server.jar');
    const tempDest = path.join(SERVER_DIR, `paper-${version}-${build}.jar`);
    
    await downloadFile(url, tempDest);
    fs.renameSync(tempDest, dest);
    return { success: true, message: 'PaperMC downloaded successfully' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===========================================================================
// Fallback Server Detection Methods
// ===========================================================================

/** Try RCON to detect if server is online and get PID */
async function tryRconStatus() {
  if (!rconConnected || !rcon) return null;
  try {
    await rcon.send('seed');
    return true;
  } catch (_) {
    return null;
  }
}

/** Try to check if minecraft port is listening */
function tryPortCheck() {
  return new Promise(resolve => {
    exec(`netstat -ano | findstr :25565`, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      // Try to extract PID from the output (format: ... pid)
      const lines = stdout.split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length > 0) {
          const pid = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(pid) && pid > 0) {
            resolve(pid);
            return;
          }
        }
      }
      resolve(null);
    });
  });
}

/** Search for java.exe process in server directory */
function tryProcessSearch() {
  return new Promise(resolve => {
    exec(`wmic process where "name='java.exe'" get processid,commandline /format:csv`, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const lines = stdout.split('\n');
      for (const line of lines) {
        if (line.includes(SERVER_DIR)) {
          // Parse CSV line: "processid","commandline" or just look for numbers
          const parts = line.split(',');
          for (const part of parts) {
            const cleanPart = part.trim().replace(/"/g, '');
            const pid = parseInt(cleanPart, 10);
            if (!isNaN(pid) && pid > 0 && pid < 1000000) {
              resolve(pid);
              return;
            }
          }
        }
      }
      resolve(null);
    });
  });
}

/** Fallback: try multiple methods to detect running server */
async function detectServerStatus() {
  // Already have a valid PID file? Quick check first
  const savedPid = readPid(SERVER_PID_PATH);
  if (savedPid && await isPidRunning(savedPid, 'java.exe')) {
    return { pid: savedPid, source: 'pidfile' };
  }

  // Try RCON (only if we're already connected)
  const rconOk = await tryRconStatus();
  if (rconOk === true) {
    console.log('Server detected via RCON connection');
    // We're connected but don't have the PID yet; try other methods
  }

  // Try port check (netstat)
  const portPid = await tryPortCheck();
  if (portPid) {
    const isJava = await isPidRunning(portPid, 'java.exe');
    if (isJava) {
      console.log(`Server detected on port 25565, PID: ${portPid}`);
      // Save the PID for future checks
      try { fs.writeFileSync(SERVER_PID_PATH, String(portPid), 'utf8'); } catch (_) {}
      return { pid: portPid, source: 'port' };
    }
  }

  // Try process search (wmic)
  const processPid = await tryProcessSearch();
  if (processPid) {
    console.log(`Server detected via process search, PID: ${processPid}`);
    // Save the PID for future checks
    try { fs.writeFileSync(SERVER_PID_PATH, String(processPid), 'utf8'); } catch (_) {}
    return { pid: processPid, source: 'process' };
  }

  return null;
}

// ===========================================================================
// IPC handlers
// ===========================================================================

// 1. get-status
ipcMain.handle('get-status', async () => {
  const status = {
    server:        'offline',
    bot:           'offline',
    serverPid:     null,
    botPid:        null,
    serverRam:     0,
    botRam:        0,
    serverUptime:  0,
    rconConnected,
    lastCommand,
    serverRamTotal: getConfiguredServerRamMB(),
    ops:           []
  };

  // ops.json
  const opsPath = path.join(SERVER_DIR, 'ops.json');
  if (fs.existsSync(opsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(opsPath, 'utf8'));
      status.ops = data.map(o => (o.name || '').toLowerCase());
    } catch (_) {}
  }

  let sPid = readPid(SERVER_PID_PATH);

  // Primary check: use saved PID
  if (sPid) {
    const running = await isPidRunning(sPid, 'java.exe');
    if (running) {
      status.server    = 'online';
      status.serverPid = sPid;
      try {
        const stat = fs.statSync(SERVER_PID_PATH);
        status.serverUptime = Date.now() - stat.mtimeMs;
      } catch (_) {}
      status.serverRam = await getPidRamMB(sPid);
    } else {
      // Stale PID — clean up and try fallback
      try { fs.unlinkSync(SERVER_PID_PATH); } catch (_) {}
      sPid = null;
    }
  }

  // Fallback: if no saved PID or it was stale, try detection methods
  if (!sPid) {
    const detected = await detectServerStatus();
    if (detected) {
      status.server    = 'online';
      status.serverPid = detected.pid;
      status.serverRam = await getPidRamMB(detected.pid);
      // Try to get uptime from log file if PID is recent
      try {
        if (fs.existsSync(SERVER_LOG_PATH)) {
          const stat = fs.statSync(SERVER_LOG_PATH);
          status.serverUptime = Date.now() - stat.mtimeMs;
        }
      } catch (_) {}
    }
  }

  const bPid = readPid(BOT_PID_PATH);
  if (bPid) {
    const running = await isPidRunning(bPid, 'node.exe');
    if (running) {
      status.bot    = 'online';
      status.botPid = bPid;
      status.botRam = await getPidRamMB(bPid);
    } else {
      try { fs.unlinkSync(BOT_PID_PATH); } catch (_) {}
    }
  }

  return status;
});

// ===========================================================================
// Core Process Management
// ===========================================================================

async function startServerProcess() {
  const sPid = readPid(SERVER_PID_PATH);
  if (sPid && await isPidRunning(sPid, 'java.exe')) {
    return { success: false, error: 'Server is already running.' };
  }

  try {
    const javaExe = getJavaPath();
    const args    = getServerArgs();
    const managerSettings = readManagerSettings();
    const config = loadServersConfig();
    const serverConfig = config.servers[config.settings.defaultServer] || config.servers.default;
    const serverRoot = path.resolve(__dirname, serverConfig.rootPath || '../server');

    const child = spawn(javaExe, args, {
      cwd:      serverRoot,
      detached: true,
      shell:    false,
      stdio:    'ignore',
      windowsHide: !managerSettings.showTerminal
    });

    child.unref();

    if (!child.pid) {
      return { success: false, error: 'spawn() returned undefined PID — check java path.' };
    }

    await new Promise(r => setTimeout(r, 500));
    const alive = await isPidRunning(child.pid, 'java.exe');
    if (!alive) {
      return { success: false, error: `java process exited immediately. Check args: ${javaExe} ${args.slice(0, 3).join(' ')} ...` };
    }

    fs.writeFileSync(SERVER_PID_PATH, String(child.pid), 'utf8');
    startRamPolling();
    rconRetryCount = 0;
    scheduleRconConnect(15000);

    send('status-change', { type: 'server', state: 'starting' });
    updateTrayMenu();
    return { success: true, pid: child.pid };

  } catch (e) {
    send('spawn-error', { source: 'server', message: e.message });
    return { success: false, error: e.message };
  }
}

async function stopServerProcess() {
  const sPid = readPid(SERVER_PID_PATH);
  if (!sPid || !(await isPidRunning(sPid, 'java.exe'))) {
    try { fs.unlinkSync(SERVER_PID_PATH); } catch (_) {}
    return { success: false, error: 'Server is not running.' };
  }

  if (rconConnected && rcon) {
    try {
      await sendRconCommand('stop');
      await new Promise(r => setTimeout(r, 8000));
    } catch (e) {
      console.error('RCON stop failed, force-killing:', e.message);
    }
  }

  await new Promise(r => exec(`taskkill /PID ${sPid} /F /T`, r));
  try { fs.unlinkSync(SERVER_PID_PATH); } catch (_) {}
  stopRamPolling();
  rconConnected = false;
  if (rcon) { try { await rcon.end(); } catch (_) {} rcon = null; }

  send('status-change', { type: 'server', state: 'offline' });
  updateTrayMenu();
  return { success: true };
}

async function startBotProcess() {
  const bPid = readPid(BOT_PID_PATH);
  if (bPid && await isPidRunning(bPid, 'node.exe')) {
    return { success: false, error: 'Bot is already running.' };
  }

  try {
    const logDir = path.dirname(BOT_LOG_PATH);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const logFd = fs.openSync(BOT_LOG_PATH, 'a');
    const nodeExe = resolveExecutable('node');
    const managerSettings = readManagerSettings();

    const child = spawn(nodeExe, ['index.js'], {
      cwd:      BOT_DIR,
      detached: true,
      shell:    false,
      stdio:    ['ignore', logFd, logFd],
      windowsHide: !managerSettings.showTerminal
    });
    fs.closeSync(logFd);
    child.unref();

    if (!child.pid) {
      return { success: false, error: 'Bot spawn returned no PID.' };
    }

    await new Promise(r => setTimeout(r, 500));
    const alive = await isPidRunning(child.pid, 'node.exe');
    if (!alive) {
      return { success: false, error: 'node process exited immediately. Check mc-bot/index.js and .env.' };
    }

    fs.writeFileSync(BOT_PID_PATH, String(child.pid), 'utf8');
    startBotRamPolling();
    send('status-change', { type: 'bot', state: 'online' });
    updateTrayMenu();
    return { success: true, pid: child.pid };

  } catch (e) {
    send('spawn-error', { source: 'bot', message: e.message });
    return { success: false, error: e.message };
  }
}

async function stopBotProcess() {
  const bPid = readPid(BOT_PID_PATH);
  if (!bPid || !(await isPidRunning(bPid, 'node.exe'))) {
    try { fs.unlinkSync(BOT_PID_PATH); } catch (_) {}
    stopBotRamPolling();
    return { success: false, error: 'Bot is not running.' };
  }
  await new Promise(r => exec(`taskkill /PID ${bPid} /F /T`, r));
  try { fs.unlinkSync(BOT_PID_PATH); } catch (_) {}
  stopBotRamPolling();
  send('status-change', { type: 'bot', state: 'offline' });
  updateTrayMenu();
  return { success: true };
}

// 2a. start-server
ipcMain.handle('start-server', () => startServerProcess());

// 2b. stop-server
ipcMain.handle('stop-server', () => stopServerProcess());

// 2c. restart-server
ipcMain.handle('restart-server', async () => {
  await stopServerProcess();
  await new Promise(r => setTimeout(r, 2000));
  return await startServerProcess();
});

// 2d. start-bot
ipcMain.handle('start-bot', () => startBotProcess());

// 2e. stop-bot
ipcMain.handle('stop-bot', () => stopBotProcess());

// 3. RCON command execution
ipcMain.handle('send-server-command', async (_, command) => {
  if (!rconConnected || !rcon) {
    return { success: false, error: 'RCON is not connected. Wait for the server to finish starting.' };
  }
  try {
    let cmd = command.trim();
    if (cmd.startsWith('/')) cmd = cmd.slice(1); // strip leading slash
    
    const internalQueries = ['list', 'spark tps'];
    if (!internalQueries.includes(cmd.toLowerCase())) {
      lastCommand = cmd;
      send('last-command-update', { command: lastCommand });
    }
    
    const response = await sendRconCommand(cmd);
    return { success: true, response: response || '' };
  } catch (e) {
    // Connection may have dropped
    rconConnected = false;
    return { success: false, error: e.message };
  }
});

// 4. Settings read / write
ipcMain.handle('read-settings', () => {
  try {
    const config = readConfig();
    const managerSettings = readManagerSettings();
    return { ...config, ...managerSettings };
  } catch (e) {
    console.error('read-settings error:', e.message);
    return {};
  }
});

ipcMain.handle('save-settings', (_, settings) => {
  try {
    // Save manager settings
    saveManagerSettings(settings);

    // server.properties
    if (fs.existsSync(SERVER_PROPERTIES_PATH)) {
      const upd = {};
      if (settings.maxPlayers        != null) upd['max-players']          = settings.maxPlayers;
      if (settings.viewDistance       != null) upd['view-distance']        = settings.viewDistance;
      if (settings.simulationDistance != null) upd['simulation-distance']  = settings.simulationDistance;
      if (settings.motd               != null) upd['motd']                 = encodeMotd(settings.motd);
      if (settings.rconPassword       != null) upd['rcon.password']        = settings.rconPassword;
      if (Object.keys(upd).length)             updatePropertiesFile(SERVER_PROPERTIES_PATH, upd);
    }

    // .env
    if (fs.existsSync(BOT_ENV_PATH)) {
      const upd = {};
      if (settings.discordToken != null) upd['TOKEN']         = settings.discordToken;
      if (settings.rconPassword != null) upd['RCON_PASSWORD'] = settings.rconPassword;
      if (Object.keys(upd).length)       updatePropertiesFile(BOT_ENV_PATH, upd);
    }

    // start.bat — only update Xmx/Xms
    if (settings.maxRam && /^\d+[GgMm]$/i.test(settings.maxRam.trim()) && fs.existsSync(START_BAT_PATH)) {
      const ram = settings.maxRam.trim().toUpperCase();
      let bat = fs.readFileSync(START_BAT_PATH, 'utf8');
      bat = bat.replace(/-Xmx\d+[GgMm]/gi, `-Xmx${ram}`)
               .replace(/-Xms\d+[GgMm]/gi, `-Xms${ram}`);
      fs.writeFileSync(START_BAT_PATH, bat, 'utf8');
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 5. Danger zone
ipcMain.handle('danger-reset-whitelist', async () => {
  try {
    fs.writeFileSync(path.join(SERVER_DIR, 'whitelist.json'), '[]', 'utf8');
    if (rconConnected && rcon) {
      await sendRconCommand('whitelist reload');
      return { success: true, message: 'Whitelist reset and reloaded via RCON.' };
    }
    return { success: true, message: 'Whitelist reset to []. Reload manually or restart server.' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('danger-open-folder', () => {
  shell.openPath(SERVER_DIR);
  return { success: true };
});

ipcMain.handle('danger-open-logs', () => {
  if (!fs.existsSync(SERVER_LOG_PATH)) {
    return { success: false, error: 'logs/latest.log does not exist yet.' };
  }
  exec(`notepad.exe "${SERVER_LOG_PATH}"`);
  return { success: true };
});

// 6. Console history
ipcMain.handle('get-console-history', (_, type) => {
  return readLastLines(type === 'server' ? SERVER_LOG_PATH : BOT_LOG_PATH, 100);
});

// 7. Bot command tracking (called from renderer via preload)
ipcMain.on('register-bot-command', (_, cmd) => {
  lastCommand = cmd;
  send('last-command-update', { command: lastCommand });
});
