# Graphone

Graphone is a **visual workbench for serious agent work**, with **pi** as the runtime and extensibility substrate underneath.

Today, Graphone ships primarily as a native desktop app, but the project is aimed at a broader **service-capable, cross-client workbench** rather than “just a GUI for pi.”

[![Status](https://img.shields.io/badge/status-development-orange)](./FEATURES.md)
![Tauri](https://img.shields.io/badge/Tauri-2.0-blueviolet)
![License](https://img.shields.io/badge/license-MIT-green)

- Feature status: [FEATURES.md](./FEATURES.md)
- Troubleshooting: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)

## What Graphone is

Graphone is being built as:

- A visual workbench for agent operations
- A human control surface over pi-backed runtimes
- An artifact-first workspace, not only a chat UI
- A platform-agnostic product that can span desktop, browser, and future clients
- A future multi-agent environment, not only a single-session shell

In the current repo, that vision is delivered as a desktop product with:

- Native desktop builds for Linux, macOS, and Windows
- Streaming chat UI with tool output rendering
- Multi-session workflow with sidebar history
- Floating session windows
- A bundled `pi` sidecar built automatically during Tauri builds

## Platform support

| Platform | Status    | Notes                                                                                 |
| -------- | --------- | ------------------------------------------------------------------------------------- |
| Linux    | Supported | Native builds and release artifacts                                                   |
| macOS    | Supported | Local `.app` / `.dmg` builds; release artifacts published for Apple Silicon and Intel |
| Windows  | Supported | Cross-buildable from Linux; NSIS installer and portable `.exe` flows                  |

## Quick start

```bash
npm install
npm run dev:linux
```

Common build commands:

```bash
npm run build:linux
npm run build:windows
npm run build:macos:local
```

Useful variants:

```bash
npm run build:windows:portable
npm run build:macos:local:app
```

## Build notes

- **Linux**: standard Tauri build
- **Windows**: uses `cargo-xwin` for cross-compilation from Linux
- **macOS**: local ad-hoc signed build config at `src-tauri/tauri.macos.local.conf.json`
- The sidecar is compiled with **bun** from `services/agent-host`
- Linux bundles sidecar resources differently from macOS/Windows, but runtime behavior is aligned
- Tauri is the current desktop shell, not the long-term app/runtime boundary

## Requirements

- Node.js 20+
- bun 1+
- Rust stable
- Tauri build prerequisites for your target OS

Linux packages commonly needed:

```bash
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev clang lld
```

Windows cross-build extras on Linux:

```bash
cargo install cargo-xwin
sudo apt install nsis llvm lld
```

## Architecture in one line

```text
Graphone UI -> Graphone host/service boundary -> pi runtime/extensibility layer
```

Current repo seams:

- Frontend: `apps/desktop/web`
- Desktop shell: `src-tauri`
- Canonical host/runtime boundary: `services/agent-host`

## Repository layout

```text
graphone/
├── apps/desktop/web
├── src-tauri
├── services/agent-host
└── tooling/scripts
```

## Release artifacts

GitHub releases publish desktop artifacts, including macOS architecture-specific builds.

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=PriNova/graphone&type=timeline&legend=top-left)](https://www.star-history.com/?repos=PriNova%2Fgraphone&type=timeline&legend=top-left)

## License

MIT — see [LICENSE](./LICENSE)
