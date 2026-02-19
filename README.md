# Graphone - Pi-Tauri Cross-Platform Agent

A unified cross-platform interface for the [pi-mono](https://github.com/badlogic/pi-mono) coding agent, built with [Tauri 2.0](https://v2.tauri.app/). This project provides native applications for Desktop (Windows, macOS, Linux) using a sidecar pattern with the pi-mono agent.

![Project Status](https://img.shields.io/badge/status-development-orange)
![Tauri](https://img.shields.io/badge/Tauri-2.0-blueviolet)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Overview

Graphone provides a desktop interface for the pi-mono coding agent using Tauri's sidecar pattern:

| Platform    | Pattern | Mechanism                                                                    |
| ----------- | ------- | ---------------------------------------------------------------------------- |
| **Desktop** | Sidecar | Rust backend spawns Graphone host sidecar (`pi-agent`) as managed subprocess |

### Key Features

- 🤖 **Unified Interface** - Consistent chat UI for desktop platforms
- 🖥️ **Desktop Apps** - Native Windows, macOS, and Linux applications
- ⚡ **Streaming Responses** - Real-time agent output
- 🔒 **Local-First** - Works with local and remote LLM providers
- 📦 **Auto-Bundled Agent** - pi-mono binary is built automatically during Tauri build

Contributor notes:

- See `CONTRIBUTING.md` for repository workflow and staging guidance.
- See `docs/plans/repository-restructure-roadmap-2026-02.md` for the repository maintenance refactor plan.

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
4. Tauri bundles the binary as a sidecar for distribution

---

## Prerequisites

### System Requirements

- **OS**: Linux (development), Windows 11 + WSL2, macOS
- **Node.js**: 20+ (LTS recommended)
- **bun**: 1.0+ (Required for sidecar compilation)
- **Rust**: Latest stable (1.84+)

### Platform-Specific

| Target        | Requirements                                                                    |
| ------------- | ------------------------------------------------------------------------------- |
| Linux Desktop | `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `clang`, `lld` |
| Windows       | `cargo-xwin`, `nsis`, `lld`, `llvm` for cross-compilation (from WSL2)           |
| macOS         | `create-dmg` (for DMG bundling: `brew install create-dmg`)                      |

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
- Copying binary + runtime assets to the Tauri binaries directory

### 3. Run Development Server

```bash
# Desktop (Linux) - recommended shorthand
npm run dev:linux

# Desktop (macOS)
npm run dev:macos

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

# macOS
npm run build:macos

# Windows only (cross-compile from WSL2)
npm run build:windows

# All platforms
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
├── apps/
│   └── desktop/
│       └── web/                      # Svelte frontend application
│           ├── src/                  # Routes, components, stores, handlers
│           └── static/               # Static frontend assets
├── src-tauri/                        # Rust/Tauri desktop shell
│   ├── src/                          # Commands, sidecar bridge, state
│   ├── binaries/                     # Sidecar binaries + runtime assets (auto-populated)
│   ├── capabilities/                 # Tauri permissions (desktop/mobile)
│   ├── build.rs                      # Builds bundled sidecar binary via bun
│   ├── Cargo.toml
│   └── tauri.conf.json
├── services/
│   └── agent-host/                   # Graphone host sidecar source (TypeScript)
│       ├── src/
│       └── dist/
├── tooling/
│   └── scripts/                      # Build/run/verification helpers
├── docs/
│   ├── specs/
│   ├── tasks/
│   └── plans/
├── reports/
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

### WSL2 Development

This project is developed in **WSL2 on Windows 11**. See [`docs/specs/wsl2-development-notes.md`](docs/specs/wsl2-development-notes.md) for detailed guidance.

**Critical:** Keep the project in the **Linux filesystem** (e.g., `/home/username/projects/`), NOT in `/mnt/c/` (Windows filesystem) - performance difference is 10-100x.

### Sidecar Build Process

The sidecar binary is built automatically via `src-tauri/build.rs`:

1. **Dependency Check**: Verifies bun is installed
2. **Host Build**: Builds Graphone host source (`services/agent-host`)
3. **Compile**: Runs `bun build --compile ./dist/cli.js`
   - Uses an explicit bun target when cross-compiling Windows from Linux
4. **Copy**: Places the binary in `src-tauri/binaries/` with Tauri sidecar naming
5. **Assets**: Copies runtime assets (`package.json`, docs/examples, theme, export-html, `photon_rs_bg.wasm`) from `@mariozechner/pi-coding-agent`

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
| `npm run dev:macos`              | macOS    | Run dev server (native)                                                                                 |
| `npm run dev:windows`            | Windows  | Run dev server (cross-compile)                                                                          |
| `npm run build:linux`            | Linux    | Build AppImage/Deb packages                                                                             |
| `npm run build:macos`            | macOS    | Build .app bundle and DMG installer                                                                     |
| `npm run build:macos:app`        | macOS    | Build .app bundle only (no DMG)                                                                         |
| `npm run build:windows`          | Windows  | Build NSIS installer (requires NSIS)                                                                    |
| `npm run build:windows:exe`      | Windows  | Build only .exe (no installer)                                                                          |
| `npm run build:windows:portable` | Windows  | Build .exe + stage portable runtime folder (`src-tauri/target/x86_64-pc-windows-msvc/release/portable`) |
| `npm run build:all`              | All      | Build Linux + macOS + Windows packages                                                                  |
| `npm run run:windows`            | Windows  | Build (if needed), stage portable runtime, & launch Windows app from WSL2                               |

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
# Reinstall dependencies (ensures npm SDK assets are present)
npm install

# Verify package exists
ls node_modules/@mariozechner/pi-coding-agent/dist/cli.js

# Rebuild host sidecar path
npm run build:linux
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

**RESOLVED:** This issue has been fixed by embedding a Windows application manifest.

The error occurred because the Windows executable needs an [application manifest](https://learn.microsoft.com/en-us/windows/win32/sbscs/application-manifests) to enable Common Controls version 6+, which provides the `TaskDialogIndirect` API used by Tauri.

**Solution Applied:**

- Added `src-tauri/windows-app.manifest` with Common Controls v6 dependency
- Updated `build.rs` to use Tauri's native `WindowsAttributes.app_manifest()` API
- The manifest is now properly embedded during cross-compilation

**If you still encounter issues:**

- **Antivirus/Windows Defender**: The app might be blocked. Check Windows Defender history.
- **Missing sidecar**: Ensure `pi-agent-x86_64-pc-windows-msvc.exe` is in the same folder as `graphone.exe`
- **Run from CMD**: Open Command Prompt and run the exe to see detailed error messages

**Launch issues from WSL2:**
If you get "Windows cannot find..." errors when running `npm run run:windows`:

1. Manually navigate to `C:\Windows\Temp\graphone\` in Windows Explorer
2. Double-click `graphone.exe` to run it
3. Or open PowerShell and run: `C:\Windows\Temp\graphone\graphone.exe`

### macOS DMG bundling fails with "no mountable file systems"

**Issue:** On macOS 15+, DMG creation may fail with `hdiutil: create failed - no mountable file systems`.

**Cause:** Tauri's default DMG bundler uses HFS+ filesystem which is deprecated on newer macOS versions.

**Solution:** Install `create-dmg` which handles this automatically, or manually create the DMG with APFS:

```bash
# Option 1: Install create-dmg (recommended)
brew install create-dmg

# Option 2: Manual DMG creation with APFS
hdiutil create -srcfolder src-tauri/target/release/bundle/macos/graphone.app \
  -volname "graphone" -fs APFS -format UDZO \
  -o src-tauri/target/release/bundle/dmg/graphone_0.1.0_aarch64.dmg
```

**Note:** The `.app` bundle is still created successfully even if DMG bundling fails. You can run the app directly:
```bash
open src-tauri/target/release/bundle/macos/graphone.app
```

---

## Documentation

| Document                                                                                   | Description                                |
| ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| [`docs/specs/project-specs.md`](docs/specs/project-specs.md)                               | Original project specification             |
| [`docs/specs/repository-structure-2026-02.md`](docs/specs/repository-structure-2026-02.md) | Current repository architecture and naming |
| [`docs/specs/wsl2-development-notes.md`](docs/specs/wsl2-development-notes.md)             | WSL2 development environment guide         |
| [`docs/tasks/scaffolding-tasks.md`](docs/tasks/scaffolding-tasks.md)                       | Setup tasks and checklist                  |

### External References

- **Tauri 2.0 Docs**: https://v2.tauri.app
- **pi-mono SDK**: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs/sdk.md
- **pi-mono RPC**: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs/rpc.md
- **bun Documentation**: https://bun.sh/docs

---

## Contributing

Graphone builds and ships a local host sidecar from `services/agent-host`.

To develop sidecar behavior:

1. Edit `services/agent-host/src/*`
2. Test with `node tooling/scripts/verify-path-b-host.mjs`
3. Build with `npm run build:linux` (or `cargo build --manifest-path src-tauri/Cargo.toml`)

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
