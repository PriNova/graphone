# Pi-Tauri Cross-Platform Agent - Setup Tasks

**Date:** February 7, 2026  
**Environment:** WSL2 on Windows 11, Ubuntu 24.04.3 LTS  
**Project Location:** Project directory (Linux filesystem ✅)

---

## Summary

The WSL2 environment **is now fully configured** for Pi-Tauri development. All core dependencies are installed and the project has been scaffolded with automatic sidecar building.

**Key Points:**
- pi-mono is a **Node.js/TypeScript project** built with **bun**
- The sidecar binary is built automatically during Tauri build via `build.rs`
- bun compiles the TypeScript to a standalone binary (not cargo/Rust)

---

## Phase 1: Core Toolchain Installation

### 1.1 Install Rust via rustup
**Status:** ✅ INSTALLED  
**Version:** rustc 1.93.0

```bash
# Install Rust (already done)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Add to ~/.bashrc for persistence
echo 'source $HOME/.cargo/env' >> ~/.bashrc

# Verify installation
rustc --version  # rustc 1.93.0
cargo --version  # cargo 1.93.0
```

### 1.2 Install Tauri CLI
**Status:** ✅ INSTALLED  
**Version:** tauri-cli 2.10.0

```bash
# Install Tauri CLI via cargo (already done)
cargo install tauri-cli

# Verify installation
cargo tauri --version  # tauri-cli 2.10.0
```

### 1.3 Configure Rust Targets
**Status:** ✅ CONFIGURED

```bash
# Add required targets (already done)
rustup target add x86_64-unknown-linux-gnu       # Linux desktop ✅
rustup target add x86_64-pc-windows-msvc         # Windows cross-compile ✅
rustup target add aarch64-linux-android          # Android ARM64 ✅
rustup target add x86_64-linux-android           # Android x86_64 ✅

# Verify installed targets
rustup target list --installed
```

---

## Phase 2: System Dependencies Installation

### 2.1 Install Linux Desktop Prerequisites
**Status:** ✅ INSTALLED

```bash
# Install Tauri Linux prerequisites (already done)
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
| libgtk-3-dev | ✅ Installed |
| pkg-config | ✅ Installed |
| libwebkit2gtk-4.1-dev | ✅ Installed |
| libappindicator3-dev | ✅ Installed |
| librsvg2-dev | ✅ Installed |
| libssl-dev | ✅ Installed |

### 2.2 Install Cross-Compilation Tools
**Status:** ✅ INSTALLED

```bash
# Install additional tools for cross-compilation (already done)
sudo apt install -y llvm clang lld

# Install NSIS for creating Windows installers on Linux
sudo apt install nsis  # ✅

# Install cargo-xwin for Windows cross-compilation
cargo install cargo-xwin  # ✅
```

**Current Status:**
| Tool | Status |
|------|--------|
| clang | ✅ Installed (v18) |
| llvm | ✅ Installed |
| lld | ✅ Installed |
| nsis | ✅ Installed |
| cargo-xwin | ✅ Installed |

---

## Phase 3: Node.js Environment Setup

### 3.1 Install bun (Required for pi-mono sidecar)
**Status:** ✅ INSTALLED  
**Required for:** Building pi-mono sidecar binary

```bash
# Install bun (already done)
curl -fsSL https://bun.sh/install | bash

# Add to PATH
export PATH="$HOME/.bun/bin:$PATH"

# Verify installation
bun --version  # Should show 1.0+
```

**Note:** bun is required because pi-mono uses `bun build --compile` to create the standalone sidecar binary.

### 3.2 Verify Node.js/npm
**Status:** ✅ INSTALLED  
**Current:** Node v22.21.0, npm 10.9.4

```bash
node --version  # v22.21.0
npm --version   # 10.9.4
```

---

## Phase 4: Project Initialization

### 4.1 Install Project Dependencies
**Status:** ✅ COMPLETED

```bash
cd /home/prinova/CodeProjects/graphone
npm install  # ✅
```

### 4.2 Verify pi-mono Location
**Status:** ✅ PRESENT

```
/home/prinova/CodeProjects/
├── graphone/       # This project
└── pi-mono/        # pi-mono repository (Node.js/TypeScript)
    └── packages/
        └── coding-agent/   # Main package
```

**Note:** The pi-mono sidecar is built automatically during Tauri build. No npm linking is required.

### 4.3 Scaffold Tauri Project Structure
**Status:** ✅ COMPLETED

Created structure:
```
graphone/
├── src/                    # Frontend (Svelte)
├── src-tauri/              # Rust backend
│   ├── src/
│   ├── binaries/           # Sidecar binaries (auto-populated)
│   ├── capabilities/
│   ├── build.rs            # Auto-builds pi-mono sidecar
│   ├── Cargo.toml
│   └── tauri.conf.json
├── static/
└── package.json
```

---

## Phase 5: Tauri Configuration

### 5.1 Configure Cargo Build Settings
**Status:** ✅ COMPLETED

Created `src-tauri/.cargo/config.toml` with optimized build settings:

```toml
[build]
# Linker settings configured per-target for cross-compilation

[profile.dev]
incremental = true
codegen-units = 16

[profile.release]
lto = "thin"
codegen-units = 1
opt-level = 3

# Linux: Use lld linker (2-10x faster)
[target.x86_64-unknown-linux-gnu]
linker = "clang"
rustflags = ["-C", "link-arg=-fuse-ld=lld"]

# Windows: Use lld-link via cargo-xwin
[target.x86_64-pc-windows-msvc]
linker = "lld-link"

# Android: Use lld
[target.aarch64-linux-android]
linker = "lld"
[target.x86_64-linux-android]
linker = "lld"
```

### 5.2 Configure tauri.conf.json
**Status:** ✅ COMPLETED

Configured:
- `bundle.externalBin` - Sidecar binary references (`["binaries/pi-agent"]`)
- `plugins.shell` - Process spawning permissions
- Desktop window settings

### 5.3 Setup Automatic Sidecar Build
**Status:** ✅ COMPLETED

**Implementation:** `src-tauri/build.rs`

The build script automatically:
1. Detects desktop vs mobile targets (skips for mobile)
2. Locates pi-mono at `../pi-mono/packages/coding-agent`
3. Runs `npm install` if `node_modules` is missing
4. Builds the binary using `npm run build:binary` (which uses `bun build --compile`)
5. Copies the binary to `target/<profile>/binaries/pi-agent-<target-triple>`
6. Sets executable permissions on Unix

**Manual build (for debugging):**
```bash
cd ../pi-mono/packages/coding-agent
npm run build:binary
# Output: dist/pi
```

**Important:** pi-mono is a Node.js/TypeScript project, not Rust. It's compiled with bun.

### 5.4 Configure Capabilities
**Status:** ✅ COMPLETED

Created capability files:
- `src-tauri/capabilities/default.json` - Base permissions
- `src-tauri/capabilities/desktop.json` - Shell plugin, sidecar permissions
- `src-tauri/capabilities/mobile.json` - HTTP plugin (future use)

### 5.5 Add Shell Plugin
**Status:** ✅ COMPLETED

Updated:
- `Cargo.toml` - Added `tauri-plugin-shell = "2"`
- `src/lib.rs` - Added `.plugin(tauri_plugin_shell::init())`

---

## Phase 6: Development Environment Verification

### 6.1 Verify GUI Support (WSLg)
**Status:** ✅ WORKING

```bash
# Test WSLg
echo $DISPLAY  # :0
echo $WAYLAND_DISPLAY  # wayland-0
```

### 6.2 Test Tauri Dev Server
**Command:**
```bash
cd /home/prinova/CodeProjects/graphone
npm run tauri dev
```

**Expected:**
- Frontend compiles successfully
- Rust backend compiles (triggers pi-mono build via build.rs)
- Tauri window opens
- pi-agent sidecar binary is available in `target/debug/binaries/`

### 6.3 Test Build
**Commands:**
```bash
# Linux build
npm run tauri build

# Windows cross-compile (requires cargo-xwin)
npm run tauri build -- --target x86_64-pc-windows-msvc
```

---

## Phase 7: Cross-Platform Build Scripts

### 7.1 npm Scripts for Platform Builds
**Status:** ✅ CONFIGURED

The following npm scripts have been added to `package.json`:

| Script | Description |
|--------|-------------|
| `dev` | Run Vite dev server (frontend only) |
| `dev:linux` | Run Tauri dev mode for Linux (native) |
| `dev:windows` | Run Tauri dev mode for Windows (cross-compile) |
| `build:linux` | Build Linux AppImage/Deb packages |
| `build:windows` | Build Windows NSIS installer (requires `nsis` package) |
| `build:windows:exe` | Build Windows .exe only (no installer needed) |
| `build:all` | Build both Linux and Windows packages |
| `run:windows` | Build (if needed) and launch Windows app from WSL2 |

**Usage:**
```bash
# Development - Linux (native)
npm run dev:linux

# Development - Windows (cross-compile from WSL2)
npm run dev:windows

# Production build - Linux only
npm run build:linux

# Production build - Windows only (creates NSIS installer, requires nsis package)
npm run build:windows

# Production build - Windows .exe only (no installer, faster)
npm run build:windows:exe

# Production build - Both platforms
npm run build:all

# Build and run Windows app from WSL2
npm run run:windows
```

### 7.2 Windows Build Requirements
**Prerequisites:**
- `cargo-xwin` installed: `cargo install cargo-xwin`
- `lld` linker installed: `sudo apt install lld`
- `nsis` installed (optional, for creating installers): `sudo apt install nsis`
- Windows target added: `rustup target add x86_64-pc-windows-msvc`

**NSIS Not Installed Error:**
If you see `Error: makensis.exe: No such file or directory`, the build still succeeded! Only the installer creation failed.
- The `.exe` is available at: `src-tauri/target/x86_64-pc-windows-msvc/release/graphone.exe`
- Use `npm run run:windows` to launch it
- Or install NSIS and rebuild to get the installer: `sudo apt install nsis`

**Important:** Windows builds use `cargo-xwin` via the `--runner` flag. The npm scripts handle this automatically, but the manual command would be:
```bash
source ~/.cargo/env && cargo tauri build --target x86_64-pc-windows-msvc --runner cargo-xwin
```

This tells Tauri to use `cargo-xwin` instead of `cargo` for the build, which automatically downloads and configures the Windows SDK libraries.

**Why cargo-xwin is required:**
- Downloads Windows SDK libraries (shell32.lib, kernel32.lib, etc.) automatically
- Configures the linker (`lld-link`) with correct library paths
- Without it, you'll get errors like "could not open 'shell32.lib'"

**Build Output Locations:**
| Platform | Output Path |
|----------|-------------|
| Linux | `src-tauri/target/release/bundle/appimage/graphone_*.AppImage` |
| Linux | `src-tauri/target/release/bundle/deb/graphone_*.deb` |
| Windows | `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/graphone_*.exe` |

**Note:** MSI installers can only be created on Windows (requires WiX). Cross-compilation from Linux creates NSIS installers only.

**Cross-Compilation Limitations:**
Windows executables built from Linux may have compatibility issues:
- **TaskDialogIndirect error:** COMCTL32.dll manifest handling issues
- This is a known limitation with cross-compilation
- **For production releases:** Use GitHub Actions with Windows runners instead
- **For development:** Linux builds or native Windows builds recommended

### 7.3 Running Windows Builds

**Quick Launch (Recommended):**
```bash
# Build (if needed) and run Windows executable
npm run run:windows
```

This script will:
1. Check if Windows build exists (builds automatically if not)
2. Copy the .exe to `C:\Windows\Temp\`
3. Launch it via `cmd.exe`
4. Also copies the sidecar binary if available

**Manual Launch:**
```bash
# Build Windows installer
npm run build:windows

# The MSI/EXE can be run directly from Windows
# Access via: \\wsl$\<distro-name>\home\<username>\...
# Or copy to Windows filesystem:
cp src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/*.msi /mnt/c/Users/<username>/Desktop/
```

**Note:** Windows builds created in WSL2 run natively on Windows - no WSL2 required to execute them.

**Build Output Locations:**
```
src-tauri/target/x86_64-pc-windows-msvc/release/
├── graphone.exe              # Standalone executable (runs from temp)
└── bundle/
    ├── msi/
    │   └── graphone_*.msi    # Windows Installer (recommended for distribution)
    └── nsis/
        └── graphone_*.exe    # NSIS installer
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

## Quick Reference: Project Structure

```
/home/prinova/CodeProjects/
├── pi-mono/                          # Node.js/TypeScript project
│   └── packages/
│       └── coding-agent/             # Main package (built with bun)
│           ├── src/                  # TypeScript source
│           ├── dist/                 # Compiled output
│           └── package.json          # npm scripts include build:binary
│
└── graphone/                         # This project (Tauri + Svelte)
    ├── src/                          # Frontend (Svelte + TypeScript)
    ├── src-tauri/                    # Rust backend
    │   ├── src/
    │   ├── binaries/                 # Sidecar binaries (auto-populated)
    │   ├── capabilities/
    │   │   ├── default.json
    │   │   ├── desktop.json          # Shell permissions
    │   │   └── mobile.json
    │   ├── build.rs                  # Builds pi-mono automatically
    │   ├── Cargo.toml
    │   └── tauri.conf.json
    ├── management/
    │   └── specs/
    │       ├── project-specs.md
    │       ├── wsl2-development-notes.md
    │       └── tasks.md              # This file
    └── package.json
```

---

## Current Environment Status

| Component | Status | Notes |
|-----------|--------|-------|
| WSL2 | ✅ Ready | Ubuntu 24.04.3 LTS |
| Project Location | ✅ Correct | Linux filesystem |
| DISPLAY/WAYLAND | ✅ Set | :0 / wayland-0 |
| Node.js | ✅ Installed | v22.21.0 |
| npm | ✅ Installed | 10.9.4 |
| **bun** | **✅ Installed** | **Required for pi-mono build** |
| Rust | ✅ Installed | 1.93.0 |
| Cargo | ✅ Installed | 1.93.0 |
| Tauri CLI | ✅ Installed | 2.10.0 |
| Rust targets | ✅ Configured | All 4 targets installed |
| build-essential | ✅ Installed | - |
| libwebkit2gtk-4.1-dev | ✅ Installed | - |
| libappindicator3-dev | ✅ Installed | - |
| librsvg2-dev | ✅ Installed | - |
| libssl-dev | ✅ Installed | - |
| lld | ✅ Installed | - |
| cargo-xwin | ✅ Installed | - |
| pi-mono local | ✅ Present | `../pi-mono` |
| **pi-mono sidecar build** | **✅ Automated** | **Via build.rs** |
| Tauri scaffold | ✅ Complete | Svelte + TypeScript |
| npm install | ✅ Complete | - |
| Android SDK | ❌ Missing | Optional (mobile dev) |

---

## Notes

- **iOS builds are NOT possible from WSL2** - Requires macOS + Xcode
- **Project is correctly located in Linux filesystem** - Performance optimal
- **pi-mono is Node.js/TypeScript** - Built with bun, not cargo
- **Sidecar build is automated** - No manual building required
- **DISPLAY and WAYLAND_DISPLAY are set** - GUI apps work via WSLg

---

## Task Tracker

| Title | Status |
|-------|--------|
| Install Rust via rustup | ✅ COMPLETED |
| Install Tauri CLI via cargo | ✅ COMPLETED |
| Add Rust target x86_64-unknown-linux-gnu | ✅ COMPLETED |
| Add Rust target x86_64-pc-windows-msvc | ✅ COMPLETED |
| Add Rust target aarch64-linux-android | ✅ COMPLETED |
| Add Rust target x86_64-linux-android | ✅ COMPLETED |
| Install libwebkit2gtk-4.1-dev | ✅ COMPLETED |
| Install libappindicator3-dev | ✅ COMPLETED |
| Install librsvg2-dev | ✅ COMPLETED |
| Install libssl-dev | ✅ COMPLETED |
| Install lld linker | ✅ COMPLETED |
| Install nsis for Windows installer creation | ✅ COMPLETED |
| Install cargo-xwin for Windows cross-compile | ✅ COMPLETED |
| **Install bun** | **✅ COMPLETED** |
| Run npm install in project | ✅ COMPLETED |
| Scaffold Tauri project structure | ✅ COMPLETED |
| Configure Cargo build settings (lld linker) | ✅ COMPLETED |
| Configure tauri.conf.json | ✅ COMPLETED |
| **Setup automatic pi-mono sidecar build** | **✅ COMPLETED** |
| Configure desktop capabilities (shell plugin) | ✅ COMPLETED |
| Configure mobile capabilities (HTTP plugin) | ✅ COMPLETED |
| **Add npm scripts for Linux builds** | **✅ COMPLETED** |
| **Add npm scripts for Windows cross-compilation** | **✅ COMPLETED** |
| **Add run:windows script for launching Windows app** | **✅ COMPLETED** |
| Test Tauri dev server | 🔄 READY TO TEST |
| Test Linux build | 🔄 READY TO TEST |
| Test Windows cross-compilation | 🔄 READY TO TEST |
| Install Android SDK (optional) | PENDING |
| Configure ADB for WSL2 (optional) | PENDING |

---

## Next Steps

1. **Test development server (Linux):**
   ```bash
   npm run dev:linux
   ```

2. **Test development server (Windows cross-compile):**
   ```bash
   npm run dev:windows
   ```

3. **Verify sidecar binary is built:**
   ```bash
   ls -la src-tauri/target/debug/binaries/
   # Should show: pi-agent-x86_64-unknown-linux-gnu
   ```

4. **Test production build (Linux):**
   ```bash
   npm run build:linux
   ```

5. **Test production build (Windows cross-compile):**
   ```bash
   npm run build:windows
   ```

6. **Build and run Windows app directly:**
   ```bash
   npm run run:windows
   ```

7. **Build both platforms at once:**
   ```bash
   npm run build:all
   ```

8. **(Optional) Setup Android SDK** for mobile development
