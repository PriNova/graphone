#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

class HostClient {
  constructor() {
    this.child = spawn("node", ["sidecars/pi-agent-host/dist/cli.js"], {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.pending = new Map();
    this.eventLog = [];
    this.closed = false;

    const rlOut = createInterface({ input: this.child.stdout });
    rlOut.on("line", (line) => {
      let payload;
      try {
        payload = JSON.parse(line);
      } catch {
        return;
      }

      if (payload.type === "response" && payload.id && this.pending.has(payload.id)) {
        const pending = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        pending.resolve(payload);
        return;
      }

      if (payload.type === "session_event" && payload.sessionId) {
        this.eventLog.push(payload);
      }
    });

    this.child.on("exit", () => {
      this.closed = true;
      for (const [, pending] of this.pending) {
        pending.reject(new Error("host process exited"));
      }
      this.pending.clear();
    });
  }

  async send(command, timeoutMs = 30000) {
    const id = command.id;
    if (!id) throw new Error("command.id is required");

    this.child.stdin.write(`${JSON.stringify(command)}\n`);

    return await new Promise((resolveResponse, rejectResponse) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectResponse(new Error(`timeout waiting for response id=${id}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolveResponse(response);
        },
        reject: (error) => {
          clearTimeout(timeout);
          rejectResponse(error);
        },
      });
    });
  }

  waitForSessionEvent(sessionId, eventType, timeoutMs = 120000) {
    return new Promise((resolveEvent, rejectEvent) => {
      const startedLen = this.eventLog.length;
      const started = Date.now();

      const poll = async () => {
        while (!this.closed && Date.now() - started < timeoutMs) {
          for (let i = startedLen; i < this.eventLog.length; i += 1) {
            const event = this.eventLog[i];
            if (event.sessionId === sessionId && event.event?.type === eventType) {
              resolveEvent(event);
              return;
            }
          }
          await delay(25);
        }

        rejectEvent(new Error(`timeout waiting for ${sessionId}:${eventType}`));
      };

      void poll();
    });
  }

  async shutdown() {
    if (this.closed) return;
    try {
      await this.send({ id: "shutdown", type: "shutdown" }, 10000);
    } catch {
      // ignore
    }

    this.child.kill("SIGTERM");
    await delay(200);
    if (!this.closed) {
      this.child.kill("SIGKILL");
    }
  }
}

async function main() {
  // Build host sidecar first.
  await new Promise((resolveDone, rejectDone) => {
    const builder = spawn(
      "bun",
      ["build", "./src/cli.ts", "--target", "node", "--format", "esm", "--outfile", "./dist/cli.js"],
      { cwd: resolve(projectRoot, "sidecars/pi-agent-host"), stdio: "inherit" },
    );
    builder.on("exit", (code) => {
      if (code === 0) resolveDone();
      else rejectDone(new Error(`bun build failed: ${code}`));
    });
  });

  const host = new HostClient();

  try {
    const c1 = await host.send({
      id: "create-1",
      type: "create_session",
      sessionId: "sess-A",
      cwd: projectRoot,
    });
    const c2 = await host.send({
      id: "create-2",
      type: "create_session",
      sessionId: "sess-B",
      cwd: resolve(projectRoot, "src"),
    });

    if (!c1.success || !c2.success) {
      throw new Error("Failed to create sessions");
    }

    const listBefore = await host.send({ id: "list-before", type: "list_sessions" });
    if (!listBefore.success) {
      throw new Error(`list_sessions failed: ${listBefore.error}`);
    }

    const waitA = host.waitForSessionEvent("sess-A", "agent_end", 120000);
    const waitB = host.waitForSessionEvent("sess-B", "agent_end", 120000);

    const p1 = await host.send({
      id: "prompt-1",
      type: "prompt",
      sessionId: "sess-A",
      message: "Reply with exactly A",
    });
    const p2 = await host.send({
      id: "prompt-2",
      type: "prompt",
      sessionId: "sess-B",
      message: "Reply with exactly B",
    });

    if (!p1.success || !p2.success) {
      throw new Error("Prompt command failed");
    }

    await Promise.all([waitA, waitB]);

    const close = await host.send({ id: "close-b", type: "close_session", sessionId: "sess-B" });
    if (!close.success) {
      throw new Error(`close_session failed: ${close.error}`);
    }

    const listAfter = await host.send({ id: "list-after", type: "list_sessions" });
    if (!listAfter.success) {
      throw new Error(`list_sessions after close failed: ${listAfter.error}`);
    }

    const eventsBefore = host.eventLog.length;

    const waitA2 = host.waitForSessionEvent("sess-A", "agent_end", 120000);
    const p3 = await host.send({
      id: "prompt-3",
      type: "prompt",
      sessionId: "sess-A",
      message: "Reply with exactly OK",
    });
    if (!p3.success) {
      throw new Error(`prompt on sess-A failed: ${p3.error}`);
    }

    await waitA2;
    await delay(300);

    const newEvents = host.eventLog.slice(eventsBefore);
    const leakedClosedEvents = newEvents.filter((e) => e.sessionId === "sess-B");

    if (leakedClosedEvents.length > 0) {
      throw new Error("Received events for closed session sess-B");
    }

    const sessionsBefore = listBefore.data?.sessions ?? [];
    const sessionsAfter = listAfter.data?.sessions ?? [];

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          ok: true,
          createdSessionCount: sessionsBefore.length,
          remainingSessionCount: sessionsAfter.length,
          totalSessionEvents: host.eventLog.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await host.shutdown();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
