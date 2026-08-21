# SHADOW MC HOST - Setup Guide

> Complete setup instructions for both the Desktop Manager and Discord Bot

---

## 📋 Quick Start Checklist

- [ ] Install [Node.js 18+](https://nodejs.org/)
- [ ] Install [Java 17+](https://adoptium.net/) (for Minecraft server)
- [ ] Download [PaperMC server](https://papermc.io/downloads)
- [ ] Clone this repository
- [ ] Configure your server
- [ ] Set up Discord bot (optional)
- [ ] Launch SHADOW MC HOST

---

## 🖥️ Desktop Manager Setup

### 1. Clone the Repository

```bash
# Using HTTPS
git clone https://github.com/SHADOW-MC-HOST/SHADOW-MC-HOST.git
cd SHADOW-MC-HOST

# Or using SSH
git clone git@github.com:SHADOW-MC-HOST/SHADOW-MC-HOST.git
cd SHADOW-MC-HOST
```

### 2. Install Dependencies

```bash
cd manager
npm install
```

This installs all required Electron and Node.js dependencies.

### 3. Prepare Your Minecraft Server

#### Option A: Use Existing Server

Place your existing PaperMC/Spigot server files in a folder next to the `manager/` directory:

```
SHADOW-MC-HOST/
├── manager/         # This is the desktop app
├── server.jar       # Your PaperMC server JAR
├── start.bat        # Your startup script
├── server.properties
├── eula.txt
└── ...             # Other server files
```

#### Option B: Create New Server

1. Download PaperMC from [papermc.io/downloads](https://papermc.io/downloads)
2. Create a folder for your server (e.g., `server/`)
3. Place `server.jar` in the folder
4. Create `start.bat` with recommended JVM flags:

```batch
@echo off
java -Xms2G -Xmx4G \
  -XX:+UseG1GC \
  -XX:+ParallelRefProcEnabled \
  -XX:MaxGCPauseMillis=200 \
  -XX:+UnlockExperimentalVMOptions \
  -XX:+DisableExplicitGC \
  -XX:G1NewSizePercent=30 \
  -XX:G1MaxNewSizePercent=40 \
  -XX:G1HeapRegionSize=8M \
  -XX:G1ReservePercent=20 \
  -XX:G1HeapWastePercent=5 \
  -XX:G1MixedGCCountTarget=4 \
  -XX:InitiatingHeapOccupancyPercent=15 \
  -XX:G1MixedGCLiveThresholdPercent=90 \
  -XX:G1RSetUpdatingPauseTimePercent=5 \
  -XX:SurvivorRatio=32 \
  -XX:+PerfDisableSharedMem \
  -XX:MaxTenuringThreshold=1 \
  -Dusing.aikars.flags=https://mcflags.emc.gs \
  -Daikars.new.flags=true \
  -jar server.jar nogui
pause
```

5. Run the server once to generate `eula.txt` and accept the EULA

### 4. Configure Server Properties

Edit `server.properties` and enable RCON:

```properties
# Required for SHADOW MC HOST to control the server
enable-rcon=true
rcon.password=your-strong-password-here
rcon.port=25575

# Recommended settings
server-port=25565
max-players=20
view-distance=10
gamemode=survival
difficulty=normal
```

> ⚠️ **IMPORTANT**: Use a strong RCON password (16+ characters, mixed case, numbers, symbols)

### 5. Configure SHADOW MC HOST

Edit `manager/servers.json` to match your server setup:

```json
{
  "servers": {
    "default": {
      "name": "My Minecraft Server",
      "rootPath": "..",
      "botDir": "../mc-bot",
      "serverJar": "server.jar",
      "javaPath": null,
      "rconHost": "127.0.0.1",
      "rconPort": 25575,
      "rconPassword": "",
      "autoStart": false,
      "maxRam": "10G",
      "notes": "Primary survival server"
    }
  },
  "settings": {
    "defaultServer": "default",
    "showTerminal": false,
    "closeToTray": true,
    "autoStartDefaultServer": false,
    "autoStartDefaultBot": false
  }
}
```

**Key fields:**
- `rootPath`: Path to your server directory (relative to `manager/`)
- `botDir`: Path to Discord bot directory (relative to `manager/`)
- `rconPassword`: Your RCON password (optional, can also be in server.properties)
- `maxRam`: Maximum RAM allocation (e.g., `10G`, `4096M`)

### 6. Launch the Manager

```bash
cd manager
npm start
```

The desktop application will launch and auto-detect your server configuration.

---

## 🤖 Discord Bot Setup (Optional)

The Discord bot allows you to control your Minecraft server via Discord slash commands.

### 1. Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"**
3. Give it a name (e.g., "SHADOW MC HOST Bot")
4. Go to **Bot** → **Add Bot**
5. Copy the **Bot Token** (keep this SECRET!)

### 2. Get Guild ID

1. Enable **Developer Mode** in Discord: User Settings → Advanced → Developer Mode
2. Right-click your server name → **Copy ID**
3. This is your **GUILD_ID**

### 3. Invite Bot to Server

Replace `CLIENT_ID` with your bot's Client ID (from Discord Developer Portal):

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=274877941760&scope=bot%20applications.commands
```

Open this URL in your browser and add the bot to your server.

### 4. Configure Bot Environment

Create a file `mc-bot/.env` (this file should **NEVER** be committed to Git):

```
# Discord Bot Token (from Developer Portal)
TOKEN=your-bot-token-here

# Your Discord Server ID
GUILD_ID=your-guild-id-here

# Optional: Client ID (from Developer Portal)
CLIENT_ID=your-client-id-here

# Server Configuration
SERVER_PATH=../
SERVER_JAR=server.jar
JAVA_PATH=java

# RCON Configuration (optional - reads from server.properties by default)
RCON_HOST=127.0.0.1
RCON_PORT=25575
RCON_PASSWORD=your-rcon-password
```

> ⚠️ **CRITICAL**: Add `.env` to your `.gitignore` to prevent accidentally committing your token!

### 5. Install Bot Dependencies

```bash
cd mc-bot
npm install
```

### 6. Deploy Slash Commands

```bash
node deploy-commands.js
```

This registers the following commands:
- `/startserver` - Start the Minecraft server
- `/stopserver` - Stop the Minecraft server
- `/status` - Check server status
- `/players` - List online players
- `/tps` - Check server TPS

### 7. Start the Bot

From the `mc-bot/` directory:

```bash
node index.js
```

Or start it from the SHADOW MC HOST desktop manager UI.

---

## 🎮 Available Discord Commands

| Command | Description |
|---------|-------------|
| `/startserver` | Start the Minecraft server |
| `/stopserver` | Stop the Minecraft server (graceful shutdown) |
| `/status` | Check if server is online/offline |
| `/players` | List all online players |
| `/tps` | Check server TPS (ticks per second) |

---

## 📁 File Structure

```
SHADOW-MC-HOST/
├── manager/                   # Desktop Application
│   ├── main.js               # Main process (server management)
│   ├── preload.js            # IPC bridge
│   ├── renderer/             # User Interface
│   │   ├── index.html        # HTML structure
│   │   ├── app.js            # UI logic
│   │   └── style.css         # CSS styles
│   ├── servers.json          # Server configurations
│   └── package.json          # Node.js dependencies
├── mc-bot/                   # Discord Bot
│   ├── index.js              # Bot main file
│   ├── deploy-commands.js    # Register slash commands
│   └── package.json          # Bot dependencies
├── LICENSE                   # MIT License
├── README.md                # Project documentation
├── SETUP.md                 # This file
└── CONTRIBUTING.md          # Contribution guidelines
```

---

## ⚙️ Configuration Reference

### Server Configuration (`manager/servers.json`)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | - | Display name for the server |
| `rootPath` | string | `..` | Path to server directory |
| `botDir` | string | `../mc-bot` | Path to bot directory |
| `serverJar` | string | `server.jar` | Server JAR filename |
| `javaPath` | string | `null` | Custom Java path (auto-detected) |
| `rconHost` | string | `127.0.0.1` | RCON host address |
| `rconPort` | number | `25575` | RCON port |
| `rconPassword` | string | `""` | RCON password |
| `autoStart` | boolean | `false` | Auto-start on app launch |
| `maxRam` | string | `10G` | Max RAM allocation |
| `notes` | string | `""` | Optional description |

### Bot Configuration (`mc-bot/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `TOKEN` | ✅ Yes | Discord bot token from Developer Portal |
| `GUILD_ID` | ✅ Yes | Your Discord server ID |
| `CLIENT_ID` | ❌ No | Discord application client ID |
| `SERVER_PATH` | ❌ No | Path to Minecraft server (default: `../`) |
| `SERVER_JAR` | ❌ No | Server JAR filename (default: `server.jar`) |
| `JAVA_PATH` | ❌ No | Java executable path (default: `java`) |
| `RCON_HOST` | ❌ No | RCON host (default: `127.0.0.1`) |
| `RCON_PORT` | ❌ No | RCON port (default: `25575`) |
| `RCON_PASSWORD` | ❌ No | RCON password (default: from server.properties) |

---

## 🛠️ Troubleshooting

### Server Won't Start

1. **Check Java installation**: Run `java -version` in CMD
2. **Verify paths**: Ensure `rootPath` in `servers.json` is correct
3. **Check RCON**: Make sure RCON is enabled in `server.properties`
4. **View logs**: Check the server console for errors
5. **Port conflicts**: Ensure port 25565 is not in use

### Discord Bot Won't Connect

1. **Verify token**: Ensure `TOKEN` in `.env` is correct
2. **Check bot permissions**: Bot needs proper permissions in your server
3. **Rate limits**: Discord has rate limits; wait and retry
4. **Network issues**: Check your internet connection
5. **Token revoked**: If token was exposed, it may be revoked (create a new one)

### RCON Connection Fails

1. **Check RCON enabled**: `enable-rcon=true` in server.properties
2. **Verify password**: Ensure `rcon.password` matches
3. **Check port**: Default is 25575, must match server.properties
4. **Firewall**: Ensure port 25575 is open in your firewall
5. **Server running**: RCON only works when server is online

### RAM Monitoring Shows 0

1. **Wait for startup**: RAM polling starts after server is detected
2. **Check PID**: Ensure server process is running
3. **Java path**: Verify Java is in your PATH or set `JAVA_PATH` in `.env`

---

## 🔒 Security Best Practices

1. **Never commit `.env` files** - They contain sensitive tokens
2. **Use strong passwords** - RCON password should be 16+ characters
3. **Limit bot permissions** - Only give the bot necessary Discord permissions
4. **Keep tokens secret** - Discord bot tokens can control your server
5. **Use different tokens** - Don't reuse tokens across different bots
6. **Rotate tokens periodically** - Change tokens every few months
7. **Restrict RCON access** - Only allow RCON from trusted IPs if possible

---

## 📚 Additional Resources

- [PaperMC Documentation](https://papermc.io/docs)
- [Electron Documentation](https://www.electronjs.org/docs)
- [Discord.js Guide](https://discordjs.guide/)
- [RCON Protocol](https://wiki.vg/RCON)
- [Minecraft Wiki](https://minecraft.fandom.com/)

---

## 🙏 Support

- **Issues**: [GitHub Issues](https://github.com/SHADOW-MC-HOST/SHADOW-MC-HOST/issues)
- **Discussions**: [GitHub Discussions](https://github.com/SHADOW-MC-HOST/SHADOW-MC-HOST/discussions)
- **Source Code**: [GitHub Repository](https://github.com/SHADOW-MC-HOST/SHADOW-MC-HOST)

---

**Happy Minecrafting!** 🎮

*Built with ❤️ by SHADOW MC HOST Team*
