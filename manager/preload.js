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
  }
});
