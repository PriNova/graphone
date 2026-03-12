# Changelog

## [Unreleased]

## [0.4.1] - 2026-03-12

### Added

- Added reopening of your open chat tabs on relaunch when they are still available.

### Changed

- Refined session tab visuals so active and inactive states feel more consistent across the app.
- Improved automatic scrolling after you send a prompt so the latest conversation stays in view more reliably.

### Fixed

- Fixed inconsistent auto-scrolling when switching between sessions.

## [0.4.0] - 2026-03-12

### Added

- Added VS Code-style open session tabs so you can switch between active chats more quickly.
- Added a dedicated session tab presentation layer to keep tab labels and ordering consistent across the app.

### Changed

- Updated the main chat layout and home route to surface session tabs as part of the primary workspace.
- Improved tab overflow scrolling so larger session sets remain easier to navigate.

### Fixed

- Fixed tab tooltip rendering and related header polish issues in the session tabs UI.

## [0.3.1] - 2026-03-11

### Added

- Added macOS release downloads for Apple Silicon and Intel.
- Added expand/collapse controls for `!command` and `!!command` output panels.

### Changed

- Improved startup behavior so Graphone returns to your last valid project or chat more predictably.
- Improved how model availability settings fall back from project preferences to home defaults.

### Fixed

- Fixed Stop so it can cancel long-running `!command` and `!!command` runs more reliably.
- Fixed cases where startup could fall back to an unintended project when a previous scope was no longer available.

## [0.3.0] - 2026-03-10

### Added

- Added a dedicated macOS local-build pipeline with GitHub Actions artifacts for both Apple Silicon (`arm64`) and Intel (`x64`) test builds.
- Added local macOS Tauri bundle overrides and entitlements for ad-hoc signed `.app` builds.

### Changed

- Updated the macOS sidecar/runtime packaging flow so Graphone bundles required host runtime assets under app resources and resolves them reliably at startup.
- Updated CI macOS artifact checks to validate required sidecar runtime assets before publishing artifacts.

### Fixed

- Fixed macOS bundle signing failures caused by placing non-code runtime data in code-sign-sensitive locations.
- Fixed macOS sidecar runtime pathing and environment bootstrapping so packaged builds correctly locate `package.json`, docs/examples, theme/export assets, and externalized native module dependencies.

### Credits

- 🚀 Huge shout-out to **David Ichim** for hands-on macOS validation and rapid iteration feedback during this release: https://github.com/ichim-david

## [0.2.5] - 2026-03-09

### Added

- Added `!command` / `!!command` prompt behavior with live bash execution rendering in chat and persisted bash execution history.

### Changed

- Improved streaming thinking blocks so active reasoning clearly shows a running state while it is still in progress.

### Fixed

- Fixed Windows bang-command shell behavior by aligning `!` / `!!` execution with pi's bash shell resolution.

## [0.2.4] - 2026-03-08

### Added

- Added a persistent light/dark appearance setting, including settings UI, startup theme bootstrap, cross-window sync, and native window theme mirroring.
- Added unseen session review indicators in the sidebar for sessions that complete outside the current view, with persisted state when Graphone observed the completion.

## [0.2.3] - 2026-03-08

### Added

- Added stable UUIDv4 internal session IDs for more reliable session and window identity handling.

### Changed

- Updated the bundled `@mariozechner/pi-coding-agent` runtime to `0.57.1` and aligned the host transport with strict LF-only JSONL framing.

### Fixed

- Fixed oversized agent IPC payload handling by chunking large messages instead of sending oversized frames.
- Fixed HTML tool result rendering for SVG-heavy visualizations.

## [0.2.2] - 2026-03-06

### Added

- Added full expansion for truncated tool results so long outputs can be inspected without losing detail.

### Changed

- Moved provider model catalog sync to startup so model metadata is refreshed earlier in app startup.
- Removed translucent desktop surfaces for a more consistent desktop presentation.
- Updated the bundled `@mariozechner/pi-coding-agent` runtime to `0.56.2`.

### Fixed

- Fixed chat column alignment and scroll gutter issues in the main chat layout.

## [0.2.1] - 2026-03-05

### Added

- Added runtime provider model catalog sync into `models.json`.
- Added OpenAI Codex to runtime model discovery.
- Added root Tauri build helper scripts for easier desktop build flows.

### Changed

- Refreshed the model registry before model operations and improved model refresh diagnostics.

## [0.2.0] - 2026-03-05

### Changed

- Switched Graphone to the Graphone-local host sidecar multiplexer architecture, consolidating desktop runtime ownership around the host sidecar.
- Hid title headers in floating session windows for a cleaner dedicated chat surface.

### Fixed

- Improved tool output streaming and chat scroll behavior in active sessions.

## [0.1.10] - 2026-03-04

### Added

- Added floating session windows backed by the canonical chat surface.
- Added a settings overlay and extension inventory across the desktop app and host runtime.

### Changed

- Replaced compact capsule views with the floating session window workflow.
- Updated the bundled `@mariozechner/pi-coding-agent` runtime to `0.55.4`.

## [0.1.9] - 2026-03-03

### Added

- Added HTML tool result rendering in chat.
- Added visible auto-compaction summaries in the Graphone chat surface.

### Changed

- Split runtime and session flows more cleanly across the desktop app, host, and Tauri shell.

## [0.1.8] - 2026-02-28

### Added

- Added multi-window session workflow for the desktop app.

## [0.1.7] - 2026-02-27

### Added

- Added multi-session workflow support.

## [0.1.6] - 2026-02-26

### Changed

- Stabilized compact-mode layout behavior and Linux host interop wording.

### Fixed

- Fixed compact activity previews to include the preceding assistant turn.

## [0.1.5] - 2026-02-23

### Added

- Added login and logout flow support.

## [0.1.4] - 2026-02-23

### Changed

- Stabilized compact rail motion in compact mode.

### Fixed

- Fixed compact activity rail tool chip borders.

## [0.1.3] - 2026-02-23

## [0.1.2] - 2026-02-23

## [0.1.1] - 2026-02-23

### Added

- Added the initial Tauri + Svelte desktop application scaffold and Graphone sidecar integration.
- Added Linux and Windows desktop build flows, including portable Windows runtime staging and cross-compilation support.
- Added slash commands, model/provider display, model scoping, thinking-level controls, current working directory display, and persistent UI state.
- Added multi-session host architecture with session lifecycle RPC, session sidebar/history/restore flows, inline tool results, markdown rendering, and new chat controls.
- Added image attachments, compact mode workflow, status bar token usage, thinking block collapsing, and safe markdown/code highlighting.

### Changed

- Moved the desktop runtime to a host-driven multi-session architecture with strict NDJSON communication between frontend, Tauri shell, and sidecar.

### Fixed

- Improved streaming reliability, scroll pinning, prompt UI behavior, idempotent session start handling, sidecar backpressure handling, release logging behavior, and Linux sidecar packaging/startup.
