#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const violations = [];

for (const legacyPath of ["src", "static"]) {
  const absolutePath = resolve(repoRoot, legacyPath);
  if (!existsSync(absolutePath)) {
    continue;
  }

  const stats = lstatSync(absolutePath);
  if (stats.isSymbolicLink()) {
    violations.push(`Root symlink is not allowed: ${legacyPath}`);
  } else {
    violations.push(`Legacy root path exists and should not be reintroduced: ${legacyPath}`);
  }
}

const stalePatterns = [
  {
    label: "legacy src symlink mapping",
    pattern: "src -> apps/desktop/web/src",
  },
  {
    label: "legacy static symlink mapping",
    pattern: "static -> apps/desktop/web/static",
  },
  {
    label: "legacy root compatibility links heading",
    pattern: "Compatibility links at repository root",
  },
  {
    label: "legacy symlink staging guidance heading",
    pattern: "Git + symlink staging cheat sheet",
  },
];

const excludedPaths = [":!docs/plans/**", ":!docs/plan/**", ":!tooling/scripts/check-repository-guardrails.mjs"];

for (const { label, pattern } of stalePatterns) {
  try {
    const output = execFileSync(
      "git",
      ["grep", "-n", "--fixed-strings", "--", pattern, ".", ...excludedPaths],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();

    if (output.length > 0) {
      violations.push(`Found ${label}:\n${output}`);
    }
  } catch (error) {
    // git grep exits with code 1 when there are no matches.
    if (error.status !== 1) {
      throw error;
    }
  }
}

if (violations.length > 0) {
  console.error("Repository guardrail check failed:\n");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Repository guardrail check passed.");
