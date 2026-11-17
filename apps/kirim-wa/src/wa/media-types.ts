import { basename } from "node:path";

export type MediaType = "image" | "video" | "audio" | "document" | "sticker";
export type OutboundMediaType = MediaType;

export interface StoredMedia {
  id: string;
  deviceId: string;
  source: "inbound" | "upload" | "history";
  mediaType: MediaType;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  originalFilename: string | null;
  storagePath: string;
  createdAt: string;
  /** Logical availability marker; once set, APIs must not serve the object. */
  expiredAt: string | null;
  /** Durable confirmation that the physical bytes were removed. */
  bytesDeletedAt: string | null;
}

const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

export function normalizeMimeType(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const mimeType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return MIME_PATTERN.test(mimeType) ? mimeType : null;
}

export function isMimeAllowedForType(mediaType: MediaType, mimeType: string): boolean {
  if (!MIME_PATTERN.test(mimeType)) return false;
  if (mediaType === "image") return mimeType.startsWith("image/") && mimeType !== "image/svg+xml";
  if (mediaType === "video") return mimeType.startsWith("video/");
  if (mediaType === "audio") return mimeType.startsWith("audio/");
  if (mediaType === "sticker") return mimeType === "image/webp";
  return true;
}

/** Keeps useful display metadata without ever allowing it to become a storage path. */
export function safeOriginalFilename(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = basename(value.replaceAll("\\", "/"))
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join("")
    .trim()
    .slice(0, 255);
  if (!normalized || normalized === "." || normalized === "..") return null;
  return normalized;
}

export function isOutboundMediaType(value: unknown): value is OutboundMediaType {
  return (
    value === "image" ||
    value === "video" ||
    value === "audio" ||
    value === "document" ||
    value === "sticker"
  );
}
