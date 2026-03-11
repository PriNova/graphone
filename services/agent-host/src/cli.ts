#!/usr/bin/env node

import { basename, delimiter, dirname, join } from "node:path";

import { handleHostCommand } from "./commands.js";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.js";
import {
  failure,
  type HostCommand,
  type HostResponse,
  type SessionEventEnvelope,
} from "./protocol.js";

const GRAPHONE_HOST_FLAG = "--graphone-host";

function normalizePathForCompare(pathEntry: string): string {
  if (process.platform === "win32") {
    return pathEntry.toLowerCase();
  }

  return pathEntry;
}

function prependPathEntry(pathEntry: string): void {
  const normalizedEntry = pathEntry.trim();
  if (!normalizedEntry) {
    return;
  }

  const existingPath = process.env.PATH ?? process.env.Path ?? "";
  const entries = existingPath
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const target = normalizePathForCompare(normalizedEntry);
  const hasEntry = entries.some(
    (entry) => normalizePathForCompare(entry) === target,
  );

  if (hasEntry) {
    return;
  }

  const nextPath = [normalizedEntry, ...entries].join(delimiter);
  process.env.PATH = nextPath;

  if (process.platform === "win32") {
    process.env.Path = nextPath;
  }
}

class LineWriter {
  private readonly queue: string[] = [];
  private writing = false;

  writeObject(value: HostResponse | SessionEventEnvelope): void {
    this.queue.push(serializeJsonLine(value));
    this.flush();
  }

  private flush(): void {
    if (this.writing) {
      return;
    }

    this.writing = true;

    while (this.queue.length > 0) {
      const next = this.queue[0]!;
      const ok = process.stdout.write(next);
      // write() returning false means backpressure (buffer is full),
      // not that the chunk was rejected. Remove the chunk immediately
      // to avoid re-writing it on every "drain" and duplicating events.
      this.queue.shift();

      if (!ok) {
        process.stdout.once("drain", () => {
          this.writing = false;
          this.flush();
        });
        return;
      }
    }

    this.writing = false;
  }
}

function applyBunPackageDirExecPathOverride(): void {
  const packageDir = process.env.PI_PACKAGE_DIR?.trim();
  if (!packageDir || !process.versions.bun) {
    return;
  }

  const execName = basename(process.execPath || "pi");
  const overrideExecPath = join(packageDir, execName);

  try {
    process.execPath = overrideExecPath;
    return;
  } catch {
    // Fall through to defineProperty fallback.
  }

  try {
    Object.defineProperty(process, "execPath", {
      value: overrideExecPath,
      configurable: true,
      enumerable: true,
      writable: true,
    });
  } catch {
    // Best-effort only.
  }
}

async function runHostMode(): Promise<void> {
  const { HostRuntime } = await import("./host-runtime.js");

  const writer = new LineWriter();

  const runtime = new HostRuntime((event) => {
    writer.writeObject(event);
  });
  const startupPromise = runtime.initialize();

  let detachInput = () => {};
  let shuttingDown = false;
  let shouldShutdownAfterQueue = false;
  let commandQueue = startupPromise;

  function parseCommandLine(
    line: string,
  ):
    | { command: HostCommand; failureResponse?: never }
    | { command?: never; failureResponse: HostResponse } {
    try {
      const parsed: unknown = JSON.parse(line);

      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof (parsed as { type?: unknown }).type !== "string"
      ) {
        return {
          failureResponse: failure(
            undefined,
            "parse",
            "Command must be a JSON object with a string 'type' field",
          ),
        };
      }

      return { command: parsed as HostCommand };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        failureResponse: failure(
          undefined,
          "parse",
          `Failed to parse command: ${message}`,
        ),
      };
    }
  }

  function isOutOfBandCommand(command: HostCommand): boolean {
    // Keep normal commands serialized so session mutations stay ordered,
    // but let bash cancellation bypass the queue. Otherwise an abort request
    // sits behind the long-running bash command it is supposed to stop.
    return command.type === "abort_bash";
  }

  async function requestShutdown(): Promise<void> {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    detachInput();
    process.stdin.pause();
    try {
      await runtime.shutdown();
    } finally {
      process.exit(0);
    }
  }

  async function processCommand(command: HostCommand): Promise<void> {
    const response = await handleHostCommand(runtime, command);
    writer.writeObject(response);

    if (command.type === "shutdown" && response.success) {
      shouldShutdownAfterQueue = true;
    }
  }

  detachInput = attachJsonlLineReader(process.stdin, (line) => {
    const parsed = parseCommandLine(line);
    if (!parsed.command) {
      writer.writeObject(parsed.failureResponse);
      return;
    }

    const { command } = parsed;

    if (isOutOfBandCommand(command)) {
      void startupPromise
        .then(async () => {
          await processCommand(command);
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          writer.writeObject(failure(undefined, "internal", message));
        });
      return;
    }

    commandQueue = commandQueue
      .then(async () => {
        await processCommand(command);
      })
      .then(async () => {
        if (shouldShutdownAfterQueue) {
          await requestShutdown();
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        writer.writeObject(failure(undefined, "internal", message));
      });
  });

  process.stdin.on("end", () => {
    commandQueue.finally(() => {
      void requestShutdown();
    });
  });

  process.on("SIGINT", () => {
    void requestShutdown();
  });

  process.on("SIGTERM", () => {
    void requestShutdown();
  });
}

async function runPiCliMode(args: string[]): Promise<void> {
  process.title = "pi";
  const { main: runPiCliMain } = await import("@mariozechner/pi-coding-agent");
  await runPiCliMain(args);
}

async function main(): Promise<void> {
  const realExecDir = dirname(process.execPath);
  prependPathEntry(realExecDir);
  applyBunPackageDirExecPathOverride();

  const argv = process.argv.slice(2);
  const hostMode = argv.includes(GRAPHONE_HOST_FLAG);
  const passthroughArgs = hostMode
    ? argv.filter((arg) => arg !== GRAPHONE_HOST_FLAG)
    : argv;

  if (hostMode) {
    process.argv = [
      process.argv[0] ?? "node",
      process.argv[1] ?? "cli.js",
      ...passthroughArgs,
    ];
    await runHostMode();
    return;
  }

  await runPiCliMode(passthroughArgs);
}

void main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[pi-host-sidecar] fatal: ${message}`);
  process.exit(1);
});
