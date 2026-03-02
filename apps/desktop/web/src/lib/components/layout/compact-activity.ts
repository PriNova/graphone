import type { ContentBlock, Message, UserContentBlock } from "$lib/types/agent";

export type CompactActivityItem =
  | {
      key: string;
      type: "user";
      block: { summary: string };
    }
  | {
      key: string;
      type: "assistant";
      block: { markdown: string };
    }
  | {
      key: string;
      type: "thinking";
      block: { type: "thinking"; thinking: string };
    }
  | {
      key: string;
      type: "toolCall";
      block: {
        type: "toolCall";
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        result?: string;
        isError?: boolean;
      };
    };

export function buildCompactActivityItems(
  messages: Message[],
): CompactActivityItem[] {
  if (messages.length === 0) {
    return [];
  }

  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.type === "user") {
      lastUserIndex = i;
      break;
    }
  }

  if (lastUserIndex === -1) {
    return [];
  }

  let startIdx = lastUserIndex;
  if (lastUserIndex > 0 && messages[lastUserIndex - 1]?.type === "assistant") {
    startIdx = lastUserIndex - 1;
  }

  const assistantMarkdownByMessageId = new Map<string, string>();
  let latestAssistantMessageIdWithText: string | null = null;

  for (
    let messageIndex = startIdx;
    messageIndex < messages.length;
    messageIndex += 1
  ) {
    const message = messages[messageIndex];
    if (!message || message.type !== "assistant") {
      continue;
    }

    const markdown = extractAssistantMarkdown(message.content);
    if (markdown.length === 0) {
      continue;
    }

    assistantMarkdownByMessageId.set(message.id, markdown);
    latestAssistantMessageIdWithText = message.id;
  }

  const items: CompactActivityItem[] = [];

  for (
    let messageIndex = startIdx;
    messageIndex < messages.length;
    messageIndex += 1
  ) {
    const message = messages[messageIndex];
    if (!message) {
      continue;
    }

    if (message.type === "user") {
      items.push({
        key: `user:${message.id}`,
        type: "user",
        block: { summary: summarizeUserPrompt(message.content) },
      });
      continue;
    }

    for (
      let blockIndex = 0;
      blockIndex < message.content.length;
      blockIndex += 1
    ) {
      const block = message.content[blockIndex];
      if (!block) {
        continue;
      }

      if (block.type === "thinking") {
        items.push({
          key: `thinking:${message.id}:${blockIndex}`,
          type: "thinking",
          block,
        });
        continue;
      }

      if (block.type === "toolCall") {
        const fallbackId = `${message.id}:${blockIndex}`;
        items.push({
          key: `tool:${block.id || fallbackId}`,
          type: "toolCall",
          block,
        });
      }
    }

    if (message.id === latestAssistantMessageIdWithText) {
      const markdown = assistantMarkdownByMessageId.get(message.id);
      if (markdown) {
        items.push({
          key: `assistant:${message.id}`,
          type: "assistant",
          block: { markdown },
        });
      }
    }
  }

  return items.slice(-3);
}

function summarizeUserPrompt(content: UserContentBlock[]): string {
  const text = content
    .filter(
      (block): block is Extract<UserContentBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();

  const imageCount = content.filter((block) => block.type === "image").length;

  let summary = "Prompt sent";
  if (text.length > 0 && imageCount > 0) {
    summary = `${text} • ${imageCount} image${imageCount === 1 ? "" : "s"}`;
  } else if (text.length > 0) {
    summary = text;
  } else if (imageCount > 0) {
    summary = `${imageCount} image${imageCount === 1 ? "" : "s"} attached`;
  }

  return summary.length > 120 ? `${summary.slice(0, 119)}…` : summary;
}

function extractAssistantMarkdown(content: ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => {
      return block.type === "text";
    })
    .map((block) => block.text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n")
    .trim();
}
