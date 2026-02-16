#!/usr/bin/env node

import * as readline from "node:readline";

import { handleHostCommand } from "./commands.js";
import { HostRuntime } from "./host-runtime.js";
import { failure, type HostCommand, type HostResponse, type SessionEventEnvelope } from "./protocol.js";

class LineWriter {
  private readonly queue: string[] = [];
  private writing = false;

  writeObject(value: HostResponse | SessionEventEnvelope): void {
    this.queue.push(`${JSON.stringify(value)}\n`);
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
      if (!ok) {
        process.stdout.once("drain", () => {
          this.writing = false;
          this.flush();
        });
        return;
      }
      this.queue.shift();
    }

    this.writing = false;
  }
}

const writer = new LineWriter();

const runtime = new HostRuntime((event) => {
  writer.writeObject(event);
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let shuttingDown = false;
let shouldShutdownAfterQueue = false;
let commandQueue = Promise.resolve();

async function requestShutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
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

    if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") {
      writer.writeObject(failure(undefined, "parse", "Command must be a JSON object with a string 'type' field"));
      return;
    }

    command = parsed as HostCommand;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writer.writeObject(failure(undefined, "parse", `Failed to parse command: ${message}`));
    return;
  }

  const response = await handleHostCommand(runtime, command);
  writer.writeObject(response);

  if (command.type === "shutdown" && response.success) {
    shouldShutdownAfterQueue = true;
  }
}

rl.on("line", (line) => {
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

rl.on("close", () => {
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
