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
import { createLogger } from "$lib/utils/client-logger";
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from "./backend-transport";

const logger = createLogger("LiveSkillsClient");

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
  /**
   * Raw `skill.list` fetch — throws on transport/daemon failure. The public
   * `list()` folds errors to an empty list; event-driven refetches use this
   * directly so a transient failure keeps the last known-good view instead of
   * wiping it (#610).
   */
  private async fetchList(workspaceId: string): Promise<SkillInfo[]> {
    // `skill.list` (§5.34) returns a bare array of skills (name-sorted).
    const result = await backendRequest<WireSkill[]>("skill.list", { workspaceId });
    return Array.isArray(result) ? result.map(normalizeSkill) : [];
  }

  async list(workspaceId: string): Promise<SkillInfo[]> {
    try {
      return await this.fetchList(workspaceId);
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
    let lastWorkspaceId: string | undefined;

    // Initial snapshot: emit empty array immediately so UI renders.
    // Components that need workspace-specific skills call `list(workspaceId)`.
    handler([]);

    // Event/reconnect refetch: non-folding — on failure, log and skip the
    // emit so the handler keeps its last known-good view (#610).
    const refetch = (workspaceId: string) => {
      this.fetchList(workspaceId)
        .then((skills) => {
          if (!disposed) handler(skills);
        })
        .catch((error) => {
          logger.error("Failed to refetch skill list; keeping last known-good view", error);
        });
    };

    // Register daemon subscription.
    const doSubscribe = () =>
      backendSubscribe<{ subscriptionId?: string }>({ eventTypes: ["skills:changed"] })
        .then((result) => {
          subscriptionId = result?.subscriptionId;
          if (disposed && subscriptionId) void backendUnsubscribe(subscriptionId);
        })
        .catch(() => {
          // Without a daemon subscription we stay with the empty-array fallback.
        });

    doSubscribe();

    // Listen for skills:changed events (PROTOCOL §6.5) and refetch the updated
    // skill roster for the affected workspace, then push it to the handler.
    const removeNotificationListener = onBackendNotification((n) => {
      if (n.method === "skills:changed" && !disposed) {
        const payload = n.params as { workspaceId?: string } | undefined;
        const workspaceId = payload?.workspaceId;
        if (workspaceId) {
          lastWorkspaceId = workspaceId;
          refetch(workspaceId);
        }
      }
    });

    // On reconnect the daemon dropped its subscription registry (RESUB-1);
    // the notification handler is still wired, so re-issue the subscribe and
    // refetch the last-emitted workspace's roster once to converge on
    // anything missed during the outage (#609).
    const offReconnect = onBackendReconnected(() => {
      if (disposed) return;
      subscriptionId = undefined;
      void doSubscribe();
      if (lastWorkspaceId) refetch(lastWorkspaceId);
    });

    return () => {
      disposed = true;
      removeNotificationListener();
      offReconnect();
      if (subscriptionId) void backendUnsubscribe(subscriptionId);
    };
  }
}

// Tied to AppClient["skills"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient["skills"] | undefined = undefined as
  | LiveSkillsClient
  | undefined;
void _interfaceCheck;
