'use strict';

const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dns = require('dns');
const net = require('net');
const https = require('https');

// Networking state storage path
const NETWORKING_CONFIG_PATH = path.join(__dirname, 'networking-config.json');

// Default networking configuration
const DEFAULT_NETWORKING_CONFIG = {
  selectedMethod: 'zerotier',
  methods: {
    zerotier: {
      enabled: true,
      installed: false,
      networkId: '',
      address: '',
      autoInstall: true,
      status: 'unknown'
    },
    tailscale: {
      enabled: true,
      installed: false,
      address: '',
      autoInstall: true,
      status: 'unknown'
    },
    lan: {
      enabled: true,
      addresses: [],
      status: 'detecting'
    },
    portForwarding: {
      enabled: true,
      externalPort: 25565,
      internalPort: 25565,
      protocol: 'TCP',
      status: 'unknown'
    },
    playitgg: {
      enabled: true,
      installed: false,
      address: '',
      autoInstall: true,
      status: 'unknown'
    },
    manual: {
      enabled: true,
      address: '',
      notes: ''
    }
  },
  serverNetworking: {}
};

/**
 * Load networking configuration
 */
function loadNetworkingConfig() {
  try {
    if (fs.existsSync(NETWORKING_CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(NETWORKING_CONFIG_PATH, 'utf8'));
      return { ...DEFAULT_NETWORKING_CONFIG, ...config };
    }
  } catch (e) {
    console.error('Error loading networking config:', e.message);
  }
  return { ...DEFAULT_NETWORKING_CONFIG };
}

/**
 * Save networking configuration
 */
function saveNetworkingConfig(config) {
  try {
    fs.writeFileSync(NETWORKING_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving networking config:', e.message);
    return false;
  }
}

/**
 * Download a file from URL
 */
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

// ===========================================================================
// ZEROTIER
// ===========================================================================

/**
 * Check if ZeroTier is installed
 */
async function checkZeroTierInstalled() {
  try {
    if (process.platform === 'win32') {
      const result = execSync('where zerotier-cli 2>nul', { encoding: 'utf8' });
      return result.trim().length > 0;
    } else {
      const result = execSync('which zerotier-cli 2>/dev/null', { encoding: 'utf8' });
      return result.trim().length > 0;
    }
  } catch (e) {
    return false;
  }
}

/**
 * Check if ZeroTier service is running
 */
async function checkZeroTierRunning() {
  try {
    if (process.platform === 'win32') {
      const result = execSync('sc query "ZeroTier One"', { encoding: 'utf8' });
      return result.includes('RUNNING');
    } else {
      const result = execSync('pgrep -x zerotier-one >/dev/null 2>&1 && echo yes || echo no', { encoding: 'utf8' });
      return result.trim() === 'yes';
    }
  } catch (e) {
    return false;
  }
}

/**
 * Get ZeroTier network info
 */
async function getZeroTierInfo() {
  try {
    const installed = await checkZeroTierInstalled();
    if (!installed) {
      return { installed: false, running: false, networks: [], address: '' };
    }

    const running = await checkZeroTierRunning();
    
    let networks = [];
    let address = '';
    
    if (running) {
      try {
        const result = execSync('zerotier-cli listnetworks', { encoding: 'utf8' });
        const lines = result.trim().split(/\r?\n/);
        
        for (const line of lines) {
          if (line.includes('OK') || line.includes('200')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3) {
              const networkId = parts[0];
              const status = parts.length >= 3 ? parts[2] : '';
              const name = parts.length >= 2 ? parts[1] : 'Unnamed';
              networks.push({ id: networkId, name, status });
              
              if (status === 'OK' && !address) {
                // Try to get the ZeroTier IP
                try {
                  const ifaceResult = execSync('zerotier-cli listnetworks -j', { encoding: 'utf8' });
                  const jsonData = JSON.parse(ifaceResult);
                  for (const net of jsonData) {
                    if (net.id === networkId && net.assignedAddresses) {
                      address = net.assignedAddresses[0] || '';
                      break;
                    }
                  }
                } catch (e) {
                  // Fallback: try ipconfig on Windows
                  try {
                    const ipResult = execSync('ipconfig /all', { encoding: 'utf8' });
                    const lines = ipResult.split(/\r?\n/);
                    for (const ipLine of lines) {
                      if (ipLine.includes('ZeroTier') && ipLine.includes(':')) {
                        const match = ipLine.match(/(\d+\.\d+\.\d+\.\d+)/);
                        if (match) {
                          address = match[1];
                          break;
                        }
                      }
                    }
                  } catch (e2) {}
                }
              }
            }
          }
        }
      } catch (e) {
        console.log('Could not parse ZeroTier networks:', e.message);
      }
    }

    return { installed, running, networks, address };
  } catch (e) {
    return { installed: false, running: false, networks: [], address: '' };
  }
}

/**
 * Install ZeroTier on Windows
 */
async function installZeroTier() {
  try {
    if (process.platform === 'win32') {
      const url = 'https://download.zerotier.com/dist/ZeroTier%20One.msi';
      const tempFile = path.join(os.tmpdir(), 'ZeroTier_One.msi');
      
      console.log('Downloading ZeroTier...');
      await downloadFile(url, tempFile);
      
      console.log('Installing ZeroTier...');
      await new Promise((resolve, reject) => {
        exec('msiexec /i "' + tempFile + '" /qn /norestart', (err) => {
          try { fs.unlinkSync(tempFile); } catch (_) {}
          if (err) reject(new Error('Failed to install ZeroTier: ' + err.message));
          else resolve();
        });
      });
      
      // Start the service
      await new Promise((resolve) => {
        exec('net start "ZeroTier One"', (err) => {
          setTimeout(resolve, 2000);
        });
      });
      
      return { success: true, message: 'ZeroTier installed successfully' };
    } else {
      return { success: false, error: 'Auto-install only supported on Windows. Please install manually from zerotier.com' };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Join ZeroTier network
 */
async function joinZeroTierNetwork(networkId) {
  try {
    const result = execSync(`zerotier-cli join ${networkId}`, { encoding: 'utf8' });
    return { success: true, message: 'Joined ZeroTier network', result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Leave ZeroTier network
 */
async function leaveZeroTierNetwork(networkId) {
  try {
    const result = execSync(`zerotier-cli leave ${networkId}`, { encoding: 'utf8' });
    return { success: true, message: 'Left ZeroTier network', result };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ===========================================================================
// TAILSCALE
// ===========================================================================

/**
 * Check if Tailscale is installed
 */
async function checkTailscaleInstalled() {
  try {
    if (process.platform === 'win32') {
      const result = execSync('where tailscale 2>nul', { encoding: 'utf8' });
      return result.trim().length > 0;
    } else {
      const result = execSync('which tailscale 2>/dev/null', { encoding: 'utf8' });
      return result.trim().length > 0;
    }
  } catch (e) {
    return false;
  }
}

/**
 * Check if Tailscale is running
 */
async function checkTailscaleRunning() {
  try {
    if (process.platform === 'win32') {
      const result = execSync('tailscale status', { encoding: 'utf8' });
      return !result.includes('not running') && !result.includes('To start');
    } else {
      const result = execSync('tailscale status 2>/dev/null', { encoding: 'utf8' });
      return result.trim().length > 0;
    }
  } catch (e) {
    return false;
  }
}

/**
 * Get Tailscale info
 */
async function getTailscaleInfo() {
  try {
    const installed = await checkTailscaleInstalled();
    if (!installed) {
      return { installed: false, running: false, address: '', status: 'not_installed' };
    }

    const running = await checkTailscaleRunning();
    
    let address = '';
    let status = running ? 'connected' : 'stopped';
    
    if (running) {
      try {
        const result = execSync('tailscale status --self', { encoding: 'utf8' });
        const lines = result.trim().split(/\r?\n/);
        for (const line of lines) {
          if (line.includes('100.') || line.includes('10.') || line.includes('fd')) {
            const match = line.match(/(\d+\.\d+\.\d+\.\d+|[a-f0-9:]+)/);
            if (match) {
              address = match[1];
              break;
            }
          }
        }
        
        if (!address) {
          // Try alternative command
          const result2 = execSync('tailscale ip', { encoding: 'utf8' });
          address = result2.trim();
        }
      } catch (e) {
        console.log('Could not get Tailscale address:', e.message);
      }
    }

    return { installed, running, address, status };
  } catch (e) {
    return { installed: false, running: false, address: '', status: 'error' };
  }
}

/**
 * Install Tailscale
 */
async function installTailscale() {
  try {
    if (process.platform === 'win32') {
      const url = 'https://tailscale.com/install.exe';
      const tempFile = path.join(os.tmpdir(), 'tailscale-install.exe');
      
      console.log('Downloading Tailscale...');
      await downloadFile(url, tempFile);
      
      console.log('Installing Tailscale...');
      await new Promise((resolve, reject) => {
        exec('"' + tempFile + '" /S', (err) => {
          try { fs.unlinkSync(tempFile); } catch (_) {}
          if (err) reject(new Error('Failed to install Tailscale: ' + err.message));
          else resolve();
        });
      });
      
      return { success: true, message: 'Tailscale installed. Please login using the system tray icon.' };
    } else {
      return { success: false, error: 'Auto-install only supported on Windows. Please install manually from tailscale.com' };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Start Tailscale
 */
async function startTailscale() {
  try {
    if (process.platform === 'win32') {
      exec('tailscale up', (err) => {
        if (err) console.error('Failed to start Tailscale:', err.message);
      });
    } else {
      exec('sudo tailscale up', (err) => {
        if (err) console.error('Failed to start Tailscale:', err.message);
      });
    }
    return { success: true, message: 'Tailscale started. Check system tray for login.' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Stop Tailscale
 */
async function stopTailscale() {
  try {
    if (process.platform === 'win32') {
      exec('tailscale down', (err) => {
        if (err) console.error('Failed to stop Tailscale:', err.message);
      });
    } else {
      exec('sudo tailscale down', (err) => {
        if (err) console.error('Failed to stop Tailscale:', err.message);
      });
    }
    return { success: true, message: 'Tailscale stopped' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ===========================================================================
// LAN / LOCAL NETWORK
// ===========================================================================

/**
 * Get local IP addresses
 */
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  
  for (const [name, ifaces] of Object.entries(interfaces)) {
    for (const iface of ifaces) {
      // Skip loopback and IPv6
      if (iface.internal || iface.family !== 'IPv4') continue;
      
      addresses.push({
        address: iface.address,
        netmask: iface.netmask,
        interface: name,
        family: iface.family
      });
    }
  }
  
  return addresses;
}

/**
 * Get LAN server addresses for all servers
 */
function getLanAddresses(serverPorts = {}) {
  const localIPs = getLocalIPs();
  const addresses = [];
  
  for (const ipInfo of localIPs) {
    for (const [serverId, port] of Object.entries(serverPorts)) {
      addresses.push({
        serverId,
        address: `${ipInfo.address}:${port}`,
        interface: ipInfo.interface,
        type: 'lan'
      });
    }
  }
  
  return addresses;
}

// ===========================================================================
// PORT FORWARDING
// ===========================================================================

/**
 * Get public IP address
 */
async function getPublicIP() {
  try {
    const response = await new Promise((resolve) => {
      https.get('https://api.ipify.org?format=json', (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.ip || '');
          } catch (e) {
            resolve('');
          }
        });
      }).on('error', () => resolve(''));
    });
    return response;
  } catch (e) {
    return '';
  }
}

/**
 * Check if port is open (local test)
 */
async function checkPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    
    socket.connect(port, host);
  });
}

/**
 * Get port forwarding information
 */
async function getPortForwardingInfo(internalPort = 25565, externalPort = 25565) {
  const publicIP = await getPublicIP();
  const localOpen = await checkPortOpen(internalPort);
  
  return {
    publicIP,
    internalPort,
    externalPort,
    localPortOpen: localOpen,
    protocol: 'TCP',
    address: publicIP ? `${publicIP}:${externalPort}` : '',
    status: localOpen ? 'local_ready' : 'local_not_ready'
  };
}

// ===========================================================================
// PLAYIT.GG
// ===========================================================================

/**
 * Check if Playit.gg is installed
 */
async function checkPlayitInstalled() {
  try {
    if (process.platform === 'win32') {
      const result = execSync('where playit 2>nul', { encoding: 'utf8' });
      return result.trim().length > 0;
    } else {
      const result = execSync('which playit 2>/dev/null', { encoding: 'utf8' });
      return result.trim().length > 0;
    }
  } catch (e) {
    return false;
  }
}

/**
 * Check if Playit.gg is running
 */
async function checkPlayitRunning() {
  try {
    if (process.platform === 'win32') {
      const result = execSync('tasklist /FI "IMAGENAME eq playit.exe" /NH', { encoding: 'utf8' });
      return result.includes('playit.exe');
    } else {
      const result = execSync('pgrep -x playit >/dev/null 2>&1 && echo yes || echo no', { encoding: 'utf8' });
      return result.trim() === 'yes';
    }
  } catch (e) {
    return false;
  }
}

/**
 * Get Playit.gg info
 */
async function getPlayitInfo() {
  try {
    const installed = await checkPlayitInstalled();
    const running = await checkPlayitRunning();
    
    let address = '';
    let status = 'unknown';
    
    if (running) {
      // Playit.gg typically runs on localhost with a web interface
      // The actual connection address is usually shown in their UI
      address = 'localhost:8080';
      status = 'running';
    } else if (installed) {
      status = 'installed';
    }
    
    return { installed, running, address, status };
  } catch (e) {
    return { installed: false, running: false, address: '', status: 'error' };
  }
}

/**
 * Install Playit.gg
 */
async function installPlayit() {
  try {
    if (process.platform === 'win32') {
      return { 
        success: false, 
        error: 'Playit.gg must be installed manually. Download from https://playit.gg' 
      };
    } else {
      return { 
        success: false, 
        error: 'Playit.gg must be installed manually. Download from https://playit.gg' 
      };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Start Playit.gg
 */
async function startPlayit() {
  try {
    if (process.platform === 'win32') {
      exec('start playit://', (err) => {
        if (err) console.error('Failed to start Playit.gg:', err.message);
      });
    } else {
      exec('playit', (err) => {
        if (err) console.error('Failed to start Playit.gg:', err.message);
      });
    }
    return { success: true, message: 'Playit.gg started' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ===========================================================================
// MANUAL / CUSTOM
// ===========================================================================

/**
 * Save manual connection address
 */
function saveManualAddress(address, notes = '') {
  const config = loadNetworkingConfig();
  config.methods.manual.address = address;
  config.methods.manual.notes = notes;
  return saveNetworkingConfig(config);
}

/**
 * Get manual connection address
 */
function getManualAddress() {
  const config = loadNetworkingConfig();
  return {
    address: config.methods.manual.address || '',
    notes: config.methods.manual.notes || ''
  };
}

// ===========================================================================
// SERVER-SPECIFIC NETWORKING
// ===========================================================================

/**
 * Get server's connection address based on networking method
 */
function getServerConnectionAddress(serverId, serverPort, method = 'zerotier') {
  const config = loadNetworkingConfig();
  const serverConfig = config.serverNetworking[serverId] || {};
  
  switch (method) {
    case 'zerotier':
      // Use ZeroTier address from config or auto-detect
      const ztInfo = config.methods.zerotier;
      if (ztInfo.address) {
        return `${ztInfo.address}:${serverPort}`;
      }
      break;
      
    case 'tailscale':
      const tsInfo = config.methods.tailscale;
      if (tsInfo.address) {
        return `${tsInfo.address}:${serverPort}`;
      }
      break;
      
    case 'lan':
      const localIPs = getLocalIPs();
      if (localIPs.length > 0) {
        return `${localIPs[0].address}:${serverPort}`;
      }
      break;
      
    case 'portForwarding':
      const pfInfo = config.methods.portForwarding;
      if (pfInfo.publicIP) {
        return `${pfInfo.publicIP}:${pfInfo.externalPort || serverPort}`;
      }
      break;
      
    case 'playitgg':
      const pgInfo = config.methods.playitgg;
      if (pgInfo.address) {
        return pgInfo.address;
      }
      break;
      
    case 'manual':
      const manual = config.methods.manual;
      if (manual.address) {
        // If address already includes port, use as-is
        if (manual.address.includes(':')) {
          return manual.address;
        }
        return `${manual.address}:${serverPort}`;
      }
      break;
  }
  
  // Fallback: try to detect the best method
  const ztAddress = config.methods.zerotier.address;
  const tsAddress = config.methods.tailscale.address;
  
  if (ztAddress) return `${ztAddress}:${serverPort}`;
  if (tsAddress) return `${tsAddress}:${serverPort}`;
  if (localIPs.length > 0) return `${localIPs[0].address}:${serverPort}`;
  
  return `localhost:${serverPort}`;
}

/**
 * Set server-specific networking configuration
 */
function setServerNetworking(serverId, networkingConfig) {
  const config = loadNetworkingConfig();
  config.serverNetworking[serverId] = {
    ...(config.serverNetworking[serverId] || {}),
    ...networkingConfig
  };
  return saveNetworkingConfig(config);
}

/**
 * Get all connection methods with their status
 */
async function getAllMethodsStatus() {
  const config = loadNetworkingConfig();
  
  const [ztInfo, tsInfo, lanInfo, pfInfo, pgInfo] = await Promise.all([
    getZeroTierInfo(),
    getTailscaleInfo(),
    Promise.resolve({ addresses: getLocalIPs(), status: 'active' }),
    getPortForwardingInfo(config.methods.portForwarding.internalPort, config.methods.portForwarding.externalPort),
    getPlayitInfo()
  ]);
  
  const manualInfo = getManualAddress();
  
  return {
    zerotier: {
      ...config.methods.zerotier,
      ...ztInfo,
      recommended: true
    },
    tailscale: {
      ...config.methods.tailscale,
      ...tsInfo
    },
    lan: {
      ...config.methods.lan,
      addresses: lanInfo.addresses,
      status: lanInfo.status
    },
    portForwarding: {
      ...config.methods.portForwarding,
      ...pfInfo
    },
    playitgg: {
      ...config.methods.playitgg,
      ...pgInfo
    },
    manual: {
      ...config.methods.manual,
      ...manualInfo
    },
    selectedMethod: config.selectedMethod
  };
}

// ===========================================================================
// EXPORTS
// ===========================================================================

module.exports = {
  // Configuration
  loadNetworkingConfig,
  saveNetworkingConfig,
  
  // ZeroTier
  checkZeroTierInstalled,
  checkZeroTierRunning,
  getZeroTierInfo,
  installZeroTier,
  joinZeroTierNetwork,
  leaveZeroTierNetwork,
  
  // Tailscale
  checkTailscaleInstalled,
  checkTailscaleRunning,
  getTailscaleInfo,
  installTailscale,
  startTailscale,
  stopTailscale,
  
  // LAN
  getLocalIPs,
  getLanAddresses,
  
  // Port Forwarding
  getPublicIP,
  checkPortOpen,
  getPortForwardingInfo,
  
  // Playit.gg
  checkPlayitInstalled,
  checkPlayitRunning,
  getPlayitInfo,
  installPlayit,
  startPlayit,
  
  // Manual
  saveManualAddress,
  getManualAddress,
  
  // Server-specific
  getServerConnectionAddress,
  setServerNetworking,
  
  // All methods
  getAllMethodsStatus
};
