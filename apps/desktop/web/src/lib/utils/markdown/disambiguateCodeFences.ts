interface CodeBlockMarker {
  lineIndex: number;
  hasInfoString: boolean;
  infoString?: string;
  fence: "```" | "````" | "~~~" | "~~~~";
}

interface CodeBlockPair {
  open: CodeBlockMarker;
  close: CodeBlockMarker | null;
}

/**
 * Best-effort disambiguation for nested markdown code fences.
 *
 * Converts outer triple-backtick fences to quadruple fences when they have
 * an info string, which prevents nested markdown fences from prematurely
 * closing the outer block in many LLM-generated responses.
 */
export function disambiguateCodeFences(markdown: string): string {
  const lines = markdown.split("\n");
  const markers = getCodeBlockMarkers(lines);
  const outerPairs = getOuterPairs(markers);

  for (const pair of outerPairs) {
    replaceTriplesWithQuadBackticks(lines, pair.open);
    if (pair.close) {
      replaceTriplesWithQuadBackticks(lines, pair.close);
    }
  }

  return lines.join("\n");
}

/**
 * Validates if a string is a valid info string for code fence blocks.
 */
export function isValidInfoString(line: string): boolean {
  const infoString = line.replace(/[^a-zA-Z0-9]/g, "");
  return infoString.length > 0;
}

function getCodeBlockMarkers(lines: string[]): CodeBlockMarker[] {
  const markers: CodeBlockMarker[] = [];

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim();
    const fence = trimmed.startsWith("````")
      ? "````"
      : trimmed.startsWith("```")
        ? "```"
        : trimmed.startsWith("~~~~")
          ? "~~~~"
          : trimmed.startsWith("~~~")
            ? "~~~"
            : null;

    if (!fence) return;

    // Ignore lines that contain multiple fence occurrences.
    if (trimmed.lastIndexOf(fence) !== trimmed.indexOf(fence)) {
      return;
    }

    const lineAfterFence = trimmed.slice(fence.length);
    const hasInfoString =
      lineAfterFence.length > 0 && isValidInfoString(lineAfterFence);
    const infoString = hasInfoString ? lineAfterFence : undefined;

    markers.push({ lineIndex, hasInfoString, infoString, fence });
  });

  return markers;
}

function getOuterPairs(markers: CodeBlockMarker[]): CodeBlockPair[] {
  const stack: CodeBlockMarker[] = [];
  const outerPairs: CodeBlockPair[] = [];

  for (const marker of markers) {
    if (marker.hasInfoString || stack.length === 0) {
      stack.push(marker);
      continue;
    }

    const openMarker = stack.pop();
    if (!openMarker) continue;

    if (
      stack.length === 0 &&
      openMarker.infoString &&
      marker.fence === openMarker.fence
    ) {
      outerPairs.push({ open: openMarker, close: marker });
    }
  }

  if (stack.length > 0) {
    // Outermost open marker that never closed.
    const openMarker = stack.shift();
    if (openMarker?.infoString) {
      outerPairs.push({ open: openMarker, close: null });
    }
  }

  return outerPairs;
}

function replaceTriplesWithQuadBackticks(
  lines: string[],
  marker: CodeBlockMarker,
): void {
  const line = lines[marker.lineIndex];
  if (line && marker.fence === "```") {
    lines[marker.lineIndex] = line.replace("```", "````");
  }
}
