/**
 * Image attachment processing utilities.
 * Handles validation, conversion, clipboard integration, and file reading.
 */

import type { PromptImageAttachment } from "$lib/types/agent";

// ── Types ───────────────────────────────────────────────────────────────────

export interface LocalPromptImageAttachment extends PromptImageAttachment {
  id: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

// ── Conversion ──────────────────────────────────────────────────────────────

export function toLocalAttachments(
  images: PromptImageAttachment[],
): LocalPromptImageAttachment[] {
  return images.map((image) => ({
    id: crypto.randomUUID(),
    ...image,
  }));
}

export function toExternalAttachments(
  images: LocalPromptImageAttachment[],
): PromptImageAttachment[] {
  return images.map(({ id: _id, ...image }) => image);
}

// ── Equality ────────────────────────────────────────────────────────────────

/** Generic equality check for image attachment arrays. */
export function areAttachmentsEqual(
  a:
    | ReadonlyArray<Pick<PromptImageAttachment, "mimeType" | "data">>
    | null
    | undefined,
  b:
    | ReadonlyArray<Pick<PromptImageAttachment, "mimeType" | "data">>
    | null
    | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  return a.every(
    (left, i) => left.mimeType === b[i].mimeType && left.data === b[i].data,
  );
}

/** Check if local and external attachments are equal (ignoring local id). */
export function areLocalAndExternalEqual(
  local: LocalPromptImageAttachment[],
  external: PromptImageAttachment[],
): boolean {
  return areAttachmentsEqual(toExternalAttachments(local), external);
}

// ── Validation ──────────────────────────────────────────────────────────────

export function isSupportedImageMimeType(mimeType: string): boolean {
  return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
}

export interface ImageValidationError {
  message: string;
}

/**
 * Validate a file before processing. Returns error message or null if valid.
 */
export function validateImageFile(
  file: Blob,
  currentCount: number,
): ImageValidationError | null {
  if (currentCount >= MAX_IMAGES_PER_MESSAGE) {
    return {
      message: `You can only attach up to ${MAX_IMAGES_PER_MESSAGE} images per message.`,
    };
  }

  const mimeType = file.type.toLowerCase();
  if (!mimeType.startsWith("image/")) {
    return { message: "Only image files can be attached." };
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return { message: "Image is too large. Maximum size is 5MB." };
  }

  return null;
}

// ── File reading ────────────────────────────────────────────────────────────

export function readBlobAsDataUrl(file: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = (event) => {
      const result = event.target?.result;
      resolve(typeof result === "string" ? result : null);
    };
    reader.readAsDataURL(file);
  });
}

/** Convert any data URL to PNG format using canvas. */
export async function convertDataUrlToPng(
  dataUrl: string,
): Promise<string | null> {
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });

  if (!image) return null;

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return null;

  context.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * Process a single image file: validate, read, convert if needed.
 * Returns the attachment or an error message.
 */
export async function processImageFile(
  file: Blob,
  currentCount: number,
): Promise<{ attachment: LocalPromptImageAttachment } | { error: string }> {
  const validationError = validateImageFile(file, currentCount);
  if (validationError) return { error: validationError.message };

  let dataUrl = await readBlobAsDataUrl(file);
  if (!dataUrl) return { error: "Failed to read image attachment." };

  const mimeType = file.type.toLowerCase();

  if (!isSupportedImageMimeType(mimeType)) {
    const converted = await convertDataUrlToPng(dataUrl);
    if (!converted) {
      return { error: "Only PNG, JPEG, GIF, and WebP images are supported." };
    }
    dataUrl = converted;
  }

  const commaIndex = dataUrl.indexOf(",");
  const header = commaIndex > 0 ? dataUrl.slice(0, commaIndex) : "";
  const base64Data = commaIndex > 0 ? dataUrl.slice(commaIndex + 1) : "";

  if (
    !header.startsWith("data:") ||
    !header.includes(";base64") ||
    base64Data.length === 0
  ) {
    return { error: "Unsupported clipboard image format." };
  }

  const declaredMimeType = header
    .slice("data:".length)
    .split(";")[0]
    ?.toLowerCase();

  const resolvedMimeType =
    declaredMimeType && isSupportedImageMimeType(declaredMimeType)
      ? declaredMimeType
      : "image/png";

  return {
    attachment: {
      id: crypto.randomUUID(),
      type: "image",
      data: base64Data,
      mimeType: resolvedMimeType,
    },
  };
}

/**
 * Process multiple image files, stopping when max count is reached.
 */
export async function processImageFiles(
  files: Blob[],
  currentCount: number,
): Promise<{ attachments: LocalPromptImageAttachment[]; error?: string }> {
  const attachments: LocalPromptImageAttachment[] = [];
  let currentTotal = currentCount;

  for (const file of files) {
    const result = await processImageFile(file, currentTotal);

    if ("error" in result) {
      return { attachments, error: result.error };
    }

    attachments.push(result.attachment);
    currentTotal++;

    if (currentTotal >= MAX_IMAGES_PER_MESSAGE) {
      break;
    }
  }

  return { attachments };
}

// ── Clipboard utilities ─────────────────────────────────────────────────────

export function decodeBase64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Try to read an image from the native clipboard via Tauri invoke.
 * Returns a Blob if successful, null otherwise.
 */
export async function tryReadNativeClipboardImage(
  invokeFn: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
): Promise<Blob | null> {
  try {
    const image = await invokeFn<PromptImageAttachment | null>(
      "read_clipboard_image",
    );

    if (
      !image ||
      image.type !== "image" ||
      typeof image.data !== "string" ||
      typeof image.mimeType !== "string"
    ) {
      return null;
    }

    const bytes = decodeBase64ToBytes(image.data);
    if (bytes.length === 0) return null;

    return new Blob([bytes], { type: image.mimeType });
  } catch {
    return null;
  }
}

/**
 * Extract image files from a ClipboardEvent's DataTransferItemList.
 */
export function extractImageFilesFromClipboard(
  items: DataTransferItemList,
): File[] {
  return Array.from(items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}
