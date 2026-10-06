'use strict';

const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage } = require('electron');

// ---------------------------------------------------------------------------
// Single-Instance Lock (REPO-008)
// Acquire BEFORE normal application initialization.
// If the lock cannot be acquired:
// - this is the second instance
// - it must NOT initialize manager or server lifecycle
// - it must exit immediately
// ---------------------------------------------------------------------------
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

const path = require('path');
const fs = require('fs');
const { spawn, exec, execSync } = require('child_process');
const { Rcon } = require('rcon-client');
const pidusage = require('pidusage');
const https = require('https');
const os = require('os');
const dns = require('dns');
const net = require('net');
const networking = require('./networking');
const paths = require('./paths');

// ---------------------------------------------------------------------------
// Paths — centralized via paths.js
// Read-only resources (preload, renderer, tray icon) stay in __dirname.
// Mutable runtime state (config, PID files, settings) uses app.getPath('userData').
// Server data lives under a configurable root (default C:\ShadowMCHost\servers).
// ---------------------------------------------------------------------------

// Read-only application resources (safe in ASAR)
const BOT_DIR     = paths.getBotDir();
const BOT_ENV_PATH   = paths.botEnvPath();
const BOT_LOG_PATH    = paths.botLogPath();
const START_BAT_PATH = path.join(paths.getManagerDir(), '..', 'start.bat');

// Mutable application data (writable, under userData)
const SERVER_PID_PATH = paths.legacyServerPidPath();
const BOT_PID_PATH    = paths.botPidPath();
const SETUP_LOCK_PATH = paths.setupLockPath();

// Legacy single-server paths — now resolved dynamically per active server via getServerDirectory()
// (SERVER_DIR / SERVER_PROPERTIES_PATH / SERVER_LOG_PATH constants removed — use getServerDirectory(id), 
//  getServerPropertiesPath(id), getServerLogPath(id) instead)

// Config file paths (writable, under userData)
const SERVERS_CONFIG_PATH = paths.serversConfigPath();
const MANAGER_SETTINGS_PATH = paths.managerSettingsPath();

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

  // Check Java 21+ — try PATH first, then known install dirs
  const javaExe = getJavaPath();
  try {
    const output = execSync(`"${javaExe}" -version 2>&1`, { encoding: 'utf8' });
    const m = output.match(/version "(\d+)/);
    if (m && parseInt(m[1]) >= 21) checks.java = true;
  } catch (_) {}

  // Check the active profile's resolved server JAR.
  const activeId = getActiveServerId();
  const jar = resolveServerJar(activeId);
  checks.serverJar = !!jar.absolutePath;

  // Check npm dependencies
  checks.dependencies = fs.existsSync(path.join(paths.getManagerDir(), 'node_modules')) &&
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

  // Use the active server's directory (from servers.json), not the legacy repo path
  const setupServerDir = getServerDirectory(getActiveServerId());
  if (!fs.existsSync(setupServerDir)) {
    fs.mkdirSync(setupServerDir, { recursive: true });
    setupSteps.push('Created server directory');
  }

  // Create eula.txt
  if (!fs.existsSync(path.join(setupServerDir, 'eula.txt'))) {
    fs.writeFileSync(path.join(setupServerDir, 'eula.txt'), 'eula=true', 'utf8');
    setupSteps.push('Created eula.txt');
  }

  // Create server.properties
  const setupPropsPath = path.join(setupServerDir, 'server.properties');
  if (!fs.existsSync(setupPropsPath)) {
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
    fs.writeFileSync(setupPropsPath, defaultProps, 'utf8');
    setupSteps.push('Created server.properties');
  }

  // Download PaperMC if missing
  if (!fs.existsSync(path.join(setupServerDir, 'server.jar'))) {
    try {
      const paperUrl = 'https://papermc.io/api/v2/projects/paper/versions/1.21.4/builds/191/downloads/paper-1.21.4-191.jar';
      const tempJar = path.join(setupServerDir, 'paper-temp.jar');
      await downloadFile(paperUrl, tempJar);
      fs.renameSync(tempJar, path.join(setupServerDir, 'server.jar'));
      setupSteps.push('Downloaded PaperMC server');
    } catch (e) {
      console.error('Failed to download PaperMC:', e.message);
      setupSteps.push('ERROR: Failed to download PaperMC - manual download required');
    }
  }

  // Create .env for bot
  if (!fs.existsSync(BOT_ENV_PATH)) {
    const defaultServerPath = paths.getNewServerDir('default');
    const envContent = `# Discord Bot Configuration
TOKEN=your-bot-token-here
GUILD_ID=your-server-id-here
CLIENT_ID=your-application-id-here
SERVER_PATH=${defaultServerPath}
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
  const configPath = paths.serversConfigPath();
  const defaultConfig = {
    servers: {
      default: {
        name: 'Main Server',
        rootPath: paths.getNewServerDir('default'),
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
  }
}

// ===========================================================================
// Server Configuration Helpers (Multi-Server Support)
// ===========================================================================
// SERVERS_CONFIG_PATH now set via paths.js (see above)

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
        rootPath: paths.getNewServerDir('default'),
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

// MANAGER_SETTINGS_PATH now set via paths.js (see above)

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
  try {
    const srvConfig = loadServersConfig();
    if (srvConfig && srvConfig.settings) {
      return {
        ...defaults,
        showTerminal: !!srvConfig.settings.showTerminal,
        closeToTray: srvConfig.settings.closeToTray !== false,
        autoStartServer: !!srvConfig.settings.autoStartDefaultServer,
        autoStartBot: !!srvConfig.settings.autoStartDefaultBot
      };
    }
  } catch (_) {}
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

    // Sync to servers.json
    try {
      const srvConfig = loadServersConfig();
      if (srvConfig && srvConfig.settings) {
        srvConfig.settings.showTerminal = updated.showTerminal;
        srvConfig.settings.closeToTray = updated.closeToTray;
        srvConfig.settings.autoStartDefaultServer = updated.autoStartServer;
        srvConfig.settings.autoStartDefaultBot = updated.autoStartBot;
        saveServersConfig(srvConfig);
      }
    } catch (_) {}

    return true;
  } catch (e) {
    console.error('Error saving manager settings:', e);
    return false;
  }
}

/** Read current config values for the Settings panel */
function readConfig() {
  const activeId = getActiveServerId();
  const server = getServerConfig(activeId);
  const serverPropertiesPath = getServerPropertiesPath(activeId);
  const botEnvPath = BOT_ENV_PATH;
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
  if (fs.existsSync(serverPropertiesPath)) {
    try {
      const props = parseProperties(fs.readFileSync(serverPropertiesPath, 'utf8'));
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
  if (fs.existsSync(botEnvPath)) {
    try {
      const env = parseEnv(fs.readFileSync(botEnvPath, 'utf8'));
      result.discordToken  = env['TOKEN']         || '';
      if (!result.rconPassword) result.rconPassword = env['RCON_PASSWORD'] || '';
    } catch (e) {
      console.error('readConfig: error reading .env:', e.message);
    }
  }

  if (server && server.maxRam) result.maxRam = server.maxRam;

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
      out += '\n';
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
 * Priority: JAVA_HOME env => JAVA_PATH in .env => PATH => known install dirs
 */
function getJavaPath() {
  if (process.env.JAVA_HOME) {
    const p = path.join(process.env.JAVA_HOME, 'bin', 'java.exe');
    if (fs.existsSync(p)) return p;
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
  // Try java on PATH
  try {
    const found = execSync('where java', { encoding: 'utf8' }).split('\n')[0].trim();
    if (found) return found;
  } catch (_) {}
  // Fallback: known install directories
  const candidates = [
    'C:\\Program Files\\Zulu\\zulu-25\\bin\\java.exe',
    'C:\\Program Files\\Zulu\\zulu-21\\bin\\java.exe',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.7.6-hotspot\\bin\\java.exe',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.8.9-hotspot\\bin\\java.exe',
    'C:\\Program Files\\Microsoft\\jdk-21.0.7.6-hotspot\\bin\\java.exe',
    'C:\\Program Files\\Java\\jdk-21\\bin\\java.exe',
    'C:\\Program Files\\Amazon Corretto\\jdk21.0.7_6\\bin\\java.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'java';
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
  constructor(filePath, channel, serverId = null) {
    this.filePath = filePath;
    this.channel  = channel;
    this.serverId = serverId;
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
        if (line.trim()) {
          if (this.serverId) {
            send(this.channel, { serverId: this.serverId, line });
          } else {
            send(this.channel, line);
          }
        }
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

let activeServerTailer = null;

/**
 * Switch the active server log tailer dynamically when active server changes. (REPO-004)
 */
function switchActiveServerLogTailer(serverId) {
  if (activeServerTailer) {
    activeServerTailer.stop();
    const idx = activeTailers.indexOf(activeServerTailer);
    if (idx !== -1) activeTailers.splice(idx, 1);
    activeServerTailer = null;
  }
  if (!serverId) return;
  const logPath = getServerLogPath(serverId);
  activeServerTailer = new LogTailer(logPath, 'server-log', serverId);
  activeServerTailer.start();
  activeTailers.push(activeServerTailer);
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
    const activePropsPath = getServerPropertiesPath(getActiveServerId());
    if (fs.existsSync(activePropsPath)) {
      try {
        const props = parseProperties(fs.readFileSync(activePropsPath, 'utf8'));
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
  const activeId = config.settings.defaultServer;
  // Resolve JAR: use configured, or auto-detect
  let serverJar = serverConfig.serverJar || 'server.jar';
  if (activeId) {
    const jarRes = resolveServerJar(activeId);
    if (jarRes.jar) serverJar = jarRes.jar;
  }

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
    serverJar,
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
  try {
    const iconPath = paths.getTrayIconPath();
    if (!fs.existsSync(iconPath)) return;
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon || icon.isEmpty()) return;
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
  } catch (err) {
    console.warn('[tray] Tray icon not initialized:', err.message);
  }
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
      preload: paths.getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(paths.getIndexHtmlPath());

  // Intercept close — minimize to tray if setting is on and tray is available
  mainWindow.on('close', (e) => {
    if (forceQuit) return; // let it close
    const s = readManagerSettings();
    if (s.closeToTray && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Start active server log tailer dynamically (switches on active server change)
  switchActiveServerLogTailer(getActiveServerId());

  const bt = new LogTailer(BOT_LOG_PATH, 'bot-log');
  bt.start();
  activeTailers.push(bt);
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return; // safety guard — second instance should have quit
  // Migrate legacy config files from __dirname to userData (safe, one-time)
  paths.migrateLegacyConfig();

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

  // Recover already-running servers into the multi-server lifecycle (FOUNDATION-010)
  const recoveredCount = await recoverRunningServers();

  // Auto-start default server if none were recovered and auto-start is enabled
  if (recoveredCount === 0 && managerSettings.autoStartServer) {
    const activeId = getActiveServerId();
    console.log('[Auto-Start] Starting default server...');
    send('server-log', '[System] Auto-starting Minecraft server...');
    startServerById(activeId).catch(e => console.error('[Auto-Start] Failed:', e.message));
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

app.on('window-all-closed', async () => {
  const s = readManagerSettings();
  // If minimize-to-tray is on and this wasn't a forced quit, don't actually quit
  if (s.closeToTray && !forceQuit) return;

  // Stop all tracked multi-server processes (REPO-001 — consolidated from duplicate handler)
  const serverIds = [...serverProcesses.keys()];
  for (const serverId of serverIds) {
    const state = serverProcesses.get(serverId);
    if (state && state.logTailer) { state.logTailer.stop(); }
    await stopServerById(serverId).catch(() => {});
  }

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

    // Switch active server log tailer dynamically (REPO-004)
    switchActiveServerLogTailer(serverId);
    send('active-server-changed', { serverId });

    return { success: true, serverId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

/**
 * Normalize a server directory path for reliable comparison.
 * Handles:
 * - relative vs absolute representation (resolves to absolute)
 * - / vs \ on Windows
 * - trailing separators
 * - case-insensitivity on Windows
 */
function normalizeServerPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '';
  let cleaned = rawPath.trim();
  const isWinPath = /^[a-zA-Z]:[/\\]/.test(cleaned) || cleaned.startsWith('\\\\');
  let resolved;
  if (isWinPath) {
    resolved = path.win32.normalize(cleaned);
    if (resolved.length > 3 && (resolved.endsWith('\\') || resolved.endsWith('/'))) {
      resolved = resolved.replace(/[/\\]+$/, '');
    }
    return resolved.toLowerCase();
  } else {
    resolved = path.resolve(cleaned);
    const root = path.parse(resolved).root;
    if (resolved !== root && resolved.length > 1) {
      resolved = resolved.replace(/[/\\]+$/, '');
    }
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
}

/**
 * Resolve a candidate profile's target server directory.
 */
function resolveCandidateServerDir(id, profile) {
  if (profile && profile.rootPath && typeof profile.rootPath === 'string' && profile.rootPath.trim()) {
    const raw = profile.rootPath.trim();
    const isWin = /^[a-zA-Z]:[/\\]/.test(raw) || raw.startsWith('\\\\');
    const isAbs = isWin ? path.win32.isAbsolute(raw) : path.isAbsolute(raw);
    if (isAbs && !paths.isSourcePath(raw)) {
      return isWin ? path.win32.normalize(raw) : path.resolve(raw);
    }
    return paths.getServerDirectory(id, { rootPath: raw });
  }
  return paths.getNewServerDir(id);
}

/**
 * Validates that a server profile's rootPath, serverPort, and rconPort
 * do not collide with any other configured server in the registry.
 *
 * @param {Object} profile - Profile candidate data
 * @param {string} targetServerId - ID of profile being added/updated
 * @param {Object} config - Current servers configuration
 * @returns {{ valid: boolean, error?: string, resolvedPath: string, serverPort: number, rconPort: number }}
 */
function validateServerProfile(profile, targetServerId, config) {
  const id = String(targetServerId || (profile && profile.id) || '').trim();
  if (!id) {
    return { valid: false, error: 'Server profile ID is required' };
  }

  // 1. Resolve candidate rootPath
  const resolvedPath = resolveCandidateServerDir(id, profile);
  const normCandidatePath = normalizeServerPath(resolvedPath);

  // 2. Collect used paths and ports from other configured servers (excluding self)
  const otherServers = Object.entries((config && config.servers) || {})
    .filter(([existingId]) => String(existingId) !== id);

  for (const [existingId, existingServer] of otherServers) {
    if (!existingServer) continue;
    const existingDir = resolveCandidateServerDir(existingId, existingServer);
    const normExistingPath = normalizeServerPath(existingDir);
    if (normCandidatePath === normExistingPath) {
      const serverName = existingServer.name || existingId;
      return {
        valid: false,
        error: `Server directory '${resolvedPath}' is already used by server '${serverName}'`
      };
    }
  }

  // 3. Port uniqueness check
  const usedServerPorts = new Map();
  const usedRconPorts = new Map();

  for (const [existingId, existingServer] of otherServers) {
    if (!existingServer) continue;
    const sName = existingServer.name || existingId;
    if (existingServer.serverPort) {
      const sp = parseInt(existingServer.serverPort, 10);
      if (!isNaN(sp) && sp > 0) usedServerPorts.set(sp, sName);
    }
    if (existingServer.rconPort) {
      const rp = parseInt(existingServer.rconPort, 10);
      if (!isNaN(rp) && rp > 0) usedRconPorts.set(rp, sName);
    }
  }

  // 4. Resolve & validate serverPort
  let finalServerPort;
  if (profile && profile.serverPort !== undefined && profile.serverPort !== null && String(profile.serverPort).trim() !== '') {
    const reqPort = parseInt(profile.serverPort, 10);
    if (isNaN(reqPort) || reqPort < 1 || reqPort > 65535) {
      return { valid: false, error: `Invalid server port '${profile.serverPort}'. Port must be between 1 and 65535.` };
    }
    if (usedServerPorts.has(reqPort)) {
      return {
        valid: false,
        error: `Minecraft server port ${reqPort} is already in use by server '${usedServerPorts.get(reqPort)}'`
      };
    }
    if (usedRconPorts.has(reqPort)) {
      return {
        valid: false,
        error: `Minecraft server port ${reqPort} conflicts with the RCON port of server '${usedRconPorts.get(reqPort)}'`
      };
    }
    finalServerPort = reqPort;
  } else {
    // Auto-allocate collision-free server port
    let sp = 25565;
    while (usedServerPorts.has(sp) || usedRconPorts.has(sp)) {
      sp++;
    }
    finalServerPort = sp;
  }

  // 5. Resolve & validate rconPort
  let finalRconPort;
  if (profile && profile.rconPort !== undefined && profile.rconPort !== null && String(profile.rconPort).trim() !== '') {
    const reqRcon = parseInt(profile.rconPort, 10);
    if (isNaN(reqRcon) || reqRcon < 1 || reqRcon > 65535) {
      return { valid: false, error: `Invalid RCON port '${profile.rconPort}'. Port must be between 1 and 65535.` };
    }
    if (reqRcon === finalServerPort) {
      return {
        valid: false,
        error: `RCON port (${reqRcon}) cannot be the same as the Minecraft server port (${finalServerPort})`
      };
    }
    if (usedRconPorts.has(reqRcon)) {
      return {
        valid: false,
        error: `RCON port ${reqRcon} is already in use by server '${usedRconPorts.get(reqRcon)}'`
      };
    }
    if (usedServerPorts.has(reqRcon)) {
      return {
        valid: false,
        error: `RCON port ${reqRcon} conflicts with the Minecraft server port of server '${usedServerPorts.get(reqRcon)}'`
      };
    }
    finalRconPort = reqRcon;
  } else {
    // Auto-allocate collision-free RCON port
    let rp = finalServerPort + 100;
    while (usedRconPorts.has(rp) || usedServerPorts.has(rp) || rp === finalServerPort) {
      rp++;
    }
    finalRconPort = rp;
  }

  return {
    valid: true,
    resolvedPath,
    serverPort: finalServerPort,
    rconPort: finalRconPort
  };
}

ipcMain.handle('add-server-profile', (_, profile) => {
  try {
    if (!profile || typeof profile !== 'object') {
      return { success: false, error: 'Invalid profile data provided' };
    }
    const config = loadServersConfig();
    const id = String(profile.id || '').trim() || `server-${Date.now()}`;

    // Validate path and ports for uniqueness (rejects duplicate rootPath or ports)
    const validation = validateServerProfile(profile, id, config);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const rootPath = validation.resolvedPath;
    const serverPort = validation.serverPort;
    const rconPort = validation.rconPort;
    const rconPassword = profile.rconPassword || generateRandomPassword();

    if (!fs.existsSync(rootPath)) {
      fs.mkdirSync(rootPath, { recursive: true });
    }

    // Keep server.properties consistent if it exists
    const propsPath = path.join(rootPath, 'server.properties');
    if (fs.existsSync(propsPath)) {
      updatePropertiesFile(propsPath, {
        'server-port': serverPort,
        'enable-rcon': 'true',
        'rcon.port': rconPort
      });
    }

    const savedProfile = {
      ...profile,
      id,
      name: profile.name || id,
      rootPath,
      serverPort,
      rconHost: profile.rconHost || '127.0.0.1',
      rconPort,
      rconPassword
    };

    config.servers[id] = savedProfile;
    if (!config.settings.defaultServer) {
      config.settings.defaultServer = id;
    }
    saveServersConfig(config);
    return { success: true, profile: savedProfile };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('update-server-profile', (_, serverId, updates) => {
  try {
    const config = loadServersConfig();
    if (!config.servers || !config.servers[serverId]) {
      return { success: false, error: `Server profile '${serverId}' not found` };
    }

    const merged = { ...config.servers[serverId], ...updates, id: serverId };
    const validation = validateServerProfile(merged, serverId, config);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    merged.rootPath = validation.resolvedPath;
    merged.serverPort = validation.serverPort;
    merged.rconPort = validation.rconPort;

    // Keep server.properties consistent if it exists
    const propsPath = path.join(merged.rootPath, 'server.properties');
    if (fs.existsSync(propsPath)) {
      updatePropertiesFile(propsPath, {
        'server-port': merged.serverPort,
        'enable-rcon': 'true',
        'rcon.port': merged.rconPort
      });
    }

    config.servers[serverId] = merged;
    saveServersConfig(config);
    return { success: true, profile: merged };
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

ipcMain.handle('download-papermc', async (_, version = '1.21.4', build) => {
  try {
    const result = await downloadPaperJar(version, getServerDirectory(getActiveServerId()), 'server.jar');
    return { success: true, message: 'PaperMC downloaded successfully', ...result };
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
        if (line.includes(getServerDirectory(getActiveServerId()))) {
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
  const opsPath = path.join(getServerDirectory(getActiveServerId()), 'ops.json');
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
        const activeLogPath = getServerLogPath(getActiveServerId());
        if (fs.existsSync(activeLogPath)) {
          const stat = fs.statSync(activeLogPath);
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
    const serverRoot = getServerDirectory(config.settings.defaultServer || 'default');

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
      env:      { ...process.env, SHADOW_MC_HOST_BOT_ENV: BOT_ENV_PATH },
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
    const activeId = getActiveServerId();
    const activeServer = getServerConfig(activeId);
    const serverPropertiesPath = getServerPropertiesPath(activeId);
    const botEnvPath = BOT_ENV_PATH;

    // Save manager settings
    saveManagerSettings(settings);

    // server.properties
    if (fs.existsSync(serverPropertiesPath)) {
      const upd = {};
      if (settings.maxPlayers        != null) upd['max-players']          = settings.maxPlayers;
      if (settings.viewDistance       != null) upd['view-distance']        = settings.viewDistance;
      if (settings.simulationDistance != null) upd['simulation-distance']  = settings.simulationDistance;
      if (settings.motd               != null) upd['motd']                 = encodeMotd(settings.motd);
      if (settings.rconPassword       != null) upd['rcon.password']        = settings.rconPassword;
      if (Object.keys(upd).length)             updatePropertiesFile(serverPropertiesPath, upd);
    }

    // .env
    if (fs.existsSync(botEnvPath)) {
      const upd = {};
      if (settings.discordToken != null) upd['TOKEN']         = settings.discordToken;
      if (settings.rconPassword != null) upd['RCON_PASSWORD'] = settings.rconPassword;
      if (Object.keys(upd).length)       updatePropertiesFile(botEnvPath, upd);
    }

    // Persist RAM on the active server profile.
    if (settings.maxRam && /^\d+[GgMm]$/i.test(settings.maxRam.trim()) && activeServer) {
      const ram = settings.maxRam.trim().toUpperCase();
      const config = loadServersConfig();
      config.servers[activeId].maxRam = ram;
      saveServersConfig(config);
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// 5. Danger zone
ipcMain.handle('danger-reset-whitelist', async () => {
  try {
    const activeId = getActiveServerId();
    fs.writeFileSync(path.join(getServerDirectory(activeId), 'whitelist.json'), '[]', 'utf8');
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
  shell.openPath(getServerDirectory(getActiveServerId()));
  return { success: true };
});

ipcMain.handle('danger-open-logs', () => {
  const logPath = getServerLogPath(getActiveServerId());
  if (!fs.existsSync(logPath)) {
    return { success: false, error: 'logs/latest.log does not exist yet.' };
  }
  exec(`notepad.exe "${logPath}"`);
  return { success: true };
});

// 6. Console history
ipcMain.handle('get-console-history', (_, type) => {
  return readLastLines(type === 'server' ? getServerLogPath(getActiveServerId()) : BOT_LOG_PATH, 100);
});

// 7. Bot command tracking (called from renderer via preload)
ipcMain.on('register-bot-command', (_, cmd) => {
  lastCommand = cmd;
  send('last-command-update', { command: lastCommand });
});

// ===========================================================================
// MULTI-SERVER SUPPORT
// ===========================================================================

// Per-server state: serverId -> { pid, rcon, rconConnected, rconRetryCount, rconTimeoutId, ramPollId, logTailer, serverPort, rconPort, startTime, maxRam }
const serverProcesses = new Map();

/** Get server config by ID */
function getServerConfig(serverId) {
  const config = loadServersConfig();
  return config.servers[serverId] || null;
}

/** Get all server IDs */
function getAllServerIds() {
  const config = loadServersConfig();
  return Object.keys(config.servers);
}

/** Get active server ID */
function getActiveServerId() {
  const config = loadServersConfig();
  return config.settings.defaultServer || 'default';
}

/** Set active server ID */
function setActiveServerId(serverId) {
  const config = loadServersConfig();
  if (config.servers[serverId]) {
    config.settings.defaultServer = serverId;
    saveServersConfig(config);
    return true;
  }
  return false;
}

/** Generate unique port numbers */
function getNextPorts() {
  const config = loadServersConfig();
  const usedPorts = new Set();
  const usedRconPorts = new Set();
  for (const [id, server] of Object.entries(config.servers)) {
    if (server.serverPort) usedPorts.add(server.serverPort);
    if (server.rconPort) usedRconPorts.add(server.rconPort);
  }
  let serverPort = 25565;
  while (usedPorts.has(serverPort)) serverPort++;
  let rconPort = serverPort + 100;
  while (usedRconPorts.has(rconPort) || usedPorts.has(rconPort)) rconPort++;
  return { serverPort, rconPort };
}

/** Get PID file path for server */
function getServerPidPath(serverId) {
  return paths.serverPidPath(serverId);
}

/** Get log path for server */
function getServerLogPath(serverId) {
  return path.join(getServerDirectory(serverId), 'logs', 'latest.log');
}

/** Get properties path for server */
function getServerPropertiesPath(serverId) {
  return path.join(getServerDirectory(serverId), 'server.properties');
}

/** Get server directory */
function getServerDirectory(serverId) {
  const server = getServerConfig(serverId);
  return paths.getServerDirectory(serverId, server);
}

function persistResolvedServerJar(serverId, jarName) {
  if (!serverId || !jarName) return;
  const config = loadServersConfig();
  if (!config.servers[serverId]) return;
  if (config.servers[serverId].serverJar === jarName) return;
  config.servers[serverId].serverJar = jarName;
  saveServersConfig(config);
}

function appendServerLog(serverId, line) {
  const logPath = getServerLogPath(serverId);
  try {
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logPath, line.endsWith('\n') ? line : `${line}\n`, 'utf8');
  } catch (e) {
    console.error(`Could not write server log for ${serverId}:`, e.message);
  }
  const cleanLine = line.replace(/\r?\n$/, '');
  send('server-log', { serverId, line: cleanLine });
}

function attachProcessOutput(child, serverId) {
  const wire = (stream, prefix = '') => {
    if (!stream) return;
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) appendServerLog(serverId, prefix ? `${prefix}${line}` : line);
      }
    });
    stream.on('end', () => {
      if (buffer.trim()) appendServerLog(serverId, prefix ? `${prefix}${buffer}` : buffer);
      buffer = '';
    });
  };
  wire(child.stdout);
  wire(child.stderr, '[stderr] ');
}

function waitForEarlyExit(child, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      if (settled) return;
      clearTimeout(timer);
      settled = true;
      resolve({ code, signal });
    });
  });
}

/** Check if PID is running */
function isServerPidRunning(pid, imageName) {
  return new Promise(resolve => {
    if (!pid || isNaN(pid)) return resolve(false);
    exec(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, (err, stdout) => {
      if (err) return resolve(false);
      resolve(stdout.toLowerCase().includes(imageName.toLowerCase()));
    });
  });
}

/** Read PID from file */
function readServerPid(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const n = parseInt(fs.readFileSync(filePath, 'utf8').trim(), 10);
    return isNaN(n) ? null : n;
  } catch (_) { return null; }
}

/** Get PID RAM in MB */
async function getServerPidRamMB(pid) {
  if (!pid || isNaN(pid)) return 0;
  try {
    const stats = await pidusage(pid);
    return Math.round(stats.memory / 1024 / 1024);
  } catch (_) { return 0; }
}

/** Convert RAM string to MB */
function ramToMB(str) {
  if (!str) return 0;
  const m = String(str).trim().match(/^(\d+)([GgMm])$/);
  if (!m) return 0;
  return m[2].toUpperCase() === 'G' ? parseInt(m[1], 10) * 1024 : parseInt(m[1], 10);
}

/** Generate random password */
function generateRandomPassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/** Generate random seed */
function generateRandomSeed() {
  return Math.floor(Math.random() * 9999999999).toString();
}

/** Get Java path for server */
function getServerJavaPath(serverId = null) {
  const server = serverId ? getServerConfig(serverId) : null;
  if (server && server.javaPath) return server.javaPath;
  if (process.env.JAVA_HOME) return path.join(process.env.JAVA_HOME, 'bin', 'java.exe');
  try {
    const out = execSync('where java', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = out.split(/\r?\n/).filter(Boolean);
    if (lines.length > 0) return lines[0].trim();
  } catch (e) {}
  return 'java';
}

/** Start server by ID */
async function startServerById(serverId) {
  const server = getServerConfig(serverId);
  if (!server) return { success: false, error: `Server profile '${serverId}' not found` };

  const inMemory = serverProcesses.get(serverId);
  if (inMemory && (inMemory.state === 'online' || inMemory.state === 'starting')) {
    return { success: false, error: `Server '${serverId}' is already running` };
  }

  const pidPath = getServerPidPath(serverId);
  let existingPid = readServerPid(pidPath);
  if (!existingPid && serverId === 'default') {
    existingPid = readServerPid(paths.legacyServerPidPath());
  }
  if (existingPid && await isServerPidRunning(existingPid, 'java.exe')) {
    return { success: false, error: `Server '${serverId}' is already running` };
  }

  try {
    const javaExe = getServerJavaPath(serverId);
    const serverRoot = getServerDirectory(serverId);
    const managerSettings = readManagerSettings();
    const maxRam = server.maxRam || '4G';
    const serverPort = server.serverPort || 25565;

    // Resolve the server JAR: use configured, or auto-detect
    const jarResolution = resolveServerJar(serverId);
    let serverJar = server.serverJar || 'server.jar';
    if (jarResolution.jar) {
      serverJar = jarResolution.jar;
      persistResolvedServerJar(serverId, serverJar);
    } else if (jarResolution.needsSelection) {
      return {
        success: false,
        error: `Multiple JARs found in server directory. Please select one in the Servers panel.`,
        needsJarSelection: true,
        candidates: jarResolution.candidates
      };
    } else if (jarResolution.error) {
      return { success: false, error: jarResolution.error };
    }

    const jarArg = jarResolution.absolutePath &&
      path.dirname(jarResolution.absolutePath).toLowerCase() !== serverRoot.toLowerCase()
      ? jarResolution.absolutePath
      : serverJar;
    const args = [
      `-Xms${maxRam}`, `-Xmx${maxRam}`,
      '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC',
      '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40',
      '-XX:G1HeapRegionSize=8M', '-XX:G1ReservePercent=20',
      '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
      '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90',
      '-XX:G1RSetUpdatingPauseTimePercent=5', '-XX:SurvivorRatio=32',
      '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1',
      '-Dusing.aikars.flags=https://mcflags.emc.gs', '-Daikars.new.flags=true',
      '-jar', jarArg, 'nogui'
    ];

    appendServerLog(serverId, `[System] Launching ${javaExe}`);
    appendServerLog(serverId, `[System] Working directory: ${serverRoot}`);
    appendServerLog(serverId, `[System] Server JAR: ${jarResolution.absolutePath || path.join(serverRoot, serverJar)}`);

    const child = spawn(javaExe, args, {
      cwd: serverRoot, detached: true, shell: false,
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: !managerSettings.showTerminal
    });
    if (!child.pid) return { success: false, error: 'spawn() returned undefined PID' };
    attachProcessOutput(child, serverId);

    fs.writeFileSync(pidPath, String(child.pid), 'utf8');
    serverProcesses.set(serverId, {
      child, pid: child.pid, serverPort: serverPort,
      rconPort: server.rconPort || 25575, rconPassword: server.rconPassword || '',
      startTime: Date.now(), maxRam: maxRam,
      serverRoot, serverJar, resolvedJarPath: jarResolution.absolutePath || path.join(serverRoot, serverJar),
      state: 'starting'
    });
    child.once('exit', (code, signal) => {
      const state = serverProcesses.get(serverId);
      appendServerLog(serverId, `[System] Java process exited with code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''}.`);
      try { fs.unlinkSync(pidPath); } catch (_) {}
      stopServerRamPolling(serverId);
      disconnectServerRcon(serverId);
      if (state && state.state !== 'stopping') {
        send('status-change', { type: 'server', serverId, state: code === 0 ? 'offline' : 'failed' });
      } else {
        send('status-change', { type: 'server', serverId, state: 'offline' });
      }
      serverProcesses.delete(serverId);
    });
    startServerRamPolling(serverId);
    scheduleServerRconConnect(serverId);
    const earlyExit = await waitForEarlyExit(child, 1500);
    if (earlyExit) {
      const msg = `Java exited immediately with code ${earlyExit.code ?? 'null'}${earlyExit.signal ? `, signal ${earlyExit.signal}` : ''}. See the server console for stdout/stderr.`;
      return { success: false, error: msg };
    }
    const alive = await isServerPidRunning(child.pid, 'java.exe');
    if (!alive) return { success: false, error: 'Java process is not running. See the server console for stdout/stderr.' };
    send('status-change', { type: 'server', serverId, state: 'starting' });
    return { success: true, pid: child.pid, serverId };
  } catch (e) {
    send('spawn-error', { source: 'server', serverId, message: e.message });
    return { success: false, error: e.message };
  }
}

/** Stop server by ID */
async function stopServerById(serverId) {
  const server = getServerConfig(serverId);
  if (!server) return { success: false, error: `Server profile '${serverId}' not found` };
  const pidPath = getServerPidPath(serverId);
  const sPid = readServerPid(pidPath);
  if (!sPid || !(await isServerPidRunning(sPid, 'java.exe'))) {
    try { fs.unlinkSync(pidPath); } catch (_) {}
    return { success: false, error: `Server '${serverId}' is not running` };
  }
  const state = serverProcesses.get(serverId);
  if (state) {
    state.state = 'stopping';
    if (state.logTailer) { state.logTailer.stop(); state.logTailer = null; }
  }
  send('status-change', { type: 'server', serverId, state: 'stopping' });
  if (state && state.rcon && state.rconConnected) {
    try { await state.rcon.send('stop'); await new Promise(r => setTimeout(r, 8000)); }
    catch (e) { console.error(`RCON stop failed for ${serverId}:`, e.message); }
  }
  if (await isServerPidRunning(sPid, 'java.exe')) {
    await new Promise(r => exec(`taskkill /PID ${sPid} /F /T`, r));
  }
  try { fs.unlinkSync(pidPath); } catch (_) {}
  stopServerRamPolling(serverId); disconnectServerRcon(serverId);
  serverProcesses.delete(serverId);
  send('status-change', { type: 'server', serverId, state: 'offline' });
  return { success: true, serverId };
}

/** Restart server by ID */
async function restartServerById(serverId) {
  await stopServerById(serverId);
  await new Promise(r => setTimeout(r, 2000));
  return startServerById(serverId);
}

/** Start RAM polling for server */
function startServerRamPolling(serverId) {
  const state = serverProcesses.get(serverId);
  if (!state) return;
  state.ramPollId = setInterval(async () => {
    const sPid = readServerPid(getServerPidPath(serverId));
    if (!sPid || !(await isServerPidRunning(sPid, 'java.exe'))) {
      send('ram-update', { serverId, used: 0, total: ramToMB(state.maxRam || '4G') });
      return;
    }
    const used = await getServerPidRamMB(sPid);
    send('ram-update', { serverId, used, total: ramToMB(state.maxRam || '4G') });
  }, 5000);
}

/** Stop RAM polling for server */
function stopServerRamPolling(serverId) {
  const state = serverProcesses.get(serverId);
  if (state && state.ramPollId) {
    clearInterval(state.ramPollId); state.ramPollId = null;
  }
  send('ram-update', { serverId, used: 0, total: 0 });
}

/** Schedule RCON connect for server */
function scheduleServerRconConnect(serverId) {
  const server = getServerConfig(serverId);
  const state = serverProcesses.get(serverId);
  if (!server || !state) return;
  const propsPath = getServerPropertiesPath(serverId);
  let props = {};
  if (fs.existsSync(propsPath)) {
    try { props = parseProperties(fs.readFileSync(propsPath, 'utf8')); } catch (_) {}
  }
  const rconHost = server.rconHost || props['server-ip'] || '127.0.0.1';
  const rconPort = server.rconPort || parseInt(props['rcon.port'] || '25575', 10);
  const rconPassword = server.rconPassword || props['rcon.password'] || '';
  if (state.rconTimeoutId) { clearTimeout(state.rconTimeoutId); state.rconTimeoutId = null; }
  state.rconTimeoutId = setTimeout(async () => {
    if (!state) return; state.rconConnected = false;
    if (state.rcon) { try { await state.rcon.end(); } catch (_) {} state.rcon = null; }
    try {
      const rcon = new Rcon({ host: rconHost, port: rconPort, password: rconPassword, timeout: 5000 });
      rcon.on('end', () => { if (state) state.rconConnected = false; });
      rcon.on('error', err => { if (state) state.rconConnected = false; });
      await rcon.connect(); state.rcon = rcon; state.rconConnected = true;
      state.rconRetryCount = 0; send('rcon-connected', { serverId, connected: true });
    } catch (e) {
      if (state) { state.rconConnected = false; state.rcon = null; }
      state.rconRetryCount = (state.rconRetryCount || 0) + 1;
      if (state && state.rconRetryCount < 20) scheduleServerRconConnect(serverId);
      else send('rcon-connected', { serverId, connected: false, error: e.message });
    }
  }, 15000);
}

/** Disconnect RCON for server */
function disconnectServerRcon(serverId) {
  const state = serverProcesses.get(serverId);
  if (state && state.rcon) { try { state.rcon.end(); } catch (_) {} state.rcon = null; }
  if (state && state.rconTimeoutId) { clearTimeout(state.rconTimeoutId); state.rconTimeoutId = null; }
  send('rcon-connected', { serverId, connected: false });
}

/** Send RCON command to server */
async function sendRconCommandToServer(serverId, command) {
  const state = serverProcesses.get(serverId);
  if (!state || !state.rcon || !state.rconConnected) {
    return { success: false, error: `RCON not connected for server ${serverId}` };
  }
  try {
    let cmd = command.trim();
    if (cmd.startsWith('/')) cmd = cmd.slice(1);
    const response = await state.rcon.send(cmd);
    return { success: true, response: response || '' };
  } catch (e) { state.rconConnected = false; return { success: false, error: e.message };
  }
}

/** Get server status */
async function getServerStatus(serverId) {
  const server = getServerConfig(serverId);
  if (!server) return { success: false, error: `Server profile '${serverId}' not found` };
  const pidPath = getServerPidPath(serverId);
  const sPid = readServerPid(pidPath);
  const state = serverProcesses.get(serverId);
  const status = {
    serverId: serverId, name: server.name, state: 'offline',
    pid: null, ramUsed: 0, ramTotal: ramToMB(server.maxRam || '4G'),
    uptime: 0, rconConnected: false,
    serverPort: server.serverPort || 25565, rconPort: server.rconPort || 25575
  };
  if (sPid) {
    const running = await isServerPidRunning(sPid, 'java.exe');
    if (running) {
      status.state = 'online'; status.pid = sPid; status.ramUsed = await getServerPidRamMB(sPid);
      if (state && state.startTime) status.uptime = Date.now() - state.startTime;
      else try { const st = fs.statSync(pidPath); status.uptime = Date.now() - st.mtimeMs; } catch (_) {}
      status.rconConnected = state ? state.rconConnected || false : false;
    } else try { fs.unlinkSync(pidPath); } catch (_) {}
  }
  return { success: true, status };
}

/** Get all servers status */
async function getAllServersStatus() {
  const serverIds = getAllServerIds();
  const results = {};
  for (const serverId of serverIds) {
    const result = await getServerStatus(serverId);
    if (result.success) results[serverId] = result.status;
  }
  return { success: true, servers: results };
}

/**
 * Recover servers that are already running when the manager starts.
 * Does NOT spawn new processes — only adopts existing Java processes.
 * Returns the number of servers successfully recovered. (FOUNDATION-010)
 */
async function recoverRunningServers() {
  const config = loadServersConfig();
  const serverIds = Object.keys((config && config.servers) || {});
  let recoveredCount = 0;

  for (const serverId of serverIds) {
    const server = config.servers[serverId];
    if (!server) continue;

    const pidPath = getServerPidPath(serverId);
    let pid = readServerPid(pidPath);

    // If no server-specific PID file, check legacy PID for default server
    if (!pid && serverId === 'default') {
      const legacyPidPath = paths.legacyServerPidPath();
      const legacyPid = readServerPid(legacyPidPath);
      if (legacyPid) {
        const running = await isServerPidRunning(legacyPid, 'java.exe');
        if (running) {
          pid = legacyPid;
          try { fs.writeFileSync(pidPath, String(pid), 'utf8'); } catch (_) {}
          try { fs.unlinkSync(legacyPidPath); } catch (_) {}
        } else {
          try { fs.unlinkSync(legacyPidPath); } catch (_) {}
        }
      }
    }

    if (!pid) continue; // no PID file — server was not running or was never started

    const running = await isServerPidRunning(pid, 'java.exe');
    if (!running) {
      // Stale PID file — clean up, do not register as running
      try { fs.unlinkSync(pidPath); } catch (_) {}
      continue;
    }

    // Server is genuinely running — adopt it without spawning a new process
    console.log(`[Recovery] Server '${serverId}' is already running (PID ${pid}). Adopting.`);
    appendServerLog(serverId, `[System] Detected running server process (PID ${pid}). Reconnecting.`);

    const serverRoot = getServerDirectory(serverId);
    const serverPort = server.serverPort || 25565;
    const rconPort = server.rconPort || 25575;
    const maxRam = server.maxRam || '4G';

    // Register in serverProcesses without a child process handle (adopted process)
    serverProcesses.set(serverId, {
      child: null,
      pid,
      serverPort,
      rconPort,
      rconPassword: server.rconPassword || '',
      startTime: Date.now(),
      maxRam,
      serverRoot,
      serverJar: server.serverJar || 'server.jar',
      state: 'online'
    });

    // Restore RAM monitoring
    startServerRamPolling(serverId);

    // Restore RCON connection
    scheduleServerRconConnect(serverId);

    // Restore log streaming via LogTailer (child stdout is not available for adopted processes)
    // If activeServerTailer is already streaming this server, avoid duplicate streaming
    if (serverId !== getActiveServerId()) {
      const logPath = getServerLogPath(serverId);
      const tailer = new LogTailer(logPath, 'server-log', serverId);
      tailer.start();
      activeTailers.push(tailer);
      serverProcesses.get(serverId).logTailer = tailer;
    }

    send('status-change', { type: 'server', serverId, state: 'online' });
    recoveredCount++;
  }

  return recoveredCount;
}

/** Filter out SHADOW runtime state and version control metadata when importing */
function shouldImportServerEntry(name, isDirectory) {
  // Exclude SHADOW runtime PID files and locks
  if (name.startsWith('.server-pid-') || name === '.server.pid' || name === '.bot.pid' || name === '.setup-complete') {
    return false;
  }
  // Exclude SHADOW application configs if present in source
  if (name === 'servers.json' || name === 'manager-settings.json' || name === 'networking-config.json' || name === 'bot.env') {
    return false;
  }
  // Exclude VCS and node_modules
  if (name === '.git' || name === '.svn' || name === '.hg' || (isDirectory && name === 'node_modules')) {
    return false;
  }
  return true;
}

/** Copy directory recursively */
function copyDirRecursive(src, dest, filterFn = null) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (filterFn && !filterFn(entry.name, entry.isDirectory())) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(srcPath, destPath, filterFn);
    else fs.copyFileSync(srcPath, destPath);
  }
}

// ===========================================================================
// MULTI-SERVER IPC HANDLERS
// ===========================================================================

ipcMain.handle('start-server-by-id', (_, serverId) => startServerById(serverId));
ipcMain.handle('stop-server-by-id', (_, serverId) => stopServerById(serverId));
ipcMain.handle('restart-server-by-id', (_, serverId) => restartServerById(serverId));
ipcMain.handle('get-server-status', (_, serverId) => getServerStatus(serverId));
ipcMain.handle('get-all-servers-status', () => getAllServersStatus());
ipcMain.handle('send-rcon-command', (_, serverId, command) => sendRconCommandToServer(serverId, command));
ipcMain.handle('create-server', async (_, profile) => {
  try {
    const config = loadServersConfig();
    const serverId = (profile && profile.id) || `server-${Date.now()}`;
    if (config.servers && config.servers[serverId]) {
      return { success: false, error: `Server ID '${serverId}' already exists` };
    }

    const validation = validateServerProfile(profile || {}, serverId, config);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const serverDir = validation.resolvedPath;
    const serverPort = validation.serverPort;
    const rconPort = validation.rconPort;

    // New servers go under the centralized server root
    const serversBase = paths.getServerRoot();
    if (!fs.existsSync(serversBase)) fs.mkdirSync(serversBase, { recursive: true });
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
      fs.mkdirSync(path.join(serverDir, 'plugins'), { recursive: true });
      fs.mkdirSync(path.join(serverDir, 'world'), { recursive: true });
      fs.mkdirSync(path.join(serverDir, 'logs'), { recursive: true });
    }
    const seed = (profile && profile.seed) || generateRandomSeed();
    const rconPassword = (profile && profile.rconPassword) || generateRandomPassword();
    const serverProfile = {
      id: serverId, name: (profile && profile.name) || serverId,
      rootPath: serverDir, serverJar: 'server.jar', javaPath: null,
      serverPort, rconHost: '127.0.0.1',
      rconPort, rconPassword,
      autoStart: (profile && profile.autoStart) || false, maxRam: (profile && profile.maxRam) || '4G',
      notes: (profile && profile.notes) || '', minecraftVersion: (profile && profile.minecraftVersion) || '1.21.4',
      seed, gamemode: (profile && profile.gamemode) || 'survival',
      difficulty: (profile && profile.difficulty) || 'normal', maxPlayers: (profile && profile.maxPlayers) || 20,
      viewDistance: (profile && profile.viewDistance) || 10, levelName: (profile && profile.levelName) || 'world',
      createdAt: new Date().toISOString()
    };
    config.servers[serverId] = serverProfile;
    if (!config.settings.defaultServer) config.settings.defaultServer = serverId;
    saveServersConfig(config);
    const props = {
      'server-port': serverPort, 'enable-rcon': 'true', 'rcon.port': rconPort,
      'rcon.password': rconPassword, 'gamemode': serverProfile.gamemode,
      'difficulty': serverProfile.difficulty, 'max-players': serverProfile.maxPlayers,
      'view-distance': serverProfile.viewDistance, 'motd': `Shadow MC Host - ${serverProfile.name}`,
      'online-mode': 'false', 'level-name': serverProfile.levelName,
      'level-type': 'minecraft:normal', 'level-seed': seed
    };
    fs.writeFileSync(path.join(serverDir, 'server.properties'),
      Object.entries(props).map(([k, v]) => `${k}=${v}`).join('\n'), 'utf8');
    fs.writeFileSync(path.join(serverDir, 'eula.txt'), 'eula=true', 'utf8');
    return { success: true, profile: serverProfile };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('remove-server-profile', (_, serverId) => {
  try {
    const config = loadServersConfig();
    if (!config.servers[serverId]) return { success: false, error: 'Server profile not found' };
    stopServerById(serverId).catch(() => {});
    delete config.servers[serverId];
    if (config.settings.defaultServer === serverId) {
      config.settings.defaultServer = Object.keys(config.servers)[0] || null;
    }
    saveServersConfig(config); return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

// ===========================================================================
// PAPERMC API + DOWNLOAD MANAGER
// ===========================================================================

/** Fetch JSON from a URL */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const opts = typeof url === 'string' ? { headers: { 'User-Agent': 'ShadowMCHost/1.0' } } : url;
    https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchJson(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON response')); }
      });
    }).on('error', reject);
  });
}

/** Download a file with progress reporting */
function downloadFileWithProgress(url, dest, progressChannel, serverId) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let received = 0;
    let total = 0;
    let lastReport = 0;

    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) {}
        return resolve(downloadFileWithProgress(res.headers.location, dest, progressChannel, serverId));
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch (_) {}
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      total = parseInt(res.headers['content-length'] || '0', 10);
      res.on('data', (chunk) => {
        received += chunk.length;
        const now = Date.now();
        if (progressChannel && (now - lastReport > 200 || received === total)) {
          lastReport = now;
          send(progressChannel, {
            serverId,
            received,
            total,
            percent: total > 0 ? Math.round(received / total * 100) : 0
          });
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        if (progressChannel) send(progressChannel, { serverId, received: total, total, percent: 100 });
        resolve(true);
      });
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(dest); } catch (_) {}
      reject(err);
    });
  });
}

/** Get available Paper versions from PaperMC v3 API */
async function getPaperVersions() {
  const data = await fetchJson('https://fill.papermc.io/v3/projects/paper');
  return { versions: data.versions || [], versionGroups: data.version_groups || [] };
}

/** Get latest build for a Paper version using v3 API */
async function getPaperLatestBuild(version) {
  const builds = await fetchJson(`https://fill.papermc.io/v3/projects/paper/versions/${version}/builds`);
  const arr = Array.isArray(builds) ? builds : [];
  if (arr.length === 0) return null;
  // Sort descending, pick latest
  const latest = arr.sort((a, b) => b.id - a.id)[0];
  // Download URL is in latest.downloads['server:default'].url
  let downloadUrl = latest.downloads?.['server:default']?.url;
  if (!downloadUrl) {
    // Fallback: find first property with a url
    for (const key of Object.keys(latest.downloads || {})) {
      if (latest.downloads[key]?.url) { downloadUrl = latest.downloads[key].url; break; }
    }
  }
  return { build: latest.id, downloadUrl, version };
}

/** Validate that a file is a valid JAR/ZIP archive and has reasonable file size */
function validateJarFile(filePath, minSizeBytes = 5 * 1024 * 1024) {
  if (!fs.existsSync(filePath)) {
    throw new Error('Downloaded file does not exist.');
  }
  const stats = fs.statSync(filePath);
  if (stats.size < minSizeBytes) {
    let sample = '';
    try {
      sample = fs.readFileSync(filePath, 'utf8').slice(0, 200).replace(/\s+/g, ' ');
    } catch (_) {}
    throw new Error(`Downloaded file size (${Math.round(stats.size / 1024)} KB) is too small to be a valid Paper server JAR.${sample ? ` Response: "${sample}"` : ''}`);
  }
  const buffer = Buffer.alloc(4);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 4, 0);
  fs.closeSync(fd);
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
    throw new Error('Downloaded file is not a valid ZIP/JAR archive (invalid header bytes).');
  }
  return true;
}

/** Download Paper JAR for a specific version into a directory with safety validation */
async function downloadPaperJar(version, destDir, jarName, progressChannel, serverId) {
  const buildInfo = await getPaperLatestBuild(version);
  if (!buildInfo || !buildInfo.downloadUrl) {
    throw new Error(`No Paper build found for version ${version}`);
  }
  const finalJarName = jarName || `paper-${version}-${buildInfo.build}.jar`;
  const dest = path.join(destDir, finalJarName);
  const tempDest = path.join(destDir, `.tmp-${Date.now()}-${finalJarName}`);

  try {
    await downloadFileWithProgress(buildInfo.downloadUrl, tempDest, progressChannel, serverId);
    validateJarFile(tempDest);
    if (fs.existsSync(dest)) {
      try { fs.unlinkSync(dest); } catch (_) {}
    }
    fs.renameSync(tempDest, dest);
    return { jarName: finalJarName, build: buildInfo.build, version, path: dest };
  } catch (err) {
    if (fs.existsSync(tempDest)) {
      try { fs.unlinkSync(tempDest); } catch (_) {}
    }
    throw new Error(`Paper JAR download failed validation: ${err.message}. Existing server JAR was preserved.`);
  }
}

// ===========================================================================
// JAR DETECTION
// ===========================================================================

/** Plugin/mod jar name patterns to exclude */
const PLUGIN_PATTERNS = [
  /^ViaVersion/i, /^ViaBackwards/i, /^ViaRewind/i,
  /^Vault/i, /^Essentials/i, /^LuckPerms/i, /^WorldEdit/i, /^WorldGuard/i,
  /^PlaceholderAPI/i, /^ProtocolLib/i, /^CoreProtect/i, /^dynmap/i,
  /^Multiverse/i, /^PermissionsEx/i, /^GroupManager/i, /^bStats/i
];

/** Check if a jar name looks like a plugin/mod rather than a server executable */
function isPluginJar(fileName) {
  const base = path.basename(fileName, '.jar').toLowerCase();
  // Plugins are usually in plugins/ or mods/ dirs, but if found in root, check patterns
  for (const p of PLUGIN_PATTERNS) {
    if (p.test(base)) return true;
  }
  // Very small jars (< 1MB implied by name patterns) are likely plugins
  return false;
}

/** Find suitable server JARs in a directory */
function detectServerJars(dir) {
  if (!fs.existsSync(dir)) return [];
  const jars = [];
  const pluginsDir = path.join(dir, 'plugins');
  const modsDir = path.join(dir, 'mods');
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.jar')) continue;
      // Skip if it's clearly a plugin
      if (isPluginJar(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const stat = fs.statSync(fullPath);
      // Server JARs are typically > 20MB; plugins are usually < 5MB
      if (stat.size < 5 * 1024 * 1024) continue;
      jars.push({ name: entry.name, path: fullPath, sizeMB: Math.round(stat.size / 1024 / 1024) });
    }
  } catch (_) {}
  // Sort by size descending — the largest jar is most likely the server
  jars.sort((a, b) => b.sizeMB - a.sizeMB);
  return jars;
}

/** Resolve the server JAR for a profile: use configured, or detect */
function resolveServerJar(serverId) {
  const server = getServerConfig(serverId);
  if (!server) return { jar: null, error: 'Server profile not found' };
  const serverDir = getServerDirectory(serverId);

  // 1. If serverJar is configured and exists, use it
  if (server.serverJar) {
    const jarPath = path.isAbsolute(server.serverJar) ? server.serverJar : path.join(serverDir, server.serverJar);
    if (fs.existsSync(jarPath)) {
      return { jar: path.basename(server.serverJar), absolutePath: jarPath };
    }
  }

  // 2. Prefer the conventional server.jar in this profile directory.
  const conventionalJar = path.join(serverDir, 'server.jar');
  if (fs.existsSync(conventionalJar)) {
    return { jar: 'server.jar', absolutePath: conventionalJar, autoDetected: !server.serverJar };
  }

  // 3. Detect JARs in the server directory
  const detected = detectServerJars(serverDir);
  const detectedServerJar = detected.find(j => j.name.toLowerCase() === 'server.jar');
  if (detectedServerJar) {
    return { jar: detectedServerJar.name, absolutePath: detectedServerJar.path, autoDetected: !server.serverJar };
  }
  if (detected.length === 1) {
    // Auto-select the only candidate
    return { jar: detected[0].name, absolutePath: detected[0].path, autoDetected: true };
  }
  if (detected.length > 1) {
    // Multiple candidates — don't guess, return list for user to choose
    return { jar: null, candidates: detected, needsSelection: true };
  }

  // No JAR found
  return { jar: null, error: 'No server JAR found in server directory' };
}

ipcMain.handle('import-server', async (_, sourcePath, importServerId = null) => {
  try {
    const config = loadServersConfig();
    const id = importServerId || `imported-${Date.now()}`;
    const resolvedSource = path.resolve(sourcePath);
    const serversBase = paths.getServerRoot();
    const serverDir = paths.getNewServerDir(id);

    if (!fs.existsSync(resolvedSource)) {
      return { success: false, error: `Source directory not found: ${resolvedSource}` };
    }
    if (!fs.statSync(resolvedSource).isDirectory()) {
      return { success: false, error: `Source path is not a directory: ${resolvedSource}` };
    }
    if (config.servers && config.servers[id]) {
      return { success: false, error: `A server profile with ID '${id}' already exists.` };
    }
    if (path.resolve(serverDir) === resolvedSource) {
      return { success: false, error: 'Destination directory is the same as the source directory.' };
    }

    if (!fs.existsSync(serversBase)) fs.mkdirSync(serversBase, { recursive: true });
    if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });

    // FOUNDATION-004: Copy entire server directory preserving worlds, player data, plugins, configs
    copyDirRecursive(resolvedSource, serverDir, shouldImportServerEntry);

    // Detect server JARs in the imported destination directory
    const detectedJars = detectServerJars(serverDir);
    let serverJarName = 'server.jar';
    let jarNote = '';
    if (detectedJars.length === 1) {
      serverJarName = detectedJars[0].name;
    } else if (detectedJars.length > 1) {
      serverJarName = detectedJars[0].name;
      jarNote = ` (Multiple JARs detected, using: ${serverJarName})`;
    } else if (!fs.existsSync(path.join(serverDir, 'server.jar'))) {
      jarNote = ' (No server JAR detected; add server.jar before starting)';
    }

    // FOUNDATION-005: Parse existing server.properties to preserve all settings
    const targetPropsPath = path.join(serverDir, 'server.properties');
    let serverProps = {};
    if (fs.existsSync(targetPropsPath)) {
      try {
        serverProps = parseProperties(fs.readFileSync(targetPropsPath, 'utf8'));
      } catch (_) {}
    }

    // Allocate ports, checking against collision with other configured servers
    const ports = getNextPorts();
    const usedPorts = new Set();
    const usedRconPorts = new Set();
    for (const [srvId, srv] of Object.entries(config.servers || {})) {
      if (srvId !== id) {
        if (srv.serverPort) usedPorts.add(Number(srv.serverPort));
        if (srv.rconPort) usedRconPorts.add(Number(srv.rconPort));
      }
    }

    const existingServerPort = parseInt(serverProps['server-port'], 10);
    const existingRconPort = parseInt(serverProps['rcon.port'], 10);

    const finalServerPort = (!isNaN(existingServerPort) && existingServerPort > 0 && !usedPorts.has(existingServerPort))
      ? existingServerPort
      : ports.serverPort;

    const finalRconPort = (!isNaN(existingRconPort) && existingRconPort > 0 && !usedRconPorts.has(existingRconPort) && existingRconPort !== finalServerPort)
      ? existingRconPort
      : ports.rconPort;

    const finalRconPassword = (serverProps['rcon.password'] && serverProps['rcon.password'].trim())
      ? serverProps['rcon.password'].trim()
      : generateRandomPassword();

    // FOUNDATION-005: Update ONLY required SHADOW-controlled keys in-place
    // Preserves MOTD, gamemode, difficulty, view-distance, online-mode, whitelist, etc.
    const requiredUpdates = {
      'server-port': finalServerPort,
      'enable-rcon': 'true',
      'rcon.port': finalRconPort,
      'rcon.password': finalRconPassword
    };
    updatePropertiesFile(targetPropsPath, requiredUpdates);

    // Ensure eula.txt exists so imported server can boot
    const eulaPath = path.join(serverDir, 'eula.txt');
    if (!fs.existsSync(eulaPath)) {
      fs.writeFileSync(eulaPath, 'eula=true\r\n', 'utf8');
    }

    const serverProfile = {
      id: id,
      name: path.basename(resolvedSource) || id,
      rootPath: serverDir,
      serverJar: serverJarName,
      javaPath: null,
      serverPort: finalServerPort,
      rconHost: '127.0.0.1',
      rconPort: finalRconPort,
      rconPassword: finalRconPassword,
      autoStart: false,
      maxRam: '4G',
      notes: `Imported from: ${sourcePath}${jarNote}`,
      minecraftVersion: '1.21.4',
      seed: serverProps['level-seed'] || generateRandomSeed(),
      gamemode: serverProps['gamemode'] || 'survival',
      difficulty: serverProps['difficulty'] || 'normal',
      maxPlayers: parseInt(serverProps['max-players'], 10) || 20,
      viewDistance: parseInt(serverProps['view-distance'], 10) || 10,
      levelName: serverProps['level-name'] || 'world',
      createdAt: new Date().toISOString()
    };

    config.servers[id] = serverProfile;
    if (!config.settings.defaultServer || Object.keys(config.servers).length === 1) {
      config.settings.defaultServer = id;
    }
    saveServersConfig(config);

    return { success: true, profile: serverProfile };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ===========================================================================
// PAPERMC + JAR DETECTION IPC HANDLERS
// ===========================================================================

ipcMain.handle('get-paper-versions', async () => {
  try {
    const result = await getPaperVersions();
    return { success: true, ...result };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('download-paper-jar', async (_, version, destDir, jarName, serverId) => {
  try {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const result = await downloadPaperJar(version, destDir, jarName, 'download-progress', serverId);
    return { success: true, ...result };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('detect-server-jars', (_, dirPath) => {
  try {
    const resolved = path.resolve(dirPath);
    const jars = detectServerJars(resolved);
    return { success: true, jars };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('resolve-server-jar', (_, serverId) => {
  try {
    const result = resolveServerJar(serverId);
    if (result.jar && result.autoDetected) persistResolvedServerJar(serverId, result.jar);
    return { success: true, ...result };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('set-server-jar', (_, serverId, jarName) => {
  try {
    const config = loadServersConfig();
    if (!config.servers[serverId]) return { success: false, error: 'Server profile not found' };
    config.servers[serverId].serverJar = jarName;
    saveServersConfig(config);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('create-server-with-download', async (_, profile) => {
  try {
    const config = loadServersConfig();
    const serverId = (profile && profile.id) || `server-${Date.now()}`;
    if (config.servers && config.servers[serverId]) return { success: false, error: 'Server ID already exists' };

    const validation = validateServerProfile(profile || {}, serverId, config);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const serverPort = validation.serverPort;
    const rconPort = validation.rconPort;
    const rconPassword = (profile && profile.rconPassword) || generateRandomPassword();
    const seed = profile && profile.seed && profile.seed.trim() ? profile.seed.trim() : generateRandomSeed();
    const maxRam = (profile && profile.maxRam) || '4G';
    const minecraftVersion = (profile && profile.minecraftVersion) || '1.21.4';

    // New servers go under the centralized server root
    const serversBase = paths.getServerRoot();
    const serverDir = validation.resolvedPath;
    if (!fs.existsSync(serversBase)) fs.mkdirSync(serversBase, { recursive: true });
    if (fs.existsSync(serverDir) && fs.readdirSync(serverDir).length > 0) {
      return { success: false, error: 'Server directory already exists and is not empty. Choose a different name or path.' };
    }
    if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });
    fs.mkdirSync(path.join(serverDir, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(serverDir, 'logs'), { recursive: true });

    // Download Paper JAR
    let jarName = 'server.jar';
    if (profile.serverSoftware !== 'import') {
      const dlResult = await downloadPaperJar(minecraftVersion, serverDir, 'server.jar', 'download-progress', serverId);
      jarName = dlResult.jarName;
    }

    const serverProfile = {
      id: serverId,
      name: profile.name || serverId,
      rootPath: serverDir,
      serverJar: jarName,
      javaPath: null,
      serverPort: serverPort,
      rconHost: '127.0.0.1',
      rconPort: rconPort,
      rconPassword: rconPassword,
      autoStart: profile.autoStart || false,
      maxRam: maxRam,
      notes: profile.notes || '',
      minecraftVersion: minecraftVersion,
      serverSoftware: profile.serverSoftware || 'paper',
      seed: seed,
      gamemode: profile.gamemode || 'survival',
      difficulty: profile.difficulty || 'normal',
      maxPlayers: profile.maxPlayers || 20,
      viewDistance: profile.viewDistance || 10,
      levelName: profile.levelName || 'world',
      createdAt: new Date().toISOString()
    };
    config.servers[serverId] = serverProfile;
    if (!config.settings.defaultServer || Object.keys(config.servers).length === 1) {
      config.settings.defaultServer = serverId;
    }
    saveServersConfig(config);

    // Create server.properties
    const props = {
      'server-port': serverPort,
      'enable-rcon': 'true',
      'rcon.port': rconPort,
      'rcon.password': rconPassword,
      'gamemode': serverProfile.gamemode,
      'difficulty': serverProfile.difficulty,
      'max-players': serverProfile.maxPlayers,
      'view-distance': serverProfile.viewDistance,
      'motd': serverProfile.name,
      'online-mode': 'false',
      'level-name': serverProfile.levelName,
      'level-type': 'minecraft:normal',
      'level-seed': seed
    };
    fs.writeFileSync(path.join(serverDir, 'server.properties'),
      Object.entries(props).map(([k, v]) => `${k}=${v}`).join('\n'), 'utf8');
    fs.writeFileSync(path.join(serverDir, 'eula.txt'), 'eula=true', 'utf8');

    return { success: true, profile: serverProfile };
  } catch (e) { return { success: false, error: e.message }; }
});

// Override single-server process functions to use multi-server
startServerProcess = async function() {
  const activeId = getActiveServerId();
  return startServerById(activeId);
};
stopServerProcess = async function() {
  const activeId = getActiveServerId();
  return stopServerById(activeId);
};
let restartServerProcess = async function() {
  const activeId = getActiveServerId();
  await stopServerById(activeId);
  await new Promise(r => setTimeout(r, 2000));
  return startServerById(activeId);
};

// Override send-server-command to use active server RCON
ipcMain.removeHandler('send-server-command');
ipcMain.handle('send-server-command', async (_, command) => {
  const activeId = getActiveServerId();
  return sendRconCommandToServer(activeId, command);
});

// Override get-status to include all servers
ipcMain.removeHandler('get-status');
ipcMain.handle('get-status', async () => {
  const status = {
    server: 'offline', bot: 'offline', serverPid: null, botPid: null,
    serverRam: 0, botRam: 0, serverUptime: 0, rconConnected,
    lastCommand, serverRamTotal: 0, ops: [], allServers: {}
  };
  const allStatus = await getAllServersStatus();
  status.allServers = allStatus.servers || {};

  // Active server status
  const activeId = getActiveServerId();
  const activeStatus = allStatus.servers && allStatus.servers[activeId];
  if (activeStatus) {
    status.server = activeStatus.state;
    status.serverPid = activeStatus.pid;
    status.serverRam = activeStatus.ramUsed;
    status.serverRamTotal = activeStatus.ramTotal;
    status.serverUptime = activeStatus.uptime;
    status.rconConnected = activeStatus.rconConnected;
  }

  // ops.json for active server
  const activeServer = getServerConfig(activeId);
  if (activeServer) {
    const opsPath = path.join(getServerDirectory(activeId), 'ops.json');
    if (fs.existsSync(opsPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(opsPath, 'utf8'));
        status.ops = data.map(o => (o.name || '').toLowerCase());
      } catch (_) {}
    }
  }

  // Bot status
  const bPid = readPid(BOT_PID_PATH);
  if (bPid) {
    const running = await isPidRunning(bPid, 'node.exe');
    if (running) {
      status.bot = 'online';
      status.botPid = bPid;
      status.botRam = await getPidRamMB(bPid);
    } else {
      try { fs.unlinkSync(BOT_PID_PATH); } catch (_) {}
    }
  }

  return status;
});

// ===========================================================================
// NETWORKING IPC HANDLERS
// ===========================================================================

ipcMain.handle('get-all-networking-status', async () => {
  try {
    const status = await networking.getAllMethodsStatus();
    return { success: true, ...status };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('select-networking-method', async (_, method) => {
  try {
    const config = networking.loadNetworkingConfig();
    config.selectedMethod = method;
    networking.saveNetworkingConfig(config);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('install-zerotier', async () => {
  try {
    return await networking.installZeroTier();
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('start-zerotier', async () => {
  try {
    return await networking.startZeroTier();
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('join-zerotier-network', async (_, networkId) => {
  try {
    return await networking.joinZeroTierNetwork(networkId);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('install-tailscale', async () => {
  try {
    return await networking.installTailscale();
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('start-tailscale', async () => {
  try {
    return await networking.startTailscale();
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('stop-tailscale', async () => {
  try {
    return await networking.stopTailscale();
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-port-forwarding-info', async (_, externalPort, internalPort) => {
  try {
    const info = await networking.getPortForwardingInfo(internalPort || 25565, externalPort || 25565);
    return { success: true, ...info };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('install-playit', async () => {
  try {
    return await networking.installPlayit();
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('start-playit', async () => {
  try {
    return await networking.startPlayit();
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('save-manual-address', async (_, address, notes) => {
  try {
    return await networking.saveManualAddress(address, notes);
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-manual-address', async () => {
  try {
    return await networking.getManualAddress();
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-server-connection-address', async (_, serverId, serverPort, method) => {
  try {
    const address = networking.getServerConnectionAddress(serverId, serverPort, method);
    return { success: true, address };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
