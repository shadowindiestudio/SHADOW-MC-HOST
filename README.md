# SHADOW MC HOST

> **Open-source Minecraft server management for Windows**

A powerful, user-friendly desktop application for managing PaperMC Minecraft servers with built-in Discord bot integration, RCON control, and real-time monitoring.

![Dashboard](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&style=flat-square)
![Electron](https://img.shields.io/badge/Electron-2B2E3A?logo=electron&style=flat-square)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

---

## ⚡ Features

- **Server Management**: Start, stop, restart Minecraft servers with one click
- **Real-time Monitoring**: RAM usage, TPS, uptime, and player count
- **Live Console**: Stream server logs in real-time
- **RCON Support**: Execute server commands remotely
- **Discord Bot Integration**: Control your server via Discord slash commands
- **System Tray Support**: Minimize to tray for background operation
- **Multi-Server Ready**: Configurable server profiles (coming soon)
- **Auto-Start**: Configure servers to start automatically on app launch
- **Player Management**: View online players, kick, op/deop
- **Settings**: Configure server properties, RAM, RCON, and more

---

## 📥 Quick Start

### Prerequisites

- **Windows 10/11** (macOS/Linux support planned)
- **Node.js 18+**
- **Java 17+** (for Minecraft server)
- **PaperMC server files** in a folder next to `manager/`

### Installation

```bash
# Clone the repository
git clone https://github.com/SHADOW-MC-HOST/SHADOW-MC-HOST.git
cd mcserver

# Install dependencies (in manager directory)
cd manager
npm install

# Configure your server
# Edit manager/servers.json to point to your server directory

# Start the manager
npm start
```

### First Run Setup

1. Place your PaperMC `server.jar` and `start.bat` in a folder (e.g., `../`)
2. Run `npm start` from the `manager/` directory
3. The app will auto-detect your server or you can configure it in `servers.json`
4. Configure RCON in `server.properties`:
   ```properties
   enable-rcon=true
   rcon.password=your-strong-password
   rcon.port=25575
   ```

---

## 🎮 Discord Bot Setup

1. Create a Discord bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. Copy the bot token
3. Configure in `mc-bot/.env`:
   ```
   TOKEN=your-bot-token
   RCON_PASSWORD=your-rcon-password
   RCON_HOST=127.0.0.1
   RCON_PORT=25575
   SERVER_PATH=../
   SERVER_JAR=server.jar
   JAVA_PATH=java
   ```
4. Start the bot from the manager app or run `node index.js` in `mc-bot/`

### Available Discord Commands

- `/startserver` - Start the Minecraft server
- `/stopserver` - Stop the Minecraft server
- `/status` - Check server status
- `/players` - List online players
- `/tps` - Check server TPS

---

## 📁 Project Structure

```
mcserver/
├── manager/                 # Electron desktop application
│   ├── main.js             # Main process (server management)
│   ├── preload.js          # IPC bridge
│   ├── renderer/           # UI files
│   │   ├── index.html      # Main window
│   │   ├── app.js          # UI logic
│   │   └── style.css       # Styling
│   └── servers.json        # Server configurations
├── mc-bot/                 # Discord bot
│   ├── index.js            # Bot main file
│   └── deploy-commands.js  # Slash command registration
└── server.properties        # Minecraft server config
```

---

## 🔧 Configuration

### Server Configuration (`manager/servers.json`)

```json
{
  "servers": {
    "default": {
      "name": "My Server",
      "rootPath": "..",
      "botDir": "../mc-bot",
      "serverJar": "server.jar",
      "javaPath": null,
      "rconHost": "127.0.0.1",
      "rconPort": 25575,
      "rconPassword": "",
      "autoStart": false,
      "maxRam": "10G",
      "notes": "Main survival server"
    },
    "creative": {
      "name": "Creative World",
      "rootPath": "../creative-server",
      "botDir": "../mc-bot",
      "maxRam": "8G",
      "autoStart": false
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

### Manager Settings

Configure in the app's Settings panel:
- **Show Terminal Windows**: Display CMD windows when starting processes
- **Minimize to System Tray**: Hide to tray instead of quitting
- **Auto-Start Server**: Start server automatically on app launch
- **Auto-Start Bot**: Start Discord bot automatically on app launch

---

## 🛠️ Development

### Running in Development

```bash
# From manager/ directory
npm start
```

### Packaging for Distribution

```bash
# Install electron-builder
npm install electron-builder --save-dev

# Build for Windows
npx electron-builder --win --x64
```

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Contribution Guidelines

- Keep changes focused and minimal
- Preserve existing functionality
- Follow the existing code style
- Add comments for non-obvious logic
- Test your changes before submitting

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Electron](https://www.electronjs.org/) - Cross-platform desktop apps with JavaScript
- [PaperMC](https://papermc.io/) - High-performance Minecraft server
- [Discord.js](https://discord.js.org/) - Powerful Discord API library
- [rcon-client](https://github.com/JorelAli/rcon-client) - RCON protocol client

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/SHADOW-MC-HOST/SHADOW-MC-HOST/issues)
- **Discussions**: [GitHub Discussions](https://github.com/SHADOW-MC-HOST/SHADOW-MC-HOST/discussions)

---

**Made with ❤️ for the Minecraft community**
