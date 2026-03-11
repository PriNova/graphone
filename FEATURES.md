# Graphone Feature Availability

_Last updated: 2026-03-11_

This page summarizes what Graphone supports today.

## Platform availability

- ✅ Linux desktop builds and release artifacts
- ✅ Windows desktop builds and release artifacts
- ✅ macOS desktop builds, local `.app` / `.dmg` packaging, and release artifacts for Apple Silicon and Intel

## Status legend

- ✅ Available now
- 🟡 Available with limitations
- ❌ Not available yet

## ✅ Available now

### Core desktop workflow

- Multi-session chat experience
- Start a new chat while another session is still generating
- Session persistence and reopening from sidebar history
- Project-scoped session history
- Streaming assistant responses
- Stop/cancel current generation
- Markdown rendering in assistant responses
- Tool activity display with readable formatting
- Tool result rich HTML rendering via `ToolResultMessage.details._html` (sanitized)

### Windows and layout

- Main workspace with sidebar + chat surface
- Floating session windows for active or historical sessions
- Native decorated/resizable floating windows
- Shared chat/message rendering surface across workspace and floating windows

### Settings and controls

- Model selection from available providers/models
- Thinking level selection when supported by the model
- Settings overlay for message block defaults
- Light/dark appearance toggle
- Theme selection persists across restarts and syncs across open Graphone windows

### Extensions and runtime

- Registered extensions list in Settings, grouped by global (`~/.pi/agent`) and local (`.pi`) scope
- Extension load diagnostics in Settings when available
- Bundled `pi` sidecar runtime included with desktop builds
- Bundled sidecar supports Graphone host mode and normal pi CLI behavior
- Runtime PATH is prepended process-locally so extension subprocesses can resolve bundled `pi`

### Authentication and safety

- OAuth login/logout command flow in the GUI (`/login`, `/logout`)
- Active generations are aborted during app shutdown

### Attachments and input

- Image attachments in the composer (paste, drag/drop, file picker)
- `!command` / `!!command` prompt behavior

## 🟡 Available with limitations

### Image support limits

- Image attachments are model-dependent
- Sending is blocked on text-only models
- Limited to 4 images/message and 5MB/image
- Supported payloads: PNG, JPEG, GIF, WebP

### Templates, skills, and extensions

- Prompt templates and skills can work, but there is no full management UI yet
- Extensions are visible in Settings, but enable/disable/package management UX is still limited
- Graphone does not yet expose all interactive extension UI capabilities available in the terminal app

### Model catalog sync

- Runtime model catalog sync currently works best with providers exposing OpenAI-style model listing endpoints
- OpenAI Codex-backed model catalogs can be synced into `~/.pi/agent/models.json`
- Anthropic, Google, Bedrock, and other provider-specific catalogs are not yet fully auto-discovered at runtime

### Tool result HTML rendering

- Rich tool-result HTML is sanitized before rendering
- Script execution is blocked

### Session resume parity

- Session resume works through sidebar/history flow
- Full command-level parity is still incomplete
- Unseen-completion indicators persist across restarts only for completions Graphone observed while open

### Floating session windows

- Floating windows are bound to specific sessions
- If the session is no longer available, the window shows an unavailable-state message

## ❌ Not available yet

### Input and picker parity

- `@` file reference picker in the input box

### Advanced command parity

- Full queued message behavior parity
- Full parity for advanced commands such as:
  - `/settings`, `/scoped-models`, `/fork`, `/tree`, `/resume`
  - `/export`, `/share`, `/copy`, `/name`, `/session`
  - `/compact`, `/reload`, `/hotkeys`, `/changelog`, `/quit`

### Keyboard and branching workflows

- TUI-style keyboard shortcut parity
- Full tree-branch navigation and branch summary workflow parity

### TUI configuration parity

- Full theme/settings/package management parity with the TUI

## Summary

Graphone already covers the main day-to-day desktop workflow well: sessions, streaming, tools, history, floating windows, and bundled sidecar runtime across Linux, macOS, and Windows.
