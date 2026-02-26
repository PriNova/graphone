# Graphone - Pi-Tauri Cross-Platform Agent

📌 **Feature availability (what works today):** [FEATURES.md](./FEATURES.md)

A unified cross-platform interface for the [pi-mono](https://github.com/badlogic/pi-mono) coding agent, built with [Tauri 2.0](https://v2.tauri.app/). This project provides native applications for Desktop (Windows, macOS, Linux) using a sidecar pattern with the pi-mono agent.

![Project Status](https://img.shields.io/badge/status-development-orange)
![Tauri](https://img.shields.io/badge/Tauri-2.0-blueviolet)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Overview

Graphone provides a desktop interface for the pi-mono coding agent using Tauri's sidecar pattern:

| Platform            | Pattern                   | Mechanism                                                                                                 |
| ------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Windows / macOS** | Sidecar (`externalBin`)   | Rust backend spawns bundled `pi-agent` binary via Tauri sidecar integration                               |
| **Linux**           | Sidecar (resource bundle) | Build stages `sidecar/linux/pi-agent.gz` + runtime assets; app extracts to app-local runtime and launches |

### Key Features

- 🤖 **Unified Interface** - Consistent chat UI for desktop platforms
- 🗜️ **Compact Mode** - Switch between full workspace and compact capsule mode (with a collapsible scope drawer)
- 🖥️ **Desktop Apps** - Native Windows, macOS, and Linux applications
- ⚡ **Streaming Responses** - Real-time agent output
- 🔒 **Local-First** - Works with local and remote LLM providers
- 📦 **Auto-Bundled Agent** - pi-mono binary is built automatically during Tauri build

Contributor notes:

- See `CONTRIBUTING.md` for repository workflow and staging guidance.

---

## Architecture

### pi-mono Sidecar (Node.js/TypeScript)

**Important:** pi-mono is a **Node.js/TypeScript project**, not a Rust project. It's built into a standalone binary using **bun**:

```
Frontend (Svelte) ←→ Tauri Commands ←→ Rust Backend ←→ Graphone host sidecar (bun-compiled)
                                                                   ↓
                                                         stdin/stdout JSON protocol
```

The host sidecar is built automatically during Tauri builds via `src-tauri/build.rs`.

Graphone compiles `services/agent-host/dist/cli.js` to a standalone binary with bun.
Runtime SDK assets are copied from the pinned npm dependency (`node_modules/@mariozechner/pi-coding-agent`).

**Build Process:**

1. Build host sidecar source (`services/agent-host`)
2. Compile `dist/cli.js` using `bun build --compile`
3. Copy binary + runtime assets to `src-tauri/binaries/`
4. Bundle sidecar by platform:
   - Windows/macOS: Tauri bundles `binaries/pi-agent` via `externalBin`
   - Linux: build script stages `src-tauri/sidecar/linux` with `pi-agent.gz` + runtime assets
5. Linux runtime startup: app extracts `pi-agent.gz` into app-local data and launches from that extracted runtime directory

---

## Prerequisites

### System Requirements

- **OS**: Linux (native or VM), Windows 11, macOS
- **Node.js**: 20+ (LTS recommended)
- **bun**: 1.0+ (Required for sidecar compilation)
- **Rust**: Latest stable (1.84+)

### Platform-Specific

| Target        | Requirements                                                                    |
| ------------- | ------------------------------------------------------------------------------- |
| Linux Desktop | `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `clang`, `lld` |
| Windows       | `cargo-xwin`, `nsis`, `lld`, `llvm` for cross-compilation from Linux            |

### Build Configuration

The project uses **lld** (LLVM linker) for faster linking on Linux and Android targets. Cross-compilation for Windows uses `cargo-xwin` which automatically handles the Windows SDK libraries and linker configuration.

**Configured in `src-tauri/.cargo/config.toml`:**

```toml
# Linux x86_64: Use lld for faster linking
[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=lld"]

# Windows x86_64: Use cargo-xwin (no linker config needed)
# cargo-xwin is invoked via --runner flag
# This is handled automatically by npm run build:windows

# Android targets: Use lld
[target.aarch64-linux-android]
linker = "lld"
```

**Windows Cross-Compilation:**

```bash
# Install NSIS (required for creating Windows installers on Linux)
sudo apt install nsis lld llvm

# Install cargo-xwin (downloads Windows SDK automatically)
cargo install cargo-xwin

# Build for Windows (creates NSIS installer, not MSI)
npm run build:windows
```

**Important:** MSI installers can only be created on Windows. Cross-compilation from Linux creates NSIS installers (`-setup.exe`).

### Required Tools

```bash
# Install bun (required for sidecar compilation)
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
└── graphone/         # This repository
```

```bash
# Navigate to project
cd graphone

# Install dependencies
npm install
```

### 2. Build Sidecar (Automatic)

The sidecar is built automatically when you run Tauri commands. The build script (`src-tauri/build.rs`) handles:

- Building Graphone host sidecar source (`services/agent-host`)
- Compiling `dist/cli.js` with `bun build --compile`
- Copying binary + runtime assets to `src-tauri/binaries/`
- Staging Linux bundle resources under `src-tauri/sidecar/linux` (`pi-agent.gz` + runtime assets)

### 3. Run Development Server

```bash
# Desktop (Linux) - recommended shorthand
npm run dev:linux

# Desktop (Windows cross-compile from Linux)
npm run dev:windows

# Legacy command
npm run tauri dev
```

### 4. Build for Production

**Quick Build Commands:**

```bash
# Linux only
npm run build:linux

# Windows only (cross-compile from Linux)
npm run build:windows

# Both platforms
npm run build:all
```

**Legacy commands (equivalent):**

```bash
# Linux
npm run tauri build

# Windows (from Linux)
npm run tauri build -- --target x86_64-pc-windows-msvc
```

---

## Project Structure

```
graphone/
├── apps/
│   └── desktop/
│       └── web/                      # Svelte frontend application
│           ├── src/                  # Routes, components, stores, handlers
│           └── static/               # Static frontend assets
├── src-tauri/                        # Rust/Tauri desktop shell
│   ├── src/                          # Commands, sidecar bridge, state
│   ├── binaries/                     # Sidecar binaries + runtime assets (auto-populated)
│   ├── sidecar/linux/                # Linux resource bundle (auto-populated, includes pi-agent.gz)
│   ├── capabilities/                 # Tauri permissions (desktop/mobile)
│   ├── build.rs                      # Builds/stages sidecar binaries and Linux resource bundle
│   ├── Cargo.toml
│   ├── tauri.conf.json               # Base config (Windows/macOS sidecar externalBin)
│   └── tauri.linux.conf.json         # Linux bundle override (resource-based sidecar)
├── services/
│   └── agent-host/                   # Graphone host sidecar source (TypeScript)
│       ├── src/
│       └── dist/
├── tooling/
│   └── scripts/                      # Build/run/verification helpers
├── reports/                          # Benchmark and measurement output
└── package.json
```

Frontend canonical paths:

- `apps/desktop/web/src`
- `apps/desktop/web/static`

Canonical repo map (quick):

- `apps/desktop/web` → Svelte frontend workspace
- `src-tauri` → Rust/Tauri desktop shell
- `services/agent-host` → bun-compiled host sidecar source
- `tooling/scripts` → build/run/verification helpers

---

## Development

### Linux Development (Native or VM)

This project is developed and tested in **Linux environments** (native installs and VMs).

**Critical:** Keep the project on a fast local Linux filesystem (e.g., `/home/username/projects/`) rather than shared/network-mounted folders to avoid major I/O slowdowns.

### Sidecar Build Process

The sidecar binary is built automatically via `src-tauri/build.rs`:

1. **Dependency Check**: Verifies bun is installed
2. **Host Build**: Builds Graphone host source (`services/agent-host`)
3. **Compile**: Runs `bun build --compile ./dist/cli.js`
   - Uses an explicit bun target when cross-compiling Windows from Linux
4. **Copy**: Places the binary in `src-tauri/binaries/` with Tauri sidecar naming
5. **Assets**: Copies runtime assets (`package.json`, docs/examples, theme, export-html, `photon_rs_bg.wasm`) from `@mariozechner/pi-coding-agent`
6. **Linux Bundle Stage**: Compresses the Linux binary to `src-tauri/sidecar/linux/pi-agent.gz` and stages runtime assets for Linux packaging/runtime extraction

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

| Script                           | Platform | Description                                                                                             |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `npm run dev:linux`              | Linux    | Run dev server (native)                                                                                 |
| `npm run dev:windows`            | Windows  | Run dev server (cross-compile)                                                                          |
| `npm run build:linux`            | Linux    | Build AppImage/Deb packages                                                                             |
| `npm run build:windows`          | Windows  | Build NSIS installer (requires NSIS)                                                                    |
| `npm run build:windows:exe`      | Windows  | Build only .exe (no installer)                                                                          |
| `npm run build:windows:portable` | Windows  | Build .exe + stage portable runtime folder (`src-tauri/target/x86_64-pc-windows-msvc/release/portable`) |
| `npm run build:all`              | Both     | Build Linux + Windows packages                                                                          |
| `npm run run:windows`            | Windows  | Build (if needed), stage portable runtime, and launch the Windows app via host interop (if available)   |

**Examples:**

```bash
# Quick development - Linux
npm run dev:linux

# Build for both platforms from Linux
npm run build:all

# Build and run the Windows app directly from Linux host interop
npm run run:windows

# Build only the Windows executable (fastest, no NSIS needed)
npm run build:windows:exe

# Build and stage a portable Windows runtime folder (copy this folder to Windows)
npm run build:windows:portable
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

# Windows: Use cargo-xwin (configured via CARGO env var)
# No linker config needed - cargo-xwin handles SDK libs and linking
# [target.x86_64-pc-windows-msvc]
# linker = "lld-link"  # Don't set - use CARGO=cargo-xwin instead

# Android: Use lld (included in NDK)
[target.aarch64-linux-android]
linker = "lld"
```

**Benefits:**

- **lld linker**: 2-10x faster linking compared to default system linker
- **Incremental compilation**: Faster rebuilds during development
- **Thin LTO**: Better optimized release builds without full LTO overhead
- **Cross-compilation ready**: Configured for Linux, Windows, and Android targets

### Tauri bundle configuration (platform split)

Sidecar bundling uses a base config plus a Linux override:

- `src-tauri/tauri.conf.json` (base, used for Windows/macOS)
- `src-tauri/tauri.linux.conf.json` (Linux override)

**Base (`tauri.conf.json`):**

```json
{
  "bundle": {
    "externalBin": ["binaries/pi-agent"]
  }
}
```

**Linux override (`tauri.linux.conf.json`):**

```json
{
  "bundle": {
    "externalBin": [],
    "resources": ["sidecar/linux"]
  }
}
```

On Linux, Graphone extracts `sidecar/linux/pi-agent.gz` into app-local data at runtime and launches the extracted binary from there.

### Capabilities

- **desktop.json**: Shell plugin permissions for spawning sidecar
- **mobile.json**: HTTP plugin for SDK-only mode (future use)

---

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.

---

## External References

- **Tauri 2.0 Docs**: https://v2.tauri.app
- **pi-mono SDK**: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs/sdk.md
- **pi-mono RPC**: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs/rpc.md
- **bun Documentation**: https://bun.sh/docs

---

## Contributing

Graphone builds and ships a local host sidecar from `services/agent-host`.

To develop sidecar behavior:

1. Edit `services/agent-host/src/*`
2. Test with `bun tooling/scripts/verify-path-b-host.mjs`
3. Build with `npm run build:linux` (or `cargo build --manifest-path src-tauri/Cargo.toml`)

---

## License

MIT License - See [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [pi-mono](https://github.com/badlogic/pi-mono) by Mario Zechner - The underlying coding agent (Node.js/TypeScript)
- [Tauri](https://tauri.app) - Cross-platform application framework
- [bun](https://bun.sh) - JavaScript runtime and bundler used for sidecar compilation

---

**Status**: Active development | **Last Updated**: February 23, 2026
