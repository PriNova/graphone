markdown
# Project Spec: Pi-Tauri Cross-Platform Agent

## 1. Overview
A unified application to interface with the `pi-mono` (/home/prinova/CodeProjects/pi-mono) coding agent across Desktop (Windows/macOS/Linux) and Mobile (iOS/Android), plus a strategy for VS Code integration.

## 2. Tech Stack
- **Framework:** [Tauri 2.0](https://v2.tauri.app) (Multi-platform support)
- **Frontend:** TypeScript + [React](https://react.dev) or [Vue](https://vuejs.org) (for UI/UX)
- **Backend:** [Rust](https://www.rust-lang.org) (for OS-level process management)
- **Agent:** [pi-mono](https://github.com) (Running in RPC mode or via SDK)

## 3. Architecture & Requirements

### A. Desktop (The Sidecar Pattern)
- **Mechanism:** The Rust backend spawns `pi --mode rpc` as a managed sidecar.
- **Communication:** [Tauri Command API](https://v2.tauri.appconcept/inter-process-communication/) bridges the Frontend TS and the Rust sidecar `stdin/stdout`.
- **Packaging:** Include the `pi` binary in the [Tauri Bundle](https://v2.tauri.appplugin/shell/).

### B. Mobile (The Library Pattern)
- **Mechanism:** Since Mobile cannot run Node.js subprocesses, the `pi-mono` logic must be bundled as a library within the WebView.
- **Data:** Use the [Tauri HTTP Plugin](https://v2.tauri.appplugin/http/) to bypass Mobile CORS restrictions for LLM API calls.

### C. VS Code (The Shared Logic Pattern)
- **Mechanism:** A standalone [VS Code Extension](https://code.visualstudio.com) project.
- **Code Sharing:** Import the exact same `pi-mono` NPM package used in the Tauri frontend.

## 4. Scaffold Structure
```text
.
├── src-tauri/               # Rust Backend
│   ├── src/main.rs          # Process management for `pi --mode rpc`
│   ├── tauri.conf.json      # Mobile & Desktop capabilities
│   └── capabilities/        # Permissions for Shell/HTTP
├── src/                     # Frontend (TypeScript)
│   ├── components/          # Chat UI & Code Views
│   ├── hooks/               # usePiAgent (Logic switch: RPC vs SDK)
│   └── services/            # Bridge to Tauri Commands
├── vscode-extension/        # Separate TS project for VS Code
│   └── src/extension.ts     # Uses pi-mono logic directly
└── package.json             # Includes pi-mono dependency
```

## 5. Development Milestones
- **Phase 1 (Desktop MVP):** Scaffold Tauri 2.0 and implement the Rust-to-RPC bridge for pi.
- **Phase 2 (Mobile Adjustments):** Configure Android/iOS build targets and implement the SDK-fallback for environments without exec access.
- **Phase 3 (UI/UX):** Implement a responsive chat interface that adapts from desktop panels to mobile screens.
Phase 4 (VS Code): Create the extension wrapper using the core logic refined in Phase 1.

## 6. Resources
- **Tauri 2.0 Documentation:** https://v2.tauri.app
- **pi-mono RPC Protocol:** https://github.com/spcl/pi-mono/blob/main/docs/rpc.md
- **VS Code Webview UI Toolkit:** https://code.visualstudio.com/api/extension-guides/webview
