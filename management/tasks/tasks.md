# Pi-Tauri Cross-Platform Agent - Setup Tasks

**Date:** February 7, 2026  
**Environment:** WSL2 on Windows 11, Ubuntu 24.04.3 LTS  
**Project Location:** Project directory (Linux filesystem ✅)

---

## Summary

The WSL2 environment **partially fulfills** the project requirements. Node.js is installed, but **Rust and several system dependencies are missing**. This document outlines all steps required to bring the system to a fully operational state for Pi-Tauri development.

---

## Phase 1: Core Toolchain Installation

### 1.1 Install Rust via rustup
**Status:** NOT INSTALLED ❌  
**Required for:** Tauri backend, cargo CLI, compilation

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Verify installation
rustc --version  # Should show 1.84+
cargo --version
```

### 1.2 Install Tauri CLI
**Status:** NOT INSTALLED ❌  
**Required for:** Tauri project scaffolding, dev server, builds

```bash
# Install Tauri CLI via cargo
cargo install tauri-cli

# Verify installation
cargo tauri --version
```

### 1.3 Configure Rust Targets
**Status:** NOT CONFIGURED ❌  
**Required for:** Cross-platform builds

```bash
# Add required targets
rustup target add x86_64-unknown-linux-gnu       # Linux desktop
rustup target add x86_64-pc-windows-msvc         # Windows cross-compile
rustup target add aarch64-linux-android          # Android ARM64
rustup target add x86_64-linux-android           # Android x86_64
```

---

## Phase 2: System Dependencies Installation

### 2.1 Install Linux Desktop Prerequisites
**Status:** PARTIALLY INSTALLED ⚠️  
**Missing:** libwebkit2gtk-4.1-dev, libappindicator3-dev, librsvg2-dev

```bash
# Install Tauri Linux prerequisites
sudo apt update
sudo apt install -y \
    libwebkit2gtk-4.1-dev \
    libappindicator3-dev \
    librsvg2-dev \
    libssl-dev
```

**Current Status:**
| Package | Status |
|---------|--------|
| build-essential | ✅ Installed |
| libgtk-3-dev | ✅ Installed (libgtk-3-0t64) |
| pkg-config | ✅ Installed |
| libwebkit2gtk-4.1-dev | ❌ Missing |
| libappindicator3-dev | ❌ Missing |
| librsvg2-dev | ❌ Missing (runtime only installed) |
| libssl-dev | ❌ Missing (likely needed) |

### 2.2 Install Cross-Compilation Tools (Optional)
**Status:** PARTIALLY INSTALLED ⚠️  
**For:** Windows builds from WSL2

```bash
# Install additional tools for cross-compilation
sudo apt install -y llvm clang lld

# Install cargo-xwin for Windows cross-compilation
cargo install cargo-xwin
```

**Current Status:**
| Tool | Status |
|------|--------|
| clang | ✅ Installed (v18) |
| llvm | ✅ Installed (via clang) |
| lld | ❌ Verify/install |
| cargo-xwin | ❌ Not installed |

---

## Phase 3: Node.js Environment Setup (Optional)

### 3.1 Install NVM (Recommended)
**Status:** NOT INSTALLED ❌  
**Note:** Node.js v22 is already installed system-wide, but NVM is recommended for version management

```bash
# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Reload shell configuration
source ~/.bashrc  # or ~/.zshrc

# Install Node.js 20 (LTS recommended for Tauri)
nvm install 20
nvm use 20
nvm alias default 20
```

### 3.2 Verify Node.js/npm
**Status:** INSTALLED ✅  
**Current:** Node v22.21.0, npm 10.9.4

```bash
# Already installed and working
node --version  # v22.21.0
npm --version   # 10.9.4
```

---

## Phase 4: Project Initialization

### 4.1 Install Project Dependencies
**Status:** NOT INITIALIZED ❌  

```bash
cd <project-directory>
npm install
```

### 4.2 Link Local pi-mono (Development Mode)
**Status:** NOT CONFIGURED ❌  
**Local pi-mono exists at:** `../pi-mono` (relative to this project) ✅

```bash
# Option 1: npm link (for active development)
cd ../pi-mono/packages/coding-agent
npm link

cd ../graphone
npm link @mariozechner/pi-coding-agent

# Option 2: Use local path in package.json
# "@mariozechner/pi-coding-agent": "file:../pi-mono/packages/coding-agent"
```

### 4.3 Scaffold Tauri Project Structure
**Status:** NOT CREATED ❌  
**Missing directories:** `src/`, `src-tauri/`, `vscode-extension/`

```bash
# Option 1: Use Tauri scaffold (if starting fresh)
npm create tauri-app@latest

# Option 2: Manual scaffold based on project specs
# Create directory structure:
# - src/ (Frontend React/TypeScript)
# - src-tauri/ (Rust backend)
#   - src/main.rs
#   - binaries/ (sidecar binaries)
#   - capabilities/
#   - tauri.conf.json
# - vscode-extension/
```

---

## Phase 5: Tauri Configuration

### 5.1 Configure tauri.conf.json
**Required:** Desktop capabilities, sidecar configuration, mobile permissions

Key configurations needed:
- `bundle.externalBin` - Sidecar binary references
- `plugins.shell` - Process spawning permissions
- Capabilities for desktop vs mobile

### 5.2 Setup Sidecar Binaries (Desktop)
**Required for:** Desktop pattern with `pi --mode rpc`

```bash
# Build pi binary for Linux
cargo build --release --target x86_64-unknown-linux-gnu

# Place in src-tauri/binaries/
# Name format: pi-agent-x86_64-unknown-linux-gnu
```

### 5.3 Configure Capabilities
**Required files:**
- `src-tauri/capabilities/desktop.json` - Shell plugin, sidecar permissions
- `src-tauri/capabilities/mobile.json` - HTTP plugin, SDK-only mode

---

## Phase 6: Development Environment Verification

### 6.1 Verify GUI Support (WSLg)
**Status:** SHOULD BE WORKING ✅  

```bash
# Test WSLg
echo $DISPLAY  # Should show :0
echo $WAYLAND_DISPLAY  # Should show wayland-0

# Optional: Install x11-apps for GUI testing
sudo apt install x11-apps -y
xclock  # Test GUI app
```

### 6.2 Test Tauri Dev Server
**Command:**
```bash
cd <project-directory>
npm run tauri dev
```

### 6.3 Test Build
**Commands:**
```bash
# Linux build
npm run tauri build

# Windows cross-compile (requires cargo-xwin)
npm run tauri build -- --target x86_64-pc-windows-msvc
```

---

## Phase 7: Android Development Setup (Optional)

### 7.1 Install Android SDK
**Status:** NOT INSTALLED ❌  
**Required for:** Mobile builds

```bash
# Download and install Android SDK
export ANDROID_HOME=$HOME/android-sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin

# Install command line tools
mkdir -p $ANDROID_HOME/cmdline-tools
cd $ANDROID_HOME/cmdline-tools
wget https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip commandlinetools-linux-11076708_latest.zip
mv cmdline-tools latest

# Install SDK components
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;25.2.9519653"
```

### 7.2 Configure ADB for WSL2
**Required for:** Device debugging from WSL2

```bash
# In WSL2
sudo apt install android-tools-adb

# On Windows PowerShell (Admin):
adb kill-server
adb -a -P 5037 nodaemon server

# In WSL2, connect to Windows ADB
export ADB_SERVER_SOCKET=tcp:$(cat /etc/resolv.conf | grep nameserver | awk '{print $2}'):5037
adb devices
```

---

## Quick Reference: Installation Order

For the fastest path to a working development environment, install in this order:

1. **System dependencies** (Phase 2.1) - Required for Tauri to compile
2. **Rust** (Phase 1.1) - Required for all Tauri operations
3. **Tauri CLI** (Phase 1.2) - Required for dev/build commands
4. **Rust targets** (Phase 1.3) - Required for cross-compilation
5. **Project dependencies** (Phase 4.1) - npm install
6. **Local pi-mono link** (Phase 4.2) - For SDK development
7. **Project scaffold** (Phase 4.3) - Create actual project files

---

## Current Environment Status

| Component | Status | Notes |
|-----------|--------|-------|
| WSL2 | ✅ Ready | Ubuntu 24.04.3 LTS |
| Project Location | ✅ Correct | Linux filesystem (e.g., `/home/<user>/projects/`) |
| DISPLAY/WAYLAND | ✅ Set | :0 / wayland-0 |
| Node.js | ✅ Installed | v22.21.0 |
| npm | ✅ Installed | 10.9.4 |
| build-essential | ✅ Installed | - |
| libgtk-3 | ✅ Installed | Runtime only |
| pkg-config | ✅ Installed | - |
| clang/llvm | ✅ Installed | v18 |
| curl | ✅ Installed | 8.5.0 |
| file | ✅ Installed | 5.45 |
| pi-mono local | ✅ Present | `../pi-mono` (relative to this project) |
| **Rust** | **❌ Missing** | **BLOCKER** |
| **Cargo** | **❌ Missing** | **BLOCKER** |
| **Tauri CLI** | **❌ Missing** | **BLOCKER** |
| **libwebkit2gtk-4.1-dev** | **❌ Missing** | **BLOCKER** |
| **libappindicator3-dev** | **❌ Missing** | Compilation may fail |
| **librsvg2-dev** | **❌ Missing** | Compilation may fail |
| **libssl-dev** | **❌ Missing** | Likely needed |
| nvm | ❌ Missing | Optional but recommended |
| cargo-xwin | ❌ Missing | Optional (Windows builds) |
| Android SDK | ❌ Missing | Optional (mobile dev) |

---

## Notes

- **iOS builds are NOT possible from WSL2** - Requires macOS + Xcode
- **Project is correctly located in Linux filesystem** - Performance will be optimal
- **DISPLAY and WAYLAND_DISPLAY are set** - GUI apps should work via WSLg
- **pi-mono repository exists locally** - Can be linked for development

---

## Task Tracker

| Title | Status |
|-------|--------|
| Install Rust via rustup | PENDING |
| Install Tauri CLI via cargo | PENDING |
| Add Rust target x86_64-unknown-linux-gnu | PENDING |
| Add Rust target x86_64-pc-windows-msvc | PENDING |
| Add Rust target aarch64-linux-android | PENDING |
| Add Rust target x86_64-linux-android | PENDING |
| Install libwebkit2gtk-4.1-dev | PENDING |
| Install libappindicator3-dev | PENDING |
| Install librsvg2-dev | PENDING |
| Install libssl-dev | PENDING |
| Install lld linker | PENDING |
| Install cargo-xwin for Windows cross-compile | PENDING |
| Install NVM for Node version management | PENDING |
| Run npm install in project | PENDING |
| Link local pi-mono via npm link | PENDING |
| Scaffold Tauri project structure | PENDING |
| Configure tauri.conf.json | PENDING |
| Setup sidecar binaries for desktop | PENDING |
| Configure desktop capabilities (shell plugin) | PENDING |
| Configure mobile capabilities (HTTP plugin) | PENDING |
| Test Tauri dev server | PENDING |
| Test Linux build | PENDING |
| Test Windows cross-compilation | PENDING |
| Install Android SDK (optional) | PENDING |
| Configure ADB for WSL2 (optional) | PENDING |
