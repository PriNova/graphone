import { spawn } from "node:child_process";

import {
  getShellConfig,
  type BashOperations,
} from "@mariozechner/pi-coding-agent";

// ── Types ───────────────────────────────────────────────────────────────────

export interface BashCommandResult {
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Creates session-scoped bash operations for executing shell commands.
 * Handles process spawning, signal-based abort (SIGTERM → SIGKILL escalation),
 * and platform-specific process group management.
 */
export function createSessionScopedBashOperations(cwd: string): BashOperations {
  return {
    exec: async (command, _cwd, options) => {
      const { shell, args } = getShellConfig();

      return await new Promise<{ exitCode: number | null }>(
        (resolve, reject) => {
          const child = spawn(shell, [...args, command], {
            cwd,
            env: {
              ...process.env,
              ...(options.env ?? {}),
            },
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32",
          });

          let settled = false;
          let abortTimer: ReturnType<typeof setTimeout> | null = null;

          const finalize = (callback: () => void): void => {
            if (settled) return;

            settled = true;

            if (abortTimer) {
              clearTimeout(abortTimer);
              abortTimer = null;
            }

            if (options.signal) {
              options.signal.removeEventListener("abort", abortHandler);
            }

            callback();
          };

          const abortHandler = (): void => {
            if (child.exitCode !== null || child.killed) return;

            if (process.platform === "win32") {
              child.kill();
              return;
            }

            const pid = child.pid;
            if (!pid) {
              child.kill();
              return;
            }

            try {
              process.kill(-pid, "SIGTERM");
            } catch {
              child.kill("SIGTERM");
            }

            abortTimer = setTimeout(() => {
              if (child.exitCode !== null || child.killed) return;

              try {
                process.kill(-pid, "SIGKILL");
              } catch {
                child.kill("SIGKILL");
              }
            }, 250);
          };

          if (options.signal) {
            if (options.signal.aborted) {
              abortHandler();
            } else {
              options.signal.addEventListener("abort", abortHandler, {
                once: true,
              });
            }
          }

          child.stdout?.on("data", (data: Buffer) => {
            options.onData(data);
          });

          child.stderr?.on("data", (data: Buffer) => {
            options.onData(data);
          });

          child.once("error", (error) => {
            finalize(() => reject(error));
          });

          child.once("close", (code) => {
            finalize(() => resolve({ exitCode: code }));
          });
        },
      );
    },
  };
}

/**
 * Wrap bash operations with a fixed working directory.
 * Useful when extension event results provide their own operations
 * but need to be scoped to the session's cwd.
 */
export function wrapBashOperationsWithCwd(
  operations: BashOperations,
  cwd: string,
): BashOperations {
  return {
    exec: (command, _cwd, options) => operations.exec(command, cwd, options),
  };
}
