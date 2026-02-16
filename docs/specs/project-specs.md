markdown
# Project Spec: Pi-Tauri Cross-Platform Agent

## 1. Overview
A unified application to interface with the `pi-mono` coding agent across Desktop (Windows/macOS/Linux) and Mobile (iOS/Android), plus a strategy for VS Code integration.

## 2. Tech Stack
- **Framework:** [Tauri 2.0](https://v2.tauri.app) (Multi-platform support)
- **Frontend:** TypeScript + [Svelte](https://svelte.dev) (via Tauri scaffold)
- **Backend:** [Rust](https://www.rust-lang.org) (for OS-level process management)
- **Agent:** [pi-mono](https://github.com) (Node.js/TypeScript project, compiled with bun)

## 3. Architecture & Requirements

### A. Desktop (The Sidecar Pattern)
- **Mechanism:** The Rust backend spawns the Graphone host sidecar (`pi-agent`) as a managed sidecar.
- **Communication:** [Tauri Command API](https://v2.tauri.app/concept/inter-process-communication/) bridges the frontend and Rust backend; Rust communicates with the sidecar over `stdin/stdout` JSON lines.
- **Packaging:** Include the `pi-agent` binary in the [Tauri Bundle](https://v2.tauri.app/plugin/shell/).

**Important:** The shipped sidecar is Graphone-local host code (`sidecars/pi-agent-host`) built with **bun** and using `@mariozechner/pi-coding-agent` as its SDK dependency.

The build is automated via `src-tauri/build.rs`, which:
1. Detects the build target
2. Builds `sidecars/pi-agent-host/dist/cli.js`
3. Compiles it to a standalone binary with `bun build --compile`
4. Copies runtime assets from `@mariozechner/pi-coding-agent`
5. Tauri bundles it as a sidecar

### B. Mobile (The Library Pattern)
- **Mechanism:** Since Mobile cannot run Node.js subprocesses, the `pi-mono` logic must be bundled as a library within the WebView.
- **Data:** Use the [Tauri HTTP Plugin](https://v2.tauri.app/plugin/http/) to bypass Mobile CORS restrictions for LLM API calls.

### C. VS Code (The Shared Logic Pattern)
- **Mechanism:** A standalone [VS Code Extension](https://code.visualstudio.com) project.
- **Code Sharing:** Import the exact same `pi-mono` NPM package used in the Tauri frontend.

## 4. Scaffold Structure
```text
.
├── sidecars/
│   └── pi-agent-host/       # Graphone host sidecar source (TypeScript)
├── src-tauri/               # Rust Backend
│   ├── src/
│   │   ├── lib.rs           # Tauri commands and state management
│   │   └── main.rs          # Entry point
│   ├── binaries/            # Sidecar binaries (auto-populated by build.rs)
│   ├── build.rs             # Build script: compiles host sidecar with bun
│   ├── tauri.conf.json      # Desktop config with externalBin
│   └── capabilities/        # Permissions for shell/http plugins
├── src/                     # Frontend (TypeScript + Svelte)
│   ├── lib/
│   │   ├── stores/          # Session-scoped stores
│   │   ├── handlers/        # sessionId event/command routing
│   │   └── components/      # Chat and prompt UI
└── package.json             # Includes @mariozechner/pi-coding-agent dependency
```

## 5. Sidecar Build Process

### Prerequisites
- **bun** must be installed: https://bun.sh/docs/installation
- `@mariozechner/pi-coding-agent` installed in `node_modules`

### Automatic Build (via build.rs)
```text
1. Check target platform (skip mobile)
2. Build sidecars/pi-agent-host/src/cli.ts -> dist/cli.js
3. Compile with bun build --compile
4. Copy binary to src-tauri/binaries/pi-agent-<target-triple>
5. Copy runtime assets from @mariozechner/pi-coding-agent
6. Tauri bundles sidecar via externalBin
```

### Binary Naming Convention
Tauri sidecar binaries:
- Linux: `pi-agent-x86_64-unknown-linux-gnu`
- Windows: `pi-agent-x86_64-pc-windows-msvc.exe`
- macOS: `pi-agent-x86_64-apple-darwin` (Intel) or `pi-agent-aarch64-apple-darwin` (Apple Silicon)

## 6. Development Milestones
- **Phase 1 (Desktop MVP):** Scaffold Tauri 2.0 and implement the Rust-to-host-sidecar bridge.
- **Phase 2 (Mobile Adjustments):** Configure Android/iOS build targets and implement the SDK-fallback for environments without exec access.
- **Phase 3 (UI/UX):** Implement a responsive chat interface that adapts from desktop panels to mobile screens.
- **Phase 4 (VS Code):** Create the extension wrapper using the core logic refined in Phase 1.

## 7. Key Configuration

### tauri.conf.json
```json
{
  "bundle": {
    "externalBin": ["binaries/pi-agent"]
  },
  "plugins": {
    "shell": {
      "open": true
    }
  }
}
```

### Cargo.toml
```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
tauri-plugin-shell = "2"  # Required for sidecar spawning
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

### Capabilities (desktop.json)
```json
{
  "permissions": [
    "core:default",
    "opener:default",
    "shell:allow-spawn",
    "shell:allow-execute",
    "shell:allow-kill",
    "shell:allow-write-stdin"
  ]
}
```

## 8. Resources
- **Tauri 2.0 Documentation:** https://v2.tauri.app
- **pi-mono RPC Protocol:** https://github.com/spcl/pi-mono/blob/main/docs/rpc.md
- **bun Documentation:** https://bun.sh/docs
- **VS Code Webview UI Toolkit:** https://code.visualstudio.com/api/extension-guides/webview

## 9. Notes

### Why bun?
pi-mono uses `bun build --compile` to create a standalone binary because:
- bun can compile TypeScript/JavaScript to a single executable
- The resulting binary has no Node.js runtime dependency
- It's faster and produces smaller binaries than alternatives like pkg

### Project Location
Both projects should be in the same parent directory:
```
projects/
├── pi-mono/       # Node.js/TypeScript (external dependency)
└── graphone/      # This Tauri project
```

### Mobile Builds
For mobile (Android/iOS), the sidecar pattern is not used. Instead:
- The pi-mono SDK is bundled directly in the WebView
- The HTTP plugin is used for LLM API calls
- The mobile capability file configures these permissions
