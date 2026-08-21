require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const { spawn } = require("child_process");
const { Rcon } = require("rcon-client");
const path = require("path");
const fs = require("fs");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const SERVER_PATH = process.env.SERVER_PATH || "../";
const MC_DIR = path.resolve(__dirname, SERVER_PATH);
const SERVER_JAR = process.env.SERVER_JAR || "server.jar";
const JAVA = process.env.JAVA_PATH || "java";
const SERVER_PROPERTIES = path.join(MC_DIR, "server.properties");

// Store server PID for process tracking
let serverPID = null;
let serverProcess = null;

// ---------- RCON Helper Functions ----------

let activeRcon = null;

function readServerProperties() {
  try {
    const content = fs.readFileSync(SERVER_PROPERTIES, "utf8");
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
    console.warn(`[CONFIG] Could not read ${SERVER_PROPERTIES}: ${err.message}`);
    return {};
  }
}

async function getRcon() {
  if (activeRcon) return activeRcon;

  const properties = readServerProperties();
  activeRcon = await Rcon.connect({
    host: properties["server-ip"] || process.env.RCON_HOST || "127.0.0.1",
    port: Number(properties["rcon.port"] || process.env.RCON_PORT || 25575),
    password: properties["rcon.password"] || process.env.RCON_PASSWORD,
  });

  activeRcon.on("end", () => {
    console.log("[RCON] Connection closed or dropped. Will reconnect automatically.");
    activeRcon = null;
  });

  activeRcon.on("error", (err) => {
    console.error("[RCON] Connection error:", err.message);
    activeRcon = null;
  });

  return activeRcon;
}

async function executeRconCommand(command) {
  try {
    const rcon = await getRcon();
    return await rcon.send(command);
  } catch (err) {
    console.error("[RCON ERROR]", err.message);
    activeRcon = null;
    return null;
  }
}

async function isServerRunning() {
  try {
    await getRcon();
    return true;
  } catch (err) {
    return false;
  }
}

// ---------- DISCORD BOT ----------

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📁 Minecraft Dir: ${MC_DIR}`);
  console.log(`📦 Server JAR: ${SERVER_JAR}`);
  console.log(`☕ Java Path: ${JAVA}`);
  console.log(`🌐 RCON: ${process.env.RCON_HOST}:${process.env.RCON_PORT}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply();

  const cmd = interaction.commandName;
  console.log(`Executed command: /${cmd}`);

  // ============ START SERVER ============
  if (cmd === "startserver") {
    // Check if already running
    if (await isServerRunning()) {
      return interaction.editReply("⚠️ Server is already running!");
    }

    // Validate environment variables
    if (!MC_DIR) {
      return interaction.editReply("❌ MINECRAFT_DIR is not set in .env");
    }

    if (!SERVER_JAR) {
      return interaction.editReply(
        "❌ JAR_PATH or SERVER_JAR is not set in .env"
      );
    }

    try {
      const jarPath = path.resolve(MC_DIR, SERVER_JAR);

      console.log(`[BOT] Starting Minecraft server...`);
      console.log(`[BOT] JAR Path: ${jarPath}`);
      console.log(`[BOT] Working Dir: ${MC_DIR}`);
      console.log(`[BOT] Java: ${JAVA}`);

      // Verify JAR file exists
      if (!fs.existsSync(jarPath)) {
        console.error(`[ERROR] JAR not found: ${jarPath}`);
        return interaction.editReply(
          `❌ Server JAR not found:\n\`${jarPath}\``
        );
      }

      // Spawn the server process with FIXED JVM flag syntax and laptop-friendly memory (2G-4G)
      serverProcess = spawn(
        JAVA,
        [
          "-Xms2G", "-Xmx4G",
          "-XX:+UseG1GC", "-XX:+ParallelRefProcEnabled", "-XX:MaxGCPauseMillis=200", 
          "-XX:+UnlockExperimentalVMOptions", "-XX:+DisableExplicitGC", "-XX:G1NewSizePercent=30", 
          "-XX:G1MaxNewSizePercent=40", "-XX:G1HeapRegionSize=8M", "-XX:G1ReservePercent=20", 
          "-XX:G1HeapWastePercent=5", "-XX:G1MixedGCCountTarget=4", "-XX:InitiatingHeapOccupancyPercent=15", 
          "-XX:G1MixedGCLiveThresholdPercent=90", "-XX:G1RSetUpdatingPauseTimePercent=5", 
          "-XX:SurvivorRatio=32", "-XX:+PerfDisableSharedMem", "-XX:MaxTenuringThreshold=1", 
          "-Dusing.aikars.flags=https://mcflags.emc.gs", "-Daikars.new.flags=true", 
          "-jar", jarPath, "nogui"
        ],
        {
          cwd: MC_DIR,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"], // Capture output
        }
      );

      serverPID = serverProcess.pid;

      // Handle stdout
      serverProcess.stdout?.on("data", (data) => {
        const output = data.toString().trim();
        if (output) {
          console.log(`[SERVER OUTPUT] ${output}`);
        }
      });

      // Handle stderr
      serverProcess.stderr?.on("data", (data) => {
        const error = data.toString().trim();
        if (error) {
          console.error(`[SERVER ERROR] ${error}`);
        }
      });

      // Handle process errors
      serverProcess.on("error", (err) => {
        console.error(`[SPAWN ERROR] ${err.message}`);
        serverPID = null;
        serverProcess = null;
      });

      // Handle process close
      serverProcess.on("close", (code) => {
        console.log(`[SERVER CLOSED] Exit code: ${code}`);
        serverPID = null;
        serverProcess = null;
      });

      // Detach process so it runs independently
      serverProcess.unref();

      return interaction.editReply(
        `🟢 **Server Starting...**\n` +
        `Process ID: \`${serverPID}\`\n` +
        `JAR: \`${jarPath}\`\n` +
        `Heap: 2GB initial, 4GB maximum\n` +
        `Check console for startup logs (may take 30-60 seconds)`
      );
    } catch (err) {
      console.error("[START ERROR]", err);
      serverPID = null;
      serverProcess = null;
      return interaction.editReply(
        `❌ Failed to start server:\n\`\`\`${err.message}\`\`\``
      );
    }
  }

  // ============ STOP SERVER ============
  if (cmd === "stopserver") {
    // Check if server is running
    if (!(await isServerRunning())) {
      return interaction.editReply("❌ Server is not running.");
    }

    try {
      console.log("[BOT] Stopping server via RCON...");

      const response = await executeRconCommand("stop");

      if (response !== null) {
        return interaction.editReply(
          `🛑 **Server Stopping...**\n` +
          `The server will shut down gracefully.\n` +
          `Players will be saved (10-30 seconds)`
        );
      } else {
        return interaction.editReply(
          "❌ Failed to send stop command via RCON.\n" +
          "Check RCON settings in `.env`"
        );
      }
    } catch (err) {
      console.error("[STOP ERROR]", err);
      return interaction.editReply(
        `❌ Failed to stop server:\n\`\`\`${err.message}\`\`\``
      );
    }
  }

  // ============ SERVER STATUS ============
  if (cmd === "status") {
    try {
      const running = await isServerRunning();
      const status = running ? "🟢 **ONLINE**" : "🔴 **OFFLINE**";

      let message = `**Server Status:** ${status}\n`;
      message += `**JAR:** \`${SERVER_JAR}\`\n`;
      message += `**Directory:** \`${MC_DIR}\`\n`;
      message += `**Heap:** 2GB initial, 4GB maximum\n`;

      if (serverPID) {
        message += `**Process ID:** \`${serverPID}\``;
      }

      return interaction.editReply(message);
    } catch (err) {
      console.error("[STATUS ERROR]", err);
      return interaction.editReply("❌ Failed to check server status.");
    }
  }

  // ============ ONLINE PLAYERS ============
  if (cmd === "players") {
    if (!(await isServerRunning())) {
      return interaction.editReply("❌ Server is offline.");
    }
    try {
      const response = await executeRconCommand("list");
      if (response !== null) {
        return interaction.editReply(`**Online Players:**\n\`\`\`${response.replace(/§[0-9a-fk-or]/ig, '')}\`\`\``);
      } else {
        return interaction.editReply("❌ Failed to communicate with RCON.");
      }
    } catch (err) {
      console.error("[PLAYERS ERROR]", err);
      return interaction.editReply("❌ Failed to check players.");
    }
  }

  // ============ TPS ============
  if (cmd === "tps") {
    if (!(await isServerRunning())) {
      return interaction.editReply("❌ Server is offline.");
    }
    try {
      const response = await executeRconCommand("tps");
      if (response !== null) {
        return interaction.editReply(`**Server TPS:**\n\`\`\`${response.replace(/§[0-9a-fk-or]/ig, '')}\`\`\``);
      } else {
        return interaction.editReply("❌ Failed to communicate with RCON.");
      }
    } catch (err) {
      console.error("[TPS ERROR]", err);
      return interaction.editReply("❌ Failed to check TPS.");
    }
  }
});

// Login to Discord
client.login(process.env.TOKEN);