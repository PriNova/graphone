#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

const SESSION_COUNTS = [1, 2, 4];
const PROMPT_TEXT = "Reply with exactly: OK";

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function readRssKb(pid) {
  try {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const line = status
      .split("\n")
      .find((entry) => entry.startsWith("VmRSS:"));
    if (!line) return 0;
    const parts = line.trim().split(/\s+/);
    const value = Number(parts[1]);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

class JsonLineClient extends EventEmitter {
  constructor(command, args, options = {}) {
    super();

    this.child = spawn(command, args, {
      cwd: options.cwd ?? projectRoot,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.pending = new Map();
    this.closed = false;

    const rlOut = createInterface({ input: this.child.stdout });
    rlOut.on("line", (line) => {
      let payload;
      try {
        payload = JSON.parse(line);
      } catch {
        this.emit("raw", line);
        return;
      }

      this.emit("json", payload);

      if (payload && payload.type === "response") {
        const id = payload.id;
        if (id && this.pending.has(id)) {
          const pending = this.pending.get(id);
          this.pending.delete(id);
          pending.resolve(payload);
        }
      }
    });

    const rlErr = createInterface({ input: this.child.stderr });
    rlErr.on("line", (line) => this.emit("stderr", line));

    this.child.on("exit", (code, signal) => {
      this.closed = true;
      for (const [, pending] of this.pending) {
        pending.reject(new Error(`process exited before response (code=${code}, signal=${signal})`));
      }
      this.pending.clear();
      this.emit("exit", { code, signal });
    });
  }

  async send(command, timeoutMs = 20000) {
    if (this.closed) {
      throw new Error("process is closed");
    }

    const id = command.id;
    if (!id) {
      throw new Error("command.id is required");
    }

    const payload = `${JSON.stringify(command)}\n`;
    this.child.stdin.write(payload);

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

  async waitForSessionEvent(sessionId, eventType, timeoutMs = 60000) {
    return await new Promise((resolveEvent, rejectEvent) => {
      const timeout = setTimeout(() => {
        this.off("json", onJson);
        rejectEvent(new Error(`timeout waiting for session_event ${sessionId}:${eventType}`));
      }, timeoutMs);

      const onJson = (payload) => {
        if (payload?.type !== "session_event") return;
        if (payload?.sessionId !== sessionId) return;
        if (payload?.event?.type !== eventType) return;

        clearTimeout(timeout);
        this.off("json", onJson);
        resolveEvent(payload);
      };

      this.on("json", onJson);
    });
  }

  async waitForEvent(eventType, timeoutMs = 60000) {
    return await new Promise((resolveEvent, rejectEvent) => {
      const timeout = setTimeout(() => {
        this.off("json", onJson);
        rejectEvent(new Error(`timeout waiting for event ${eventType}`));
      }, timeoutMs);

      const onJson = (payload) => {
        if (payload?.type !== eventType) return;

        clearTimeout(timeout);
        this.off("json", onJson);
        resolveEvent(payload);
      };

      this.on("json", onJson);
    });
  }

  async terminate() {
    if (this.closed) return;
    this.child.kill("SIGTERM");
    const started = Date.now();
    while (!this.closed && Date.now() - started < 3000) {
      await delay(50);
    }
    if (!this.closed) {
      this.child.kill("SIGKILL");
    }
  }
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function runHostScenario(sessionCount) {
  const client = new JsonLineClient("node", ["services/agent-host/dist/cli.js"], { cwd: projectRoot });

  const createLatenciesMs = [];
  const sessionIds = [];

  const startCreate = performance.now();
  for (let i = 0; i < sessionCount; i += 1) {
    const sessionId = `host-s${i + 1}`;
    sessionIds.push(sessionId);

    const t0 = performance.now();
    const response = await client.send({
      id: `create-${i + 1}`,
      type: "create_session",
      sessionId,
      cwd: projectRoot,
    });
    const t1 = performance.now();
    createLatenciesMs.push(t1 - t0);

    if (!response.success) {
      throw new Error(`host create_session failed: ${response.error}`);
    }
  }
  const totalCreateMs = performance.now() - startCreate;

  const getStateLatenciesMs = [];
  for (let i = 0; i < sessionIds.length; i += 1) {
    const t0 = performance.now();
    const response = await client.send({
      id: `state-${i + 1}`,
      type: "get_state",
      sessionId: sessionIds[i],
    });
    const t1 = performance.now();
    getStateLatenciesMs.push(t1 - t0);

    if (!response.success) {
      throw new Error(`host get_state failed: ${response.error}`);
    }
  }

  const rssKb = await readRssKb(client.child.pid);

  // Concurrent prompt wall-clock measurement.
  const waiters = sessionIds.map((sessionId) => client.waitForSessionEvent(sessionId, "agent_end", 120000));
  const promptStart = performance.now();
  await Promise.all(
    sessionIds.map((sessionId, i) =>
      client.send({
        id: `prompt-${i + 1}`,
        type: "prompt",
        sessionId,
        message: PROMPT_TEXT,
      }),
    ),
  );
  await Promise.all(waiters);
  const promptWallMs = performance.now() - promptStart;

  await client.send({ id: "shutdown", type: "shutdown" });
  await client.terminate();

  return {
    architecture: "host",
    sessionCount,
    processCount: 1,
    rssKbTotal: rssKb,
    createLatencyMsAvg: mean(createLatenciesMs),
    createLatencyMsTotal: totalCreateMs,
    getStateLatencyMsAvg: mean(getStateLatenciesMs),
    promptWallMs,
  };
}

async function runLegacyScenario(sessionCount) {
  const clients = [];

  try {
    const bootLatencies = [];
    const startAll = performance.now();

    for (let i = 0; i < sessionCount; i += 1) {
      const client = new JsonLineClient(
        "node",
        [
          "node_modules/@mariozechner/pi-coding-agent/dist/cli.js",
          "--mode",
          "rpc",
          "--no-session",
          "--no-skills",
          "--models",
          "*",
        ],
        { cwd: projectRoot },
      );

      clients.push(client);

      const t0 = performance.now();
      const response = await client.send({ id: `boot-${i + 1}`, type: "get_state" });
      const t1 = performance.now();
      bootLatencies.push(t1 - t0);

      if (!response.success) {
        throw new Error(`legacy get_state failed: ${response.error}`);
      }
    }

    const totalBootMs = performance.now() - startAll;

    const rssValues = await Promise.all(clients.map((client) => readRssKb(client.child.pid)));
    const rssKbTotal = rssValues.reduce((a, b) => a + b, 0);

    const getStateLatenciesMs = [];
    for (let i = 0; i < clients.length; i += 1) {
      const t0 = performance.now();
      const response = await clients[i].send({ id: `state-${i + 1}`, type: "get_state" });
      const t1 = performance.now();
      getStateLatenciesMs.push(t1 - t0);
      if (!response.success) {
        throw new Error(`legacy get_state failed: ${response.error}`);
      }
    }

    const promptWaiters = clients.map((client) => client.waitForEvent("agent_end", 120000));
    const promptStart = performance.now();
    await Promise.all(
      clients.map((client, i) =>
        client.send({
          id: `prompt-${i + 1}`,
          type: "prompt",
          message: PROMPT_TEXT,
        }),
      ),
    );
    await Promise.all(promptWaiters);
    const promptWallMs = performance.now() - promptStart;

    return {
      architecture: "legacy",
      sessionCount,
      processCount: sessionCount,
      rssKbTotal,
      createLatencyMsAvg: mean(bootLatencies),
      createLatencyMsTotal: totalBootMs,
      getStateLatencyMsAvg: mean(getStateLatenciesMs),
      promptWallMs,
    };
  } finally {
    await Promise.all(clients.map((client) => client.terminate()));
  }
}

async function ensureHostBuilt() {
  const builder = new JsonLineClient("bun", ["build", "./src/cli.ts", "--target", "node", "--format", "esm", "--outfile", "./dist/cli.js"], {
    cwd: resolve(projectRoot, "services/agent-host"),
  });
  await new Promise((resolveDone, rejectDone) => {
    builder.child.on("exit", (code) => {
      if (code === 0) resolveDone();
      else rejectDone(new Error(`bun build failed with code ${code}`));
    });
  });
}

async function main() {
  await ensureHostBuilt();

  const results = [];

  for (const sessionCount of SESSION_COUNTS) {
    // eslint-disable-next-line no-console
    console.log(`Running host scenario (sessions=${sessionCount})...`);
    const hostResult = await runHostScenario(sessionCount);
    results.push(hostResult);

    // eslint-disable-next-line no-console
    console.log(`Running legacy scenario (sessions=${sessionCount})...`);
    const legacyResult = await runLegacyScenario(sessionCount);
    results.push(legacyResult);
  }

  const comparisons = SESSION_COUNTS.map((sessionCount) => {
    const host = results.find((r) => r.architecture === "host" && r.sessionCount === sessionCount);
    const legacy = results.find((r) => r.architecture === "legacy" && r.sessionCount === sessionCount);

    return {
      sessionCount,
      rssReductionPercent:
        legacy && host && legacy.rssKbTotal > 0
          ? ((legacy.rssKbTotal - host.rssKbTotal) / legacy.rssKbTotal) * 100
          : null,
      promptWallImprovementPercent:
        legacy && host && legacy.promptWallMs > 0
          ? ((legacy.promptWallMs - host.promptWallMs) / legacy.promptWallMs) * 100
          : null,
    };
  });

  const output = {
    timestamp: new Date().toISOString(),
    machine: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    promptText: PROMPT_TEXT,
    results,
    comparisons,
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
