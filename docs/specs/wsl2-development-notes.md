# WSL2 + Windows 11 Development Environment Notes

**Date:** February 7, 2026  
**Context:** Development environment for Pi-Tauri Cross-Platform Agent  
**Status:** Reference Guide

---

## Overview

This document addresses the specific considerations, frictions, and workarounds when developing the Pi-Tauri project within a **WSL2 (Windows Subsystem for Linux)** environment with a **Windows 11** host. While WSL2 provides an excellent Linux development experience, Tauri cross-platform development introduces unique challenges that require awareness and configuration.

**Key Points:**
- pi-mono is a **Node.js/TypeScript project** built with **bun**
- The sidecar binary is built automatically during Tauri builds
- bun is a **required dependency** for building the project

---

## 1. Architecture Context

### 1.1 How WSL2 Works
- **Lightweight VM:** WSL2 runs a real Linux kernel in a lightweight utility VM
- **File System:** Two distinct filesystems with performance implications:
  - **Linux filesystem (`/home/user`, `/projects`):** Ext4, native performance for Linux apps
  - **Windows filesystem (`/mnt/c`, `/mnt/d`):** 9P protocol, significantly slower
- **Networking:** WSL2 has its own network stack with NAT to Windows host
- **GUI Apps:** Supports Linux GUI apps via Wayland/X11 integration

### 1.2 Tauri Build Targets
| Target | Build From | Runs On | Notes |
|--------|-----------|---------|-------|
| Linux (AppImage/deb) | WSL2 | Linux/WSL2 | Native build, works well |
| Windows (MSI/NSIS) | WSL2 | Windows 11 | Cross-compilation via `cargo-xwin` |
| Android | WSL2 | Android | Requires Android SDK in WSL2 |
| iOS | ❌ | macOS only | iOS builds **require macOS** |

### 1.3 Host Sidecar Architecture

**Important:** Graphone ships a local host sidecar (`sidecars/pi-agent-host`) and compiles it with bun during Tauri builds.

The host sidecar uses `@mariozechner/pi-coding-agent` as an SDK dependency and multiplexes many in-process sessions.

**Build Flow:**
```
Tauri Build
    ↓
build.rs executes
    ↓
Detects desktop target → Builds sidecars/pi-agent-host
    ↓
bun build --compile ./dist/cli.js --outfile <compiled binary>
    ↓
Binary copied to src-tauri/binaries/
    ↓
Tauri bundles as sidecar
```

---

## 2. Known Frictions & Solutions

### 2.1 File System Performance (Critical)

**Problem:**
Storing the project on Windows filesystem (`/mnt/c/`) causes **severe performance degradation** (10-100x slower) for:
- `cargo build` (Rust compilation)
- `npm install` (Node modules)
- bun build operations
- Hot module reloading during development

**Solution:**
```bash
# ✅ CORRECT: Store project in Linux filesystem
cd ~
mkdir -p <project-directory>
cd <project-directory>

# ❌ AVOID: Windows filesystem paths
cd /mnt/c/Users/username/projects/graphone  # Slow!
```

**Performance Comparison:**
| Operation | Linux FS (`/home/<user>/projects/`) | Windows FS (`/mnt/c/`) |
|-----------|------------------------|----------------------|
| `cargo build` | ~30s | ~5-10 min |
| `npm install` | ~20s | ~3-5 min |
| bun build | ~10s | ~2-5 min |
| HMR updates | <100ms | 2-5s |

### 2.2 Cross-Compiling for Windows from WSL2

**Problem:**
Tauri Windows builds typically require Windows-native tooling, but WSL2 can cross-compile.

**Solution - Using `cargo-xwin`:**
```bash
# Install cross-compilation toolchain
sudo apt install llvm clang lld

# Install NSIS (required for creating Windows installers on Linux)
sudo apt install nsis

# Install cargo-xwin
cargo install cargo-xwin

# Add Windows target
rustup target add x86_64-pc-windows-msvc

# Build Windows app from WSL2 (using npm script)
npm run build:windows

# Or manually with cargo-xwin:
source ~/.cargo/env && cargo tauri build --target x86_64-pc-windows-msvc --runner cargo-xwin
```

**Important:** The `--runner cargo-xwin` flag is required because:
- `cargo-xwin` downloads Windows SDK libraries automatically
- It sets up the correct linker paths for `lld-link`
- Without it, the linker cannot find `shell32.lib`, `kernel32.lib`, etc.
- This is handled automatically by the `npm run build:windows` script

**Limitations:**
- MSI installers can only be created on Windows (requires WiX toolset)
- NSIS installers (`-setup.exe`) can be created on Linux/WSL2
- The executable `.exe` can be built and run directly without an installer

**Note:** The pi-mono sidecar will also be built for Windows during this process (bun can cross-compile).

### 2.3 GUI/Display Issues

**Problem:**
Tauri apps need display access for development. WSL2 supports GUI apps, but may need configuration.

**Solution:**
```bash
# Ensure DISPLAY is set (usually automatic in modern WSL2)
echo $DISPLAY
# Should output: :0

# If not set, add to ~/.bashrc or ~/.zshrc:
export DISPLAY=:0

# For Wayland (modern, preferred):
export WAYLAND_DISPLAY=wayland-0
```

**Troubleshooting:**
- Install Windows 11 GUI support: `wsl --update` on Windows side
- Ensure Windows firewall allows WSL2 connections

### 2.4 Mobile Development (Android)

**Problem:**
Android development requires ADB (Android Debug Bridge) connection to physical devices or emulators.

**Solution - Device Connection:**
```bash
# Install ADB in WSL2
sudo apt install android-tools-adb

# Windows must expose ADB to WSL2
# On Windows PowerShell (Admin):
adb kill-server
adb -a -P 5037 nodaemon server

# In WSL2, connect to Windows ADB
export ADB_SERVER_SOCKET=tcp:$(cat /etc/resolv.conf | grep nameserver | awk '{print $2}'):5037
adb devices
```

**Android Emulator:**
- Run emulator on Windows host (better GPU acceleration)
- Connect from WSL2 using ADB over network

### 2.5 Port Forwarding & Network

**Problem:**
WSL2 has its own IP address. Services running in WSL2 aren't directly accessible from Windows without port forwarding.

**Tauri Dev Server:**
```bash
# Vite/Tauri dev server runs on 0.0.0.0:1420 by default
# Access from Windows via localhost:1420 (WSL2 forwards automatically)
# If not working, manually forward:
netsh interface portproxy add v4tov4 listenport=1420 connectport=1420 connectaddress=$(wsl hostname -I)
```

**Problem:**
Firewall blocking Tauri app communication between Windows and WSL2.

**Solution:**
```powershell
# On Windows PowerShell (Admin)
# Allow WSL2 subnet through firewall
New-NetFirewallRule -DisplayName "WSL2" -Direction Inbound -InterfaceAlias "vEthernet (WSL)" -Action Allow
```

---

## 3. Pi-Tauri Project Specific Considerations

### 3.1 pi-mono Sidecar Pattern (Desktop)

**Challenge:**
The sidecar pattern (running the Graphone host sidecar as external binary) requires bun for compilation.

**Architecture Clarification:**
```
NOT: pi-mono (Rust) → cargo build → binary
YES:  pi-mono (TypeScript) → bun build --compile → binary
```

**Configuration:**
```rust
// src-tauri/src/lib.rs
// The sidecar name matches the target triple

#[cfg(target_os = "linux")]
const SIDECAR_NAME: &str = "pi-agent-x86_64-unknown-linux-gnu";

#[cfg(target_os = "windows")]
const SIDECAR_NAME: &str = "pi-agent-x86_64-pc-windows-msvc.exe";

// In tauri.conf.json:
{
  "bundle": {
    "externalBin": ["binaries/pi-agent"]
  }
}
```

**Build Sidecar for Both Platforms:**
```bash
# Linux binary (runs in WSL2)
npm run tauri build
# Binary location: target/release/binaries/pi-agent-x86_64-unknown-linux-gnu

# Windows binary (runs on Windows host)
npm run tauri build -- --target x86_64-pc-windows-msvc
# Binary location: target/release/binaries/pi-agent-x86_64-pc-windows-msvc.exe
```

**Automatic Build:**
The `build.rs` script automatically:
1. Detects the target platform
2. Runs `npm run build:binary` in pi-mono (which uses bun)
3. Copies the binary to the correct location
4. Sets executable permissions

### 3.2 Node.js and bun Version Management

**Recommended:** Use system Node.js for the project, but ensure bun is installed:

```bash
# Install bun (required for pi-mono sidecar)
curl -fsSL https://bun.sh/install | bash

# Add to PATH
export PATH="$HOME/.bun/bin:$PATH"

# Verify
bun --version  # Should be 1.0+

# Make permanent
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
```

**Avoid:** Using Windows Node.js (`/mnt/c/Program Files/nodejs`) from WSL2 - causes path and permission issues.

### 3.3 Rust Toolchain in WSL2

**Installation:**
```bash
# Standard Rust installation
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add to PATH
source $HOME/.cargo/env

# Required targets for this project
rustup target add x86_64-unknown-linux-gnu      # Linux desktop
rustup target add x86_64-pc-windows-msvc        # Windows desktop (cross-compile)
rustup target add aarch64-linux-android          # Android ARM64
rustup target add x86_64-linux-android           # Android x86_64
```

**WSL2-Specific Rust Config:**

The project includes a pre-configured `.cargo/config.toml` with optimized settings:

```toml
[build]
# Linker settings are configured per-target for cross-compilation support

[profile.dev]
# Faster debug builds with incremental compilation
incremental = true
codegen-units = 16

[profile.release]
# Optimized release builds with thin LTO
lto = "thin"
codegen-units = 1
opt-level = 3

# Linux x86_64: Use lld for faster linking (2-10x faster than system linker)
[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=lld"]

# Windows x86_64: Use lld-link via cargo-xwin
[target.x86_64-pc-windows-msvc]
linker = "lld-link"

# Android targets: Use lld (included in Android NDK)
[target.aarch64-linux-android]
linker = "lld"
[target.x86_64-linux-android]
linker = "lld"
```

**Why lld?**
- Linking is often the bottleneck in incremental builds
- lld is 2-10x faster than the default GNU ld on Linux
- lld-link is used for Windows cross-compilation via cargo-xwin
- Works seamlessly with cross-compilation to Android

**Alternative global config (optional):**
```bash
# Add to ~/.cargo/config.toml for system-wide defaults
[build]
target-dir = "/tmp/cargo-target"  # Faster if using Windows FS (tmpfs)

# Or use sccache for distributed caching
# cargo install sccache
# export RUSTC_WRAPPER=sccache
```

### 3.4 IDE Integration

**VS Code (Recommended):**
- Install VS Code on Windows (not in WSL2)
- Use "Remote - WSL" extension
- Open project with `code .` from WSL2 terminal
- All extensions work seamlessly

**IntelliJ / RustRover:**
- Run IDE on Windows
- Configure WSL2 toolchain in Settings → Build → Toolchains
- Or use IDE within WSL2 (JetBrains Gateway)

---

## 4. Local Repository Structure

**Current Setup (as of February 2026):**
```
<projects-directory>/                    # Linux filesystem (✅ fast!)
├── pi-mono/                             # Local pi-mono clone (Node.js/TypeScript)
│   ├── packages/
│   │   ├── coding-agent/                # Main SDK package (built with bun)
│   │   │   ├── src/                     # TypeScript source
│   │   │   ├── dist/                    # Compiled JavaScript
│   │   │   ├── docs/
│   │   │   │   ├── sdk.md               # SDK documentation
│   │   │   │   ├── rpc.md               # RPC protocol docs
│   │   │   │   ├── extensions.md
│   │   │   │   └── skills.md
│   │   │   └── package.json             # Contains build:binary script
│   │   ├── agent/                       # Core agent runtime
│   │   ├── ai/                          # LLM API abstractions
│   │   ├── tui/                         # Terminal UI components
│   │   └── web-ui/                      # Web UI components
│   └── README.md
│
└── graphone/                            # This project (Pi-Tauri)
    ├── management/
    │   └── specs/
    │       ├── project-specs.md         # Original specification
    │       ├── project-findings-2026-02.md  # Research findings
    │       └── wsl2-development-notes.md    # This document
    ├── src/                             # Frontend code (Svelte)
    ├── src-tauri/                       # Rust backend
    │   ├── src/
    │   │   ├── lib.rs                   # Main library
    │   │   └── main.rs                  # Entry point
    │   ├── binaries/                    # Sidecar binaries (auto-populated by build.rs)
    │   ├── capabilities/                # Permissions
    │   │   ├── default.json
    │   │   ├── desktop.json             # Shell plugin permissions
    │   │   └── mobile.json              # HTTP plugin permissions
    │   ├── build.rs                     # Build script: auto-builds pi-mono with bun
    │   ├── Cargo.toml                   # Rust dependencies (includes tauri-plugin-shell)
    │   └── tauri.conf.json              # Tauri configuration
    ├── src/                             # Frontend (Svelte + TypeScript)
    ├── static/                          # Static assets
    ├── vscode-extension/                # VS Code extension (future)
    │   └── src/
    ├── package.json                     # Node dependencies
    └── vite.config.js                   # Vite configuration
```

**Using Local pi-mono:**
The pi-mono sidecar is built automatically. No npm linking is required:

```bash
# The build.rs script handles everything:
# 1. Locates pi-mono at ../pi-mono/packages/coding-agent
# 2. Runs npm install if needed
# 3. Runs npm run build:binary (uses bun)
# 4. Copies binary to target/<profile>/binaries/
```

**For SDK development (if needed):**
```bash
# Option 1: npm link for development
cd ../pi-mono/packages/coding-agent
npm link

cd ../../graphone
npm link @mariozechner/pi-coding-agent

# Option 2: Local path in package.json
{
  "dependencies": {
    "@mariozechner/pi-coding-agent": "file:../pi-mono/packages/coding-agent"
  }
}

# Option 3: Build and pack
cd ../pi-mono/packages/coding-agent
npm pack
# Then reference the .tgz file
```

## 5. Recommended Project Structure for WSL2

**General Best Practice (for new projects):**
```
<project-directory>/           # Linux filesystem (fast!)
├── src/                       # Frontend TypeScript/Svelte
├── src-tauri/                 # Rust backend
│   ├── src/
│   ├── binaries/              # Sidecar binaries (auto-populated by build.rs)
│   ├── capabilities/
│   └── tauri.conf.json
├── vscode-extension/          # VS Code extension
│   └── src/
└── package.json
```

**Important:** Never create the project under `/mnt/c/` or `/mnt/d/`.

---

## 6. Development Workflows

### 6.1 Daily Development Loop (Linux Target)
```bash
# Terminal 1: WSL2
# Navigate to project directory
cd graphone
npm install              # Fast on Linux FS
npm run dev:linux        # Opens GUI via WSLg, builds pi-mono automatically
```

### 6.2 Testing Windows Build
```bash
# Cross-compile from WSL2 using npm scripts
cd graphone

# Quick Windows build
npm run build:windows

# Or build both Linux and Windows
npm run build:all

# Legacy command:
npm run tauri build -- --target x86_64-pc-windows-msvc
```

### 6.3 Running Windows App from WSL2

**Automatic Launch (Recommended):**
```bash
# Build (if needed) and run Windows app from WSL2
npm run run:windows
```

This script (`scripts/run-windows.sh`) will:
1. Check if the Windows executable exists (builds automatically if missing)
2. Copy the .exe to `C:\Windows\Temp\graphone.exe`
3. Copy the sidecar binary if available
4. Launch via `cmd.exe /c start`

**Manual Launch:**
```bash
# Copy to Windows and run
npm run build:windows
cp src-tauri/target/x86_64-pc-windows-msvc/release/graphone.exe /mnt/c/Users/<username>/Desktop/
# Then double-click in Windows Explorer
```

**Note:** Windows builds created in WSL2 run natively on Windows - no WSL2 required to execute them.

### 6.3 Mobile Development (Android)
```bash
# Setup Android SDK in WSL2
export ANDROID_HOME=$HOME/android-sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools

# Navigate to project directory
cd graphone

# Dev server with Android
npm run tauri android dev

# If emulator on Windows, use:
npm run tauri android dev -- --host  # Bind to all interfaces
```

### 6.4 Debugging Sidecar Build

If the automatic sidecar build fails:

```bash
# 1. Check bun is installed
which bun
bun --version

# 2. Verify pi-mono location
ls ../pi-mono/packages/coding-agent

# 3. Manual build for debugging
cd ../pi-mono/packages/coding-agent
npm install
npm run build:binary
ls -la dist/pi

# 4. Check build.rs output
cd ../../graphone
source ~/.cargo/env
cargo build -v 2>&1 | grep -i "pi-agent\|warning\|error"
```

---

## 7. Troubleshooting Common Issues

### 7.1 Build Errors

**Error:** `bun: command not found`
```bash
# Solution
export PATH="$HOME/.bun/bin:$PATH"
# Or install:
curl -fsSL https://bun.sh/install | bash
```

**Error:** `error: linker cc not found`
```bash
# Solution
sudo apt update
sudo apt install build-essential
```

**Error:** Windows build fails with missing MSVC
```bash
# Solution: Use cargo-xwin or build on Windows
# OR install mingw for GNU toolchain (limited)
sudo apt install mingw-w64
```

**Error:** `makensis.exe: No such file or directory` (Windows cross-compile)
```bash
# Solution: Install NSIS
sudo apt install nsis

# Note: MSI installers can only be created on Windows
# NSIS installers can be created on Linux
# If you only need the .exe, use: --no-bundle flag
```

**Error:** Windows app doesn't open / crashes immediately
```bash
# Most likely cause: Missing WebView2 Runtime
# Solution: Install WebView2 on Windows
# Download from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/

# Other checks:
# 1. Antivirus might be blocking - check Windows Defender
# 2. Run from CMD to see errors: C:\Windows\Temp\graphone\graphone.exe
# 3. Check sidecar is present: pi-agent-x86_64-pc-windows-msvc.exe
```

**Error:** "TaskDialogIndirect could not be located" (cross-compile issue)
```bash
# FIXED: This issue has been resolved by embedding a Windows application manifest.
#
# The manifest (src-tauri/windows-app.manifest) declares Common Controls v6
# dependency, which provides the TaskDialogIndirect API.
#
# If you still see this error after updating:
# 1. Rebuild from scratch: cargo clean && npm run build:windows
# 2. Verify the sidecar binary is present alongside graphone.exe
# 3. Check Windows Defender isn't blocking the app
```

**Error:** `pi-mono not found` during build
```bash
# Verify directory structure
ls ../pi-mono/packages/coding-agent

# If pi-mono is elsewhere, update build.rs or create symlink
ln -s /actual/path/to/pi-mono ../pi-mono
```

### 7.2 Runtime Issues

**Error:** `Failed to create window` / Display issues
```bash
# Check WSLg is working
wsl.exe --update  # On Windows PowerShell
sudo apt install x11-apps -y
xclock  # Test GUI
```

**Error:** Sidecar permission denied
```bash
# Ensure sidecar binary has execute permissions
chmod +x src-tauri/target/*/binaries/pi-agent-*
```

**Error:** `Failed to build pi-agent` (bun compile failed)
```bash
# Check pi-mono has node_modules
cd ../pi-mono/packages/coding-agent
ls node_modules  # Should exist

# If not:
npm install

# Try manual build:
npm run build:binary
```

### 7.3 Performance Issues

**Symptom:** Extremely slow builds
```bash
# Check if project is on Windows filesystem
pwd  # Should be /home/username/..., not /mnt/c/...

# Move if needed
mv /mnt/c/projects/graphone <project-directory>/
cd <project-directory>
```

**Symptom:** bun build hangs
```bash
# Check disk space
df -h

# Check memory
free -h

# bun compile requires significant memory for large projects
```

---

## 8. Summary: Best Practices

| Practice | Recommendation |
|----------|---------------|
| **Project Location** | Always use Linux filesystem (e.g., `/home/<user>/projects/`) |
| **Node.js** | Use nvm or system Node.js in WSL2, not Windows Node.js |
| **bun** | Required - install via official installer |
| **Rust** | Install via rustup in WSL2 |
| **IDE** | VS Code Windows + WSL Remote extension |
| **Windows Builds** | Use `cargo-xwin` or build on Windows host |
| **Mobile Dev** | Run Android emulator on Windows, connect via ADB |
| **File Sharing** | Use `\wsl$​` path from Windows to access WSL2 files |
| **Git** | Configure Git in WSL2 with Windows credentials |
| **Sidecar** | Let build.rs handle it - don't manually copy binaries |
| **Linker** | lld configured per-target in `.cargo/config.toml` |

---

## 9. Quick Start Checklist

```bash
# 1. Verify WSL2 environment
wsl.exe --list --verbose  # Should show WSL 2

# 2. Create project in Linux filesystem
mkdir -p <project-directory>
cd <project-directory>

# 3. Install prerequisites
sudo apt update
sudo apt install build-essential curl wget file libssl-dev libgtk-3-dev libappindicator3-dev librsvg2-dev

# 4. Install bun (REQUIRED for pi-mono)
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# 5. Install Node.js (if not present)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20

# 6. Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# 7. Install Tauri CLI
cargo install tauri-cli

# 8. Clone/setup pi-mono (at ../pi-mono)
cd ..
git clone <pi-mono-repo> pi-mono  # If not already present
cd <project-directory>

# 9. Install dependencies and run
npm install
npm run tauri dev  # Automatically builds pi-mono sidecar
```

---

## 10. References

- [Tauri Linux Prerequisites](https://v2.tauri.app/start/prerequisites/)
- [WSL2 Filesystem Performance](https://docs.microsoft.com/en-us/windows/wsl/filesystems)
- [cargo-xwin for Windows cross-compilation](https://github.com/rust-cross/cargo-xwin)
- [WSL2 GUI Apps](https://docs.microsoft.com/en-us/windows/wsl/tutorials/gui-apps)
- [bun Documentation](https://bun.sh/docs)
- [pi-mono SDK Documentation](../pi-mono/packages/coding-agent/docs/sdk.md)
- [pi-mono RPC Protocol](../pi-mono/packages/coding-agent/docs/rpc.md)

---

*Environment: WSL2 on Windows 11, Tauri 2.0, pi-mono (Node.js/TypeScript + bun)*
*Document Status: Living document - update as friction points are discovered*
