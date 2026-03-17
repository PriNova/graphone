import { basename, dirname, extname, resolve } from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

export type ResourceScope = "user" | "project" | "temporary";
export type ResourceOrigin = "package" | "top-level";

export interface ExtensionPathMetadata {
  source: string;
  scope: ResourceScope;
  origin: ResourceOrigin;
}

export interface RegisteredExtensionSummary {
  name: string;
  path: string;
  resolvedPath: string;
  scope: "global" | "local";
  source: string;
  origin: ResourceOrigin | "unknown";
  toolCount: number;
  commandCount: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Resolves human-readable display names for extensions from various sources
 * (npm packages, git repos, file paths).
 */
export class ExtensionNameResolver {
  /**
   * Look up extension metadata from the resource loader's path metadata map.
   */
  getMetadata(
    extension: { path: string; resolvedPath: string },
    pathMetadata: Map<string, unknown>,
  ): ExtensionPathMetadata | undefined {
    const candidates = new Set<string>();

    if (extension.path) {
      candidates.add(extension.path);
      candidates.add(resolve(extension.path));
    }

    if (extension.resolvedPath) {
      candidates.add(extension.resolvedPath);
      candidates.add(resolve(extension.resolvedPath));
    }

    for (const candidate of candidates) {
      const metadata = pathMetadata.get(candidate);
      if (isExtensionPathMetadata(metadata)) {
        return metadata;
      }
    }

    return undefined;
  }

  /**
   * Determine the scope group ("global" for user scope, "local" otherwise).
   */
  mapScopeToGroup(scope: ResourceScope | undefined): "global" | "local" {
    return scope === "user" ? "global" : "local";
  }

  /**
   * Derive a human-readable display name for an extension.
   * Priority: source metadata → file path heuristics.
   */
  getDisplayName(
    path: string,
    metadata: ExtensionPathMetadata | undefined,
  ): string {
    const fromSource = metadata
      ? deriveNameFromSource(metadata.source)
      : undefined;

    return fromSource ?? deriveNameFromPath(path);
  }
}

// ── Module-level helpers ────────────────────────────────────────────────────

function isExtensionPathMetadata(
  value: unknown,
): value is ExtensionPathMetadata {
  if (!value || typeof value !== "object") return false;

  const candidate = value as {
    source?: unknown;
    scope?: unknown;
    origin?: unknown;
  };

  return (
    typeof candidate.source === "string" &&
    (candidate.scope === "user" ||
      candidate.scope === "project" ||
      candidate.scope === "temporary") &&
    (candidate.origin === "package" || candidate.origin === "top-level")
  );
}

function deriveNameFromSource(source: string): string | undefined {
  const trimmed = source.trim();

  if (!trimmed || ["auto", "local", "cli"].includes(trimmed)) {
    return undefined;
  }

  if (trimmed.startsWith("npm:")) {
    const packageName = parseNpmPackageName(trimmed.slice(4));
    return packageName ? shortPackageName(packageName) : undefined;
  }

  const looksLikePath =
    trimmed.includes("://") ||
    trimmed.startsWith("git:") ||
    trimmed.startsWith("git@") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("~");

  if (!looksLikePath) {
    const packageName = parseNpmPackageName(trimmed);
    return packageName ? shortPackageName(packageName) : undefined;
  }

  return deriveRepositoryName(trimmed);
}

function parseNpmPackageName(spec: string): string | undefined {
  const trimmed = spec.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("@")) {
    const slashIndex = trimmed.indexOf("/");
    if (slashIndex === -1) return undefined;

    const versionIndex = trimmed.indexOf("@", slashIndex + 1);
    return versionIndex === -1 ? trimmed : trimmed.slice(0, versionIndex);
  }

  const versionIndex = trimmed.indexOf("@");
  return versionIndex === -1 ? trimmed : trimmed.slice(0, versionIndex);
}

function shortPackageName(packageName: string): string {
  const slashIndex = packageName.lastIndexOf("/");
  return slashIndex === -1 ? packageName : packageName.slice(slashIndex + 1);
}

function deriveRepositoryName(source: string): string | undefined {
  const withoutPrefix = source.startsWith("git:") ? source.slice(4) : source;

  if (withoutPrefix.includes("://")) {
    try {
      const url = new URL(withoutPrefix);
      return stripGitSuffixAndRef(basename(url.pathname));
    } catch {
      return undefined;
    }
  }

  if (withoutPrefix.startsWith("git@")) {
    const splitIndex = Math.max(
      withoutPrefix.lastIndexOf("/"),
      withoutPrefix.lastIndexOf(":"),
    );
    const tail =
      splitIndex === -1 ? withoutPrefix : withoutPrefix.slice(splitIndex + 1);
    return stripGitSuffixAndRef(tail);
  }

  return undefined;
}

function stripGitSuffixAndRef(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const noGitSuffix = trimmed.endsWith(".git") ? trimmed.slice(0, -4) : trimmed;

  const refIndex = noGitSuffix.indexOf("@");
  const withoutRef =
    refIndex > 0 ? noGitSuffix.slice(0, refIndex) : noGitSuffix;

  return withoutRef || undefined;
}

function deriveNameFromPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "unnamed-extension";

  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1);
  }

  const fileName = basename(trimmed);
  const ext = extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;

  if (stem !== "index") return stem || fileName;

  const parent = basename(dirname(trimmed));
  if (!parent || parent === "." || parent === "..") return stem;

  if (["src", "dist", "build", "lib", "out"].includes(parent)) {
    const grandparent = basename(dirname(dirname(trimmed)));
    if (grandparent && grandparent !== "." && grandparent !== "..") {
      return grandparent;
    }
  }

  return parent;
}
