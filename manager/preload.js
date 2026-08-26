'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Process control
  getStatus:       () => ipcRenderer.invoke('get-status'),
  startServer:     () => ipcRenderer.invoke('start-server'),
  stopServer:      () => ipcRenderer.invoke('stop-server'),
  restartServer:   () => ipcRenderer.invoke('restart-server'),
  startBot:        () => ipcRenderer.invoke('start-bot'),
  stopBot:         () => ipcRenderer.invoke('stop-bot'),

  // RCON
  sendServerCommand: (cmd) => ipcRenderer.invoke('send-server-command', cmd),

  // Settings
  readSettings:    ()         => ipcRenderer.invoke('read-settings'),
  saveSettings:    (settings) => ipcRenderer.invoke('save-settings', settings),

  // Danger zone
  dangerResetWhitelist: () => ipcRenderer.invoke('danger-reset-whitelist'),
  dangerOpenFolder:     () => ipcRenderer.invoke('danger-open-folder'),
  dangerOpenLogs:       () => ipcRenderer.invoke('danger-open-logs'),

  // Prerequisites check
  checkPrerequisites:  () => ipcRenderer.invoke('check-prerequisites'),
  checkprerequisites:  () => ipcRenderer.invoke('check-prerequisites'),

  // Console history
  getConsoleHistory: (type) => ipcRenderer.invoke('get-console-history', type),

  // Manager settings (tray, terminal, auto-start)
  readManagerSettings:  ()         => ipcRenderer.invoke('read-manager-settings'),
  saveManagerSettings:  (settings) => ipcRenderer.invoke('save-manager-settings', settings),

  // Server profiles
  getServerProfiles:   ()         => ipcRenderer.invoke('get-server-profiles'),
  getActiveServerId:   ()         => ipcRenderer.invoke('get-active-server-id'),
  setActiveServer:     (serverId) => ipcRenderer.invoke('set-active-server', serverId),
  addServerProfile:    (profile)  => ipcRenderer.invoke('add-server-profile', profile),
  removeServerProfile: (serverId) => ipcRenderer.invoke('remove-server-profile', serverId),

  // Server creation and management
  createServer:          (profile)         => ipcRenderer.invoke('create-server', profile),
  createServerWithDownload: (profile)      => ipcRenderer.invoke('create-server-with-download', profile),
  importServer:          (sourcePath, id)   => ipcRenderer.invoke('import-server', sourcePath, id),
  getPaperVersions:     ()                 => ipcRenderer.invoke('get-paper-versions'),
  downloadPaperJar:      (version, dir, jarName, serverId) => ipcRenderer.invoke('download-paper-jar', version, dir, jarName, serverId),
  detectServerJars:      (dirPath)          => ipcRenderer.invoke('detect-server-jars', dirPath),
  resolveServerJar:      (serverId)         => ipcRenderer.invoke('resolve-server-jar', serverId),
  setServerJar:          (serverId, jarName) => ipcRenderer.invoke('set-server-jar', serverId, jarName),

  // Multi-server process control
  startServerById:    (serverId) => ipcRenderer.invoke('start-server-by-id', serverId),
  stopServerById:     (serverId) => ipcRenderer.invoke('stop-server-by-id', serverId),
  restartServerById:  (serverId) => ipcRenderer.invoke('restart-server-by-id', serverId),
  getServerStatus:    (serverId) => ipcRenderer.invoke('get-server-status', serverId),
  getAllServersStatus: ()         => ipcRenderer.invoke('get-all-servers-status'),
  sendRconCommand:    (serverId, cmd) => ipcRenderer.invoke('send-rcon-command', serverId, cmd),

  // Auto-setup
  runAutoSetup: () => ipcRenderer.invoke('run-auto-setup'),

  // Networking
  getAllNetworkingStatus:    ()                         => ipcRenderer.invoke('get-all-networking-status'),
  selectNetworkingMethod:    (method)                   => ipcRenderer.invoke('select-networking-method', method),
  installZeroTier:           ()                         => ipcRenderer.invoke('install-zerotier'),
  startZeroTier:             ()                         => ipcRenderer.invoke('start-zerotier'),
  joinZeroTierNetwork:       (networkId)                => ipcRenderer.invoke('join-zerotier-network', networkId),
  installTailscale:          ()                         => ipcRenderer.invoke('install-tailscale'),
  startTailscale:             ()                         => ipcRenderer.invoke('start-tailscale'),
  stopTailscale:              ()                         => ipcRenderer.invoke('stop-tailscale'),
  getPortForwardingInfo:      (externalPort, internalPort) => ipcRenderer.invoke('get-port-forwarding-info', externalPort, internalPort),
  installPlayit:              ()                         => ipcRenderer.invoke('install-playit'),
  startPlayit:                ()                         => ipcRenderer.invoke('start-playit'),
  saveManualAddress:          (address, notes)           => ipcRenderer.invoke('save-manual-address', address, notes),
  getManualAddress:           ()                         => ipcRenderer.invoke('get-manual-address'),
  getServerConnectionAddress: (serverId, serverPort, method) => ipcRenderer.invoke('get-server-connection-address', serverId, serverPort, method),

  // Bot command tracking (renderer -> main)
  registerBotCommand: (cmd) => ipcRenderer.send('register-bot-command', cmd),

  // Push listeners (main -> renderer)
  onServerLog: (cb) => {
    const fn = (_, line) => cb(line);
    ipcRenderer.on('server-log', fn);
    return () => ipcRenderer.removeListener('server-log', fn);
  },
  onBotLog: (cb) => {
    const fn = (_, line) => cb(line);
    ipcRenderer.on('bot-log', fn);
    return () => ipcRenderer.removeListener('bot-log', fn);
  },
  onSpawnError: (cb) => {
    const fn = (_, payload) => cb(payload);
    ipcRenderer.on('spawn-error', fn);
    return () => ipcRenderer.removeListener('spawn-error', fn);
  },
  onStatusChange: (cb) => {
    const fn = (_, payload) => cb(payload);
    ipcRenderer.on('status-change', fn);
    return () => ipcRenderer.removeListener('status-change', fn);
  },
  onRamUpdate: (cb) => {
    const fn = (_, payload) => cb(payload);
    ipcRenderer.on('ram-update', fn);
    return () => ipcRenderer.removeListener('ram-update', fn);
  },
  onLastCommandUpdate: (cb) => {
    const fn = (_, payload) => cb(payload);
    ipcRenderer.on('last-command-update', fn);
    return () => ipcRenderer.removeListener('last-command-update', fn);
  },
  onBotRamUpdate: (cb) => {
    const fn = (_, payload) => cb(payload);
    ipcRenderer.on('bot-ram-update', fn);
    return () => ipcRenderer.removeListener('bot-ram-update', fn);
  },
  onDownloadProgress: (cb) => {
    const fn = (_, payload) => cb(payload);
    ipcRenderer.on('download-progress', fn);
    return () => ipcRenderer.removeListener('download-progress', fn);
  }
});
