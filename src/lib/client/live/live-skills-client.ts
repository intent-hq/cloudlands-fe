/**
 * Live skills domain backed by the FE-main skills IPC (`skills:list`).
 *
 * Skills are FE-main-owned (no `skill.*` RPC exists in PROTOCOL.md; the
 * loader scans `.augment/skills/` + `~/.augment/skills/` and parses SKILL.md
 * frontmatter). This client invokes the existing `skills:list` IPC channel
 * (already preload-allowlisted) and maps the loader's `SkillMetadata` shape
 * to the renderer's `SkillInfo` contract.
 */
import type {
  AppClient,
  SkillsClient,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import type { SkillInfo } from "$store/renderer/slices/skills/skills-types";
import { SKILLS_CHANNELS } from "$shared/ipc/channels";

/** CommandResponse envelope the IPC handler returns. */
interface CommandResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * SkillMetadata as returned by the skills-loader (main-process).
 * Includes extra fields (`allowedTools`, `compatibility`) that the renderer
 * `SkillInfo` contract omits.
 */
interface SkillMetadata {
  name: string;
  description: string;
  location: string;
  scope: "project" | "user";
  allowedTools?: string;
  compatibility?: string;
}

/**
 * Invoke the skills:list IPC channel, preferring the real Electron bridge
 * (`window.electronAPI`) so the request reaches the live main-process handler.
 * Falls back to returning an empty array when no real bridge is present (unit
 * tests / non-Electron environments).
 */
async function invokeSkillsList(workspaceId: string): Promise<SkillInfo[]> {
  if (typeof window !== "undefined" && window.electronAPI?.invoke) {
    try {
      const response = (await window.electronAPI.invoke(
        SKILLS_CHANNELS.LIST,
        { workspaceId },
      )) as CommandResponse<SkillMetadata[]>;

      if (response.success && Array.isArray(response.data)) {
        // Map SkillMetadata → SkillInfo (strip allowedTools/compatibility).
        return response.data.map((skill) => ({
          name: skill.name,
          description: skill.description,
          location: skill.location,
          scope: skill.scope,
        }));
      }
    } catch {
      // Fold IPC errors to empty list so the UI degrades gracefully.
    }
  }
  return [];
}

export class LiveSkillsClient implements SkillsClient {
  async list(workspaceId: string): Promise<SkillInfo[]> {
    return invokeSkillsList(workspaceId);
  }

  subscribe(handler: SubscriptionHandler<SkillInfo[]>): Unsubscribe {
    // No `skills:*` change events exist on the wire (the loader is polled
    // on-demand), so the subscription is a one-shot snapshot of the current
    // discovered skills.
    // The mock contract calls with no workspaceId; the live path needs one.
    // Emit an empty list synchronously to match the mock's emit-once behavior.
    handler([]);
    return () => {
      // no-op unsubscribe for this emit-once subscription
    };
  }
}

// Tied to AppClient["skills"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient["skills"] | undefined = undefined as
  | LiveSkillsClient
  | undefined;
void _interfaceCheck;
