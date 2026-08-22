# SHADOW MC HOST

> **The Ultimate One-Click Minecraft Server Manager for Windows**

A powerful, user-friendly desktop application for managing PaperMC Minecraft servers with built-in Discord bot integration, RCON control, real-time monitoring, and **complete one-click setup**.

![Dashboard](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&style=flat-square)
![Electron](https://img.shields.io/badge/Electron-2B2E3A?logo=electron&style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

---

## \u26a1 Features

- **One-Click Setup**: Automatically checks, installs, and configures everything needed
- **Auto-Download PaperMC**: Downloads the latest PaperMC server if missing
- **Server Management**: Start, stop, restart Minecraft servers with one click
- **Real-time Monitoring**: RAM usage, TPS, uptime, and player count
- **Live Console**: Stream server logs in real-time
- **RCON Support**: Execute server commands remotely
- **Discord Bot Integration**: Control your server via Discord slash commands
- **System Tray Support**: Minimize to tray for background operation
- **Multi-Server Ready**: Configurable server profiles
- **Auto-Start**: Configure servers to start automatically on app launch
- **Player Management**: View online players, kick, op/deop
- **Auto-Configuration**: Creates all necessary files automatically

---

## \ud83d\udce5 Quick Start (One-Click Method)

### For Non-Tech Users:

1. **Clone the repository**
   ```bash
   git clone https://github.com/SHADOW-MC-HOST/SHADOW-MC-HOST.git
   cd SHADOW-MC-HOST
   ```

2. **Double-click `LAUNCHER.bat`**
   
   That's it! The launcher will:
   - Check for Node.js and install if missing
   - Check for Java 25+ and install if missing
   - Download PaperMC server automatically
   - Create all configuration files
   - Install npm dependencies
   - Launch the manager UI

3. **In the manager app**, click the big **"One-Click Start Everything"** button

### For Tech Users:

```bash
# Clone and enter
cd SHADOW-MC-HOST

# Run the launcher (does everything automatically)
LAUNCHER.bat

# Or manually:
setup.bat          # Check and install prerequisites
start.bat          # Start Minecraft server
start-manager.bat  # Start desktop manager
start-bot.bat      # Start Discord bot (configure .env first)
```

---

## \ud83c\udfae Discord Bot Setup

### Quick Setup:
1. Edit `mc-bot/.env` with your Discord bot token
2. Click "Start Bot" in the manager
3. Use Discord commands to control your server

### Detailed Setup:

1. Create a Discord bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. Copy the bot token
3. Configure in `mc-bot/.env`:
   ```
   TOKEN=your-bot-token
   GUILD_ID=your-server-id
   CLIENT_ID=your-application-id
   SERVER_PATH=../server
   SERVER_JAR=server.jar
   JAVA_PATH=java
   RCON_HOST=127.0.0.1
   RCON_PORT=25575
   RCON_PASSWORD=your-rcon-password
   ```
4. Start the bot from the manager app or run `node index.js` in `mc-bot/`

### Available Discord Commands

- `/startserver` - Start the Minecraft server
- `/stopserver` - Stop the Minecraft server (graceful shutdown)
- `/status` - Check if server is online/offline
- `/players` - List all online players
- `/tps` - Check server TPS (ticks per second)

---

## \ud83d\udcc1 Project Structure

```
SHADOW-MC-HOST/
├── LAUNCHER.bat              # One-click launcher (RECOMMENDED)
├── setup.bat                 # Setup script (legacy)
├── start.bat                 # Start Minecraft server
├── start-manager.bat         # Start desktop manager
├── start-bot.bat             # Start Discord bot
├── server/                   # Minecraft server files (auto-created)
│   ├── server.jar           # PaperMC server JAR
│   ├── server.properties    # Server configuration
│   ├── eula.txt             # EULA acceptance
│   └── logs/                # Server logs
├── manager/                  # Desktop Application
│   ├── main.js              # Main process (server management)
│   ├── preload.js           # IPC bridge
│   ├── renderer/            # User Interface
│   │   ├── index.html       # HTML structure
│   │   ├── app.js           # UI logic
│   │   └── style.css        # CSS styles
│   ├── servers.json         # Server configurations
│   └── package.json         # Node.js dependencies
└── mc-bot/                  # Discord Bot
    ├── index.js             # Bot entry point
    ├── deploy-commands.js   # Slash command registration
    └── package.json          # Bot dependencies
```

---

## \ud83d\udee0\ufe0f Development

### Running in Development

```bash
# From manager/ directory
cd manager
npm install
electron .
```

### Packaging for Distribution

```bash
# Install electron-builder
npm install electron-builder --save-dev

# Build for Windows
npx electron-builder --win --x64
```

---

## \ud83e\udd1d Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## \ud83d\udcdc License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## \ud83d\ude4f Acknowledgments

- [Electron](https://www.electronjs.org/) - Cross-platform desktop apps with JavaScript
- [PaperMC](https://papermc.io/) - High-performance Minecraft server
- [Discord.js](https://discord.js.org/) - Powerful Discord API library
- [rcon-client](https://github.com/JorelAli/rcon-client) - RCON protocol client

---

## \ud83d\udcde Support

- **Issues**: [GitHub Issues](https://github.com/SHADOW-MC-HOST/SHADOW-MC-HOST/issues)
- **Discussions**: [GitHub Discussions](https://github.com/SHADOW-MC-HOST/SHADOW-MC-HOST/discussions)

---

**Made with \u2764\ufe0f for the Minecraft community**

---

## \u2753 Troubleshooting

### Server Won't Start

1. **Check Java installation**: Run `java -version` in CMD
2. **Verify paths**: Ensure `rootPath` in `servers.json` is correct
3. **Check RCON**: Make sure RCON is enabled in `server.properties`
4. **View logs**: Check the server console for errors
5. **Port conflicts**: Ensure port 25565 is not in use

### One-Click Setup Fails

1. **Windows only**: This launcher is designed for Windows
2. **Admin rights**: Some installations may require admin privileges
3. **Internet connection**: Required for downloading PaperMC and Node.js
4. **Check LAUNCHER.bat output**: It shows detailed progress and errors

### Discord Bot Won't Connect

1. **Verify token**: Ensure `TOKEN` in `.env` is correct
2. **Check bot permissions**: Bot needs proper permissions in your server
3. **Rate limits**: Discord has rate limits; wait and retry
4. **Network issues**: Check your internet connection
5. **Token revoked**: If token was exposed, it may be revoked (create a new one)
