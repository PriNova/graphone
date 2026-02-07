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

**Reference:** Local pi-mono at `/home/prinova/CodeProjects/pi-mono`

## Code Style Guidelines
- **Language**: TypeScript (frontend), Rust (backend)
- **Framework**: React 18 with functional components
- **State**: Zustand or Jotai (lightweight)
- **Styling**: Tailwind CSS
- **Bundler**: Vite (Tauri default)

## Critical Development Notes
**WSL2 Development:** Store project in **Linux filesystem** (`~/projects`), NOT `/mnt/c/` (10-100x performance difference)

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

## Current Environment (As of February 7, 2026)

### Host System
- **Platform:** WSL2 on Windows 11
- **OS:** Ubuntu 24.04.3 LTS (Noble Numbat)
- **Kernel:** Linux 6.6.87.2-microsoft-standard-WSL2
- **Architecture:** x86_64

### Project Location
- **Path:** `/home/prinova/CodeProjects/graphone` ✅
- **Filesystem:** Linux (ext4) - Performance optimal
- **Reference Project:** `/home/prinova/CodeProjects/pi-mono` ✅

### Installed Components ✅
| Component | Version | Status |
|-----------|---------|--------|
| Node.js | v22.21.0 | Ready |
| npm | 10.9.4 | Ready |
| build-essential | 12.10ubuntu1 | Ready |
| libgtk-3 | 3.24.41 | Ready |
| pkg-config | 1.8.1 | Ready |
| clang/llvm | 18.0 | Ready |
| curl | 8.5.0 | Ready |
| file | 5.45 | Ready |
| librsvg2 | 2.58.0 | Runtime only |
| DISPLAY | :0 | Ready (WSLg) |
| WAYLAND_DISPLAY | wayland-0 | Ready (WSLg) |

### Missing Components ❌ (BLOCKERS)
| Component | Required For |
|-----------|--------------|
| Rust (rustup) | All Tauri operations |
| Cargo | Build system |
| Tauri CLI | Dev server, builds |
| libwebkit2gtk-4.1-dev | WebView compilation |
| libappindicator3-dev | System tray integration |
| librsvg2-dev | SVG rendering (dev headers) |
| libssl-dev | HTTPS/TLS support |
| Rust targets | Cross-platform builds |

### Optional Missing Components
| Component | Purpose |
|-----------|---------|
| NVM | Node version management |
| cargo-xwin | Windows cross-compilation |
| lld | Faster linking |
| Android SDK | Mobile development |

### Development Status
- **Phase:** Assessment complete, setup pending
- **Next Steps:** Install Rust toolchain and system dependencies
- **Full Task List:** See `management/tasks/tasks.md`
- **Estimated Setup Time:** 15-30 minutes

### Notes
- WSLg is configured and ready for GUI applications
- Project is in optimal location (Linux filesystem)
- Local pi-mono reference is available for SDK development
- iOS builds require macOS (not possible from WSL2)
