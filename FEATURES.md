# Graphone Feature Availability

_Last updated: 2026-03-20_

This page summarizes what Graphone supports today.

## Platform availability

- ✅ Linux desktop builds and release downloads
- ✅ Windows desktop builds and release downloads
- ✅ macOS local builds and release downloads for Apple Silicon and Intel

## Status legend

- ✅ Available now
- 🟡 Available with limitations
- ❌ Not available yet

## ✅ Available now

### Core desktop workflow

- Multi-session chat experience
- Open chats in a tab bar and switch between them without losing your place
- Reopen your previously open chat tabs on relaunch when they are still available
- Start a new chat while another session is still generating
- Start a new chat from the New Chat button or `/new` without replacing your current open conversation
- Session history in the sidebar, including reopening older chats
- Project-based chat organization with a folder picker for adding project scopes
- Session tree view for browsing a conversation as a branchable transcript
- Open the session tree from the toolbar or with `/tree`
- Jump back to earlier points in a chat and branch from earlier user prompts
- Optional branch summaries when switching paths, with cancel support while the summary is being created
- Streaming assistant responses
- Stop/cancel the current response
- Markdown rendering in assistant responses
- Readable tool output in chat
- Floating session windows for active or historical chats
- More reliable startup that reopens your last valid project or chat when available

### Input and commands

- Image attachments in the composer (paste, drag and drop, file picker)
- `!command` / `!!command` prompt behavior
- Slash-command autocomplete and handling for runtime-provided commands, including prompts, skills, and extension commands when available
- Compact in-chat rendering for skill command invocations
- Expand/collapse controls for bash command output
- Stop/cancel for running bash commands

### Settings and personalization

- Model selection from available models
- Thinking level selection when supported by the model
- Settings for message display defaults
- Light/dark appearance toggle
- Theme selection that persists across restarts and stays in sync across open windows
- Model availability settings follow project preferences first, then home defaults
- Prompts and Skills sections in Settings, grouped by global, local, and path/package scope when available

### Extensions and account

- Extension list in Settings
- Extension load status in Settings when available
- Extension status updates can appear in the app status bar during a session
- Login/logout flow in the app

### Safety

- Active generations are stopped during app shutdown

## 🟡 Available with limitations

### Image support limits

- Image attachments depend on the selected model
- Sending is blocked on text-only models
- Limited to 4 images per message and 5MB per image
- Supported formats: PNG, JPEG, GIF, and WebP

### Templates, skills, and extensions

- Prompt templates and skills are visible in Settings, but there is no full install/edit management UI yet
- Extensions are visible in Settings, but management in the app is still limited
- Some extension experiences available in the terminal app are not yet exposed in Graphone, but session status updates are now shown in the app

### Model discovery

- Automatic model discovery works best with some providers
- Some providers may still require manual setup

### Session history and windows

- Session resume works through the sidebar and history flow
- Floating windows stay tied to a specific chat
- If that chat is no longer available, the window shows an unavailable message

## ❌ Not available yet

### Input and picker support

- `@` file reference picker in the input box

### Advanced command support

- Full queued message behavior
- Full support for advanced commands such as:
  - `/settings`, `/scoped-models`, `/fork`, `/resume`
  - `/export`, `/share`, `/copy`, `/name`, `/session`
  - `/compact`, `/reload`, `/hotkeys`, `/changelog`, `/quit`

### Keyboard and branching workflows

- Full terminal-style keyboard shortcut coverage
- Full keyboard-first tree navigation and branch management flow

### Terminal-app parity

- Full theme, settings, and package management coverage from the terminal app

## Summary

Graphone already covers the main day-to-day desktop workflow well: sessions, tabs, slash commands, tools, history, floating windows, and desktop releases across Linux, Windows, and macOS.
