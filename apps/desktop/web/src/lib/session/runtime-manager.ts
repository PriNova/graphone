import { invoke } from "@tauri-apps/api/core";

import { createAgentStore } from "$lib/stores/agent.svelte";
import { createEnabledModelsStore } from "$lib/stores/enabledModels.svelte";
import { createMessagesStore } from "$lib/stores/messages.svelte";
import type { SessionDescriptor } from "$lib/stores/sessions.svelte";
import type { SessionRuntime } from "$lib/types/session";

export type SessionRuntimeMap = Record<string, SessionRuntime>;

export function getRuntimeForSession(
  runtimes: SessionRuntimeMap,
  sessionId: string,
): SessionRuntime | undefined {
  return runtimes[sessionId];
}

export function setRuntimeForSession(
  runtimes: SessionRuntimeMap,
  runtime: SessionRuntime,
): SessionRuntimeMap {
  return {
    ...runtimes,
    [runtime.sessionId]: runtime,
  };
}

export function removeRuntimeForSession(
  runtimes: SessionRuntimeMap,
  sessionId: string,
): SessionRuntimeMap {
  if (!runtimes[sessionId]) {
    return runtimes;
  }

  const next = { ...runtimes };
  delete next[sessionId];
  return next;
}

export async function loadMessages(runtime: SessionRuntime): Promise<void> {
  try {
    const response = await invoke<
      | {
          success: true;
          data: {
            messages: Array<{
              role: string;
              content: unknown;
              timestamp?: number;
            }>;
          };
        }
      | { success: false; error: string }
    >("get_messages", { sessionId: runtime.sessionId });

    if (
      response &&
      typeof response === "object" &&
      "success" in response &&
      response.success
    ) {
      runtime.messages.loadFromAgentMessages(response.data.messages);
    }
  } catch (error) {
    runtime.messages.addErrorMessage(`Failed to load messages: ${error}`);
  }
}

export async function initializeRuntime(
  descriptor: SessionDescriptor,
): Promise<SessionRuntime> {
  const runtime: SessionRuntime = {
    sessionId: descriptor.sessionId,
    projectDir: descriptor.projectDir,
    title: descriptor.title,
    agent: createAgentStore(descriptor.sessionId),
    messages: createMessagesStore(),
    enabledModels: createEnabledModelsStore(descriptor.projectDir),
  };

  await runtime.agent.initialize();
  await loadMessages(runtime);
  await runtime.agent.loadAvailableModels().catch((error) => {
    console.warn("Failed to load available models:", error);
  });

  return runtime;
}

export async function ensureRuntime(
  descriptor: SessionDescriptor,
  runtimes: SessionRuntimeMap,
  setRuntimes: (next: SessionRuntimeMap) => void,
): Promise<SessionRuntime> {
  const existing = runtimes[descriptor.sessionId];
  if (existing) {
    if (existing.projectDir !== descriptor.projectDir) {
      const updated: SessionRuntime = {
        ...existing,
        projectDir: descriptor.projectDir,
      };
      updated.enabledModels.setProjectDir(descriptor.projectDir);
      await updated.enabledModels.refresh().catch(() => undefined);
      setRuntimes(
        setRuntimeForSession(runtimes, {
          ...updated,
        }),
      );
      return updated;
    }

    return existing;
  }

  const runtime = await initializeRuntime(descriptor);
  setRuntimes(setRuntimeForSession(runtimes, runtime));
  return runtime;
}
