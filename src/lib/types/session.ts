import type { AgentStore } from "$lib/stores/agent.svelte";
import type { MessagesStore } from "$lib/stores/messages.svelte";
import type { EnabledModelsStore } from "$lib/stores/enabledModels.svelte";

export interface SessionRuntime {
  sessionId: string;
  projectDir: string;
  title: string;
  agent: AgentStore;
  messages: MessagesStore;
  enabledModels: EnabledModelsStore;
}
