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
| Windows | `cargo-xwin`, `nsis`, `lld`, `llvm` for cross-compilation (from WSL2) |

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
| `npm run build:windows` | Windows | Build NSIS installer (requires NSIS) |
| `npm run build:windows:exe` | Windows | Build only .exe (no installer) |
| `npm run build:all` | Both | Build Linux + Windows packages |
| `npm run run:windows` | Windows | Build (if needed) & launch Windows app from WSL2 |

**Examples:**
```bash
# Quick development - Linux
npm run dev:linux

# Build for both platforms from WSL2
npm run build:all

# Build and run Windows app directly from WSL2
npm run run:windows

# Build only the Windows executable (fastest, no NSIS needed)
npm run build:windows:exe
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

### Windows build fails with "link.exe not found" or "could not open 'shell32.lib'"

This happens when `cargo-xwin` is not used. The npm scripts handle this automatically, but if running manually:

```bash
# Wrong - will fail:
npm run tauri build -- --target x86_64-pc-windows-msvc

# Correct - use cargo-xwin via --runner flag:
source ~/.cargo/env && cargo tauri build --target x86_64-pc-windows-msvc --runner cargo-xwin

# Or use the npm script (recommended):
npm run build:windows
```

**Cause:** Cross-compiling for Windows requires Windows SDK libraries (kernel32.lib, shell32.lib, etc.) which `cargo-xwin` downloads and configures automatically.

### Windows build fails with "makensis.exe: No such file or directory"

**This error is expected if NSIS is not installed.** The good news is that the `.exe` file is still built successfully! Only the installer creation fails.

**Quick Fix - Run without installer:**
```bash
# The exe is already built! Just run it:
npm run run:windows
```

**To install NSIS (for creating Windows installers):**
```bash
sudo apt install nsis
npm run build:windows  # Now creates both exe and installer
```

**Note:** 
- MSI installers can only be created on Windows (requires WiX)
- NSIS installers (`-setup.exe`) can be created on Linux (requires `nsis` package)
- The standalone `.exe` works fine without any installer
- Use `npm run build:windows:exe` to build just the exe without bundling

### Windows app doesn't open / crashes immediately

**Most likely cause: Missing WebView2 Runtime**

Tauri apps require Microsoft Edge WebView2 Runtime to be installed on Windows. 

**Check if WebView2 is installed:**
1. Open PowerShell on Windows
2. Run: `Get-ItemProperty -Path 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -Name 'pv' -ErrorAction SilentlyContinue`
3. If nothing is returned, WebView2 is not installed

**Install WebView2:**
- Download from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
- Or use the Evergreen Bootstrapper (recommended)

### "TaskDialogIndirect could not be located" Error

**This is a known issue with cross-compilation from Linux to Windows.**

The error occurs because cross-compiled Windows executables may have issues with:
- COMCTL32.dll version 6+ (required for TaskDialogIndirect)
- Application manifest handling
- Windows Common Controls

**Solutions:**
1. **For development/testing:** Build and run on Linux using `npm run dev:linux`
2. **For Windows releases:** Use GitHub Actions (recommended) or build natively on Windows
3. **Quick workaround:** The error may not affect actual functionality - try clicking OK and see if the app still runs

**Recommended Approach for Windows Distribution:**
Use GitHub Actions to build on actual Windows runners (see `.github/workflows/` for examples).

**Other possible causes:**
- **Antivirus/Windows Defender**: The app might be blocked. Check Windows Defender history.
- **Missing sidecar**: Ensure `pi-agent-x86_64-pc-windows-msvc.exe` is in the same folder as `graphone.exe`
- **Run from CMD**: Open Command Prompt and run `C:\Windows\Temp\graphone\graphone.exe` to see error messages

**Launch issues from WSL2:**
If you get "Windows cannot find..." errors when running `npm run run:windows`:
1. Manually navigate to `C:\Windows\Temp\graphone\` in Windows Explorer
2. Double-click `graphone.exe` to run it
3. Or open PowerShell and run: `C:\Windows\Temp\graphone\graphone.exe`

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
