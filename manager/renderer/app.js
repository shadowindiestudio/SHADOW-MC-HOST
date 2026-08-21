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

/** Parse allocated RAM string "10G" or "10240M" → number of MB */
function ramToMB(str) {
  if (!str) return 10240;
  const m = String(str).match(/^(\d+)([GgMm])$/);
  if (!m) return 10240;
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
  if (id === 'players')  refreshPlayersPanel();
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
  serverStatusBadge.textContent = isOnline ? 'Online' : isStarting ? 'Starting…' : 'Offline';

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
  appendSystemLine(miniConsoleOutput, '[System] Starting Minecraft server…');

  const res = await window.api.startServer();
  if (!res.success) {
    applyServerStatus('offline');
    appendSystemLine(miniConsoleOutput, `[Error] ${res.error}`);
    if (activePanel === 'console') appendSystemLine(fullConsoleOutput, `[Error] ${res.error}`);
  } else {
    appendSystemLine(miniConsoleOutput, `[System] Server process started (PID ${res.pid}). Waiting for RCON…`);
  }
  // Status will settle via polling or status-change push
});

btnStopServer.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to stop the Minecraft Server?')) return;
  btnStopServer.disabled    = true;
  btnRestartServer.disabled = true;
  appendSystemLine(miniConsoleOutput, '[System] Stopping server…');

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
  appendSystemLine(miniConsoleOutput, '[System] Restarting server…');

  const res = await window.api.restartServer();
  if (!res.success) {
    appendSystemLine(miniConsoleOutput, `[Error] Restart failed: ${res.error}`);
    applyServerStatus('offline');
  } else {
    applyServerStatus('starting');
    appendSystemLine(miniConsoleOutput, '[System] Server restarting. Waiting for RCON…');
  }
});

btnStartBot.addEventListener('click', async () => {
  btnStartBot.disabled = true;
  appendSystemLine(miniConsoleOutput, '[System] Starting Discord bot…');

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
      const clean = r.response.replace(/§[0-9a-fk-or]/gi, '');
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
    setMaxPlayers.value   = cfg.maxPlayers        ?? 10;
    setViewDist.value     = cfg.viewDistance       ?? 10;
    setSimDist.value      = cfg.simulationDistance ?? 10;
    setMotd.value         = cfg.motd               ?? '';
    setRconPass.value     = cfg.rconPassword       ?? '';
    setDiscordToken.value = cfg.discordToken       ?? '';
    setMaxRam.value       = cfg.maxRam             ?? '10G';

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
  settingsStatusMessage.textContent = 'Saving…';

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
