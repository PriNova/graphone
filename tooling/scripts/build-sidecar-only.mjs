#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = process.cwd();

const targetArg = process.argv
  .find((arg) => arg.startsWith("--target="))
  ?.split("=", 2)[1]
  ?.trim();

const externalKoffi = !process.argv.includes("--no-external-koffi");

const targets =
  !targetArg || targetArg === "all"
    ? ["linux", "windows"]
    : [targetArg];

const targetConfig = {
  linux: {
    bunTarget: "bun-linux-x64-baseline",
    koffiTriplet: "linux_x64",
    outfile: "src-tauri/binaries/pi-agent-x86_64-unknown-linux-gnu",
  },
  windows: {
    bunTarget: "bun-windows-x64-baseline",
    koffiTriplet: "win32_x64",
    outfile: "src-tauri/binaries/pi-agent-x86_64-pc-windows-msvc.exe",
  },
};

for (const target of targets) {
  const config = targetConfig[target];
  if (!config) {
    console.error(`Unknown target: ${target}. Expected linux, windows, or all.`);
    process.exit(1);
  }

  const absoluteOutfile = resolve(repoRoot, config.outfile);
  mkdirSync(dirname(absoluteOutfile), { recursive: true });

  console.log(
    `Building sidecar only (${target}${externalKoffi ? ", external koffi" : ""}) -> ${config.outfile}`,
  );

  const args = [
    "build",
    "--compile",
    "--production",
    "--minify",
    "--define",
    "DEBUG=false",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    `--target=${config.bunTarget}`,
  ];

  if (externalKoffi) {
    args.push("--external", "koffi");
  }

  args.push("services/agent-host/src/cli.ts", "--outfile", config.outfile);

  const result = spawnSync("bun", args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (externalKoffi) {
    const binariesDir = resolve(repoRoot, "src-tauri/binaries");
    const destinationRoot = resolve(binariesDir, "node_modules/koffi");
    const sourceRoot = resolve(repoRoot, "node_modules/koffi");

    if (!existsSync(sourceRoot)) {
      console.error(`Missing source koffi package at ${sourceRoot}`);
      process.exit(1);
    }

    const tripletDir = resolve(destinationRoot, "build/koffi", config.koffiTriplet);
    rmSync(tripletDir, { recursive: true, force: true });
    mkdirSync(tripletDir, { recursive: true });

    copyFileSync(resolve(sourceRoot, "package.json"), resolve(destinationRoot, "package.json"));
    copyFileSync(resolve(sourceRoot, "index.js"), resolve(destinationRoot, "index.js"));
    copyFileSync(
      resolve(sourceRoot, "build/koffi", config.koffiTriplet, "koffi.node"),
      resolve(tripletDir, "koffi.node"),
    );

    console.log(`Staged minimal koffi runtime at src-tauri/binaries/node_modules/koffi (${config.koffiTriplet})`);
  }
}
