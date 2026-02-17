# Contributing Guide

This document covers two things:

1. A practical **Git + symlink staging cheat sheet** for this repository.
2. A **long-term refactor plan** to remove current symlink complexity and align with best practices.

---

## Git + symlink staging cheat sheet (important)

### Current repo reality

At repo root we intentionally have compatibility symlinks:

- `src -> apps/desktop/web/src`
- `static -> apps/desktop/web/static`

Because these are symlinks, Git treats them as link entries, not normal folders.

### Golden rule

- ✅ Stage real files via `apps/desktop/web/...`
- ✅ Stage symlink entries via `src` / `static`
- ❌ Do **not** stage child paths under symlinks in explicit pathspecs (`src/...`, `static/...`)

If you do, Git will fail with:

`fatal: pathspec '...' is beyond a symbolic link`

### Safe staging commands

```bash
# safest overall
git add -A .

# explicit/surgical alternative
git add -A -- apps/desktop/web/src apps/desktop/web/static
git add -- src static
```

### VS Code Source Control tips

If you only use the `+` buttons:

- Prefer **Stage All Changes** when large move/refactor changes are present.
- If one-file staging fails, run one terminal staging command (above), then continue in VS Code.

### Quick diagnostics

```bash
# verify symlinks
ls -ld src static

# inspect staged shape
git status --short
```

---

## Long-term maintenance refactor plan (best-practice direction)

## Why this plan exists

As of 2026:
- SvelteKit documents `kit.files.*` as deprecated.
- SvelteKit convention remains canonical `src/` + `static/` under the app root.
- Vite allows custom fs paths, but this introduces additional maintenance/security complexity.

Current symlink approach works, but it creates recurring friction:
- Git staging confusion (`beyond a symbolic link`)
- Vite dev-server allow-list edge cases
- higher onboarding cost for contributors

## Target end-state

Use **one canonical physical source path** for frontend files (no root compatibility symlinks), with clear workspace boundaries.

Recommended architecture:

- `apps/desktop/web` is a true frontend app root
- `src-tauri` remains physical Tauri shell root (short/mid term)
- root-level scripts orchestrate per-app scripts via npm workspaces or `--prefix`

---

## Execution roadmap

## Phase 0 — Stabilize current state (done/short term)

- Keep symlinks temporarily.
- Keep Vite `server.fs.allow` entries required for symlink targets.
- Keep this cheat sheet in repo.

Exit criteria:
- No active dev-blocking errors in `npm run tauri dev`.

## Phase 1 — Make frontend a real standalone workspace

1. Create `apps/desktop/web/package.json` (workspace package), with local scripts:
   - `dev`, `build`, `check`, `preview`
2. Move/duplicate frontend config ownership into `apps/desktop/web`:
   - `svelte.config.js`
   - `vite.config.js`
   - `tsconfig.json` (or extends root base)
3. Update root `package.json` to use npm workspaces and call web scripts through workspace names.

Exit criteria:
- `npm run dev` and `npm run build` work through workspace orchestration.
- No path rewrites depend on symlink aliases.

## Phase 2 — Tauri command integration cleanup

1. Update `src-tauri/tauri.conf.json` build commands to call workspace scripts directly.
2. Ensure `beforeDevCommand` and `beforeBuildCommand` still produce `frontendDist` correctly.
3. Validate Windows cross-build scripts still function.

Exit criteria:
- `npm run dev:linux`, `npm run build:linux`, `npm run build:windows` pass.

## Phase 3 — Remove compatibility symlinks

1. Delete root symlinks:
   - `src`
   - `static`
2. Remove temporary Vite fs allow workaround entries no longer needed.
3. Update docs/instructions/AGENTS references.

Exit criteria:
- No references to root `src` or `static` remain.
- Staging works without symlink caveats.

## Phase 4 — Guardrails and CI hardening

1. Add a CI check script to prevent accidental re-introduction of root symlinks.
2. Add a docs lint/check for stale paths (`src/...` vs `apps/desktop/web/src/...`).
3. Keep a short “repo map” section in README/AGENTS.

Exit criteria:
- CI catches path regressions early.

---

## Validation checklist for each phase

Run after each phase:

```bash
npm run check
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run dev:linux
```

For Windows cross-compile flows:

```bash
npm run build:windows:exe
npm run build:windows:portable
```

---

## Risk notes

- The highest risk is changing assumptions in `src-tauri/build.rs` and shell scripts that currently expect repo-root-relative paths.
- Keep `src-tauri` physical path stable unless done in a separate dedicated migration.
