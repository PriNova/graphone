# Graphone Feature Availability (User Guide)

_Last updated: 2026-03-05_

This page helps you quickly understand what to expect from **Graphone** today, especially if you already know the pi terminal app (TUI).

## Status Legend

- ✅ **Available now**
- 🟡 **Available with limitations**
- ❌ **Not available yet**

---

## ✅ Available now

### Sessions & project scope

- Multi-session chat experience
- Start a new chat while another session is still generating (parallel session creation)
- New chat creation (`/new`)
- Session persistence and reopening from sidebar history
- Project-scope sidebar with session history
- Session activity indicators in the sidebar/history list (idle vs active)
- Deleting a **single session** from a project scope
- Deleting an entire project scope

### Windowing & layout

- Main workspace layout with sidebar + chat surface
- Open the active session in a floating session window from the main workspace
- Open session history items in floating session windows from the sidebar
- Floating session windows are native decorated/resizable windows
- Floating session windows and the main workspace use the same chat/message rendering surface

### Settings & extension visibility

- Settings overlay for message block defaults
- Registered extensions list in Settings, grouped by **Global** (`~/.pi/agent`) and **Local** (`.pi`) scope
- Extension load diagnostics visible in Settings (when extension loading reports errors)

### Chat generation & content display

- Real-time streaming assistant responses
- Thinking/reasoning block display
- Markdown rendering in assistant responses
- Tool activity display (calls/results) with readable formatting
- Tool result rich HTML rendering via `ToolResultMessage.details._html` (Graphone-specific, sanitized)
- Stop/cancel current generation

### Model controls & context

- Model selection from available providers/models
- Runtime provider model catalog sync refreshes supported provider model lists before session startup
- Thinking level selection (when supported by model)
- Usage/context indicator in the status area

### Authentication

- OAuth login/logout command flow in the GUI (`/login`, `/logout`)

### Safety & lifecycle

- Active generations are aborted during app shutdown to avoid orphaned runs

### Sidecar runtime compatibility (internal)

- Graphone ships a single bundled `pi` sidecar binary (`pi` / `pi.exe` / `pi.gz`)
- Bundled sidecar supports dual mode dispatch:
  - Graphone host mode via private `--graphone-host`
  - Normal pi CLI behavior by default (for `--mode json`, `--mode rpc`, etc.)
- Runtime PATH is prepended process-locally so extension subprocesses can resolve bundled `pi` first
- Community/custom extensions that call `spawn("pi", ...)` work even without a global/system `pi` install

### Attachments

- Image attachments in the prompt composer (paste, drag/drop, file picker)

---

## 🟡 Available with limitations

### Image support limits

- Image attachments are model-dependent (send is blocked on text-only models)
- Limited to 4 images/message and 5MB/image
- Supported payloads: PNG/JPEG/GIF/WebP

### Templates, skills, and extensions

- Prompt templates and skills can work, but there is no full dedicated browser-style management UI yet
- Extensions are visible in Settings (grouped Global/Local), but enable/disable/package management UX is still limited
- Extension-powered features can run, but Graphone does not yet expose all interactive extension UI capabilities available in the terminal experience

### Runtime model catalog sync limits

- Runtime provider model catalog sync currently supports providers with OpenAI-style model listing endpoints using `openai-completions`, `openai-responses`, and `openai-codex-responses`
- OpenAI Codex-backed model catalogs can now be synced into `~/.pi/agent/models.json`, but broader provider discovery is still incomplete
- Anthropic, Google, Bedrock, and other provider-specific catalogs are not yet fully auto-discovered at runtime

### Tool result HTML rendering limits

- Rich tool-result HTML is sanitized before rendering
- Script execution in tool-result HTML is blocked

### Session resume parity

- Session resume works through sidebar/history flow; command-level parity is still incomplete

### Floating session window limits

- Floating windows are opened for specific sessions (active session or selected history session)
- If the bound session is no longer available, the floating window shows an unavailable-state message

---

## ❌ Not available yet (compared to pi TUI)

### Input command flow

- `@` file reference picker in the input box
- `!command` / `!!command` prompt behavior

### Advanced command/workflow parity

- Full queued message behavior parity (steer/follow-up queue UX)
- Full command parity for advanced session/workflow commands, including:
  - `/settings`, `/scoped-models`, `/fork`, `/tree`, `/resume`
  - `/export`, `/share`, `/copy`, `/name`, `/session`
  - `/compact`, `/reload`, `/hotkeys`, `/changelog`, `/quit`

### Keyboard and branching workflows

- TUI-style keyboard shortcut parity (model cycling, thinking cycling, tree/fork shortcuts, etc.)
- Full tree-branch navigation and branch summary workflow parity

### TUI configuration parity

- Full theme/settings/package management parity with TUI

---

## What this means for you

Graphone already covers the core day-to-day chat workflow well (sessions, model selection, streaming, tools, history management, and floating session windows from the desktop workspace). Advanced terminal workflows are still being brought over.

If you depend on specific TUI commands, check this page first before expecting full parity in the GUI.
