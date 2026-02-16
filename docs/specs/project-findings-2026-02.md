# Pi-Tauri Cross-Platform Agent: Design & Scaffolding Findings

**Date:** February 7, 2026  
**Status:** Research Summary for Initial Design Phase

---

## Executive Summary

This document compiles the latest findings (as of February 2026) from web research on technologies and patterns relevant to the Pi-Tauri Cross-Platform Agent project. The project aims to create a unified Desktop (Windows/macOS/Linux), Mobile (iOS/Android), and VS Code extension interface for the pi-mono coding agent using Tauri 2.0.

---

## 1. Tauri 2.0: Current State & Key Capabilities

### 1.1 Release Status
- **Stable Release:** Tauri 2.0 reached stable in October 2024 after 2+ years of development
- **Security:** Completed external security audits (similar to Tauri 1.0 with Radically Open Security)
- **Maturity:** Production-ready with 8 minor versions of 1.x branch maintained in parallel

### 1.2 Core Architecture Principles
Tauri 2.0 is built on trust boundaries between frontend and backend:

| Layer | Technology | Trust Level | Capabilities |
|-------|-----------|-------------|--------------|
| Frontend | System WebView (WKWebView/WebView2/WebKitGTK) | Untrusted/Sandboxed | UI rendering, explicit API access only |
| Backend | Rust Core | Trusted | Full system access, business logic |
| Plugins | Rust/Swift/Kotlin | Configurable | Modular feature extensions |

### 1.3 Mobile Support (Critical for Project)
**Platform Coverage:**
- ✅ iOS: Full support with Swift bindings for native plugins
- ✅ Android: Full support with Kotlin bindings for native plugins
- **Development Workflow:**
  - `tauri ios dev` / `tauri android dev` for device/simulator testing
  - `--open` flag launches Xcode/Android Studio for debugging
  - Physical device testing requires network configuration via `TAURI_DEV_HOST`

**Mobile Limitations to Consider:**
- Not all desktop plugins work on mobile (some by design, some not yet implemented)
- **No Node.js subprocess support on mobile** (confirms the Library Pattern approach)
- CORS restrictions require HTTP plugin for external API calls

### 1.4 Key Official Plugins Relevant to Project

| Plugin | Desktop | Mobile | Purpose |
|--------|---------|--------|---------|
| `tauri-plugin-shell` | ✅ | ❌ | Process spawning (sidecar pattern) |
| `tauri-plugin-http` | ✅ | ✅ | HTTP client for bypassing CORS |
| `tauri-plugin-fs` | ✅ | ✅ | File system access |
| `tauri-plugin-store` | ✅ | ✅ | Persistent key-value storage |
| `tauri-plugin-sql` | ✅ | ✅ | SQLite database access |
| `tauri-plugin-updater` | ✅ | ⚠️ | In-app updates |

### 1.5 Sidecar Pattern Deep Dive
**Current Implementation (Desktop Only):**
```rust
// Configuration in tauri.conf.json
{
  "bundle": {
    "externalBin": ["binaries/my-sidecar"]
  }
}
```

**Process:**
1. Package Node.js app using `pkg` (or similar) to binary
2. Name binary with target triple: `my-sidecar-x86_64-unknown-linux-gnu`
3. Place in `src-tauri/binaries/`
4. Use `Command.sidecar()` from shell plugin
5. Communicate via stdin/stdout or local sockets

**Important:** Sidecars require shell plugin permissions configured in capabilities.

---

## 2. pi-mono Coding Agent: Integration Modes

### 2.1 Package Information
- **NPM Package:** `@mariozechner/pi-coding-agent` (v0.52.7 as of Feb 2026)
- **Repository:** `github.com/badlogic/pi-mono`
- **License:** MIT
- **Core Philosophy:** Minimal, extensible, workflow-adaptable

### 2.2 Four Operation Modes

| Mode | Use Case | Integration Method |
|------|----------|-------------------|
| **Interactive** | TUI experience | Not applicable for embedded use |
| **Print/JSON** | Scripting, one-shot | `pi -p "query"` or `--mode json` |
| **RPC** | Process integration | historical direct RPC CLI over stdin/stdout |
| **SDK** | Embedded applications | NPM import, direct Node.js |

### 2.3 SDK Integration Pattern (Mobile/Library Approach)
```typescript
import { 
  AuthStorage, 
  createAgentSession, 
  ModelRegistry, 
  SessionManager 
} from "@mariozechner/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage: new AuthStorage(),
  modelRegistry: new ModelRegistry(authStorage),
});

await session.prompt("What files are in the current directory?");
```

### 2.4 Host Sidecar Protocol Pattern (Desktop/Graphone)
```text
# Graphone runtime
Rust backend <-> pi-agent-host sidecar <-> in-process SDK sessions
```
- newline-delimited JSON protocol over stdin/stdout
- session-scoped envelopes with `sessionId`
- one host process multiplexing many sessions

### 2.5 Key SDK Components

| Component | Purpose |
|-----------|---------|
| `AgentSession` | Lifecycle, message history, event streaming |
| `SessionManager` | Session persistence (in-memory or file-based) |
| `ModelRegistry` | Provider/model management |
| `AuthStorage` | API key and credential storage |

### 2.6 Event System
The SDK uses streaming events for real-time updates:
```typescript
session.subscribe((event) => {
  if (event.type === "message_update" && 
      event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});
```

---

## 3. VS Code Extension Development (2026 State)

### 3.1 Current API Version
- **Latest Stable:** VS Code 1.109 (January 2026)
- **Key Focus:** Multi-agent development, AI extensibility

### 3.2 Webview API (Primary UI Method)
```typescript
const panel = vscode.window.createWebviewPanel(
  'piAgent',
  'Pi Agent',
  vscode.ViewColumn.One,
  { enableScripts: true }
);
```

**Webview Capabilities:**
- Full HTML/CSS/JS rendering
- Message passing via `postMessage`/`onDidReceiveMessage`
- Access to VS Code theme via CSS variables (`--vscode-editor-foreground`)
- Developer tools via "Developer: Toggle Developer Tools"

### 3.3 Security Best Practices (2026)
- Content Security Policy (CSP) mandatory
- Sanitize all user input
- Use `localResourceRoots` to restrict file access
- Never leak `acquireVsCodeApi()` to global scope

### 3.4 Shared Logic Pattern
The VS Code extension will use the **same** `@mariozechner/pi-coding-agent` NPM package as the Tauri frontend, enabling:
- Code reuse across platforms
- Consistent behavior
- Single dependency management

### 3.5 New 2026 Features Relevant to AI Extensions
- **MCP (Model Context Protocol) Apps:** Rich interactive UI in chat
- **Chat Output Renderer API:** Custom webview-based chat responses
- **Language Model Tools:** First-class tool calling support
- **Chat Resource Providers:** Dynamic prompts and skills

---

## 4. Mobile Development Considerations

### 4.1 The Library Pattern (Confirmed Approach)
Since mobile platforms **cannot spawn Node.js subprocesses**, the architecture must:

1. **Bundle pi-mono as library** within the app JavaScript context
2. **Use Tauri HTTP Plugin** for LLM API calls (bypasses CORS)
3. **Avoid sidecar pattern** on iOS/Android

### 4.2 CORS Handling for LLM APIs

**Problem:** WebView CORS restrictions block direct LLM API calls from frontend.

**Official Solution:** `tauri-plugin-http`
```typescript
import { fetch } from '@tauri-apps/plugin-http';
// Use instead of native fetch for external APIs
```

**Alternative Community Plugin:** `tauri-plugin-cors-fetch`
- Transparently proxies `fetch()` through Tauri HTTP client
- Zero code changes (hooks global fetch)
- Supports streaming and SSE
- Version 5.0.0 (Jan 2026) - actively maintained

### 4.3 Mobile Plugin Development
For platform-specific features, Tauri 2.0 supports:
- **iOS:** Swift plugins extending `Plugin` class
- **Android:** Kotlin plugins extending `Plugin` class
- **Communication:** Rust bridge with `@Command` decorators

---

## 5. AI Agent Architecture Patterns (2026)

### 5.1 Recommended Patterns from Anthropic Research
Based on "Building Effective AI Agents" (Dec 2024):

| Pattern | When to Use | Complexity |
|---------|-------------|------------|
| **Prompt Chaining** | Decomposable tasks, need for verification | Low |
| **Routing** | Different inputs need different handlers | Low |
| **Parallelization** | Multiple subtasks can run simultaneously | Medium |
| **Orchestrator-Workers** | Dynamic subtasks (coding agents) | Medium-High |
| **Autonomous Agent** | Open-ended problems, high trust required | High |

### 5.2 pi-mono's Architecture Alignment
pi-mono follows the **Orchestrator-Workers** pattern:
- Central agent reasons about tasks
- Tool execution delegated to specialized handlers
- Event-driven architecture for streaming responses

### 5.3 Memory Management
pi-mono provides:
- **Short-term:** In-context conversation history
- **Long-term:** Session persistence via `SessionManager`
- **Compaction:** Automatic summarization approaching context limits

---

## 6. Recommended Tech Stack Decisions

### 6.1 Frontend Framework
**Recommendation:** React with TypeScript

**Rationale:**
- pi-mono uses React for its TUI components
- Extensive ecosystem for chat UI components
- Type safety for SDK integration
- Easy integration with VS Code webviews

**Alternative:** Vue 3 (also well-supported by Tauri)

### 6.2 State Management
- **Desktop/Mobile:** Zustand or Jotai (lightweight, TypeScript-friendly)
- **VS Code:** Built-in state management via extension context

### 6.3 UI Component Library
Recommended options for chat interfaces:
- Custom components (for full control)
- Tailwind CSS for styling
- Headless UI for accessible primitives

### 6.4 Build & Development
- **Package Manager:** pnpm (fast, efficient)
- **Bundler:** Vite (Tauri default, fast HMR)
- **Rust:** Latest stable (1.84+ for `--print host-tuple` support)

---

## 7. Security Considerations

### 7.1 Tauri Security Model
- **Capability-based permissions:** Explicit allowlisting in `capabilities/`
- **CSP:** Content Security Policy in `tauri.conf.json`
- **Scope validation:** All commands validate parameters

### 7.2 pi-mono Security
- Extensions run with full system access
- Skills can instruct model to run executables
- Review all third-party pi packages before installation

### 7.3 LLM API Security
- Store API keys in Tauri Store (encrypted on mobile)
- Never commit credentials to version control
- Use environment variables for development

---

## 8. Development Milestones: Updated Recommendations

### Phase 1: Desktop MVP (Weeks 1-4)
1. Scaffold Tauri 2.0 with React
2. Configure Graphone host sidecar packaging and spawn
3. Implement Rust-to-host-protocol bridge
4. Basic chat UI with message streaming
5. Shell plugin configuration

### Phase 2: Mobile Adaptation (Weeks 5-8)
1. Configure mobile build targets (iOS/Android)
2. Implement SDK-fallback for mobile (no sidecar)
3. Integrate HTTP plugin for CORS bypass
4. Platform-specific UI adjustments
5. Test on physical devices

### Phase 3: VS Code Extension (Weeks 9-12)
1. Scaffold extension with `yo code`
2. Shared logic via `@mariozechner/pi-coding-agent`
3. Webview panel for chat interface
4. Command palette integration
5. Extension packaging and publishing

### Phase 4: Polish & Distribution (Weeks 13-16)
1. Responsive UI refinements
2. Updater plugin integration
3. App store preparation
4. Documentation and examples

---

## 9. Key Resources & References

### Tauri 2.0
- Documentation: https://v2.tauri.app
- GitHub: https://github.com/tauri-apps/tauri
- Mobile Plugin Dev: https://v2.tauri.app/develop/plugins/develop-mobile/

### pi-mono
- Repository: https://github.com/badlogic/pi-mono
- NPM: https://www.npmjs.com/package/@mariozechner/pi-coding-agent
- SDK Docs: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md
- RPC Docs: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md

### VS Code Extension
- API Docs: https://code.visualstudio.com/api
- Webview Guide: https://code.visualstudio.com/api/extension-guides/webview
- Samples: https://github.com/microsoft/vscode-extension-samples

### AI Agent Patterns
- Anthropic Research: https://www.anthropic.com/research/building-effective-agents
- MCP Protocol: https://modelcontextprotocol.io

---

## 10. Risk Factors & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tauri mobile ecosystem immaturity | Medium | Use established plugins, fallback to native modules |
| pi-mono SDK API changes | Medium | Pin version in package.json, monitor changelog |
| LLM API rate limits | Low | Implement request queuing, local model fallback |
| Mobile performance constraints | Medium | Optimize bundle size, lazy loading |
| VS Code API deprecations | Low | Target stable APIs, follow extension guidelines |

---

## 11. Local Repository Structure

**Current Setup:**
```
<project-directory>/
├── pi-mono/              # Local clone of pi-mono repository
│   ├── packages/
│   │   ├── coding-agent/     # @mariozechner/pi-coding-agent
│   │   ├── agent/            # @mariozechner/pi-agent-core
│   │   ├── ai/               # @mariozechner/pi-ai
│   │   ├── tui/              # Terminal UI library
│   │   └── web-ui/           # Web UI components
│   ├── docs/
│   └── examples/
│
└── graphone/             # This project (Pi-Tauri Cross-Platform Agent)
    ├── management/
    │   └── specs/
    ├── src/
    ├── src-tauri/
    └── vscode-extension/
```

**Development Workflow:**
- **pi-mono local path:** `../pi-mono` (relative to this project)
- **Current project:** `graphone` (this project)
- **Reference in code:** Use relative paths or npm link for local pi-mono development

**npm Link Setup (for local pi-mono development):**
```bash
# In pi-mono repository
cd ../pi-mono/packages/coding-agent
npm link

# In graphone project
cd ../graphone
npm link @mariozechner/pi-coding-agent
```

## 12. WSL2 + Windows 11 Development Considerations

**Reference Document:** See `wsl2-development-notes.md` for detailed guidance.

**Key Points:**
- **Store project in Linux filesystem** (e.g., `/home/<user>/projects/`) - not `/mnt/c/` (10-100x performance difference)
- **Use WSL2 for development** - native Linux performance for cargo/node
- **Cross-compile for Windows** - use `cargo-xwin` or build on Windows host
- **Mobile dev** - Android SDK works in WSL2, iOS requires macOS
- **IDE** - VS Code Windows + WSL Remote extension recommended

**Quick Checklist:**
- [ ] Project is in `<project-directory>/` (Linux FS)
- [ ] Using Node.js via nvm in WSL2
- [ ] Rust installed via rustup in WSL2
- [ ] VS Code with Remote-WSL extension
- [ ] WSL2 updated (`wsl --update`)

---

## Conclusion

The Pi-Tauri Cross-Platform Agent project is well-positioned to leverage mature, production-ready technologies:

1. **Tauri 2.0** provides the necessary cross-platform foundation with excellent mobile support
2. **pi-mono's SDK and RPC modes** offer flexible integration options for desktop vs mobile
3. **VS Code's extension API** enables seamless IDE integration using shared logic

The architecture outlined in the project specification aligns with current best practices and the state of these technologies as of February 2026.

---

*Document generated for initial design and scaffolding phase.*
*Last updated: February 7, 2026*
