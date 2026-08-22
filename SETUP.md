# SHADOW MC HOST Setup Guide

This project has a Minecraft server, a desktop manager, and an optional Discord bot. The easiest way is to run the setup script once and let it check everything for you.

---

## The easiest way: one-click setup

1. Open a terminal in the project folder.
2. Run:

```bat
setup.bat
```

3. The script will:
   - check whether Node.js is installed
   - install Node.js if it is missing
   - check whether Git is installed
   - install Git if it is missing
   - check Java
   - install Java 25 if it is missing
   - install the manager and bot dependencies
   - check whether the server JAR exists
   - create a basic bot config if needed
   - tell you the next startup steps

> Important: Paper 26.2 requires Java 25 or newer. If Java 21 is installed, it will not start correctly.

---

## Files you should have in the main folder

Your project should look roughly like this:

```text
SHADOW-MC-HOST/
├── setup.bat
├── start.bat
├── start-manager.bat
├── start-bot.bat
├── server/
│   ├── server.jar
│   ├── eula.txt
│   ├── server.properties
│   └── ...
├── manager/
│   ├── package.json
│   └── ...
├── mc-bot/
│   ├── .env
│   ├── package.json
│   └── ...
└── ...
```

---

## Start the server

If the setup script already ran successfully, start the Minecraft server with:

```bat
start.bat
```

This is the correct startup file for the project. It changes to the server folder, uses Java 25, and launches the Paper server.

---

## Start the desktop manager

To open the Electron app:

```bat
start-manager.bat
```

This runs the desktop manager from the manager folder.

---

## Start the Discord bot

If you want the Discord bot, first open the bot config file and replace the placeholder values:

```text
mc-bot/.env
```

Example:

```env
TOKEN=your-real-bot-token
GUILD_ID=123456789012345678
CLIENT_ID=123456789012345678
SERVER_PATH=../
SERVER_JAR=server.jar
JAVA_PATH=C:\Program Files\Zulu\zulu-25\bin\java.exe
RCON_HOST=127.0.0.1
RCON_PORT=25575
RCON_PASSWORD=change-this-local-password
```

Then run:

```bat
start-bot.bat
```

---

## What the setup script checks

The script checks these things automatically:

- Node.js is installed
- Git is installed
- Java 25 is installed
- the Paper server JAR is present in the server folder
- the manager dependencies are installed
- the bot dependencies are installed
- the bot config file exists
- the EULA file exists and is accepted

If something is missing, it tries to install it for you.

---

## Important notes

- PaperMC 26.2 needs Java 25 or newer.
- The server should live in the server folder.
- If the bot is not working, the most common issue is a missing or invalid Discord token.
- If the server does not start, make sure the JAR in the server folder is the actual Paper server JAR.

---

## Quick repeat steps for a beginner

1. Double-click setup.bat
2. Wait for it to finish
3. Double-click start.bat
4. Double-click start-manager.bat
5. If you want the bot, edit mc-bot/.env and then double-click start-bot.bat

That is the easiest way to get everything working with no guesswork.
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
