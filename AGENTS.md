# Graphone - Agent Quick Reference

## Build Commands
- `npm install` - Install dependencies
- `npm run dev:linux` - Dev server (Linux native)
- `npm run dev:windows` - Dev server (Windows cross-compile)
- `npm run build:linux` - Build Linux AppImage/deb
- `npm run build:windows` - Build Windows NSIS installer
- `npm run build:windows:exe` - Build Windows .exe only (no installer needed)
- `npm run build:all` - Build Linux + Windows
- `npm run run:windows` - Build (if needed) & launch Windows app from WSL2

## Stack & Architecture
- **Frontend**: Svelte 5 + TypeScript + Vite
- **Backend**: Rust + Tauri 2.0
- **Sidecar**: pi-mono (TypeScript/Node.js, built with bun)
- **Pattern**: Desktop uses sidecar (`pi --mode rpc` subprocess via shell plugin)
- **Reference**: Local pi-mono at `../pi-mono` (relative to this project)

## Project Structure
```
graphone/
├── src/                    # Svelte frontend
├── src-tauri/
│   ├── src/               # Rust backend
│   ├── binaries/          # Sidecar binaries (auto-populated by build.rs)
│   ├── capabilities/      # Tauri permissions (desktop.json, mobile.json)
│   ├── .cargo/config.toml # lld linker settings per-target
│   ├── build.rs           # Auto-builds pi-mono sidecar with bun
│   ├── Cargo.toml
│   └── tauri.conf.json    # externalBin: ["binaries/pi-agent"]
├── docs/
│   ├── specs/            # wsl2-development-notes.md, project-findings-2026-02.md
│   └── tasks/            # scaffolding-tasks.md (setup history)
├── scripts/run-windows.sh # Launch Windows app from WSL2
└── package.json
```

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
| bun | 1.x | ✅ **Required for pi-mono build** |
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
- pi-mono is built automatically during Tauri builds via `src-tauri/build.rs`
- Requires **bun**: `curl -fsSL https://bun.sh/install | bash`
- Binary naming: `pi-agent-<target-triple>` (with `.exe` for Windows)
- bun compiles TypeScript to standalone binary (not cargo/Rust)

### Linker Configuration (.cargo/config.toml)
- **Linux**: `lld` via `clang -fuse-ld=lld` (2-10x faster than system linker)
- **Windows**: Handled automatically by `cargo-xwin`
- **Android**: `lld` (from NDK)

## Common Issues & Solutions
| Issue | Solution |
|-------|----------|
| `bun: command not found` | `export PATH="$HOME/.bun/bin:$PATH"` |
| `makensis.exe: No such file` | `sudo apt install nsis` or use `build:windows:exe` |
| `shell32.lib` / `kernel32.lib` not found | Use `npm run build:windows` (handles cargo-xwin) |
| Windows app won't open | Install WebView2 Runtime on Windows |
| Slow builds | Verify project is in Linux filesystem, not `/mnt/c/` |
| "TaskDialogIndirect could not be located" | Fixed - rebuild with `npm run build:windows` |

## Frontend Development Rules

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
- `docs/specs/project-findings-2026-02.md` - Tech research & patterns
- `docs/specs/wsl2-development-notes.md` - WSL2 development guide
- `docs/tasks/scaffolding-tasks.md` - Complete setup history

## External References
- Tauri 2.0: https://v2.tauri.app
- bun: https://bun.sh/docs
- cargo-xwin: https://github.com/rust-cross/cargo-xwin
