#!/usr/bin/env node

import { existsSync, statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const baselinePath = resolve(repoRoot, "tooling/config/sidecar-size-baseline.json");

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

const argTarget = process.argv
  .find((arg) => arg.startsWith("--target="))
  ?.split("=", 2)[1]
  ?.trim();

const selectedTargets =
  argTarget && argTarget !== "all" ? [argTarget] : Object.keys(baseline.targets ?? {});

const warnDeltaMb = Number(process.env.GRAPHONE_SIDECAR_SIZE_WARN_DELTA_MB ?? baseline.warnDeltaMb ?? 10);
const failDeltaMb = Number(process.env.GRAPHONE_SIDECAR_SIZE_FAIL_DELTA_MB ?? baseline.failDeltaMb ?? 20);

const warnings = [];
const failures = [];

function mb(bytes) {
  return bytes / (1024 * 1024);
}

console.log("Sidecar binary size report");
console.log(`Baseline config: ${baselinePath}`);
console.log(`Warn delta: +${warnDeltaMb} MB | Fail delta: +${failDeltaMb} MB`);

for (const target of selectedTargets) {
  const config = baseline.targets?.[target];
  if (!config) {
    console.log(`- ${target}: no baseline config`);
    continue;
  }

  const absolutePath = resolve(repoRoot, config.path);
  if (!existsSync(absolutePath)) {
    console.log(`- ${target}: missing (${config.path})`);
    continue;
  }

  const sizeBytes = statSync(absolutePath).size;
  const sizeMb = mb(sizeBytes);

  const baselineBytes = Number(config.baselineBytes ?? 0);
  const baselineMb = mb(baselineBytes);
  const deltaMb = sizeMb - baselineMb;
  const deltaText = `${deltaMb >= 0 ? "+" : ""}${deltaMb.toFixed(1)} MB`;

  console.log(`- ${target}: ${sizeMb.toFixed(1)} MB (${config.path}) | baseline ${baselineMb.toFixed(1)} MB | delta ${deltaText}`);

  if (deltaMb > failDeltaMb) {
    failures.push(`${target} exceeded fail threshold (${deltaText})`);
  } else if (deltaMb > warnDeltaMb) {
    warnings.push(`${target} exceeded warn threshold (${deltaText})`);
  }
}

if (warnings.length > 0) {
  console.warn("\nSize warnings:");
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}

if (failures.length > 0) {
  console.error("\nSize failures:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
