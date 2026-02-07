# WSL2 + Windows 11 Development Environment Notes

**Date:** February 7, 2026  
**Context:** Development environment for Pi-Tauri Cross-Platform Agent  
**Status:** Reference Guide

---

## Overview

This document addresses the specific considerations, frictions, and workarounds when developing the Pi-Tauri project within a **WSL2 (Windows Subsystem for Linux)** environment with a **Windows 11** host. While WSL2 provides an excellent Linux development experience, Tauri cross-platform development introduces unique challenges that require awareness and configuration.

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

---

## 2. Known Frictions & Solutions

### 2.1 File System Performance (Critical)

**Problem:**
Storing the project on Windows filesystem (`/mnt/c/`) causes **severe performance degradation** (10-100x slower) for:
- `cargo build` (Rust compilation)
- `npm install` (Node modules)
- Hot module reloading during development

**Solution:**
```bash
# ✅ CORRECT: Store project in Linux filesystem
cd ~
mkdir -p ~/projects/pi-tauri
cd ~/projects/pi-tauri

# ❌ AVOID: Windows filesystem paths
cd /mnt/c/Users/username/projects/pi-tauri  # Slow!
```

**Performance Comparison:**
| Operation | Linux FS (`~/projects`) | Windows FS (`/mnt/c/`) |
|-----------|------------------------|----------------------|
| `cargo build` | ~30s | ~5-10 min |
| `npm install` | ~20s | ~3-5 min |
| HMR updates | <100ms | 2-5s |

### 2.2 Cross-Compiling for Windows from WSL2

**Problem:**
Tauri Windows builds typically require Windows-native tooling, but WSL2 can cross-compile.

**Solution - Using `cargo-xwin`:**
```bash
# Install cross-compilation toolchain
sudo apt install llvm clang lld

# Install cargo-xwin
 cargo install cargo-xwin

# Add Windows target
rustup target add x86_64-pc-windows-msvc

# Build Windows app from WSL2
npm run tauri build -- --target x86_64-pc-windows-msvc
```

**Alternative - Using Windows Host:**
For complex Windows-specific features, consider building natively on Windows:
```powershell
# From Windows PowerShell (not WSL)
cd \\wsl$\Ubuntu\home\username\projects\pi-tauri
npm run tauri build
```

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
The sidecar pattern (running `pi --mode rpc` as external binary) has path considerations.

**Configuration:**
```rust
// src-tauri/src/main.rs
// Sidecar binaries must be placed correctly for cross-platform builds

#[cfg(target_os = "linux")]
const SIDECAR_NAME: &str = "pi-agent-x86_64-unknown-linux-gnu";

#[cfg(target_os = "windows")]
const SIDECAR_NAME: &str = "pi-agent-x86_64-pc-windows-msvc.exe";

// In tauri.conf.json, ensure externalBin references work for both platforms
```

**Build Sidecar for Both Platforms:**
```bash
# Linux binary (runs in WSL2)
cargo build --release --target x86_64-unknown-linux-gnu

# Windows binary (runs on Windows host)
cargo build --release --target x86_64-pc-windows-msvc
```

### 3.2 Node.js Version Management

**Recommended:** Use `nvm` in WSL2, not Windows Node.js�```bash
# Install nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Install Node.js 20 (LTS, recommended for Tauri 2.0)
nvm install 20
nvm use 20
nvm alias default 20
```

**Avoid:** Using Windows Node.js (`/mnt/c/Program Files/nodejs`) from WSL2 - causes path and permission issues.

### 3.3 Rust Toolchain in WSL2

**Installation:**
```bash
# Standard Rust installation
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Required targets for this project
rustup target add x86_64-unknown-linux-gnu      # Linux desktop
rustup target add x86_64-pc-windows-msvc        # Windows desktop (cross-compile)
rustup target add aarch64-linux-android          # Android ARM64
rustup target add x86_64-linux-android           # Android x86_64
```

**WSL2-Specific Rust Config:**
```bash
# Add to ~/.cargo/config.toml for faster builds
[build]
target-dir = "/tmp/cargo-target"  # Faster if using Windows FS (tmpfs)

# Or use sccache for caching
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

## 6. Development Workflows

### 6.1 Daily Development Loop (Linux Target)
```bash
# Terminal 1: WSL2
cd /home/prinova/CodeProjects/graphone
npm install          # Fast on Linux FS
npm run tauri dev    # Opens GUI via WSLg
```

### 6.2 Testing Windows Build
```bash
# Cross-compile from WSL2
cd /home/prinova/CodeProjects/graphone
npm run tauri build -- --target x86_64-pc-windows-msvc

# Run the Windows binary from Windows side
/mnt/c/.../pi-tauri.exe  # Or copy to Windows desktop
```

### 6.3 Mobile Development (Android)
```bash
# Setup Android SDK in WSL2
export ANDROID_HOME=$HOME/android-sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools

cd /home/prinova/CodeProjects/graphone

# Dev server with Android
npm run tauri android dev

# If emulator on Windows, use:
npm run tauri android dev -- --host  # Bind to all interfaces
```

---

## 4. Local Repository Structure

**Current Setup (as of February 2026):**
```
/home/prinova/CodeProjects/              # Linux filesystem (✅ fast!)
├── pi-mono/                             # Local pi-mono clone
│   ├── packages/
│   │   ├── coding-agent/                # Main SDK package
│   │   │   ├── src/
│   │   │   ├── docs/
│   │   │   │   ├── sdk.md               # SDK documentation
│   │   │   │   ├── rpc.md               # RPC protocol docs
│   │   │   │   ├── extensions.md
│   │   │   │   └── skills.md
│   │   │   └── examples/
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
    ├── src/                             # Frontend code
    ├── src-tauri/                       # Rust backend
    │   ├── src/
    │   ├── binaries/                    # Sidecar binaries
    │   ├── capabilities/
│   │   │   ├── desktop.json
│   │   │   └── mobile.json
    │   └── tauri.conf.json
    ├── vscode-extension/                # VS Code extension
    │   └── src/
    └── package.json
```

**Using Local pi-mono:**
```bash
# Option 1: npm link for development
cd /home/prinova/CodeProjects/pi-mono/packages/coding-agent
npm link

cd /home/prinova/CodeProjects/graphone
npm link @mariozechner/pi-coding-agent

# Option 2: Local path in package.json
{
  "dependencies": {
    "@mariozechner/pi-coding-agent": "file:../pi-mono/packages/coding-agent"
  }
}

# Option 3: Build and pack
cd /home/prinova/CodeProjects/pi-mono/packages/coding-agent
npm pack
# Then reference the .tgz file
```

## 5. Recommended Project Structure for WSL2

**General Best Practice (for new projects):**
```
~/projects/pi-tauri/           # Linux filesystem (fast!)
├── src/                       # Frontend TypeScript/React
├── src-tauri/                 # Rust backend
│   ├── src/
│   ├── binaries/              # Sidecar binaries
│   │   ├── pi-agent-x86_64-unknown-linux-gnu
│   │   └── pi-agent-x86_64-pc-windows-msvc.exe
│   ├── capabilities/
│   └── tauri.conf.json
├── vscode-extension/          # VS Code extension
│   └── src/
└── package.json
```

**Important:** Never create the project under `/mnt/c/` or `/mnt/d/`.

---

## 7. Troubleshooting Common Issues

### 7.1 Build Errors

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
chmod +x src-tauri/binaries/pi-agent-*
```

### 7.3 Performance Issues

**Symptom:** Extremely slow builds
```bash
# Check if project is on Windows filesystem
pwd  # Should be /home/username/..., not /mnt/c/...

# Move if needed
mv /mnt/c/projects/pi-tauri ~/projects/
cd ~/projects/pi-tauri
```

---

## 8. Summary: Best Practices

| Practice | Recommendation |
|----------|---------------|
| **Project Location** | Always use Linux filesystem (`~/projects`) |
| **Node.js** | Use nvm in WSL2, not Windows Node.js |
| **Rust** | Install via rustup in WSL2 |
| **IDE** | VS Code Windows + WSL Remote extension |
| **Windows Builds** | Use `cargo-xwin` or build on Windows host |
| **Mobile Dev** | Run Android emulator on Windows, connect via ADB |
| **File Sharing** | Use `\wsl$\` path from Windows to access WSL2 files |
| **Git** | Configure Git in WSL2 with Windows credentials |

---

## 9. Quick Start Checklist

```bash
# 1. Verify WSL2 environment
wsl.exe --list --verbose  # Should show WSL 2

# 2. Create project in Linux filesystem
mkdir -p ~/projects/pi-tauri
cd ~/projects/pi-tauri

# 3. Install prerequisites
sudo apt update
sudo apt install build-essential curl wget file libssl-dev libgtk-3-dev libappindicator3-dev librsvg2-dev

# 4. Install Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20

# 5. Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# 6. Install Tauri CLI
cargo install tauri-cli

# 7. Scaffold project (when ready)
npm create tauri-app@latest
```

---

## 10. References

- [Tauri Linux Prerequisites](https://v2.tauri.app/start/prerequisites/)
- [WSL2 Filesystem Performance](https://docs.microsoft.com/en-us/windows/wsl/filesystems)
- [cargo-xwin for Windows cross-compilation](https://github.com/rust-cross/cargo-xwin)
- [WSL2 GUI Apps](https://docs.microsoft.com/en-us/windows/wsl/tutorials/gui-apps)

---

*Environment: WSL2 on Windows 11, Tauri 2.0, pi-mono integration*
*Document Status: Living document - update as friction points are discovered*
