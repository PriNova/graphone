import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function validateCwd(cwd: string): string {
  const normalized = resolve(cwd);

  if (!existsSync(normalized)) {
    throw new Error(`Directory does not exist: ${normalized}`);
  }

  const stats = statSync(normalized);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${normalized}`);
  }

  return normalized;
}

export function validateSessionFile(sessionFile: string): string {
  const normalized = resolve(sessionFile);

  if (!existsSync(normalized)) {
    throw new Error(`Session file does not exist: ${normalized}`);
  }

  const stats = statSync(normalized);
  if (!stats.isFile()) {
    throw new Error(`Session file path is not a file: ${normalized}`);
  }

  return normalized;
}
