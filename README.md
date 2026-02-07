# Graphone - Pi-Tauri Cross-Platform Agent

A unified cross-platform interface for the [pi-mono](https://github.com/badlogic/pi-mono) coding agent, built with [Tauri 2.0](https://v2.tauri.app/). This project provides native applications for Desktop (Windows, macOS, Linux) using a sidecar pattern with the pi-mono agent.

![Project Status](https://img.shields.io/badge/status-development-orange)
![Tauri](https://img.shields.io/badge/Tauri-2.0-blueviolet)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Overview

Graphone provides a desktop interface for the pi-mono coding agent using Tauri's sidecar pattern:

| Platform | Pattern | Mechanism |
|----------|---------|-----------|
| **Desktop** | Sidecar | Rust backend spawns `pi --mode rpc` as managed subprocess |

### Key Features

- 🤖 **Unified Interface** - Consistent chat UI for desktop platforms
- 🖥️ **Desktop Apps** - Native Windows, macOS, and Linux applications
- ⚡ **Streaming Responses** - Real-time agent output
- 🔒 **Local-First** - Works with local and remote LLM providers
- 📦 **Auto-Bundled Agent** - pi-mono binary is built automatically during Tauri build

---

## Architecture

### pi-mono Sidecar (Node.js/TypeScript)

**Important:** pi-mono is a **Node.js/TypeScript project**, not a Rust project. It's built into a standalone binary using **bun**:

```
Frontend (Svelte) ←→ Tauri Commands ←→ Rust Backend ←→ pi sidecar (bun-compiled)
                                                          ↓
                                                   stdin/stdout JSON-RPC
```

The pi-mono agent is located at `../pi-mono` (relative to this project) and is automatically built during the Tauri build process via `src-tauri/build.rs`.

**Build Process:**
1. pi-mono source (TypeScript) is compiled using `bun build --compile`
2. The resulting binary is copied to `src-tauri/binaries/`
3. Tauri bundles the binary as a sidecar for distribution

---

## Prerequisites

### System Requirements

- **OS**: Linux (development), Windows 11 + WSL2, macOS
- **Node.js**: 20+ (LTS recommended)
- **bun**: 1.0+ (Required for building pi-mono sidecar)
- **Rust**: Latest stable (1.84+)

### Platform-Specific

| Target | Requirements |
|--------|--------------|
| Linux Desktop | `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `clang`, `lld` |
| Windows | `cargo-xwin` for cross-compilation (from WSL2) |

### Build Configuration

The project uses **lld** (LLVM linker) for faster linking on Linux and Android targets. Cross-compilation for Windows uses `lld-link` via `cargo-xwin`. This is configured in `src-tauri/.cargo/config.toml`:

```toml
# Linux x86_64: Use lld for faster linking
[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=lld"]

# Windows x86_64: Use lld-link via cargo-xwin
[target.x86_64-pc-windows-msvc]
linker = "lld-link"

# Android targets: Use lld
[target.aarch64-linux-android]
linker = "lld"
```

### Required Tools

```bash
# Install bun (required for pi-mono sidecar)
curl -fsSL https://bun.sh/install | bash

# Verify bun installation
bun --version  # Should show 1.0+
```

---

## Quick Start

### 1. Clone and Setup

**Repository Structure:**
```
projects/
├── pi-mono/          # Clone this first (../pi-mono from graphone)
│   └── packages/
│       └── coding-agent/
└── graphone/         # This repository
```

```bash
# Navigate to project
cd graphone

# Install dependencies
npm install
```

### 2. Build pi-mono Sidecar (Automatic)

The pi-mono sidecar is built automatically when you run Tauri commands. The build script (`src-tauri/build.rs`) handles:
- Running `npm install` in pi-mono if needed
- Building the binary with `bun build --compile`
- Copying to the correct location for Tauri bundling

**Manual build (if needed):**
```bash
cd ../pi-mono/packages/coding-agent
npm install
bun build --compile ./dist/cli.js --outfile dist/pi
```

### 3. Run Development Server

```bash
# Desktop (Linux) - recommended shorthand
npm run dev:linux

# Desktop (Windows cross-compile from WSL2)
npm run dev:windows

# Legacy command
npm run tauri dev
```

### 4. Build for Production

**Quick Build Commands:**
```bash
# Linux only
npm run build:linux

# Windows only (cross-compile from WSL2)
npm run build:windows

# Both platforms
npm run build:all
```

**Legacy commands (equivalent):**
```bash
# Linux
npm run tauri build

# Windows (from WSL2)
npm run tauri build -- --target x86_64-pc-windows-msvc
```

---

## Project Structure

```
graphone/
├── src/                      # Frontend (Svelte + TypeScript)
│   ├── components/           # UI components
│   ├── hooks/                # Reactive state and logic
│   └── services/             # Tauri command bridge
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── lib.rs            # Main library with commands
│   │   └── main.rs           # Entry point
│   ├── binaries/             # Sidecar binaries (auto-populated)
│   ├── capabilities/         # Permissions
│   │   ├── default.json      # Base capabilities
│   │   ├── desktop.json      # Desktop-specific (shell plugin)
│   │   └── mobile.json       # Mobile-specific (HTTP plugin)
│   ├── build.rs              # Build script (builds pi-mono sidecar)
│   ├── Cargo.toml            # Rust dependencies
│   └── tauri.conf.json       # Tauri configuration
├── management/
│   └── specs/                # Project documentation
│       ├── project-specs.md
│       ├── wsl2-development-notes.md
│       └── tasks.md
├── package.json              # Node dependencies
└── vite.config.js            # Vite configuration
```

---

## Development

### WSL2 Development

This project is developed in **WSL2 on Windows 11**. See [`management/specs/wsl2-development-notes.md`](management/specs/wsl2-development-notes.md) for detailed guidance.

**Critical:** Keep the project in the **Linux filesystem** (e.g., `/home/username/projects/`), NOT in `/mnt/c/` (Windows filesystem) - performance difference is 10-100x.

### Sidecar Build Process

The sidecar binary is built automatically via `src-tauri/build.rs`:

1. **Dependency Check**: Verifies bun is installed
2. **npm install**: Runs in pi-mono if `node_modules` is missing
3. **Compile**: Runs `npm run build:binary` in pi-mono
   - This uses `bun build --compile` to create a standalone binary
4. **Copy**: Places the binary in `target/<profile>/binaries/` with the correct naming convention
5. **Permissions**: Sets executable permissions on Unix systems

**Environment Variables:**
- `CARGO_MANIFEST_DIR`: Used to locate the project root
- `TARGET`: Target triple for cross-compilation
- `CARGO_CFG_TARGET_OS`: Used to detect mobile builds (skipped)

### Key Technologies

- **Frontend**: Svelte 5, TypeScript, Vite
- **Backend**: Rust, Tauri 2.0
- **Agent**: pi-mono SDK (`@mariozechner/pi-coding-agent`)
- **Sidecar Build**: bun (compiles TypeScript to standalone binary)

---

## Build Scripts

Convenience npm scripts for cross-platform builds:

| Script | Platform | Description |
|--------|----------|-------------|
| `npm run dev:linux` | Linux | Run dev server (native) |
| `npm run dev:windows` | Windows | Run dev server (cross-compile) |
| `npm run build:linux` | Linux | Build AppImage/Deb packages |
| `npm run build:windows` | Windows | Build MSI/NSIS installer (cross-compile) |
| `npm run build:all` | Both | Build Linux + Windows packages |

**Examples:**
```bash
# Quick development - Linux
npm run dev:linux

# Build for both platforms from WSL2
npm run build:all
```

---

## Build Configuration

### Cargo Configuration

The project uses a custom `.cargo/config.toml` for optimized builds and cross-compilation:

```toml
[build]
# Linker settings are configured per-target below

[profile.dev]
# Faster debug builds with incremental compilation
incremental = true
codegen-units = 16

[profile.release]
# Optimized release builds with thin LTO
lto = "thin"
codegen-units = 1
opt-level = 3

# Linux: Use lld for faster linking
[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=lld"]

# Windows: Use lld-link via cargo-xwin
[target.x86_64-pc-windows-msvc]
linker = "lld-link"

# Android: Use lld (included in NDK)
[target.aarch64-linux-android]
linker = "lld"
```

**Benefits:**
- **lld linker**: 2-10x faster linking compared to default system linker
- **Incremental compilation**: Faster rebuilds during development
- **Thin LTO**: Better optimized release builds without full LTO overhead
- **Cross-compilation ready**: Configured for Linux, Windows, and Android targets

### tauri.conf.json

Key configuration for sidecar support:

```json
{
  "bundle": {
    "externalBin": ["binaries/pi-agent"]
  },
  "plugins": {
    "shell": {
      "open": true
    }
  }
}
```

### Capabilities

- **desktop.json**: Shell plugin permissions for spawning sidecar
- **mobile.json**: HTTP plugin for SDK-only mode (future use)

---

## Troubleshooting

### bun not found

```bash
# Install bun
curl -fsSL https://bun.sh/install | bash

# Add to PATH in ~/.bashrc or ~/.zshrc
export PATH="$HOME/.bun/bin:$PATH"
```

### Sidecar build fails

```bash
# Check pi-mono exists at correct location
ls ../pi-mono/packages/coding-agent

# Manual build for debugging
cd ../pi-mono/packages/coding-agent
npm run build:binary
```

### Binary not found during Tauri build

Ensure the binary naming matches the target triple:
- Linux: `pi-agent-x86_64-unknown-linux-gnu`
- Windows: `pi-agent-x86_64-pc-windows-msvc.exe`

---

## Documentation

| Document | Description |
|----------|-------------|
| [`management/specs/project-specs.md`](management/specs/project-specs.md) | Original project specification |
| [`management/specs/wsl2-development-notes.md`](management/specs/wsl2-development-notes.md) | WSL2 development environment guide |
| [`management/specs/tasks.md`](management/specs/tasks.md) | Setup tasks and checklist |

### External References

- **Tauri 2.0 Docs**: https://v2.tauri.app
- **pi-mono SDK**: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs/sdk.md
- **pi-mono RPC**: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs/rpc.md
- **bun Documentation**: https://bun.sh/docs

---

## Contributing

This project uses the local pi-mono repository at `../pi-mono` (relative to this project). When making changes:

1. pi-mono changes: Edit in `../pi-mono`, the build script will pick them up
2. The build script automatically rebuilds pi-mono when `src/` or `package.json` changes
3. Test changes with `cargo build` or `npm run tauri dev`

---

## License

MIT License - See [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [pi-mono](https://github.com/badlogic/pi-mono) by Mario Zechner - The underlying coding agent (Node.js/TypeScript)
- [Tauri](https://tauri.app) - Cross-platform application framework
- [bun](https://bun.sh) - JavaScript runtime and bundler used for sidecar compilation
- [Anthropic](https://anthropic.com), [OpenAI](https://openai.com), and other LLM providers supported by pi-mono

---

**Status**: Active development | **Last Updated**: February 7, 2026
