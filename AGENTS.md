# Pi-Tauri Cross-Platform Agent - Agent Guide

## Build Commands
- `npm install` - Install dependencies
- `cargo install tauri-cli` - Install Tauri CLI
- `npm run tauri dev` - Run desktop dev server
- `npm run tauri build` - Build for production
- `npm run tauri android dev` - Mobile dev (requires Android SDK)

## Architecture & Project Structure
**Tauri 2.0 + React + TypeScript + Rust**
- Desktop: **Sidecar pattern** - Rust spawns `pi --mode rpc` subprocess via shell plugin
- Mobile: **Library pattern** - pi-mono SDK bundled in WebView, HTTP plugin for LLM APIs
- VS Code: **Shared logic** - Uses same `@mariozechner/pi-coding-agent` NPM package

**Structure:**
- `src/` - Frontend (React/TypeScript): components, hooks, services
- `src-tauri/` - Rust backend: process management, Tauri commands, sidecar binaries
- `vscode-extension/` - VS Code extension source
- `management/specs/` - Project specs, findings, WSL2 notes

**Reference:** Local pi-mono at `../pi-mono` (relative to this project)

## Code Style Guidelines
- **Language**: TypeScript (frontend), Rust (backend)
- **Framework**: React 18 with functional components
- **State**: Zustand or Jotai (lightweight)
- **Styling**: Tailwind CSS
- **Bundler**: Vite (Tauri default)

## Critical Development Notes
**WSL2 Development:** Store project in **Linux filesystem** (e.g., `/home/<username>/projects/`), NOT `/mnt/c/` (Windows filesystem) - performance difference is 10-100x.

**Rust toolchain targets:**
- `x86_64-unknown-linux-gnu` (Linux desktop)
- `x86_64-pc-windows-msvc` (Windows cross-compile via `cargo-xwin`)
- `aarch64-linux-android` (Android ARM64)

**pi-mono Integration:**
- SDK: `import { createAgentSession } from "@mariozechner/pi-coding-agent"`
- RPC: `pi --mode rpc` for sidecar communication

## Documentation
- `management/specs/project-specs.md` - Original specification
- `management/specs/project-findings-2026-02.md` - Tech research & patterns
- `management/specs/wsl2-development-notes.md` - WSL2 development guide
- `management/tasks/tasks.md` - Setup tasks and environment assessment

---

## Current Environment (Updated February 2026)

### Host System
- **Platform:** WSL2 on Windows 11
- **OS:** Ubuntu 24.04.3 LTS (Noble Numbat)
- **Kernel:** Linux 6.6.87.2-microsoft-standard-WSL2
- **Architecture:** x86_64

### Project Location
- **Path:** project directory (example: `/home/<username>/projects/graphone`)
- **Filesystem:** Linux (ext4) - Performance optimal
- **Reference Project:** `../pi-mono` (relative to this project)

### Installed Components ✅
| Component | Version | Status |
|-----------|---------|--------|
| Node.js | v22.21.0 | Ready |
| npm | 10.9.4 | Ready |
| bun | 1.x | Ready (required for pi-mono) |
| Rust | 1.93.0 | Ready |
| Cargo | 1.93.0 | Ready |
| Tauri CLI | 2.10.0 | Ready |
| build-essential | 12.10ubuntu1 | Ready |
| libwebkit2gtk-4.1-dev | Latest | Ready |
| libappindicator3-dev | Latest | Ready |
| librsvg2-dev | 2.58.0 | Ready |
| libssl-dev | Latest | Ready |
| cargo-xwin | Latest | Ready (Windows cross-compile) |
| nsis | Latest | Ready (Windows installers) |
| lld | Latest | Ready (fast linking) |
| DISPLAY | :0 | Ready (WSLg) |
| WAYLAND_DISPLAY | wayland-0 | Ready (WSLg) |

### Rust Targets ✅
| Target | Status | Purpose |
|--------|--------|---------|
| x86_64-unknown-linux-gnu | Ready | Linux desktop |
| x86_64-pc-windows-msvc | Ready | Windows cross-compile |
| aarch64-linux-android | Ready | Android ARM64 |
| x86_64-linux-android | Ready | Android x86_64 |

### Windows Cross-Compilation Notes
- Uses `cargo-xwin` via `--runner cargo-xwin` flag
- **TaskDialogIndirect issue RESOLVED** - Windows application manifest now embedded via Tauri's `WindowsAttributes.app_manifest()`
- NSIS installers can be built on Linux
- MSI installers require Windows (WiX toolset)

### Development Status
- **Phase:** Setup complete, development ready
- **Windows builds:** Working with embedded manifest
- **Sidecar build:** Automated via `build.rs`

### Notes
- WSLg is configured and ready for GUI applications
- Project is in optimal location (Linux filesystem)
- Local pi-mono reference is available for SDK development
- iOS builds require macOS (not possible from WSL2)
