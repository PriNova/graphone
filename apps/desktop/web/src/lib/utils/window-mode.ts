import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";
import {
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  monitorFromPoint,
  primaryMonitor,
  type Monitor,
} from "@tauri-apps/api/window";

export type DisplayMode = "full" | "compact";

const COMPACT_BASE_HEIGHT = 58;
const COMPACT_HARD_MAX_HEIGHT = 1400;
const COMPACT_WORKAREA_VERTICAL_MARGIN = 24;
const COMPACT_MIN_WIDTH = 560;
const DEFAULT_FULL_WIDTH = 1024;
const DEFAULT_FULL_HEIGHT = 768;
const COMPACT_HEIGHT_RESTORE_THRESHOLD = COMPACT_BASE_HEIGHT + 20;
const POSITION_APPLY_TOLERANCE_PX = 2;
const POSITION_STUCK_THRESHOLD_PX = 16;
const POSITION_SETTLE_DELAY_MS = 40;
const POSITION_SETTLE_ATTEMPTS = 4;

let lastKnownFullOuterSize: { width: number; height: number } | null = null;
let lastKnownCompactPosition: { x: number; y: number } | null = null;
let disableProgrammaticPositioning = false;
let currentAppliedMode: DisplayMode | null = null;
let requestedCompactHeight = COMPACT_BASE_HEIGHT;
let currentCompactHeight = COMPACT_BASE_HEIGHT;
let requestedCompactWidth: number | null = null;
let currentCompactWidth: number | null = null;
let compactHeightApplyQueue: Promise<void> = Promise.resolve();

async function readCurrentInnerLogicalSize(): Promise<{
  width: number;
  height: number;
} | null> {
  try {
    const appWindow = getCurrentWindow();
    const physicalSize = await appWindow.innerSize();
    const scaleFactor = await appWindow.scaleFactor();
    const logicalSize = physicalSize.toLogical(scaleFactor);

    return {
      width: Math.max(1, Math.round(logicalSize.width)),
      height: Math.max(1, Math.round(logicalSize.height)),
    };
  } catch {
    return null;
  }
}

async function readCurrentOuterLogicalSize(): Promise<{
  width: number;
  height: number;
} | null> {
  try {
    const appWindow = getCurrentWindow();
    const physicalSize = await appWindow.outerSize();
    const scaleFactor = await appWindow.scaleFactor();
    const logicalSize = physicalSize.toLogical(scaleFactor);

    return {
      width: Math.max(1, Math.round(logicalSize.width)),
      height: Math.max(1, Math.round(logicalSize.height)),
    };
  } catch {
    return null;
  }
}

async function readCurrentLogicalFrameSize(): Promise<{
  width: number;
  height: number;
} | null> {
  const [inner, outer] = await Promise.all([
    readCurrentInnerLogicalSize(),
    readCurrentOuterLogicalSize(),
  ]);

  if (!inner || !outer) {
    return null;
  }

  return {
    width: Math.max(0, outer.width - inner.width),
    height: Math.max(0, outer.height - inner.height),
  };
}

async function readCurrentOuterPosition(): Promise<{
  x: number;
  y: number;
} | null> {
  try {
    const appWindow = getCurrentWindow();
    const position = await appWindow.outerPosition();

    return {
      x: Math.round(position.x),
      y: Math.round(position.y),
    };
  } catch {
    return null;
  }
}

async function readCurrentOuterSize(): Promise<{
  width: number;
  height: number;
} | null> {
  try {
    const appWindow = getCurrentWindow();
    const size = await appWindow.outerSize();

    return {
      width: Math.max(1, Math.round(size.width)),
      height: Math.max(1, Math.round(size.height)),
    };
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function drainCompactHeightApplyQueue(): Promise<void> {
  await compactHeightApplyQueue.catch(() => undefined);
}

async function setPositionBestEffort(x: number, y: number): Promise<boolean> {
  if (disableProgrammaticPositioning) {
    return false;
  }

  const appWindow = getCurrentWindow();
  const before = await readCurrentOuterPosition();

  try {
    await appWindow.setPosition(new PhysicalPosition(x, y));
  } catch {
    disableProgrammaticPositioning = true;
    return false;
  }

  if (!before) {
    return true;
  }

  let observedPosition: { x: number; y: number } | null = null;
  let observedMoveX = 0;
  let observedMoveY = 0;

  for (let attempt = 0; attempt < POSITION_SETTLE_ATTEMPTS; attempt += 1) {
    await sleep(POSITION_SETTLE_DELAY_MS);

    const after = await readCurrentOuterPosition();
    if (!after) {
      continue;
    }

    observedPosition = after;
    observedMoveX = Math.max(observedMoveX, Math.abs(after.x - before.x));
    observedMoveY = Math.max(observedMoveY, Math.abs(after.y - before.y));

    const reachedTarget =
      Math.abs(after.x - x) <= POSITION_APPLY_TOLERANCE_PX &&
      Math.abs(after.y - y) <= POSITION_APPLY_TOLERANCE_PX;
    if (reachedTarget) {
      return true;
    }
  }

  if (!observedPosition) {
    return true;
  }

  const requestedMoveX = Math.abs(x - before.x);
  const requestedMoveY = Math.abs(y - before.y);

  const wasMeaningfulMoveRequest =
    requestedMoveX > POSITION_STUCK_THRESHOLD_PX ||
    requestedMoveY > POSITION_STUCK_THRESHOLD_PX;
  const didNotMove =
    observedMoveX <= POSITION_APPLY_TOLERANCE_PX &&
    observedMoveY <= POSITION_APPLY_TOLERANCE_PX;

  // Wayland/WSLg may ignore absolute positioning. Detect this once and
  // gracefully disable future forced-position attempts for this runtime.
  if (wasMeaningfulMoveRequest && didNotMove) {
    disableProgrammaticPositioning = true;
  }

  return false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function resolveMonitorForPoint(
  x: number,
  y: number,
): Promise<Monitor | null> {
  return (
    (await monitorFromPoint(x, y).catch(() => null)) ??
    (await currentMonitor().catch(() => null)) ??
    (await primaryMonitor().catch(() => null)) ??
    (await availableMonitors()
      .then((monitors) => monitors[0] ?? null)
      .catch(() => null))
  );
}

async function readWindowCenterMonitor(): Promise<Monitor | null> {
  const appWindow = getCurrentWindow();

  try {
    const [position, size] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
    ]);

    const centerX = position.x + Math.floor(size.width / 2);
    const centerY = position.y + Math.floor(size.height / 2);

    return await resolveMonitorForPoint(centerX, centerY);
  } catch {
    return null;
  }
}

async function clampWindowIntoVisibleWorkArea(
  preferredMonitor?: Monitor | null,
): Promise<void> {
  if (disableProgrammaticPositioning) {
    return;
  }

  const appWindow = getCurrentWindow();

  try {
    const [position, size] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
    ]);

    const centerX = position.x + Math.floor(size.width / 2);
    const centerY = position.y + Math.floor(size.height / 2);
    const monitor =
      preferredMonitor ?? (await resolveMonitorForPoint(centerX, centerY));

    if (!monitor) {
      return;
    }

    const workX = monitor.workArea.position.x;
    const workY = monitor.workArea.position.y;
    const maxX = workX + Math.max(0, monitor.workArea.size.width - size.width);
    const maxY =
      workY + Math.max(0, monitor.workArea.size.height - size.height);

    const targetX = clamp(position.x, workX, maxX);
    const targetY = clamp(position.y, workY, maxY);

    if (targetX !== position.x || targetY !== position.y) {
      await setPositionBestEffort(targetX, targetY);
    }
  } catch {
    // best effort: keep mode switching resilient even if monitor APIs fail
  }
}

function normalizeCompactHeight(height: number): number {
  if (!Number.isFinite(height)) {
    return COMPACT_BASE_HEIGHT;
  }

  return clamp(
    Math.round(height),
    COMPACT_BASE_HEIGHT,
    COMPACT_HARD_MAX_HEIGHT,
  );
}

function normalizeCompactWidth(width: number): number {
  if (!Number.isFinite(width)) {
    return COMPACT_MIN_WIDTH;
  }

  return Math.max(COMPACT_MIN_WIDTH, Math.round(width));
}

async function resolveCompactMaxHeight(
  fallbackHeight: number,
): Promise<number> {
  const monitor = await readWindowCenterMonitor();

  if (monitor) {
    const logicalWorkAreaHeight = Math.round(
      monitor.workArea.size.height / monitor.scaleFactor,
    );
    const paddedHeight =
      logicalWorkAreaHeight - COMPACT_WORKAREA_VERTICAL_MARGIN * 2;

    return clamp(paddedHeight, COMPACT_BASE_HEIGHT, COMPACT_HARD_MAX_HEIGHT);
  }

  return clamp(
    Math.max(fallbackHeight, DEFAULT_FULL_HEIGHT),
    COMPACT_BASE_HEIGHT,
    COMPACT_HARD_MAX_HEIGHT,
  );
}

async function resolveCompactMaxWidth(fallbackWidth: number): Promise<number> {
  const monitor = await readWindowCenterMonitor();

  if (monitor) {
    const logicalWorkAreaWidth = Math.round(
      monitor.workArea.size.width / monitor.scaleFactor,
    );
    return Math.max(COMPACT_MIN_WIDTH, logicalWorkAreaWidth);
  }

  return Math.max(COMPACT_MIN_WIDTH, fallbackWidth, DEFAULT_FULL_WIDTH * 2);
}

async function applyCompactWindowSize(
  height: number,
  options?: { anchorBottom?: boolean; width?: number },
): Promise<void> {
  const appWindow = getCurrentWindow();
  const [currentInner, currentOuter] = await Promise.all([
    readCurrentInnerLogicalSize(),
    readCurrentOuterLogicalSize(),
  ]);

  const requestedWidth = normalizeCompactWidth(
    options?.width ??
      currentOuter?.width ??
      currentInner?.width ??
      requestedCompactWidth ??
      currentCompactWidth ??
      lastKnownFullOuterSize?.width ??
      COMPACT_MIN_WIDTH,
  );

  const normalizedRequestedHeight = normalizeCompactHeight(height);
  const [compactMaxWidth, compactMaxHeight] = await Promise.all([
    resolveCompactMaxWidth(requestedWidth),
    resolveCompactMaxHeight(normalizedRequestedHeight),
  ]);
  const targetWidth = clamp(requestedWidth, COMPACT_MIN_WIDTH, compactMaxWidth);
  const targetHeight = clamp(
    normalizedRequestedHeight,
    COMPACT_BASE_HEIGHT,
    compactMaxHeight,
  );

  const anchorBottom = options?.anchorBottom === true;
  const beforePosition = anchorBottom ? await readCurrentOuterPosition() : null;
  const beforeOuterSize = anchorBottom ? await readCurrentOuterSize() : null;

  await appWindow.setMinSize(new LogicalSize(COMPACT_MIN_WIDTH, targetHeight));
  await appWindow.setMaxSize(new LogicalSize(compactMaxWidth, targetHeight));
  await appWindow.setSize(new LogicalSize(targetWidth, targetHeight));
  requestedCompactWidth = targetWidth;
  currentCompactWidth = targetWidth;
  currentCompactHeight = targetHeight;

  if (anchorBottom && beforePosition && beforeOuterSize) {
    const afterOuterSize = await readCurrentOuterSize();
    if (afterOuterSize) {
      const deltaHeight = afterOuterSize.height - beforeOuterSize.height;
      if (deltaHeight !== 0) {
        await setPositionBestEffort(
          beforePosition.x,
          beforePosition.y - deltaHeight,
        );
      }
    }

    await clampWindowIntoVisibleWorkArea();
  }
}

export function syncCompactWindowHeight(height: number): Promise<void> {
  requestedCompactHeight = normalizeCompactHeight(height);

  if (currentAppliedMode !== "compact") {
    return Promise.resolve();
  }

  compactHeightApplyQueue = compactHeightApplyQueue
    .then(async () => {
      if (currentAppliedMode !== "compact") {
        return;
      }

      const targetHeight = requestedCompactHeight;
      if (Math.abs(targetHeight - currentCompactHeight) <= 1) {
        return;
      }

      await applyCompactWindowSize(targetHeight, { anchorBottom: true });
    })
    .catch(() => undefined);

  return compactHeightApplyQueue;
}

export async function applyWindowMode(mode: DisplayMode): Promise<void> {
  const appWindow = getCurrentWindow();

  if (mode === "compact") {
    const [currentInner, currentOuter] = await Promise.all([
      readCurrentInnerLogicalSize(),
      readCurrentOuterLogicalSize(),
    ]);

    const captureCandidate = currentOuter ?? currentInner;
    if (
      captureCandidate &&
      (captureCandidate.height > COMPACT_BASE_HEIGHT + 16 ||
        captureCandidate.width > COMPACT_MIN_WIDTH)
    ) {
      lastKnownFullOuterSize = captureCandidate;
    }

    await appWindow.setTitle("");
    await appWindow.setDecorations(false);
    await appWindow.setResizable(true);

    const targetCompactHeight = normalizeCompactHeight(requestedCompactHeight);
    const targetCompactWidth = normalizeCompactWidth(
      requestedCompactWidth ??
        currentOuter?.width ??
        currentInner?.width ??
        lastKnownFullOuterSize?.width ??
        COMPACT_MIN_WIDTH,
    );
    await applyCompactWindowSize(targetCompactHeight, {
      width: targetCompactWidth,
    });

    if (lastKnownCompactPosition) {
      const compactOuterSize = await readCurrentOuterSize();
      const monitor = compactOuterSize
        ? await resolveMonitorForPoint(
            lastKnownCompactPosition.x + Math.floor(compactOuterSize.width / 2),
            lastKnownCompactPosition.y +
              Math.floor(compactOuterSize.height / 2),
          )
        : null;

      await setPositionBestEffort(
        lastKnownCompactPosition.x,
        lastKnownCompactPosition.y,
      );
      await clampWindowIntoVisibleWorkArea(monitor);
    }

    await appWindow.setShadow(false).catch(() => undefined);
    currentAppliedMode = "compact";
    return;
  }

  const wasCompactMode = currentAppliedMode === "compact";
  if (wasCompactMode) {
    // Prevent any in-flight compact height sync from applying compact constraints
    // after we start restoring full mode.
    currentAppliedMode = "full";
    await drainCompactHeightApplyQueue();
  }

  const [currentInner, currentOuter] = await Promise.all([
    readCurrentInnerLogicalSize(),
    readCurrentOuterLogicalSize(),
  ]);

  const currentHeight =
    currentInner?.height ?? currentOuter?.height ?? Infinity;
  const switchingFromCompact =
    wasCompactMode || currentHeight <= COMPACT_HEIGHT_RESTORE_THRESHOLD;

  let compactMonitor: Monitor | null = null;
  if (switchingFromCompact) {
    compactMonitor = await readWindowCenterMonitor();
    const compactPosition = await readCurrentOuterPosition();
    if (compactPosition) {
      lastKnownCompactPosition = compactPosition;
    }

    const compactWidthCandidate = currentOuter?.width ?? currentInner?.width;
    if (compactWidthCandidate) {
      const normalizedCompactWidth = normalizeCompactWidth(
        compactWidthCandidate,
      );
      requestedCompactWidth = normalizedCompactWidth;
      currentCompactWidth = normalizedCompactWidth;
    }
  }

  await appWindow.setTitle("Graphone");
  await appWindow.setDecorations(true);
  await appWindow.setResizable(true);
  await appWindow.setMaximizable(true).catch(() => undefined);
  await appWindow.setMinimizable(true).catch(() => undefined);
  await appWindow.setClosable(true).catch(() => undefined);
  await appWindow.setMinSize(null);
  await appWindow.setMaxSize(null);
  await appWindow.setShadow(true).catch(() => undefined);

  const shouldRestoreDefaultSize =
    !lastKnownFullOuterSize && switchingFromCompact;

  const targetOuter = shouldRestoreDefaultSize
    ? {
        width: Math.max(
          DEFAULT_FULL_WIDTH,
          currentOuter?.width ?? currentInner?.width ?? DEFAULT_FULL_WIDTH,
        ),
        height: DEFAULT_FULL_HEIGHT,
      }
    : lastKnownFullOuterSize;

  if (targetOuter) {
    const frame = await readCurrentLogicalFrameSize();
    const targetInnerWidth = Math.max(
      1,
      targetOuter.width - (frame?.width ?? 0),
    );
    const targetInnerHeight = Math.max(
      1,
      targetOuter.height - (frame?.height ?? 0),
    );

    await appWindow.setSize(
      new LogicalSize(targetInnerWidth, targetInnerHeight),
    );
    await clampWindowIntoVisibleWorkArea(compactMonitor);
  }

  currentAppliedMode = "full";
}
