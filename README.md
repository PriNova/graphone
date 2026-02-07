# Pi-Tauri Cross-Platform Agent

A unified cross-platform interface for the [pi-mono](https://github.com/badlogic/pi-mono) coding agent, built with [Tauri 2.0](https://v2.tauri.app/). This project provides native applications for Desktop (Windows, macOS, Linux), Mobile (iOS, Android), and a VS Code extension.

![Project Status](https://img.shields.io/badge/status-design%20phase-blue)
![Tauri](https://img.shields.io/badge/Tauri-2.0-blueviolet)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Overview

This project implements a cross-platform coding agent interface using three architecture patterns:

| Platform | Pattern | Mechanism |
|----------|---------|-----------|
| **Desktop** | Sidecar | Rust backend spawns `pi --mode rpc` as managed subprocess |
| **Mobile** | Library | pi-mono SDK bundled within WebView; HTTP plugin for LLM APIs |
| **VS Code** | Shared Logic | Extension uses same pi-mono NPM package as frontend |

### Key Features

- 🤖 **Unified Interface** - Consistent chat UI across all platforms
- 🖥️ **Desktop Apps** - Native Windows, macOS, and Linux applications
- 📱 **Mobile Support** - iOS and Android apps with SDK integration
- 🔌 **VS Code Extension** - Seamless IDE integration
- ⚡ **Streaming Responses** - Real-time agent output
- 🔒 **Local-First** - Works with local and remote LLM providers

---

## Project Structure

```
graphone/                                # This repository
├── management/
│   └── specs/
│       ├── project-specs.md             # Original specification
│       ├── project-findings-2026-02.md  # Research & findings
│       └── wsl2-development-notes.md    # WSL2 development guide
├── src/                                 # Frontend (React + TypeScript)
│   ├── components/                      # Chat UI & code views
│   ├── hooks/                           # usePiAgent hook (RPC vs SDK)
│   └── services/                        # Tauri command bridge
├── src-tauri/                           # Rust backend
│   ├── src/                             # Process management, commands
│   ├── binaries/                        # pi sidecar binaries
│   ├── capabilities/                    # Permissions (desktop/mobile)
│   └── tauri.conf.json                  # Tauri configuration
├── vscode-extension/                    # VS Code extension
│   └── src/
│       └── extension.ts                 # VS Code API integration
└── package.json

pi-mono/                                 # Local pi-mono clone (reference)
└── packages/
    └── coding-agent/                    # @mariozechner/pi-coding-agent
        ├── docs/sdk.md                  # SDK documentation
        ├── docs/rpc.md                  # RPC protocol docs
        └── src/                         # Source code
```

---

## Prerequisites

### System Requirements

- **OS**: Linux (development), Windows 11 + WSL2, macOS
- **Node.js**: 20+ (LTS recommended)
- **Rust**: Latest stable (1.84+)
- **pnpm**: (recommended) or npm/yarn

### Platform-Specific

| Target | Requirements |
|--------|--------------|
| Linux Desktop | `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev` |
| Windows | `cargo-xwin` for cross-compilation (from WSL2) |
| Android | Android SDK, NDK, Java 17+ |
| iOS | **macOS + Xcode required** (cannot build on Linux/WSL2) |

---

## Quick Start

### 1. Clone and Setup

```bash
# Navigate to project
cd graphone

# Install dependencies
npm install

# Install Tauri CLI
cargo install tauri-cli
```

### 2. Link Local pi-mono (Optional)

For development with local pi-mono changes:

```bash
# Option 1: npm link
cd ../pi-mono/packages/coding-agent
npm link

cd ../../graphone
npm link @mariozechner/pi-coding-agent

# Option 2: Local path in package.json
# "@mariozechner/pi-coding-agent": "file:../pi-mono/packages/coding-agent"
```

### 3. Run Development Server

```bash
# Desktop (Linux)
npm run tauri dev

# With specific target
npm run tauri dev -- --target x86_64-unknown-linux-gnu
```

### 4. Build for Production

```bash
# Linux
npm run tauri build

# Windows (from WSL2)
npm run tauri build -- --target x86_64-pc-windows-msvc

# Android
npm run tauri android build
```

---

## Development

### WSL2 Development (Current Environment)

This project is developed in **WSL2 on Windows 11**. See [`management/specs/wsl2-development-notes.md`](management/specs/wsl2-development-notes.md) for detailed guidance.

**Critical:** When using WSL2, keep the project in the **Linux filesystem** (e.g., `/home/username/projects/`), NOT in `/mnt/c/` (Windows filesystem) - performance difference is 10-100x.

### Architecture Patterns

#### Desktop (Sidecar Pattern)
```
Frontend (React) ←→ Tauri Commands ←→ Rust Backend ←→ pi --mode rpc (sidecar)
                                                          ↓
                                                   stdin/stdout JSON-RPC
```

#### Mobile (Library Pattern)
```
Frontend (React) ←→ pi-mono SDK ←→ HTTP Plugin ←→ LLM APIs
       ↓
Tauri Runtime (iOS/Android)
```

#### VS Code Extension
```
VS Code ←→ Extension Host ←→ pi-mono SDK ←→ LLM APIs
              ↓
          Webview Panel (Chat UI)
```

### Key Technologies

- **Frontend**: React 18, TypeScript, Tailwind CSS
- **Backend**: Rust, Tauri 2.0
- **Agent Integration**: pi-mono SDK (`@mariozechner/pi-coding-agent`)
- **State Management**: Zustand or Jotai
- **Build Tool**: Vite

---

## Documentation

| Document | Description |
|----------|-------------|
| [`management/specs/project-specs.md`](management/specs/project-specs.md) | Original project specification |
| [`management/specs/project-findings-2026-02.md`](management/specs/project-findings-2026-02.md) | Latest research & technology findings |
| [`management/specs/wsl2-development-notes.md`](management/specs/wsl2-development-notes.md) | WSL2 development environment guide |

### External References

- **Tauri 2.0 Docs**: https://v2.tauri.app
- **pi-mono SDK**: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs/sdk.md
- **pi-mono RPC**: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs/rpc.md
- **VS Code Extension API**: https://code.visualstudio.com/api

---

## Roadmap

### Phase 1: Desktop MVP (Weeks 1-4)
- [ ] Scaffold Tauri 2.0 with React
- [ ] Implement Rust-to-RPC bridge for pi sidecar
- [ ] Basic chat UI with streaming messages
- [ ] Shell plugin configuration

### Phase 2: Mobile Adaptation (Weeks 5-8)
- [ ] Configure iOS/Android build targets
- [ ] SDK-fallback for mobile (no sidecar)
- [ ] HTTP plugin for CORS bypass
- [ ] Mobile-optimized UI

### Phase 3: VS Code Extension (Weeks 9-12)
- [ ] Extension scaffold with webview panel
- [ ] Shared logic via pi-mono SDK
- [ ] Command palette integration
- [ ] Extension packaging

### Phase 4: Polish & Distribution (Weeks 13-16)
- [ ] Responsive UI refinements
- [ ] Auto-updater integration
- [ ] App store preparation
- [ ] Documentation

---

## Contributing

This project uses the local pi-mono repository at `../pi-mono` (relative to this project) as a reference. When making changes that affect both projects:

1. Test SDK changes in pi-mono first
2. Use `npm link` or local path for integration testing
3. Ensure RPC protocol compatibility

---

## License

MIT License - See [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [pi-mono](https://github.com/badlogic/pi-mono) by Mario Zechner - The underlying coding agent
- [Tauri](https://tauri.app) - Cross-platform application framework
- [Anthropic](https://anthropic.com), [OpenAI](https://openai.com), and other LLM providers supported by pi-mono

---

**Status**: Design & scaffolding phase | **Last Updated**: February 7, 2026
