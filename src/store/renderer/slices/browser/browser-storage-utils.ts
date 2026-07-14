/**
 * Shared browser storage utilities for localStorage persistence.
 *
 * Extracted from live-browser-client.ts and browser-persistence-service.ts
 * to keep the storageKey generation and RecentUrl validation logic in one place.
 */
import { BROWSER_STORAGE_KEY_PREFIX } from "./browser-types";
import type { RecentUrl } from "./browser-types";

/** localStorage key for a workspace's recent URLs: `browser-recent-${workspaceId}` */
export function storageKey(workspaceId: string): string {
  return `${BROWSER_STORAGE_KEY_PREFIX}${workspaceId}`;
}

/** Type guard for `RecentUrl` (runtime validation of localStorage payloads). */
export function isRecentUrl(value: unknown): value is RecentUrl {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.url === "string" &&
    typeof obj.lastVisited === "string" &&
    (obj.title === undefined || typeof obj.title === "string") &&
    (obj.favicon === undefined || typeof obj.favicon === "string")
  );
}
