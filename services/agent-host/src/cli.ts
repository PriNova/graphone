#!/usr/bin/env node

import { delimiter, dirname } from "node:path";

import { main as runPiCliMain } from "@mariozechner/pi-coding-agent";

import { handleHostCommand } from "./commands.js";
import { HostRuntime } from "./host-runtime.js";
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

function runHostMode(): void {
  const writer = new LineWriter();

  const runtime = new HostRuntime((event) => {
    writer.writeObject(event);
  });
  const startupPromise = runtime.initialize();

  let detachInput = () => {};
  let shuttingDown = false;
  let shouldShutdownAfterQueue = false;
  let commandQueue = startupPromise;

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

  async function processLine(line: string): Promise<void> {
    let command: HostCommand;

    try {
      const parsed: unknown = JSON.parse(line);

      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof (parsed as { type?: unknown }).type !== "string"
      ) {
        writer.writeObject(
          failure(
            undefined,
            "parse",
            "Command must be a JSON object with a string 'type' field",
          ),
        );
        return;
      }

      command = parsed as HostCommand;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writer.writeObject(
        failure(undefined, "parse", `Failed to parse command: ${message}`),
      );
      return;
    }

    const response = await handleHostCommand(runtime, command);
    writer.writeObject(response);

    if (command.type === "shutdown" && response.success) {
      shouldShutdownAfterQueue = true;
    }
  }

  detachInput = attachJsonlLineReader(process.stdin, (line) => {
    commandQueue = commandQueue
      .then(() => processLine(line))
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

function runPiCliMode(args: string[]): void {
  process.title = "pi";
  void runPiCliMain(args);
}

function main(): void {
  prependPathEntry(dirname(process.execPath));

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
    runHostMode();
    return;
  }

  runPiCliMode(passthroughArgs);
}

main();
