const path = require("path");
const fs = require("fs");
const paths = require("../manager/paths");
const botEnvPath = process.env.SHADOW_MC_HOST_BOT_ENV || paths.botEnvPath();

if (fs.existsSync(botEnvPath)) {
  require("dotenv").config({ path: botEnvPath });
} else {
  const localEnv = path.join(__dirname, ".env");
  if (fs.existsSync(localEnv)) {
    require("dotenv").config({ path: localEnv });
  } else {
    require("dotenv").config({ path: botEnvPath });
  }
}

const { Client, GatewayIntentBits } = require("discord.js");
const { Rcon } = require("rcon-client");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Load server configuration from SHADOW's multi-server config
function loadServersConfig() {
  try {
    const configPath = paths.serversConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('[BOT] Error loading servers config:', e.message);
  }
  return {
    servers: {
      default: {
        name: 'Default Server',
        rootPath: paths.getNewServerDir('default'),
        serverJar: 'server.jar',
        rconHost: '127.0.0.1',
        rconPort: 25575,
        rconPassword: ''
      }
    },
    settings: {
      defaultServer: 'default'
    }
  };
}

function getActiveServerId() {
  const config = loadServersConfig();
  return config.settings?.defaultServer || 'default';
}

function getActiveServerConfig() {
  const config = loadServersConfig();
  const serverId = getActiveServerId();
  return config.servers?.[serverId] || config.servers?.default || null;
}

// Get server directory from SHADOW's path resolution
function getServerDirectory() {
  const server = getActiveServerConfig();
  if (server) {
    return paths.getServerDirectory(getActiveServerId(), server);
  }
  // Fallback to default
  return paths.getServerDirectory('default');
}

// Get server properties path
function getServerPropertiesPath() {
  return path.join(getServerDirectory(), "server.properties");
}

// ---------- RCON Helper Functions ----------

// Per-command RCON connection - no persistent activeRcon state
// This connects on-demand for each command, avoiding lifecycle ownership
async function getRconConnection() {
  const server = getActiveServerConfig();
  const properties = readServerProperties();
  
  const host = server?.rconHost || properties["server-ip"] || process.env.RCON_HOST || "127.0.0.1";
  const port = Number(server?.rconPort || properties["rcon.port"] || process.env.RCON_PORT || 25575);
  const password = server?.rconPassword || properties["rcon.password"] || process.env.RCON_PASSWORD || '';

  if (!password) {
    console.warn('[RCON] No RCON password configured');
    return null;
  }

  const rcon = new Rcon({ host, port, password, timeout: 5000 });

  try {
    await rcon.connect();
    return rcon;
  } catch (err) {
    console.error('[RCON] Connection failed:', err.message);
    try { await rcon.end(); } catch (_) {}
    return null;
  }
}

async function executeRconCommand(command) {
  let rcon = null;
  try {
    rcon = await getRconConnection();
    if (!rcon) return null;
    return await rcon.send(command);
  } catch (err) {
    console.error("[RCON ERROR]", err.message);
    return null;
  } finally {
    if (rcon) {
      try { await rcon.end(); } catch (_) {}
    }
  }
}

function readServerProperties() {
  try {
    const serverPropsPath = getServerPropertiesPath();
    const content = fs.readFileSync(serverPropsPath, "utf8");
    return Object.fromEntries(
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          return separator === -1
            ? [line, ""]
            : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
        })
    );
  } catch (err) {
    console.warn(`[CONFIG] Could not read server.properties: ${err.message}`);
    return {};
  }
}

async function isServerRunning() {
  // Check via RCON connectivity - this is the only reliable way from the bot
  let rcon = null;
  try {
    rcon = await getRconConnection();
    if (rcon) {
      // Try a lightweight command to verify server is responsive
      await rcon.send('seed');
      return true;
    }
    return false;
  } catch (err) {
    return false;
  } finally {
    if (rcon) {
      try { await rcon.end(); } catch (_) {}
    }
  }
}

// ---------- DISCORD BOT ----------

client.once("ready", () => {
  console.log(`\u2705 Logged in as ${client.user.tag}`);
  const serverDir = getServerDirectory();
  const serverConfig = getActiveServerConfig();
  console.log(`\ud83d\udcc1 Active Server Directory: ${serverDir}`);
  console.log(`\ud83c\udf10 RCON: ${serverConfig?.rconHost || '127.0.0.1'}:${serverConfig?.rconPort || 25575}`);
  console.log(`[ARCHITECTURE] Discord bot is running in SHADOW-bound mode. Server lifecycle is managed by SHADOW MC HOST.`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply();

  const cmd = interaction.commandName;
  console.log(`Executed command: /${cmd}`);

  // ============ START SERVER ============
  // Delegated to SHADOW MC HOST manager - bot does NOT spawn Java process
  if (cmd === "startserver") {
    const serverConfig = getActiveServerConfig();
    const serverDir = getServerDirectory();
    
    return interaction.editReply(
      `\ud83d\udfe2 **Server Management Delegated to SHADOW MC HOST**\n` +
      `This Discord bot no longer directly manages server lifecycle.\n` +
      `\n` +
      `To start the server, use the SHADOW MC HOST application:\n` +
      `- Open the SHADOW MC HOST manager\n` +
      `- Click "Start Server" in the dashboard or system tray\n` +
      `- Or use the auto-start settings in the manager\n` +
      `\n` +
      `**Active Server:** ${serverConfig?.name || 'default'}\n` +
      `**Server Directory:** \`${serverDir}\`\n` +
      `\n` +
      `The server must be started through SHADOW MC HOST for proper process management, RAM monitoring, and log tailing.`
    );
  }

  // ============ STOP SERVER ============
  // Uses RCON - delegated to the running server, not bot-owned lifecycle
  if (cmd === "stopserver") {
    // Check if server is running via RCON
    if (!(await isServerRunning())) {
      return interaction.editReply("\u274c Server is not running or RCON is not connected.");
    }

    try {
      console.log("[BOT] Stopping server via RCON...");

      const response = await executeRconCommand("stop");

      if (response !== null) {
        return interaction.editReply(
          `\ud83d\uded1 **Server Stopping...**\n` +
          `The server will shut down gracefully.\n` +
          `Players will be saved (10-30 seconds)`
        );
      } else {
        return interaction.editReply(
          "\u274c Failed to send stop command via RCON.\n" +
          "Check RCON settings in SHADOW MC HOST configuration"
        );
      }
    } catch (err) {
      console.error("[STOP ERROR]", err);
      return interaction.editReply(
        `\u274c Failed to stop server:\n\`\`\`${err.message}\`\`\``
      );
    }
  }

  // ============ SERVER STATUS ============
  if (cmd === "status") {
    try {
      const running = await isServerRunning();
      const status = running ? "\ud83d\udfe2 **ONLINE**" : "\ud83d\udd34 **OFFLINE**";

      const serverConfig = getActiveServerConfig();
      const serverDir = getServerDirectory();

      let message = `**Server Status:** ${status}\n`;
      message += `**Server Name:** ${serverConfig?.name || 'default'}\n`;
      message += `**Directory:** \`${serverDir}\`\n`;
      message += `**Managed by:** SHADOW MC HOST\n`;

      return interaction.editReply(message);
    } catch (err) {
      console.error("[STATUS ERROR]", err);
      return interaction.editReply("\u274c Failed to check server status.");
    }
  }

  // ============ ONLINE PLAYERS ============
  if (cmd === "players") {
    if (!(await isServerRunning())) {
      return interaction.editReply("\u274c Server is offline.");
    }
    try {
      const response = await executeRconCommand("list");
      if (response !== null) {
        return interaction.editReply(`**Online Players:**\n\`\`\`${response.replace(/\u00a7[0-9a-fk-or]/ig, '')}\`\`\``);
      } else {
        return interaction.editReply("\u274c Failed to communicate with RCON.");
      }
    } catch (err) {
      console.error("[PLAYERS ERROR]", err);
      return interaction.editReply("\u274c Failed to check players.");
    }
  }

  // ============ TPS ============
  if (cmd === "tps") {
    if (!(await isServerRunning())) {
      return interaction.editReply("\u274c Server is offline.");
    }
    try {
      const response = await executeRconCommand("tps");
      if (response !== null) {
        return interaction.editReply(`**Server TPS:**\n\`\`\`${response.replace(/\u00a7[0-9a-fk-or]/ig, '')}\`\`\``);
      } else {
        return interaction.editReply("\u274c Failed to communicate with RCON.");
      }
    } catch (err) {
      console.error("[TPS ERROR]", err);
      return interaction.editReply("\u274c Failed to check TPS.");
    }
  }
});

// Login to Discord
client.login(process.env.TOKEN);
