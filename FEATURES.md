# Graphone Feature Availability (User Guide)

_Last updated: 2026-02-27_

This page helps you quickly understand what to expect from **Graphone** today, especially if you already know the pi terminal app (TUI).

## Status Legend

- ✅ **Available now**
- 🟡 **Available with limitations**
- ❌ **Not available yet**

---

## ✅ Available now

- Multi-session chat experience
- Start a new chat while another session is still generating (parallel session creation)
- Project-scope sidebar with session history
- Session activity indicators in the sidebar/history list (idle vs active)
- Full-mode and compact-mode UI toggle
- Compact mode activity rail + collapsible project-scope drawer
- Resizable compact window width (left/right drag handles)
- Prompt draft is preserved when switching between full and compact mode
- Window placement/size is preserved when toggling compact mode
- Deleting an entire project scope
- Deleting a **single session** from a project scope
- Real-time streaming assistant responses
- Tool activity display (calls/results) with readable formatting
- Thinking/reasoning block display
- Markdown rendering in assistant responses
- Model selection from available providers/models
- Thinking level selection (when supported by model)
- New chat creation (`/new`)
- Session persistence and reopening from sidebar history
- Usage/context indicator in the status area
- Stop/cancel current generation
- Active generations are aborted during app shutdown to avoid orphaned runs
- Image attachments in the prompt composer (paste, drag/drop, file picker)

---

## 🟡 Available with limitations

- Image attachments are model-dependent (send is blocked on text-only models), limited to 4 images/message, 5MB/image, and PNG/JPEG/GIF/WebP payloads
- Prompt templates and skills can work, but there is no full dedicated browser-style management UI yet
- Extension-powered features can run, but Graphone does not yet expose all interactive extension UI capabilities available in the terminal experience
- Session resume works through sidebar/history flow; command-level parity is still incomplete

---

## ❌ Not available yet (compared to pi TUI)

- Login/logout command flow in the GUI (`/login`, `/logout`)
- `@` file reference picker in the input box
- `!command` / `!!command` prompt behavior
- Full queued message behavior parity (steer/follow-up queue UX)
- Full command parity for advanced session/workflow commands, including:
  - `/settings`, `/scoped-models`, `/fork`, `/tree`, `/resume`
  - `/export`, `/share`, `/copy`, `/name`, `/session`
  - `/compact` command parity (compact mode is available via the GUI toggle), `/reload`, `/hotkeys`, `/changelog`, `/quit`
- TUI-style keyboard shortcut parity (model cycling, thinking cycling, tree/fork shortcuts, etc.)
- Full tree-branch navigation and branch summary workflow parity
- Full theme/settings/package management parity with TUI

---

## What this means for you

Graphone already covers the core day-to-day chat workflow well (sessions, model selection, streaming, tools, history management, and compact/full display mode). Advanced terminal workflows are still being brought over.

If you depend on specific TUI commands, check this page first before expecting full parity in the GUI.
