'use strict';

// ===========================================================================
// Global State
// ===========================================================================
let activePanel      = 'dashboard';
let activeConsoleTab = 'server';
let serverStatus     = 'offline';  // 'offline' | 'starting' | 'online'
let botStatus        = 'offline';  // 'offline' | 'online'
let onlinePlayersList = [];
let maxPlayersCount   = 10;
let opsList           = [];
let serverUptimeStart = 0;   // ms timestamp when server came online
let uptimeTickId      = null; // setInterval for uptime counter
let serverMaxRamMB    = 0;

// Server profiles state
let serverProfiles = {};
let activeServerId = 'default';

// Setup state
let setupInProgress = false;
let setupSteps = [];
let prerequisitesChecked = false;
let prerequisitesStatus = {};


// ===========================================================================
// DOM References
// ===========================================================================
const navBtns         = document.querySelectorAll('.nav-btn');
const panels          = document.querySelectorAll('.panel');
const dashboardClock  = document.getElementById('dashboard-clock');

// Status indicators
const serverSidebarDot  = document.getElementById('server-sidebar-dot');
const botSidebarDot     = document.getElementById('bot-sidebar-dot');
const serverStatusBadge = document.getElementById('server-status-badge');
const botStatusBadge    = document.getElementById('bot-status-badge');

// Metrics
const serverRamValue  = document.getElementById('server-ram-value');
const serverRamBar    = document.getElementById('server-ram-bar');
const serverUptimeVal = document.getElementById('server-uptime-val');
const botRamValue     = document.getElementById('bot-ram-value');
const botLastCmdEl    = document.getElementById('bot-last-command');

// Widgets
const widgetPlayerCount = document.getElementById('widget-player-count');
const widgetPlayerBar   = document.getElementById('widget-player-bar');
const widgetTpsVal      = document.getElementById('widget-tps-val');
const widgetTpsStatus   = document.getElementById('widget-tps-status');

// Controls
const btnStartServer   = document.getElementById('btn-start-server');
const btnStopServer    = document.getElementById('btn-stop-server');
const btnRestartServer = document.getElementById('btn-restart-server');
const btnStartBot      = document.getElementById('btn-start-bot');
const btnStopBot       = document.getElementById('btn-stop-bot');
const btnGoToConsole   = document.getElementById('btn-go-to-console');

// Console
const miniConsoleOutput  = document.getElementById('mini-console-output');
const fullConsoleOutput  = document.getElementById('full-console-output');
const tabServerConsole   = document.getElementById('tab-server-console');
const tabBotConsole      = document.getElementById('tab-bot-console');
const consoleInputField  = document.getElementById('console-input-field');
const btnSendConsoleCmd  = document.getElementById('btn-send-console-cmd');
const btnCopyConsole     = document.getElementById('btn-copy-console');

// Players
const playersCountBadge  = document.getElementById('players-count-badge');
const playersEmptyState  = document.getElementById('players-empty-state');
const playersListGrid    = document.getElementById('players-list-grid');

// Settings
const settingsFormEl          = document.getElementById('settings-form-el');
const setMaxPlayers           = document.getElementById('set-max-players');
const setViewDist             = document.getElementById('set-view-dist');
const setSimDist              = document.getElementById('set-sim-dist');
const setMotd                 = document.getElementById('set-motd');
const setRconPass             = document.getElementById('set-rcon-pass');
const setDiscordToken         = document.getElementById('set-discord-token');
const setMaxRam               = document.getElementById('set-max-ram');
const btnToggleTokenMask      = document.getElementById('btn-toggle-token-mask');
const settingsStatusMessage   = document.getElementById('settings-status-message');

// App Behaviour toggles
const setShowTerminal         = document.getElementById('set-show-terminal');
const setCloseToTray          = document.getElementById('set-close-to-tray');
const setAutoStartServer      = document.getElementById('set-auto-start-server');
const setAutoStartBot         = document.getElementById('set-auto-start-bot');

// Danger zone
const btnDangerResetWhitelist = document.getElementById('btn-danger-reset-whitelist');
const btnDangerOpenFolder     = document.getElementById('btn-danger-open-folder');
const btnDangerOpenLogs       = document.getElementById('btn-danger-open-logs');

// Server Profiles
const btnAddServer        = document.getElementById('btn-add-server');
const btnCloseAddServer   = document.getElementById('btn-close-add-server');
const btnCancelAddServer   = document.getElementById('btn-cancel-add-server');
const btnConfirmAddServer  = document.getElementById('btn-confirm-add-server');
const addServerModal      = document.getElementById('add-server-modal');
const serverProfilesGrid  = document.getElementById('server-profiles-grid');
const serversEmptyState   = document.getElementById('servers-empty-state');
const newServerId         = document.getElementById('new-server-id');
const newServerName       = document.getElementById('new-server-name');
const newServerPath       = document.getElementById('new-server-path');
const newServerBotdir     = document.getElementById('new-server-botdir');
const newServerMaxram    = document.getElementById('new-server-maxram');
const newServerNotes      = document.getElementById('new-server-notes');
const addServerForm       = document.getElementById('add-server-form');

// Setup Panel Elements
const setupPanel         = document.getElementById('setup-panel');
const btnRunSetup         = document.getElementById('btn-run-setup');
const btnCheckPrereqs     = document.getElementById('btn-check-prereqs');
const setupProgress       = document.getElementById('setup-progress');
const setupStatus         = document.getElementById('setup-status');
const prereqsList         = document.getElementById('prereqs-list');
const setupStepsList      = document.getElementById('setup-steps-list');

// Quick Start Panel
const quickStartPanel     = document.getElementById('quickstart-panel');
const btnOneClickStart    = document.getElementById('btn-oneclick-start');


// ===========================================================================
// Helpers
// ===========================================================================
function formatUptime(ms) {
  if (!ms || ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600).toString().padStart(2, '0');
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

/** Parse allocated RAM string "10G" or "10240M" => number of MB */
function ramToMB(str) {
  if (!str) return 4096;
  const m = String(str).match(/^(\d+)([GgMm])$/);
  if (!m) return 4096;
  const num = parseInt(m[1], 10);
  return m[2].toUpperCase() === 'G' ? num * 1024 : num;
}

function truncateCommand(command) {
  const text = command || 'None';
  return text.length > 30 ? `${text.slice(0, 27)}...` : text;
}

function updateLastCommand(command) {
  if (botLastCmdEl) botLastCmdEl.textContent = truncateCommand(command);
}

function updateServerRam(used, total) {
  const safeUsed = Number.isFinite(Number(used)) ? Number(used) : 0;
  const safeTotal = Number.isFinite(Number(total)) ? Number(total) : serverMaxRamMB;
  if (safeTotal > 0) serverMaxRamMB = safeTotal;

  const displayTotal = serverMaxRamMB || safeTotal || 0;
  serverRamValue.textContent = `${Math.round(safeUsed)} MB / ${Math.round(displayTotal)} MB`;
  serverRamBar.style.width = displayTotal > 0
    ? `${Math.min(100, Math.round(safeUsed / displayTotal * 100))}%`
    : '0%';
}

function parsePlayerList(response) {
  // "There are 2 of a max of 20 players online: alice, bob"
  const m = response.match(/There are (\d+) of a max of (\d+)/i);
  const online = m ? parseInt(m[1], 10) : 0;
  const max    = m ? parseInt(m[2], 10) : maxPlayersCount;
  let names = [];
  const colonIdx = response.indexOf(':');
  if (colonIdx !== -1 && online > 0) {
    names = response.slice(colonIdx + 1).split(',').map(n => n.trim()).filter(n => n.length > 0);
  }
  return { online, max, names };
}

function colorCodeLogLine(line) {
  const lower = line.toLowerCase();
  let cls = 'info-line';
  if (lower.includes('warn'))                                    cls = 'warn-line';
  else if (lower.includes('error') || lower.includes('severe') || lower.includes('exception')) cls = 'error-line';
  else if (lower.includes('done') || lower.includes('started in')) cls = 'success-line';

  const div = document.createElement('div');
  div.className = `console-line ${cls}`;
  div.textContent = line;
  return div;
}

function appendToMiniConsole(line) {
  const atBottom = miniConsoleOutput.scrollHeight - miniConsoleOutput.clientHeight - miniConsoleOutput.scrollTop < 30;
  miniConsoleOutput.appendChild(colorCodeLogLine(line));
  while (miniConsoleOutput.children.length > 120) miniConsoleOutput.removeChild(miniConsoleOutput.firstChild);
  if (atBottom) miniConsoleOutput.scrollTop = miniConsoleOutput.scrollHeight;
}

function appendToFullConsole(line, autoScroll) {
  fullConsoleOutput.appendChild(colorCodeLogLine(line));
  if (autoScroll) fullConsoleOutput.scrollTop = fullConsoleOutput.scrollHeight;
}

function appendSystemLine(container, text) {
  const div = document.createElement('div');
  div.className = 'console-line system-line';
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ===========================================================================
// Live clock
// ===========================================================================
function updateClock() {
  const now = new Date();
  dashboardClock.textContent =
    `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ` +
    `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
}
setInterval(updateClock, 1000);
updateClock();

// ===========================================================================
// Navigation
// ===========================================================================
function switchPanel(id) {
  activePanel = id;
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.panel === id));
  panels.forEach(p  => p.classList.toggle('active', p.id === `${id}-panel`));

  if (id === 'console')  loadConsoleHistory();
  if (id === 'settings') loadSettings();
  if (id === 'servers') loadServerProfiles();
  if (id === 'players')  refreshPlayersPanel();
  if (id === 'setup') checkPrerequisites();
}

navBtns.forEach(b => b.addEventListener('click', () => switchPanel(b.dataset.panel)));
btnGoToConsole.addEventListener('click', () => switchPanel('console'));

// ===========================================================================
// Apply status to UI (centralised so nothing gets out of sync)
// ===========================================================================
function applyServerStatus(state, extras = {}) {
  serverStatus = state;

  const isOnline   = state === 'online';
  const isStarting = state === 'starting';
  const isOffline  = state === 'offline';

  // Sidebar dot
  serverSidebarDot.className = isOnline ? 'status-dot online' : isStarting ? 'status-dot warning' : 'status-dot offline';

  // Badge
  serverStatusBadge.className = `status-badge ${isOnline ? 'online' : isStarting ? 'warning' : 'offline'}`;
  serverStatusBadge.textContent = isOnline ? 'Online' : isStarting ? 'Starting...' : 'Offline';

  // Buttons
  btnStartServer.disabled   = isOnline || isStarting;
  btnStopServer.disabled    = isOffline || isStarting;
  btnRestartServer.disabled = isOffline;

  // Uptime ticker
  if (isOnline) {
    if (!uptimeTickId) {
      serverUptimeStart = extras.uptimeMs ? Date.now() - extras.uptimeMs : Date.now();
      uptimeTickId = setInterval(() => {
        serverUptimeVal.textContent = formatUptime(Date.now() - serverUptimeStart);
      }, 1000);
    }
  } else {
    if (uptimeTickId) { clearInterval(uptimeTickId); uptimeTickId = null; }
    serverUptimeVal.textContent = '00:00:00';
  }

  // RAM
  if (isOnline && extras.ram != null) {
    updateServerRam(extras.ram, extras.ramTotal);
  } else if (!isOnline) {
    updateServerRam(0, extras.ramTotal);
  }
}

function applyBotStatus(state, extras = {}) {
  botStatus = state;
  const isOnline = state === 'online';

  botSidebarDot.className  = isOnline ? 'status-dot online' : 'status-dot offline';
  botStatusBadge.className = `status-badge ${isOnline ? 'online' : 'offline'}`;
  botStatusBadge.textContent = isOnline ? 'Online' : 'Offline';

  btnStartBot.disabled = isOnline;
  btnStopBot.disabled  = !isOnline;

  if (isOnline && extras.ram != null) {
    botRamValue.textContent = `${extras.ram} MB`;
  } else if (!isOnline) {
    botRamValue.textContent = '0 MB';
  }
}

// ===========================================================================
// Poll status from main (every 3 s)
// ===========================================================================
async function pollStatus() {
  try {
    const s = await window.api.getStatus();

    applyServerStatus(s.server, { ram: s.serverRam, ramTotal: s.serverRamTotal, uptimeMs: s.serverUptime });
    applyBotStatus(s.bot, { ram: s.botRam });

    opsList = s.ops || [];
    updateLastCommand(s.lastCommand || 'None');

  } catch (e) {
    console.error('pollStatus error:', e);
  }
}

setInterval(pollStatus, 3000);
pollStatus(); // immediate first call

// ===========================================================================
// Push: status-change from main (fired right after spawn so no polling delay)
// ===========================================================================
window.api.onStatusChange(({ type, state }) => {
  if (type === 'server') applyServerStatus(state);
  if (type === 'bot')    applyBotStatus(state);
});

window.api.onRamUpdate(({ used, total }) => {
  updateServerRam(used, total);
});

window.api.onLastCommandUpdate(({ command }) => {
  updateLastCommand(command);
});

window.api.onBotRamUpdate(({ used }) => {
  botRamValue.textContent = `${used} MB`;
});

// ===========================================================================
// Push: spawn errors
// ===========================================================================
window.api.onSpawnError(({ source, message }) => {
  const text = `[ERROR] Failed to spawn ${source}: ${message}`;
  appendToMiniConsole(text);
  if (activePanel === 'console') appendSystemLine(fullConsoleOutput, text);

  // Re-enable the button so user can try again
  if (source === 'server') { btnStartServer.disabled = false; }
  if (source === 'bot')    { btnStartBot.disabled    = false; }
});

// ===========================================================================
// Process controls
// ===========================================================================
btnStartServer.addEventListener('click', async () => {
  btnStartServer.disabled = true;
  applyServerStatus('starting');
  appendSystemLine(miniConsoleOutput, '[System] Starting Minecraft server...');

  const res = await window.api.startServer();
  if (!res.success) {
    applyServerStatus('offline');
    appendSystemLine(miniConsoleOutput, `[Error] ${res.error}`);
    if (activePanel === 'console') appendSystemLine(fullConsoleOutput, `[Error] ${res.error}`);
  } else {
    appendSystemLine(miniConsoleOutput, `[System] Server process started (PID ${res.pid}). Waiting for RCON...`);
  }
});

btnStopServer.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to stop the Minecraft Server?')) return;
  btnStopServer.disabled    = true;
  btnRestartServer.disabled = true;
  appendSystemLine(miniConsoleOutput, '[System] Stopping server...');

  const res = await window.api.stopServer();
  if (!res.success) {
    appendSystemLine(miniConsoleOutput, `[Error] Stop failed: ${res.error}`);
  } else {
    appendSystemLine(miniConsoleOutput, '[System] Server stopped.');
    applyServerStatus('offline');
  }
});

btnRestartServer.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to restart the Minecraft Server?')) return;
  btnRestartServer.disabled = true;
  btnStopServer.disabled    = true;
  btnStartServer.disabled   = true;
  appendSystemLine(miniConsoleOutput, '[System] Restarting server...');

  const res = await window.api.restartServer();
  if (!res.success) {
    appendSystemLine(miniConsoleOutput, `[Error] Restart failed: ${res.error}`);
    applyServerStatus('offline');
  } else {
    applyServerStatus('starting');
    appendSystemLine(miniConsoleOutput, '[System] Server restarting. Waiting for RCON...');
  }
});

btnStartBot.addEventListener('click', async () => {
  btnStartBot.disabled = true;
  appendSystemLine(miniConsoleOutput, '[System] Starting Discord bot...');

  const res = await window.api.startBot();
  if (!res.success) {
    btnStartBot.disabled = false;
    appendSystemLine(miniConsoleOutput, `[Error] ${res.error}`);
  } else {
    applyBotStatus('online');
    appendSystemLine(miniConsoleOutput, `[System] Bot started (PID ${res.pid}).`);
  }
});

btnStopBot.addEventListener('click', async () => {
  btnStopBot.disabled = true;
  const res = await window.api.stopBot();
  if (!res.success) {
    btnStopBot.disabled = false;
    appendSystemLine(miniConsoleOutput, `[Error] ${res.error}`);
  } else {
    applyBotStatus('offline');
    appendSystemLine(miniConsoleOutput, '[System] Bot stopped.');
  }
});

// ===========================================================================
// Live stats (TPS + player list) — polled every 10 s via RCON
// ===========================================================================
async function fetchLiveStats() {
  if (serverStatus !== 'online') {
    widgetTpsVal.textContent    = '--.--';
    widgetTpsStatus.textContent = 'Server Offline';
    widgetTpsStatus.className   = 'tps-sub tps-offline';
    widgetPlayerCount.textContent = `0/${maxPlayersCount}`;
    widgetPlayerBar.style.width   = '0%';
    return;
  }

  // TPS via built-in tps command
  try {
    const r = await window.api.sendServerCommand('tps');
    if (r.success && r.response) {
      const clean = r.response.replace(/\u00a7[0-9a-fk-or]/gi, '');
      const parts = clean.split(':');
      let tps = null;
      if (parts.length > 1) {
        tps = parseFloat(parts[1].split(',')[0].trim());
      }
      if (tps != null && tps > 0 && tps <= 20) {
        widgetTpsVal.textContent = tps.toFixed(2);
        if (tps >= 19) {
          widgetTpsStatus.textContent = 'Healthy';
          widgetTpsStatus.className   = 'tps-sub tps-online';
        } else if (tps >= 15) {
          widgetTpsStatus.textContent = 'Lagging';
          widgetTpsStatus.className   = 'tps-sub tps-warning';
        } else {
          widgetTpsStatus.textContent = 'Critical';
          widgetTpsStatus.className   = 'tps-sub tps-offline';
        }
      } else {
        widgetTpsVal.textContent = '--.--';
        widgetTpsStatus.textContent = 'Error';
        widgetTpsStatus.className = 'tps-sub tps-offline';
      }
    } else {
      widgetTpsVal.textContent = '--.--';
      widgetTpsStatus.textContent = 'Error';
      widgetTpsStatus.className = 'tps-sub tps-offline';
    }
  } catch (e) {
    widgetTpsVal.textContent = '--.--';
    widgetTpsStatus.textContent = 'Error';
    widgetTpsStatus.className = 'tps-sub tps-offline';
  }

  // Player list
  try {
    const r = await window.api.sendServerCommand('list');
    if (r.success && r.response) {
      const parsed = parsePlayerList(r.response);
      onlinePlayersList = parsed.names;
      maxPlayersCount   = parsed.max;

      widgetPlayerCount.textContent = `${parsed.online}/${parsed.max}`;
      widgetPlayerBar.style.width   = `${Math.min(100, Math.round(parsed.online / parsed.max * 100))}%`;

      if (activePanel === 'players') renderPlayersGrid();
    }
  } catch (e) { /* ignore */ }
}

setInterval(fetchLiveStats, 10000);
setTimeout(fetchLiveStats, 5000);

// ===========================================================================
// Console — log streaming
// ===========================================================================
let autoScrollServer = true;
let autoScrollBot    = true;

fullConsoleOutput.addEventListener('scroll', () => {
  const atBottom = fullConsoleOutput.scrollHeight - fullConsoleOutput.clientHeight - fullConsoleOutput.scrollTop < 30;
  if (activeConsoleTab === 'server') autoScrollServer = atBottom;
  else                               autoScrollBot    = atBottom;
});

async function loadConsoleHistory() {
  fullConsoleOutput.innerHTML = '';
  try {
    const lines = await window.api.getConsoleHistory(activeConsoleTab);
    lines.forEach(l => appendToFullConsole(l, false));
    fullConsoleOutput.scrollTop = fullConsoleOutput.scrollHeight;
  } catch (e) {
    appendSystemLine(fullConsoleOutput, `[Error loading history] ${e.message}`);
  }
}

tabServerConsole.addEventListener('click', () => {
  activeConsoleTab = 'server';
  tabServerConsole.classList.add('active');
  tabBotConsole.classList.remove('active');
  loadConsoleHistory();
});

tabBotConsole.addEventListener('click', () => {
  activeConsoleTab = 'bot';
  tabBotConsole.classList.add('active');
  tabServerConsole.classList.remove('active');
  loadConsoleHistory();
});

// Server log push
window.api.onServerLog(line => {
  appendToMiniConsole(line);
  if (activePanel === 'console' && activeConsoleTab === 'server') {
    appendToFullConsole(line, autoScrollServer);
  }
});

// Bot log push
window.api.onBotLog(line => {
  const m = line.match(/Executed command:?\s*\/([\w\s]+)/i);
  if (m) {
    const cmdStr = `/${m[1].trim()}`;
    window.api.registerBotCommand(cmdStr);
    if (botLastCmdEl) botLastCmdEl.textContent = cmdStr;
  }

  if (activePanel === 'console' && activeConsoleTab === 'bot') {
    appendToFullConsole(line, autoScrollBot);
  }
});

// Send command
async function sendConsoleCommand() {
  const val = consoleInputField.value.trim();
  if (!val) return;
  consoleInputField.value = '';

  if (activeConsoleTab === 'bot') {
    appendSystemLine(fullConsoleOutput, '[Info] Cannot send stdin commands to the bot. Use Server Console for RCON.');
    return;
  }
  if (serverStatus !== 'online') {
    appendSystemLine(fullConsoleOutput, '[Info] Server is not online. Start it before sending commands.');
    return;
  }

  appendSystemLine(fullConsoleOutput, `> ${val}`);
  
  // Update UI and sync with main
  const displayCmd = val.startsWith('/') ? val : `/${val}`;
  if (botLastCmdEl) botLastCmdEl.textContent = displayCmd;
  window.api.registerBotCommand(displayCmd);

  const res = await window.api.sendServerCommand(val);
  const out = document.createElement('div');
  out.className = `console-line ${res.success ? 'success-line' : 'error-line'}`;
  out.textContent = res.success ? (res.response || '(no output)') : `Error: ${res.error}`;
  fullConsoleOutput.appendChild(out);
  fullConsoleOutput.scrollTop = fullConsoleOutput.scrollHeight;

  if (res.success) setTimeout(fetchLiveStats, 1000);
}

btnSendConsoleCmd.addEventListener('click', sendConsoleCommand);
consoleInputField.addEventListener('keydown', e => { if (e.key === 'Enter') sendConsoleCommand(); });

btnCopyConsole.addEventListener('click', async () => {
  const text = fullConsoleOutput.innerText || '';
  try {
    await navigator.clipboard.writeText(text);
    btnCopyConsole.textContent = 'COPIED';
    setTimeout(() => { btnCopyConsole.textContent = 'COPY'; }, 1500);
  } catch (e) {
    appendSystemLine(fullConsoleOutput, `[Error] Copy failed: ${e.message}`);
  }
});

// ===========================================================================
// Players panel
// ===========================================================================
function refreshPlayersPanel() {
  playersCountBadge.textContent = `${onlinePlayersList.length} Players Online`;
  if (onlinePlayersList.length === 0) {
    playersEmptyState.style.display = 'flex';
    playersListGrid.style.display   = 'none';
  } else {
    playersEmptyState.style.display = 'none';
    playersListGrid.style.display   = 'grid';
    renderPlayersGrid();
  }
}

function renderPlayersGrid() {
  playersCountBadge.textContent = `${onlinePlayersList.length} Players Online`;
  if (onlinePlayersList.length === 0) {
    playersEmptyState.style.display = 'flex';
    playersListGrid.style.display   = 'none';
    return;
  }
  playersEmptyState.style.display = 'none';
  playersListGrid.style.display   = 'grid';
  playersListGrid.innerHTML       = '';

  onlinePlayersList.forEach(name => {
    const isOp = opsList.includes(name.toLowerCase());
    const card  = document.createElement('div');
    card.className = 'player-card';

    const av = document.createElement('div');
    av.className   = 'player-avatar';
    av.textContent = name.charAt(0).toUpperCase();

    const info = document.createElement('div');
    info.className = 'player-info';

    const nameEl = document.createElement('span');
    nameEl.className   = 'player-name';
    nameEl.textContent = name;
    info.appendChild(nameEl);

    if (isOp) {
      const badge = document.createElement('span');
      badge.className   = 'badge badge-op';
      badge.textContent = 'OP';
      info.appendChild(badge);
    }

    const actions = document.createElement('div');
    actions.className = 'player-actions';

    const kickBtn = document.createElement('button');
    kickBtn.className   = 'btn btn-sm btn-danger';
    kickBtn.textContent = 'Kick';
    kickBtn.addEventListener('click', () => kickPlayer(name));

    const opBtn = document.createElement('button');
    opBtn.className   = 'btn btn-sm';
    opBtn.textContent = isOp ? 'Deop' : 'Op';
    opBtn.addEventListener('click', () => toggleOp(name, isOp));

    actions.append(kickBtn, opBtn);
    card.append(av, info, actions);
    playersListGrid.appendChild(card);
  });
}

async function kickPlayer(name) {
  if (!confirm(`Kick ${name}?`)) return;
  const res = await window.api.sendServerCommand(`kick ${name}`);
  if (res.success) {
    setTimeout(fetchLiveStats, 1000);
  } else {
    alert(`Failed: ${res.error}`);
  }
}

async function toggleOp(name, isOp) {
  const action = isOp ? 'deop' : 'op';
  if (!confirm(`${action.toUpperCase()} ${name}?`)) return;
  const res = await window.api.sendServerCommand(`${action} ${name}`);
  if (res.success) {
    if (isOp) opsList = opsList.filter(n => n !== name.toLowerCase());
    else      opsList.push(name.toLowerCase());
    renderPlayersGrid();
  } else {
    alert(`Failed: ${res.error}`);
  }
}

// ===========================================================================
// Settings
// ===========================================================================
async function loadSettings() {
  try {
    const cfg = await window.api.readSettings();
    setMaxPlayers.value   = cfg.maxPlayers        ?? 20;
    setViewDist.value     = cfg.viewDistance       ?? 10;
    setSimDist.value      = cfg.simulationDistance ?? 10;
    setMotd.value         = cfg.motd               ?? '';
    setRconPass.value     = cfg.rconPassword       ?? '';
    setDiscordToken.value = cfg.discordToken       ?? '';
    setMaxRam.value       = cfg.maxRam             ?? '4G';

    // App Behaviour toggles
    const ms = await window.api.readManagerSettings();
    setShowTerminal.checked    = !!ms.showTerminal;
    setCloseToTray.checked     = ms.closeToTray !== false; // default ON
    setAutoStartServer.checked = !!ms.autoStartServer;
    setAutoStartBot.checked    = !!ms.autoStartBot;
  } catch (e) {
    settingsStatusMessage.textContent = `Load error: ${e.message}`;
    settingsStatusMessage.className   = 'save-status-msg error';
  }
}

btnToggleTokenMask.addEventListener('click', () => {
  const isPass = setDiscordToken.type === 'password';
  setDiscordToken.type        = isPass ? 'text' : 'password';
  btnToggleTokenMask.textContent = isPass ? 'Hide' : 'Show';
});

settingsFormEl.addEventListener('submit', async e => {
  e.preventDefault();
  settingsStatusMessage.className   = 'save-status-msg';
  settingsStatusMessage.textContent = 'Saving...';

  const updates = {
    maxPlayers:        parseInt(setMaxPlayers.value, 10),
    viewDistance:      parseInt(setViewDist.value, 10),
    simulationDistance: parseInt(setSimDist.value, 10),
    motd:              setMotd.value,
    rconPassword:      setRconPass.value.trim(),
    discordToken:      setDiscordToken.value.trim(),
    maxRam:            setMaxRam.value.trim()
  };

  const managerUpdates = {
    showTerminal:    setShowTerminal.checked,
    closeToTray:     setCloseToTray.checked,
    autoStartServer: setAutoStartServer.checked,
    autoStartBot:    setAutoStartBot.checked
  };

  const [res] = await Promise.all([
    window.api.saveSettings(updates),
    window.api.saveManagerSettings(managerUpdates)
  ]);

  if (res.success) {
    settingsStatusMessage.textContent = 'Saved. Some changes apply on next launch.';
    settingsStatusMessage.className   = 'save-status-msg success';
  } else {
    settingsStatusMessage.textContent = `Save failed: ${res.error}`;
    settingsStatusMessage.className   = 'save-status-msg error';
  }
  setTimeout(() => { settingsStatusMessage.textContent = ''; }, 5000);
});

// ===========================================================================
// Danger zone
// ===========================================================================
btnDangerResetWhitelist.addEventListener('click', async () => {
  if (!confirm('RESET whitelist.json to []? This removes all whitelisted players.')) return;
  const res = await window.api.dangerResetWhitelist();
  alert(res.success ? res.message : `Error: ${res.error}`);
});

btnDangerOpenFolder.addEventListener('click', () => window.api.dangerOpenFolder());

btnDangerOpenLogs.addEventListener('click', async () => {
  const res = await window.api.dangerOpenLogs();
  if (!res.success) alert(res.error);
});


// ===========================================================================
// Server Profiles Management
// ===========================================================================

async function loadServerProfiles() {
  try {
    const result = await window.api.getServerProfiles();
    if (result.success) {
      serverProfiles = result.profiles;
      activeServerId = result.active;
      renderServerProfiles();
    }
  } catch (e) {
    console.error('Failed to load server profiles:', e);
    serverProfilesGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">\u26a0\ufe0f</div><h3>Error Loading Profiles</h3><p>' + e.message + '</p></div>';
  }
}

function renderServerProfiles() {
  if (Object.keys(serverProfiles).length === 0) {
    serversEmptyState.style.display = 'block';
    serverProfilesGrid.innerHTML = '';
    return;
  }

  serversEmptyState.style.display = 'none';
  serverProfilesGrid.innerHTML = '';

  for (const [id, profile] of Object.entries(serverProfiles)) {
    const card = document.createElement('div');
    card.className = 'server-profile-card' + (id === activeServerId ? ' active' : '');
    card.dataset.serverId = id;

    card.innerHTML = `
      <div class="server-profile-header">
        <h4 class="server-profile-name">${escapeHtml(profile.name || id)}</h4>
        <span class="server-profile-id">${escapeHtml(id)}</span>
      </div>
      <div class="server-profile-meta">
        <span>\ud83d\udcc1 ${escapeHtml(profile.rootPath || '../server')}</span>
        <span>\ud83d\udcbe ${escapeHtml(profile.maxRam || '4G')}</span>
        ${profile.notes ? '<span>\ud83d\udcdd ' + escapeHtml(profile.notes) + '</span>' : ''}
      </div>
      <div class="server-profile-actions">
        <button class="btn btn-sm ${id === activeServerId ? 'btn-primary' : ''}" onclick="setActiveServer('${id}')">
          ${id === activeServerId ? 'Active' : 'Activate'}
        </button>
        <button class="btn btn-sm btn-danger" onclick="removeServerProfile('${id}')">Remove</button>
      </div>
    `;

    serverProfilesGrid.appendChild(card);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function setActiveServer(serverId) {
  if (serverId === activeServerId) return;
  
  try {
    const result = await window.api.setActiveServer(serverId);
    if (result.success) {
      activeServerId = serverId;
      renderServerProfiles();
      // Reload status to reflect the new server
      pollStatus();
    }
  } catch (e) {
    console.error('Failed to set active server:', e);
  }
}

async function removeServerProfile(serverId) {
  if (!confirm('Are you sure you want to remove server profile: ' + serverId + '?')) return;
  
  try {
    const result = await window.api.removeServerProfile(serverId);
    if (result.success) {
      delete serverProfiles[serverId];
      if (activeServerId === serverId) {
        activeServerId = Object.keys(serverProfiles)[0] || 'default';
      }
      renderServerProfiles();
    } else {
      alert('Error: ' + result.error);
    }
  } catch (e) {
    console.error('Failed to remove server profile:', e);
  }
}

// Modal handlers
btnAddServer.addEventListener('click', () => {
  addServerModal.classList.add('active');
  newServerId.value = '';
  newServerName.value = '';
  newServerPath.value = '../server';
  newServerBotdir.value = '../mc-bot';
  newServerMaxram.value = '4G';
  newServerNotes.value = '';
});

btnCloseAddServer.addEventListener('click', () => addServerModal.classList.remove('active'));
btnCancelAddServer.addEventListener('click', () => addServerModal.classList.remove('active'));

btnConfirmAddServer.addEventListener('click', async () => {
  const profile = {
    id: newServerId.value.trim() || Date.now().toString(),
    name: newServerName.value.trim() || newServerId.value.trim(),
    rootPath: newServerPath.value.trim(),
    botDir: newServerBotdir.value.trim(),
    maxRam: newServerMaxram.value.trim(),
    notes: newServerNotes.value.trim()
  };

  if (!profile.id) {
    alert('Please enter a profile ID');
    return;
  }

  try {
    const result = await window.api.addServerProfile(profile);
    if (result.success) {
      addServerModal.classList.remove('active');
      loadServerProfiles();
    } else {
      alert('Error: ' + result.error);
    }
  } catch (e) {
    console.error('Failed to add server profile:', e);
    alert('Failed to add server profile: ' + e.message);
  }
});

// Close modal on escape key
addServerModal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') addServerModal.classList.remove('active');
});

// Close modal when clicking outside
document.getElementById('add-server-modal').addEventListener('click', (e) => {
  if (e.target.id === 'add-server-modal') {
    addServerModal.classList.remove('active');
  }
});

// ===========================================================================
// Setup Panel Functions
// ===========================================================================

async function checkPrerequisites() {
  if (prerequisitesChecked) {
    renderPrerequisites();
    return;
  }

  setupStatus.textContent = 'Checking prerequisites...';
  setupStatus.className = 'setup-status checking';
  setupProgress.style.width = '20%';

  try {
    const result = await window.api.checkPrerequisites();
    prerequisitesStatus = result.checks || {};
    prerequisitesChecked = true;
    renderPrerequisites();
    setupProgress.style.width = '100%';
    setupStatus.textContent = 'Prerequisites check complete!';
    setupStatus.className = 'setup-status success';
  } catch (e) {
    setupStatus.textContent = 'Error checking prerequisites: ' + e.message;
    setupStatus.className = 'setup-status error';
    console.error('Prerequisites check failed:', e);
  }
}

function renderPrerequisites() {
  if (!prereqsList) return;

  prereqsList.innerHTML = '';

  const checks = [
    { name: 'Node.js', key: 'node', icon: '\ud83d\udcbb', description: 'Required for running the manager and bot' },
    { name: 'Java 25+', key: 'java', icon: '\u2615', description: 'Required for running Minecraft server' },
    { name: 'server.jar', key: 'serverJar', icon: '\ud83c\udfae', description: 'PaperMC server JAR file' },
    { name: 'npm dependencies', key: 'dependencies', icon: '\ud83c\udf10', description: 'Node.js packages for manager and bot' }
  ];

  checks.forEach(check => {
    const item = document.createElement('div');
    item.className = 'prereq-item';
    
    const status = prerequisitesStatus[check.key];
    const statusIcon = status ? '\u2705' : '\u274c';
    const statusText = status ? 'Installed' : 'Not found';
    const statusClass = status ? 'prereq-ready' : 'prereq-missing';

    item.innerHTML = `
      <div class="prereq-icon">${check.icon}</div>
      <div class="prereq-info">
        <span class="prereq-name">${check.name}</span>
        <span class="prereq-desc">${check.description}</span>
      </div>
      <div class="prereq-status ${statusClass}">
        <span>${statusIcon}</span>
        <span>${statusText}</span>
      </div>
    `;

    prereqsList.appendChild(item);
  });

  // Check if all prerequisites are met
  const allReady = Object.values(prerequisitesStatus).every(v => v === true);
  if (btnRunSetup) {
    btnRunSetup.disabled = allReady;
    btnRunSetup.textContent = allReady ? 'All Ready!' : 'Run Auto-Setup';
  }
}

async function runAutoSetup() {
  if (setupInProgress) return;

  setupInProgress = true;
  setupSteps = [];
  setupStepsList.innerHTML = '';
  setupStatus.textContent = 'Starting auto-setup...';
  setupStatus.className = 'setup-status checking';
  setupProgress.style.width = '0%';

  try {
    const result = await window.api.runAutoSetup();
    setupSteps = result.steps || [];
    
    // Render steps
    result.steps.forEach((step, index) => {
      const item = document.createElement('div');
      item.className = 'setup-step';
      const isError = step.startsWith('ERROR:') || step.includes('failed');
      const isSuccess = step.includes('created') || step.includes('downloaded') || step.includes('installed');
      const icon = isError ? '\u274c' : isSuccess ? '\u2705' : '\u2192';
      const className = isError ? 'step-error' : isSuccess ? 'step-success' : 'step-info';
      
      item.innerHTML = `<span class="step-icon">${icon}</span><span class="step-text">${step}</span>`;
      item.className = `setup-step ${className}`;
      setupStepsList.appendChild(item);
    });

    // Update progress
    const progress = Math.min(100, (result.steps.filter(s => !s.includes('ERROR')).length / result.steps.length) * 100);
    setupProgress.style.width = `${progress}%`;

    if (progress >= 100 || result.steps.every(s => !s.startsWith('ERROR:'))) {
      setupStatus.textContent = 'Auto-setup complete! You can now start the server.';
      setupStatus.className = 'setup-status success';
      
      // Check prerequisites again
      setTimeout(() => {
        prerequisitesChecked = false;
        checkPrerequisites();
      }, 2000);
    } else {
      setupStatus.textContent = 'Auto-setup completed with some errors. Check the list above.';
      setupStatus.className = 'setup-status warning';
    }

  } catch (e) {
    setupStatus.textContent = 'Auto-setup failed: ' + e.message;
    setupStatus.className = 'setup-status error';
    console.error('Auto-setup failed:', e);
  } finally {
    setupInProgress = false;
  }
}

// Setup button handlers
if (btnRunSetup) {
  btnRunSetup.addEventListener('click', runAutoSetup);
}
if (btnCheckPrereqs) {
  btnCheckPrereqs.addEventListener('click', checkPrerequisites);
}

// ===========================================================================
// Quick Start Panel - One-Click Start
// ===========================================================================

async function oneClickStart() {
  if (setupInProgress) return;
  setupInProgress = true;

  try {
    // First check prerequisites
    appendSystemLine(miniConsoleOutput, '[One-Click] Checking prerequisites...');
    const prereqs = await window.api.checkPrerequisites();
    
    // If server.jar is missing, run auto-setup
    if (!prereqs.checks.serverJar) {
      appendSystemLine(miniConsoleOutput, '[One-Click] Server JAR missing - running auto-setup...');
      const setupResult = await window.api.runAutoSetup();
      setupResult.steps.forEach(step => appendSystemLine(miniConsoleOutput, `[One-Click] ${step}`));
    }

    // Start the server
    appendSystemLine(miniConsoleOutput, '[One-Click] Starting Minecraft server...');
    const serverResult = await window.api.startServer();
    
    if (serverResult.success) {
      appendSystemLine(miniConsoleOutput, `[One-Click] Server started successfully (PID ${serverResult.pid})`);
      applyServerStatus('starting');
      
      // Wait a bit then start the bot
      setTimeout(async () => {
        appendSystemLine(miniConsoleOutput, '[One-Click] Starting Discord bot...');
        const botResult = await window.api.startBot();
        if (botResult.success) {
          appendSystemLine(miniConsoleOutput, `[One-Click] Bot started successfully (PID ${botResult.pid})`);
          applyBotStatus('online');
          appendSystemLine(miniConsoleOutput, '[One-Click] Everything is ready!');
        } else {
          appendSystemLine(miniConsoleOutput, `[One-Click] Bot failed to start: ${botResult.error}`);
        }
      }, 5000);
    } else {
      appendSystemLine(miniConsoleOutput, `[One-Click] Server failed to start: ${serverResult.error}`);
      applyServerStatus('offline');
    }

  } catch (e) {
    appendSystemLine(miniConsoleOutput, `[One-Click] Error: ${e.message}`);
    console.error('One-click start failed:', e);
  } finally {
    setupInProgress = false;
  }
}

if (btnOneClickStart) {
  btnOneClickStart.addEventListener('click', () => {
    if (confirm('This will automatically check everything and start the server and bot. Continue?')) {
      oneClickStart();
    }
  });
}

// ===========================================================================
// Auto-check on first load
// ===========================================================================
// Check if this is first run and show setup panel
setTimeout(async () => {
  try {
    const status = await window.api.getStatus();
    // If server is offline and no setup has been done, show setup panel
    if (status.server === 'offline' && !status.serverPid) {
      // Check if server directory exists
      // For now, just ensure dashboard is active
      switchPanel('dashboard');
    }
  } catch (e) {
    console.log('First run check failed, staying on dashboard');
  }
}, 1000);

// ===========================================================================
// NETWORKING PANEL
// ===========================================================================

// Networking state
let networkingStatus = null;
let currentNetworkingMethod = 'zerotier';
let manualAddress = { address: '', notes: '' };

// DOM References for Networking
const networkingPanel = document.getElementById('networking-panel');
const methodTabs = document.querySelectorAll('.method-tab');
const methodPanels = document.querySelectorAll('.networking-method-panel');
const serverMethodSelect = document.getElementById('server-method-select');
const serverConnectionsGrid = document.getElementById('server-connections-grid');
const connectionsEmptyState = document.getElementById('connections-empty-state');

// ZeroTier elements
const ztStatusBadge = document.getElementById('zt-status-badge');
const ztStatus = document.getElementById('zt-status');
const ztAddress = document.getElementById('zt-address');
const btnCopyZt = document.getElementById('btn-copy-zt');
const btnInstallZerotier = document.getElementById('btn-install-zerotier');
const btnJoinZerotier = document.getElementById('btn-join-zerotier');
const btnRefreshZerotier = document.getElementById('btn-refresh-zerotier');
const ztNetworks = document.getElementById('zt-networks');
const ztNetworksList = document.getElementById('zt-networks-list');
const ztNetworkId = document.getElementById('zt-network-id');
const btnJoinZtNetwork = document.getElementById('btn-join-zt-network');

// Tailscale elements
const tsStatusBadge = document.getElementById('ts-status-badge');
const tsStatus = document.getElementById('ts-status');
const tsAddress = document.getElementById('ts-address');
const btnCopyTs = document.getElementById('btn-copy-ts');
const btnInstallTailscale = document.getElementById('btn-install-tailscale');
const btnStartTailscale = document.getElementById('btn-start-tailscale');
const btnStopTailscale = document.getElementById('btn-stop-tailscale');
const btnRefreshTailscale = document.getElementById('btn-refresh-tailscale');

// LAN elements
const lanStatusBadge = document.getElementById('lan-status-badge');
const lanAddressesList = document.getElementById('lan-addresses-list');

// Port Forwarding elements
const pfStatusBadge = document.getElementById('pf-status-badge');
const pfPublicIp = document.getElementById('pf-public-ip');
const pfAddress = document.getElementById('pf-address');
const btnCopyPfIp = document.getElementById('btn-copy-pf-ip');
const btnCopyPf = document.getElementById('btn-copy-pf');
const pfExternalPort = document.getElementById('pf-external-port');
const pfInternalPort = document.getElementById('pf-internal-port');
const pfLocalStatus = document.getElementById('pf-local-status');
const btnRefreshPf = document.getElementById('btn-refresh-pf');
const pfExternalDisplay = document.getElementById('pf-external-display');
const pfInternalDisplay = document.getElementById('pf-internal-display');
const pfLocalIp = document.getElementById('pf-local-ip');

// Playit.gg elements
const pgStatusBadge = document.getElementById('pg-status-badge');
const pgStatus = document.getElementById('pg-status');
const pgAddress = document.getElementById('pg-address');
const btnCopyPg = document.getElementById('btn-copy-pg');
const btnInstallPlayit = document.getElementById('btn-install-playit');
const btnStartPlayit = document.getElementById('btn-start-playit');
const btnRefreshPlayit = document.getElementById('btn-refresh-playit');

// Manual elements
const manualStatusBadge = document.getElementById('manual-status-badge');
const manualAddressInput = document.getElementById('manual-address');
const manualNotesInput = document.getElementById('manual-notes');
const btnSaveManual = document.getElementById('btn-save-manual');
const manualSavedAddress = document.getElementById('manual-saved-address');
const btnCopyManual = document.getElementById('btn-copy-manual');

// ===========================================================================
// Navigation - Add networking panel handler
// ===========================================================================

// Update the switchPanel function to handle networking
function switchPanel(id) {
  activePanel = id;
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.panel === id));
  panels.forEach(p  => p.classList.toggle('active', p.id === `${id}-panel`));

  if (id === 'console')  loadConsoleHistory();
  if (id === 'settings') loadSettings();
  if (id === 'servers') loadServerProfiles();
  if (id === 'players')  refreshPlayersPanel();
  if (id === 'setup') checkPrerequisites();
  if (id === 'networking') loadNetworkingPanel();
}

// ===========================================================================
// Networking Panel Functions
// ===========================================================================

async function loadNetworkingPanel() {
  // Load all networking status
  await refreshAllNetworkingStatus();
  
  // Load manual address
  loadManualAddress();
  
  // Load server connections
  renderServerConnections();
  
  // Setup event listeners
  setupNetworkingListeners();
}

async function refreshAllNetworkingStatus() {
  try {
    const status = await window.api.getAllNetworkingStatus();
    networkingStatus = status;
    currentNetworkingMethod = status.selectedMethod || 'zerotier';
    
    // Update all method statuses
    updateZeroTierStatus(status.zerotier);
    updateTailscaleStatus(status.tailscale);
    updateLanStatus(status.lan);
    updatePortForwardingStatus(status.portForwarding);
    updatePlayitStatus(status.playitgg);
    updateManualStatus(status.manual);
    
    // Select the current method tab
    selectMethodTab(currentNetworkingMethod);
    
  } catch (e) {
    console.error('Failed to load networking status:', e);
  }
}

function selectMethodTab(method) {
  methodTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.method === method);
  });
  methodPanels.forEach(panel => {
    panel.classList.toggle('active', panel.id === `${method}-panel`);
  });
  
  // Update server connections with new method
  renderServerConnections();
}

// ===========================================================================
// ZeroTier Functions
// ===========================================================================

function updateZeroTierStatus(info) {
  const installed = info.installed || false;
  const running = info.running || false;
  const address = info.address || '';
  const networks = info.networks || [];
  
  // Update badge
  if (installed && running && address) {
    ztStatusBadge.textContent = 'Online';
    ztStatusBadge.className = 'method-status';
    ztStatus.className = 'status-badge online';
    ztStatus.textContent = 'Connected';
  } else if (installed && running) {
    ztStatusBadge.textContent = 'Running';
    ztStatusBadge.className = 'method-status';
    ztStatus.className = 'status-badge online';
    ztStatus.textContent = 'Running';
  } else if (installed) {
    ztStatusBadge.textContent = 'Installed';
    ztStatusBadge.className = 'method-status';
    ztStatus.className = 'status-badge offline';
    ztStatus.textContent = 'Not Running';
  } else {
    ztStatusBadge.textContent = 'Not Installed';
    ztStatusBadge.className = 'method-status';
    ztStatus.className = 'status-badge offline';
    ztStatus.textContent = 'Not Installed';
  }
  
  ztAddress.textContent = address || '-';
  
  // Show/hide copy button
  if (address) {
    btnCopyZt.style.display = 'inline-block';
  } else {
    btnCopyZt.style.display = 'none';
  }
  
  // Show/hide install button
  btnInstallZerotier.style.display = !installed ? 'inline-block' : 'none';
  btnJoinZerotier.style.display = installed && running && address ? 'inline-block' : 'none';
  
  // Show networks section if connected
  if (installed && running && networks.length > 0) {
    ztNetworks.style.display = 'block';
    renderZeroTierNetworks(networks);
  } else {
    ztNetworks.style.display = 'none';
  }
}

function renderZeroTierNetworks(networks) {
  ztNetworksList.innerHTML = '';
  
  networks.forEach(net => {
    const card = document.createElement('div');
    card.className = 'zt-network-card';
    card.innerHTML = `
      <span class="net-id">${net.id}</span>
      <span class="net-name">${net.name || 'Unnamed'}</span>
      <span class="net-status ${net.status === 'OK' ? 'online' : 'offline'}">${net.status}</span>
    `;
    ztNetworksList.appendChild(card);
  });
}

// ===========================================================================
// Tailscale Functions
// ===========================================================================

function updateTailscaleStatus(info) {
  const installed = info.installed || false;
  const running = info.running || false;
  const address = info.address || '';
  const status = info.status || 'unknown';
  
  // Update badge
  if (installed && running && address) {
    tsStatusBadge.textContent = 'Online';
    tsStatusBadge.className = 'method-status';
    tsStatus.className = 'status-badge online';
    tsStatus.textContent = 'Connected';
  } else if (installed && running) {
    tsStatusBadge.textContent = 'Running';
    tsStatusBadge.className = 'method-status';
    tsStatus.className = 'status-badge online';
    tsStatus.textContent = 'Running';
  } else if (installed) {
    tsStatusBadge.textContent = 'Installed';
    tsStatusBadge.className = 'method-status';
    tsStatus.className = 'status-badge offline';
    tsStatus.textContent = 'Not Running';
  } else {
    tsStatusBadge.textContent = 'Not Installed';
    tsStatusBadge.className = 'method-status';
    tsStatus.className = 'status-badge offline';
    tsStatus.textContent = 'Not Installed';
  }
  
  tsAddress.textContent = address || '-';
  
  // Show/hide copy button
  btnCopyTs.style.display = address ? 'inline-block' : 'none';
  
  // Show/hide buttons
  btnInstallTailscale.style.display = !installed ? 'inline-block' : 'none';
  btnStartTailscale.style.display = installed && !running ? 'inline-block' : 'none';
  btnStopTailscale.style.display = installed && running ? 'inline-block' : 'none';
}

// ===========================================================================
// LAN Functions
// ===========================================================================

function updateLanStatus(info) {
  const addresses = info.addresses || [];
  
  if (addresses.length > 0) {
    lanStatusBadge.textContent = 'Active';
    lanStatusBadge.className = 'method-status';
    renderLanAddresses(addresses);
  } else {
    lanStatusBadge.textContent = 'No IPs';
    lanStatusBadge.className = 'method-status';
    lanAddressesList.innerHTML = '<span style="color: var(--text-muted);">No local IP addresses detected</span>';
  }
}

function renderLanAddresses(addresses) {
  lanAddressesList.innerHTML = '';
  
  addresses.forEach(ip => {
    const item = document.createElement('div');
    item.className = 'lan-address-item';
    item.innerHTML = `
      ${ip.address}
      <span class="lan-interface">(${ip.interface})</span>
    `;
    lanAddressesList.appendChild(item);
  });
}

// ===========================================================================
// Port Forwarding Functions
// ===========================================================================

function updatePortForwardingStatus(info) {
  const publicIP = info.publicIP || '';
  const address = info.address || '';
  const localOpen = info.localPortOpen || false;
  const externalPort = info.externalPort || 25565;
  const internalPort = info.internalPort || 25565;
  
  pfPublicIp.textContent = publicIP || 'Detecting...';
  pfAddress.textContent = address || '-';
  
  // Update displays
  pfExternalDisplay.textContent = externalPort;
  pfInternalDisplay.textContent = internalPort;
  
  // Update local IP
  const localIPs = networkingStatus?.lan?.addresses || [];
  if (localIPs.length > 0) {
    pfLocalIp.textContent = localIPs[0].address;
  }
  
  // Status
  if (localOpen) {
    pfLocalStatus.className = 'status-badge online';
    pfLocalStatus.textContent = 'Port Open';
  } else {
    pfLocalStatus.className = 'status-badge offline';
    pfLocalStatus.textContent = 'Port Closed';
  }
  
  // Show/hide copy buttons
  btnCopyPfIp.style.display = publicIP ? 'inline-block' : 'none';
  btnCopyPf.style.display = address ? 'inline-block' : 'none';
  
  pfStatusBadge.textContent = publicIP ? 'Configured' : 'Detecting...';
}

// ===========================================================================
// Playit.gg Functions
// ===========================================================================

function updatePlayitStatus(info) {
  const installed = info.installed || false;
  const running = info.running || false;
  const address = info.address || '';
  const status = info.status || 'unknown';
  
  // Update badge
  if (installed && running && address) {
    pgStatusBadge.textContent = 'Online';
    pgStatusBadge.className = 'method-status';
    pgStatus.className = 'status-badge online';
    pgStatus.textContent = 'Connected';
  } else if (installed && running) {
    pgStatusBadge.textContent = 'Running';
    pgStatusBadge.className = 'method-status';
    pgStatus.className = 'status-badge online';
    pgStatus.textContent = 'Running';
  } else if (installed) {
    pgStatusBadge.textContent = 'Installed';
    pgStatusBadge.className = 'method-status';
    pgStatus.className = 'status-badge offline';
    pgStatus.textContent = 'Not Running';
  } else {
    pgStatusBadge.textContent = 'Not Installed';
    pgStatusBadge.className = 'method-status';
    pgStatus.className = 'status-badge offline';
    pgStatus.textContent = 'Not Installed';
  }
  
  pgAddress.textContent = address || '-';
  
  // Show/hide copy button
  btnCopyPg.style.display = address ? 'inline-block' : 'none';
  
  // Show/hide buttons
  btnInstallPlayit.style.display = !installed ? 'inline-block' : 'none';
  btnStartPlayit.style.display = installed && !running ? 'inline-block' : 'none';
}

// ===========================================================================
// Manual Functions
// ===========================================================================

function updateManualStatus(info) {
  const address = info.address || '';
  
  if (address) {
    manualStatusBadge.textContent = 'Configured';
    manualStatusBadge.className = 'method-status';
  } else {
    manualStatusBadge.textContent = 'Not Configured';
    manualStatusBadge.className = 'method-status';
  }
}

async function loadManualAddress() {
  try {
    const manual = await window.api.getManualAddress();
    manualAddress = manual;
    manualAddressInput.value = manual.address || '';
    manualNotesInput.value = manual.notes || '';
    manualSavedAddress.textContent = manual.address || '-';
    
    // Show/hide copy button
    btnCopyManual.style.display = manual.address ? 'inline-block' : 'none';
    
    updateManualStatus(manual);
  } catch (e) {
    console.error('Failed to load manual address:', e);
  }
}

async function saveManualAddress() {
  const address = manualAddressInput.value.trim();
  const notes = manualNotesInput.value.trim();
  
  try {
    const result = await window.api.saveManualAddress(address, notes);
    if (result.success) {
      manualAddress = { address, notes };
      manualSavedAddress.textContent = address || '-';
      btnCopyManual.style.display = address ? 'inline-block' : 'none';
      updateManualStatus({ address, notes });
      
      // Refresh server connections
      renderServerConnections();
      
      alert('Manual address saved successfully!');
    } else {
      alert('Failed to save: ' + result.error);
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ===========================================================================
// Server Connections Functions
// ===========================================================================

async function renderServerConnections() {
  try {
    const result = await window.api.getServerProfiles();
    if (!result.success || Object.keys(result.profiles).length === 0) {
      serverConnectionsGrid.style.display = 'none';
      connectionsEmptyState.style.display = 'block';
      return;
    }
    
    connectionsEmptyState.style.display = 'none';
    serverConnectionsGrid.style.display = 'grid';
    serverConnectionsGrid.innerHTML = '';
    
    const selectedMethod = serverMethodSelect.value || 'zerotier';
    const allStatus = await window.api.getAllServersStatus();
    
    for (const [serverId, profile] of Object.entries(result.profiles)) {
      const serverStatus = allStatus.servers?.[serverId] || {};
      const serverPort = profile.serverPort || 25565;
      
      // Get connection address for this server using the selected method
      const addressResult = await window.api.getServerConnectionAddress(
        serverId, 
        serverPort, 
        selectedMethod
      );
      
      const card = document.createElement('div');
      card.className = 'server-connection-card';
      
      const statusText = serverStatus.state === 'online' ? 'Online' : 
                        serverStatus.state === 'starting' ? 'Starting...' : 'Offline';
      const statusClass = serverStatus.state === 'online' ? 'online' : 
                         serverStatus.state === 'starting' ? 'warning' : 'offline';
      
      card.innerHTML = `
        <div class="server-conn-header">
          <span class="server-conn-name">${escapeHtml(profile.name || serverId)}</span>
          <span class="server-conn-status">
            <span class="status-dot ${statusClass}"></span>
            ${statusText}
          </span>
        </div>
        <div class="server-conn-address">${addressResult.address || 'N/A'}</div>
        <div class="server-conn-actions">
          <button class="btn btn-sm flat-btn btn-copy-server" data-server-id="${serverId}" data-address="${addressResult.address || ''}">Copy</button>
        </div>
      `;
      
      serverConnectionsGrid.appendChild(card);
    }
    
    // Setup copy button listeners
    document.querySelectorAll('.btn-copy-server').forEach(btn => {
      btn.addEventListener('click', () => {
        const address = btn.dataset.address;
        if (address) {
          navigator.clipboard.writeText(address).then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
          });
        }
      });
    });
    
  } catch (e) {
    console.error('Failed to render server connections:', e);
    serverConnectionsGrid.innerHTML = '<div class="empty-state"><div class="empty-icon">\u26a0\ufe0f</div><h3>Error Loading Connections</h3><p>' + e.message + '</p></div>';
  }
}

// ===========================================================================
// Event Listeners Setup
// ===========================================================================

function setupNetworkingListeners() {
  // Method tab switching
  methodTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      selectMethodTab(tab.dataset.method);
      currentNetworkingMethod = tab.dataset.method;
      window.api.selectNetworkingMethod(tab.dataset.method);
    });
  });
  
  // Server method selector
  if (serverMethodSelect) {
    serverMethodSelect.addEventListener('change', () => {
      renderServerConnections();
    });
  }
  
  // Copy buttons
  setupCopyButton(btnCopyZt, ztAddress);
  setupCopyButton(btnCopyTs, tsAddress);
  setupCopyButton(btnCopyPfIp, pfPublicIp);
  setupCopyButton(btnCopyPf, pfAddress);
  setupCopyButton(btnCopyPg, pgAddress);
  setupCopyButton(btnCopyManual, manualSavedAddress);
  
  // ZeroTier buttons
  if (btnInstallZerotier) {
    btnInstallZerotier.addEventListener('click', async () => {
      if (confirm('Install ZeroTier? This will download and install ZeroTier One on your computer.')) {
        const result = await window.api.installZeroTier();
        if (result.success) {
          alert('ZeroTier installed successfully! Please wait a moment for the service to start.');
          setTimeout(() => refreshAllNetworkingStatus(), 5000);
        } else {
          alert('Failed to install ZeroTier: ' + result.error);
        }
      }
    });
  }
  
  if (btnRefreshZerotier) {
    btnRefreshZerotier.addEventListener('click', async () => {
      await refreshAllNetworkingStatus();
    });
  }
  
  if (btnJoinZtNetwork) {
    btnJoinZtNetwork.addEventListener('click', async () => {
      const networkId = ztNetworkId.value.trim();
      if (!networkId) {
        alert('Please enter a network ID');
        return;
      }
      
      const result = await window.api.joinZeroTierNetwork(networkId);
      if (result.success) {
        alert('Successfully joined ZeroTier network! The connection may take a moment to establish.');
        setTimeout(() => refreshAllNetworkingStatus(), 3000);
      } else {
        alert('Failed to join network: ' + result.error);
      }
    });
  }
  
  // Tailscale buttons
  if (btnInstallTailscale) {
    btnInstallTailscale.addEventListener('click', async () => {
      if (confirm('Install Tailscale? This will download and install Tailscale on your computer.')) {
        const result = await window.api.installTailscale();
        if (result.success) {
          alert(result.message);
          setTimeout(() => refreshAllNetworkingStatus(), 5000);
        } else {
          alert('Failed to install Tailscale: ' + result.error);
        }
      }
    });
  }
  
  if (btnStartTailscale) {
    btnStartTailscale.addEventListener('click', async () => {
      const result = await window.api.startTailscale();
      if (result.success) {
        alert(result.message);
        setTimeout(() => refreshAllNetworkingStatus(), 3000);
      } else {
        alert('Failed to start Tailscale: ' + result.error);
      }
    });
  }
  
  if (btnStopTailscale) {
    btnStopTailscale.addEventListener('click', async () => {
      if (confirm('Stop Tailscale? Players currently connected via Tailscale will be disconnected.')) {
        const result = await window.api.stopTailscale();
        if (result.success) {
          alert(result.message);
          setTimeout(() => refreshAllNetworkingStatus(), 3000);
        } else {
          alert('Failed to stop Tailscale: ' + result.error);
        }
      }
    });
  }
  
  if (btnRefreshTailscale) {
    btnRefreshTailscale.addEventListener('click', async () => {
      await refreshAllNetworkingStatus();
    });
  }
  
  // Port Forwarding buttons
  if (btnRefreshPf) {
    btnRefreshPf.addEventListener('click', async () => {
      const externalPort = parseInt(pfExternalPort.value) || 25565;
      const internalPort = parseInt(pfInternalPort.value) || 25565;
      const info = await window.api.getPortForwardingInfo(externalPort, internalPort);
      updatePortForwardingStatus(info);
    });
  }
  
  // Port inputs - update on change
  if (pfExternalPort) {
    pfExternalPort.addEventListener('change', () => {
      pfExternalDisplay.textContent = pfExternalPort.value;
    });
  }
  
  if (pfInternalPort) {
    pfInternalPort.addEventListener('change', () => {
      pfInternalDisplay.textContent = pfInternalPort.value;
    });
  }
  
  // Playit.gg buttons
  if (btnInstallPlayit) {
    btnInstallPlayit.addEventListener('click', async () => {
      const result = await window.api.installPlayit();
      if (result.success) {
        alert(result.message);
      } else {
        alert(result.error);
      }
    });
  }
  
  if (btnStartPlayit) {
    btnStartPlayit.addEventListener('click', async () => {
      const result = await window.api.startPlayit();
      if (result.success) {
        alert(result.message);
      } else {
        alert('Failed to start Playit.gg: ' + result.error);
      }
    });
  }
  
  if (btnRefreshPlayit) {
    btnRefreshPlayit.addEventListener('click', async () => {
      await refreshAllNetworkingStatus();
    });
  }
  
  // Manual buttons
  if (btnSaveManual) {
    btnSaveManual.addEventListener('click', saveManualAddress);
  }
}

function setupCopyButton(btn, element) {
  if (btn && element) {
    btn.addEventListener('click', () => {
      const text = element.textContent;
      if (text && text !== '-') {
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        });
      }
    });
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
