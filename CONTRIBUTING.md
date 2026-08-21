# Contributing to Shadow MC Host

Thank you for your interest in contributing to Shadow MC Host! This document provides guidelines for contributing to the project.

---

## 📋 Code of Conduct

By participating in this project, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Git
- Windows development environment (primary target platform)

### Setup

```bash
# Clone the repository
git clone https://github.com/shadowindiestudio/mcserver.git
cd mcserver

# Install dependencies for manager
cd manager
npm install

# Install dependencies for Discord bot
cd ../mc-bot
npm install
```

---

## 🛠️ Development Workflow

### Branching

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
3. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

### Branch Naming Conventions

| Type | Prefix | Example |
|------|--------|---------|
| Feature | `feature/` | `feature/multi-server-support` |
| Bug Fix | `fix/` | `fix/rcon-connection-issue` |
| Documentation | `docs/` | `docs/setup-guide` |
| Refactor | `refactor/` | `refactor/core-module` |
| Chore | `chore/` | `chore/update-dependencies` |

### Committing

- Use **clear, descriptive commit messages**
- Follow the [Conventional Commits](https://www.conventionalcommits.org/) format
- Each commit should represent a **single logical change**

**Good examples:**
```
feat: add server profile switching
fix: prevent RCON connection leak on error
chore: update electron to v30.0.6
docs: add multi-server setup guide
```

**Bad examples:**
```
fixed stuff
wip
update
```

---

## 📁 Project Structure

```
mcserver/
├── manager/                 # Electron application
│   ├── main.js             # Main process - server management core
│   ├── preload.js          # IPC bridge between main and renderer
│   ├── renderer/           # Frontend UI
│   │   ├── index.html      # HTML structure
│   │   ├── app.js          # UI logic and state
│   │   └── style.css       # CSS styles
│   └── servers.json        # Server configurations
├── mc-bot/                 # Discord bot
│   ├── index.js            # Bot entry point
│   └── deploy-commands.js  # Slash command registration
└── README.md               # Project documentation
```

---

## 🎯 Contribution Guidelines

### General Principles

1. **Preserve existing functionality** - Don't break what works
2. **Keep changes minimal** - Smaller PRs are easier to review
3. **Follow existing patterns** - Match the code style and architecture
4. **Test your changes** - Ensure nothing is broken
5. **Document your changes** - Update README, comments, etc.

### Code Style

- Use **2 spaces** for indentation (not tabs)
- Use **single quotes** for strings (except when escaping)
- Use **semicolons** at the end of statements
- Use **camelCase** for variables and functions
- Use **PascalCase** for classes
- Use **UPPER_SNAKE_CASE** for constants
- Add **JSDoc comments** for functions and complex logic

### Pull Request Requirements

1. **Clear title** - Describes what the PR does
2. **Detailed description** - Explains the what, why, and how
3. **Linked issues** - Reference any related issues with `#123`
4. **Screenshots** - For UI changes, include before/after screenshots
5. **Testing** - Describe how you tested your changes

---

## 🔍 Testing

### Manual Testing

1. Start the manager: `npm start` (from manager/ directory)
2. Test all server controls (start, stop, restart)
3. Test RCON commands
4. Test Discord bot integration
5. Test settings changes
6. Verify logs are streaming correctly

### Test Checklist

- [ ] Server starts and stops correctly
- [ ] RAM monitoring works
- [ ] RCON commands execute
- [ ] Console output streams in real-time
- [ ] Player list updates
- [ ] TPS monitoring works
- [ ] Settings save and load correctly
- [ ] Discord bot connects and responds to commands
- [ ] System tray works (minimize, restore, quit)

---

## 🎨 UI Changes

When contributing UI changes:

1. **Follow the existing design language**
2. **Keep it simple and functional**
3. **Ensure responsiveness** (works at different window sizes)
4. **Use consistent colors and spacing**
5. **Test on Windows** (primary target platform)

---

## 🏗️ Architecture Notes

### Core Design Principles

1. **Separation of Concerns**
   - Main process handles server management
   - Renderer process handles UI
   - Communication via IPC

2. **Single-Server Architecture** (currently)
   - All paths and state assume one active server
   - Multi-server support is a future goal

3. **Configuration**
   - Server paths in `servers.json`
   - Server settings in `server.properties`
   - Bot settings in `mc-bot/.env`
   - Manager settings in `manager/manager-settings.json`

### Future Architecture (Multi-Server)

The project is being prepared for multi-server support:

```
Electron App
    ↓
Server Manager (per-server instances)
    ↓
Server Config (from servers.json)
```

Each server will have:
- Its own process management
- Its own RCON connection
- Its own log tailer
- Its own monitoring

---

## 📚 Documentation

When adding new features or changing existing ones:

1. **Update README.md** if the setup or usage changes
2. **Add inline comments** for non-obvious code
3. **Update this file** if contribution guidelines change

---

## ❓ Need Help?

If you have questions about contributing:

1. Check the [GitHub Discussions](https://github.com/shadowindiestudio/mcserver/discussions)
2. Open an issue with your question
3. Join our Discord (if available)

---

## 🙏 Thank You!

Your contributions help make Shadow MC Host better for everyone in the Minecraft community. We appreciate your time and effort!

---

**Happy Coding!** 🎮
