'use strict';

/**
 * Centralized path resolution for SHADOW MC HOST.
 *
 * Three-tier data ownership:
 *   1. Application code  — __dirname (read-only in packaged builds / ASAR)
 *   2. Application data  — app.getPath('userData') (writable runtime config, settings, logs, PID files)
 *   3. Server data       — configurable root, default C:\ShadowMCHost\servers\ (Minecraft worlds, JARs, plugins)
 *
 * This module is the single authoritative source for all writable paths.
 * It must not use process.cwd() or hardcode a username.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Electron's `app` is only available in the main process after app.whenReady,
// but the module-level require works at any point after the app module is loaded.
// We import lazily to avoid errors if this module is required very early.
let _electronApp = null;
function getElectronApp() {
  if (_electronApp) return _electronApp;
  try {
    _electronApp = require('electron').app;
  } catch (_) {
    _electronApp = null;
  }
  return _electronApp;
}

/**
 * Fallback userData path for non-Electron or pre-app-ready contexts.
 * Mirrors Electron's default userData logic:
 *   Windows: %APPDATA%/<appName>
 *   macOS:   ~/Library/Application Support/<appName>
 *   Linux:   ~/.config/<appName>
 */
function fallbackUserDataPath() {
  const appName = 'SHADOW MC HOST';
  const home = os.homedir();
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, appName);
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', appName);
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(xdg, appName);
}

/**
 * Get the writable application-data directory (Electron userData).
 * This is where config, settings, PID files, and logs live.
 */
function getAppDataDir() {
  const app = getElectronApp();
  if (app && typeof app.getPath === 'function') {
    try {
      return app.getPath('userData');
    } catch (_) {}
  }
  return fallbackUserDataPath();
}

/** Ensure a directory exists, creating it recursively if needed. */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

// ---------------------------------------------------------------------------
// Application-owned writable paths (under userData)
// ---------------------------------------------------------------------------

/** Root application data directory */
function appDataDir() {
  return ensureDir(getAppDataDir());
}

/** Config directory for application-owned configuration files */
function configDir() {
  return ensureDir(path.join(getAppDataDir(), 'config'));
}

/** Logs directory for application-level logs (not Minecraft server logs) */
function logsDir() {
  return ensureDir(path.join(getAppDataDir(), 'logs'));
}

/** Backups directory */
function backupsDir() {
  return ensureDir(path.join(getAppDataDir(), 'backups'));
}

/** servers.json — the server registry */
function serversConfigPath() {
  return path.join(getAppDataDir(), 'servers.json');
}

/** manager-settings.json — tray/terminal/auto-start preferences */
function managerSettingsPath() {
  return path.join(getAppDataDir(), 'manager-settings.json');
}

/** networking-config.json — networking method configuration */
function networkingConfigPath() {
  return path.join(getAppDataDir(), 'networking-config.json');
}

/** PID file for a specific server process */
function serverPidPath(serverId) {
  return path.join(getAppDataDir(), `.server-pid-${serverId}`);
}

/** Legacy single-server PID file path (kept for cleanup/migration) */
function legacyServerPidPath() {
  return path.join(getAppDataDir(), '.server.pid');
}

/** Bot PID file */
function botPidPath() {
  return path.join(getAppDataDir(), '.bot.pid');
}

/** Auto-setup completion marker */
function setupLockPath() {
  return path.join(getAppDataDir(), '.setup-complete');
}

// ---------------------------------------------------------------------------
// Server data paths (Minecraft server files — NOT application config)
// ---------------------------------------------------------------------------

/**
 * Determine the default server data root.
 * Windows:  C:\ShadowMCHost\servers
 * Other:    ~/.shadowmchost/servers
 *
 * This is NOT hardcoded to a specific user — it uses the system home or
 * a conventional root that is the same for all users on the machine.
 */
function getDefaultServerRoot() {
  if (process.platform === 'win32') {
    return path.join('C:\\ShadowMCHost', 'servers');
  }
  return path.join(os.homedir(), '.shadowmchost', 'servers');
}

/**
 * Get the configured server root, checking servers.json for a custom root.
 * Falls back to the default if not configured.
 */
function getServerRoot() {
  try {
    const configPath = serversConfigPath();
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.settings && config.settings.serverRoot) {
        return config.settings.serverRoot;
      }
    }
  } catch (_) {}
  return getDefaultServerRoot();
}

/**
 * Get the directory for a specific server by ID.
 * Uses the server's rootPath if registered (supports both absolute paths
 * for new/imported servers and legacy relative paths).
 *
 * For legacy servers with relative rootPath, resolve against the old
 * __dirname location so they continue to work without migration.
 */
function getServerDirectory(serverId, serverConfig, managerDir) {
  if (serverConfig && serverConfig.rootPath) {
    if (path.isAbsolute(serverConfig.rootPath)) {
      return serverConfig.rootPath;
    }
    // Legacy relative path — resolve against the manager directory
    // (the original __dirname) so existing servers keep working.
    const base = managerDir || __dirname;
    return path.resolve(base, serverConfig.rootPath);
  }
  // Fallback: construct path under the server root
  return path.join(getServerRoot(), serverId);
}

/**
 * Get the directory for a new server (to be created).
 * Always uses the server root, never the repo.
 */
function getNewServerDir(serverId) {
  return path.join(getServerRoot(), serverId);
}

// ---------------------------------------------------------------------------
// Read-only application resource paths (stay in __dirname / ASAR)
// ---------------------------------------------------------------------------

/** Get the manager source directory (read-only in packaged builds) */
function getManagerDir() {
  return __dirname;
}

/** Bot source directory (read-only) */
function getBotDir() {
  return path.resolve(__dirname, '..', 'mc-bot');
}

/** Renderer (UI) directory — read-only */
function getRendererDir() {
  return path.join(__dirname, 'renderer');
}

/** Tray icon path — read-only asset */
function getTrayIconPath() {
  return path.join(__dirname, 'tray-icon.png');
}

/** preload.js path — read-only */
function getPreloadPath() {
  return path.join(__dirname, 'preload.js');
}

/** index.html path — read-only */
function getIndexHtmlPath() {
  return path.join(__dirname, 'renderer', 'index.html');
}

// ---------------------------------------------------------------------------
// Config migration
// ---------------------------------------------------------------------------

/**
 * Migrate a single legacy config file from __dirname to userData.
 * - Only copies if the legacy file exists and the target does not.
 * - Never deletes or overwrites the legacy file.
 * - Returns true if migration was performed.
 */
function migrateFile(fileName) {
  const legacyPath = path.join(__dirname, fileName);
  const targetPath = path.join(getAppDataDir(), fileName);
  try {
    if (fs.existsSync(legacyPath) && !fs.existsSync(targetPath)) {
      const data = fs.readFileSync(legacyPath);
      fs.writeFileSync(targetPath, data);
      return true;
    }
  } catch (e) {
    console.error(`[paths] Could not migrate ${fileName}: ${e.message}`);
  }
  return false;
}

/**
 * Migrate all known legacy config/state files from __dirname to userData.
 * Called once at startup. Safe to call repeatedly — only migrates missing files.
 */
function migrateLegacyConfig() {
  const files = [
    'servers.json',
    'manager-settings.json',
    'networking-config.json'
  ];
  const migrated = [];
  for (const f of files) {
    if (migrateFile(f)) migrated.push(f);
  }

  // Migrate PID files (just clean up stale ones from __dirname)
  const legacyPidFiles = ['.server.pid', '.bot.pid'];
  for (const pidFile of legacyPidFiles) {
    const oldPath = path.join(__dirname, pidFile);
    const newPath = path.join(getAppDataDir(), pidFile);
    try {
      if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
        fs.copyFileSync(oldPath, newPath);
        migrated.push(pidFile);
      }
    } catch (_) {}
  }

  // Migrate per-server PID files
  try {
    const entries = fs.readdirSync(__dirname);
    for (const entry of entries) {
      if (entry.startsWith('.server-pid-')) {
        const oldPath = path.join(__dirname, entry);
        const newPath = path.join(getAppDataDir(), entry);
        if (!fs.existsSync(newPath)) {
          fs.copyFileSync(oldPath, newPath);
          migrated.push(entry);
        }
      }
    }
  } catch (_) {}

  // Migrate setup lock
  const oldLock = path.join(__dirname, '.setup-complete');
  const newLock = setupLockPath();
  try {
    if (fs.existsSync(oldLock) && !fs.existsSync(newLock)) {
      fs.copyFileSync(oldLock, newLock);
      migrated.push('.setup-complete');
    }
  } catch (_) {}

  if (migrated.length > 0) {
    console.log(`[paths] Migrated config files to userData: ${migrated.join(', ')}`);
  }

  return migrated;
}

module.exports = {
  // Application data paths (writable, under userData)
  appDataDir,
  configDir,
  logsDir,
  backupsDir,
  serversConfigPath,
  managerSettingsPath,
  networkingConfigPath,
  serverPidPath,
  legacyServerPidPath,
  botPidPath,
  setupLockPath,

  // Server data paths
  getDefaultServerRoot,
  getServerRoot,
  getServerDirectory,
  getNewServerDir,

  // Read-only resource paths
  getManagerDir,
  getBotDir,
  getRendererDir,
  getTrayIconPath,
  getPreloadPath,
  getIndexHtmlPath,

  // Migration
  migrateLegacyConfig,
  ensureDir,
};
