# Graphone - Agent Quick Reference

## Agent Workflow Guidelines
- **Check local code first** - Before using GitHub tools (`read_github`, `search_github`, etc.), always explore the local codebase using standard file tools (`read`, `bash` with `find`/`grep`, etc.)
- **Check pi-mono first for feature implementations** - Since graphone is a visual wrapper around pi-mono, look up implementations in local `../pi-mono` first (when available). Many features already exist there and can be mimicked or adapted for desktop UI
- Use GitHub tools only when you need to reference external repositories or when explicitly asked about remote code

## Build Commands
- `npm install` - Install dependencies
- `npm run check` - Type check Svelte/TypeScript (runs automatically on build)
- `npm run check:watch` - Type check in watch mode (for development)
- `npm run dev:linux` - Dev server (Linux native)
- `npm run dev:windows` - Dev server (Windows cross-compile)
- `npm run build` - Type check + build frontend (runs `check` first)
- `npm run build:linux` - Full Linux AppImage/deb build (includes type check)
- `npm run build:windows` - Full Windows NSIS installer build (includes type check)
- `npm run build:windows:exe` - Build Windows .exe only (no installer needed)
- `npm run build:windows:portable` - Build Windows .exe + stage portable runtime folder with sidecar assets
- `npm run build:all` - Build Linux + Windows
- `npm run run:windows` - Build (if needed), stage portable runtime, and launch Windows app from WSL2

## Stack & Architecture
- **Frontend**: Svelte 5 + TypeScript + Vite
- **Backend**: Rust + Tauri 2.0
- **Sidecar**: Graphone-local SDK host sidecar (`services/agent-host`, compiled with bun)
- **Pattern**: Desktop uses one host sidecar process that multiplexes multiple in-process agent sessions
- **SDK source**: Host sidecar consumes `@mariozechner/pi-coding-agent` from npm

## Project Structure
```
graphone/
├── apps/
│   └── desktop/
│       └── web/                 # Svelte frontend app
│           ├── src/
│           └── static/
├── src-tauri/                   # Rust/Tauri backend shell
│   ├── src/                     # Rust backend
│   ├── binaries/                # Sidecar binaries (auto-populated by build.rs)
│   ├── capabilities/            # Tauri permissions (desktop.json, mobile.json)
│   ├── .cargo/config.toml       # lld linker settings per-target
│   ├── build.rs                 # Auto-builds host sidecar binary with bun
│   ├── Cargo.toml
│   └── tauri.conf.json          # externalBin: ["binaries/pi-agent"]
├── services/
│   └── agent-host/              # Graphone host sidecar source
├── tooling/
│   └── scripts/                 # Build/run/verify scripts
├── docs/
│   ├── specs/
│   └── tasks/
└── package.json
```

Compatibility symlinks at repo root:
- `src -> apps/desktop/web/src`
- `static -> apps/desktop/web/static`

## Environment Status (February 2026)

### Host System
- **Platform**: WSL2 on Windows 11
- **OS**: Ubuntu 24.04.3 LTS
- **Arch**: x86_64

### Installed Components
| Component | Version | Status |
|-----------|---------|--------|
| Node.js | v22.21.0 | ✅ |
| npm | 10.9.4 | ✅ |
| bun | 1.x | ✅ **Required for sidecar compilation** |
| Rust | 1.93.0 | ✅ |
| Tauri CLI | 2.10.0 | ✅ |
| cargo-xwin | Latest | ✅ Windows cross-compile |
| lld | Latest | ✅ Fast linking |
| nsis | Latest | ✅ Windows installers |
| libwebkit2gtk-4.1-dev | Latest | ✅ |
| libappindicator3-dev | Latest | ✅ |
| librsvg2-dev | 2.58.0 | ✅ |
| DISPLAY | :0 | ✅ WSLg |
| WAYLAND_DISPLAY | wayland-0 | ✅ WSLg |

### Rust Targets
| Target | Status |
|--------|--------|
| x86_64-unknown-linux-gnu | ✅ Linux desktop |
| x86_64-pc-windows-msvc | ✅ Windows cross-compile |
| aarch64-linux-android | ✅ Android ARM64 |
| x86_64-linux-android | ✅ Android x86_64 |

## Critical Development Notes

### WSL2 Filesystem (Critical)
- **Store project in Linux filesystem** (`/home/<username>/projects/`), NOT `/mnt/c/` - performance difference is 10-100x

### Windows Cross-Compilation
- Uses `cargo-xwin` via `--runner cargo-xwin` flag (npm scripts handle this automatically)
- NSIS creates Windows installers on Linux; MSI requires Windows (WiX toolset)
- **TaskDialogIndirect issue RESOLVED** - Windows manifest embedded via Tauri's `WindowsAttributes.app_manifest()`

### Sidecar Build (Automatic)
- Sidecar is built automatically during Tauri/Cargo builds via `src-tauri/build.rs`
- Build source: `services/agent-host` (Graphone-local host multiplexer)
- Runtime SDK assets: `node_modules/@mariozechner/pi-coding-agent` (pinned npm dependency)
- Requires **bun**: `curl -fsSL https://bun.sh/install | bash`
- Binary naming: `pi-agent-<target-triple>` (with `.exe` for Windows)
- bun compiles host `dist/cli.js` to a standalone binary (not cargo/Rust)

### Linker Configuration (.cargo/config.toml)
- **Linux**: `lld` via `clang -fuse-ld=lld` (2-10x faster than system linker)
- **Windows**: Handled automatically by `cargo-xwin`
- **Android**: `lld` (from NDK)

## Common Issues & Solutions
| Issue | Solution |
|-------|----------|
| `bun: command not found` | `export PATH="$HOME/.bun/bin:$PATH"` |
| `pi-coding-agent` missing in `node_modules` | Run `npm install` in project root |
| `makensis.exe: No such file` | `sudo apt install nsis` or use `build:windows:exe` |
| `shell32.lib` / `kernel32.lib` not found | Use `npm run build:windows` (handles cargo-xwin) |
| Windows app won't open | Install WebView2 Runtime on Windows |
| Slow builds | Verify project is in Linux filesystem, not `/mnt/c/` |
| "TaskDialogIndirect could not be located" | Fixed - rebuild with `npm run build:windows` |

## Frontend Development Rules

### Type Checking
- **`npm run build` now includes type checking** - The build script runs `svelte-check` first to catch TypeScript/Svelte errors
- **`npm run check`** - Run type checking standalone (uses `svelte-check --fail-on-warnings`)
- **`npm run check:watch`** - Run type checking in watch mode during development
- Type errors and warnings will fail the build - fix them before committing

### Tailwind v4 + Svelte 5
- **Single CSS entry**: Use one `index.css` with `@import 'tailwindcss'` - do NOT split into multiple CSS files with `@import`
- **No CSS imports in Svelte `<style>`**: Import CSS in `<script>` block only: `import '$lib/styles/index.css'`

### Cross-Platform Layout (WebView2 vs WebKitGTK)
Windows WebView2 requires explicit height inheritance for flexbox layouts to work:
```css
/* Required in global CSS for Windows */
html, body, #app, #svelte { height: 100%; width: 100%; }
html, body { overflow: hidden; }
```

### Flexbox Pattern for Fixed Header/Scrollable Content/Fixed Footer
```svelte
<!-- Parent must have explicit height (h-screen) -->
<div class="flex flex-col h-screen overflow-hidden">
  <!-- Header/Input: prevent shrinking -->
  <header class="shrink-0">...</header>
  
  <!-- Scrollable area: flex-1 + min-h-0 is critical -->
  <div class="flex-1 min-h-0 overflow-y-auto">...</div>
  
  <!-- Footer/Input: prevent shrinking -->
  <section class="shrink-0">...</section>
</div>
```
**Key classes**: `shrink-0` (fixed elements), `flex-1 min-h-0` (scrollable area), `overflow-hidden` (container)

## Documentation
- `docs/specs/repository-structure-2026-02.md` - Current repository architecture and naming
- `docs/specs/project-findings-2026-02.md` - Tech research & patterns
- `docs/specs/wsl2-development-notes.md` - WSL2 development guide
- `docs/tasks/scaffolding-tasks.md` - Complete setup history

## External References
- Tauri 2.0: https://v2.tauri.app
- bun: https://bun.sh/docs
- cargo-xwin: https://github.com/rust-cross/cargo-xwin
