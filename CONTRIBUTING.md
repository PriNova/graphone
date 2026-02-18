# Contributing Guide

Roadmap document:

- `docs/plans/repository-restructure-roadmap-2026-02.md`

---

## Repository path conventions

Use canonical frontend paths only:

- `apps/desktop/web/src`
- `apps/desktop/web/static`

Do not recreate or rely on root-level `src` / `static` compatibility links.

---

## Safe staging workflow

```bash
# safest overall
git add -A .

# explicit/surgical alternative for frontend-only changes
git add -A -- apps/desktop/web/src apps/desktop/web/static
```

### VS Code Source Control tip

When large refactors/moves are present, prefer **Stage All Changes**.

---

## Quick diagnostics

```bash
# inspect staged changes
git status --short

# verify canonical frontend folders
ls -la apps/desktop/web
```

---

## Additional references

- Main project overview: `README.md`
- Agent/developer operational notes: `AGENTS.md`
- Long-term restructure roadmap: `docs/plans/repository-restructure-roadmap-2026-02.md`
