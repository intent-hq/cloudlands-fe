/**
 * Live skills domain backed by the daemon (`skill.list`, PROTOCOL §5.34).
 *
 * Skills are daemon-discovered (5-tier precedence: user p1-3 + project p4-5).
 * The daemon watches SKILL.md files and emits `skills:changed` (§6.5) when the
 * discovered set changes; this client subscribes to that event and refetches.
 */
import type {
  AppClient,
  SkillsClient,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import type { SkillInfo } from "$store/renderer/slices/skills/skills-types";
import { backendRequest, backendSubscribe, backendUnsubscribe, onBackendNotification } from "./backend-transport";

/**
 * Wire shape for `skill.list` response per PROTOCOL §5.34 — a bare array of
 * skill objects (no envelope). Includes optional frontmatter fields
 * (`allowedTools`, `compatibility`) that the renderer `SkillInfo` contract
 * omits.
 */
interface WireSkill {
  name: string;
  description: string;
  location: string;
  scope: "project" | "user";
  allowedTools?: string;
  compatibility?: string;
}

/** Map wire skill → renderer SkillInfo (strip allowedTools/compatibility). */
function normalizeSkill(wire: WireSkill): SkillInfo {
  return {
    name: wire.name,
    description: wire.description,
    location: wire.location,
    scope: wire.scope,
  };
}

export class LiveSkillsClient implements SkillsClient {
  async list(workspaceId: string): Promise<SkillInfo[]> {
    try {
      // `skill.list` (§5.34) returns a bare array of skills (name-sorted).
      const result = await backendRequest<WireSkill[]>("skill.list", { workspaceId });
      return Array.isArray(result) ? result.map(normalizeSkill) : [];
    } catch {
      // Fold transport/daemon errors to empty list (graceful degradation).
      return [];
    }
  }

  subscribe(handler: SubscriptionHandler<SkillInfo[]>): Unsubscribe {
    // Subscribe to `skills:changed` (§6.5) — emitted when the daemon detects a
    // SKILL.md file create/modify/delete. The event payload carries
    // `{ workspaceId }`. On event, refetch the skill list for the affected workspace
    // and push the fresh normalized SkillInfo[] to the handler.
    let disposed = false;
    let subscriptionId: string | undefined;

    // Initial snapshot: emit empty array immediately so UI renders.
    // Components that need workspace-specific skills call `list(workspaceId)`.
    handler([]);

    // Register daemon subscription.
    backendSubscribe<{ subscriptionId?: string }>({ eventTypes: ["skills:changed"] })
      .then((result) => {
        subscriptionId = result?.subscriptionId;
        if (disposed && subscriptionId) void backendUnsubscribe(subscriptionId);
      })
      .catch(() => {
        // Without a daemon subscription we stay with the empty-array fallback.
      });

    // Listen for skills:changed events (PROTOCOL §6.5) and refetch the updated
    // skill roster for the affected workspace, then push it to the handler.
    const removeNotificationListener = onBackendNotification((n) => {
      if (n.method === "skills:changed" && !disposed) {
        const payload = n.params as { workspaceId?: string } | undefined;
        const workspaceId = payload?.workspaceId;
        if (workspaceId) {
          // Refetch the fresh skill list for this workspace and emit it.
          void this.list(workspaceId).then((skills) => {
            if (!disposed) handler(skills);
          }).catch(() => {
            // Refetch failed; emit empty array as fallback.
            if (!disposed) handler([]);
          });
        }
      }
    });

    return () => {
      disposed = true;
      removeNotificationListener();
      if (subscriptionId) void backendUnsubscribe(subscriptionId);
    };
  }
}

// Tied to AppClient["skills"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient["skills"] | undefined = undefined as
  | LiveSkillsClient
  | undefined;
void _interfaceCheck;
