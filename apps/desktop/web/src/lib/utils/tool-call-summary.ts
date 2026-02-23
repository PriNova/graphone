import type { ToolCall } from "$lib/types/agent";

function stringifyToolArg(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function ellipsize(value: string, max = 140): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

export function computeToolCallSummary(block: ToolCall): string | null {
  const args = block.arguments ?? {};

  const arg = (key: string) => stringifyToolArg(args[key]);

  switch (block.name) {
    case "bash": {
      const command = arg("command");
      return command ? ellipsize(command, 160) : null;
    }

    case "read": {
      const path = arg("path");
      const offset = arg("offset");
      const limit = arg("limit");

      if (!path && !offset && !limit) return null;

      const meta: string[] = [];
      if (offset) meta.push(`offset=${offset}`);
      if (limit) meta.push(`limit=${limit}`);

      return ellipsize(
        `${path ?? ""}${meta.length > 0 ? ` (${meta.join(", ")})` : ""}`,
        160,
      );
    }

    case "write":
    case "edit":
    case "ls":
    case "find": {
      const path = arg("path");
      return path ? ellipsize(path, 160) : null;
    }

    case "grep": {
      const pattern = arg("pattern");
      const path = arg("path");
      if (pattern && path) return ellipsize(`${pattern} (${path})`, 160);
      return pattern
        ? ellipsize(pattern, 160)
        : path
          ? ellipsize(path, 160)
          : null;
    }

    default: {
      const fallback =
        arg("path") ??
        arg("command") ??
        arg("url") ??
        arg("query") ??
        arg("pattern") ??
        arg("filePattern");

      return fallback ? ellipsize(fallback, 160) : null;
    }
  }
}
