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
