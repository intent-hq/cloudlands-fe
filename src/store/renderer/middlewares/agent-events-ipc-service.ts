/**
 * Agent events IPC service — restores the renderer halves of the deleted
 * `auth/sagas/auth-saga.ts` agent watchers (removed with the saga runtime in
 * 95d908a2 without re-homing). With no listener, the `agent:auth-required`
 * and `agent:plan-required` events the main process forwards (see
 * `src/store/main/slices/agent-events/agent-events-slice.ts`) never surfaced
 * a toast in the renderer.
 *
 * This reconnects both paths WITHOUT re-adding a saga, following the
 * notification-ipc-service pattern: on middleware creation it registers window
 * IPC listeners for the two preload-allowed channels:
 *   - `agent:auth-required` → warning toast ("Agent Authentication Required")
 *     with the event message and an "Open Terminal" action that navigates to
 *     the workspace terminal panel when a workspaceId is present.
 *   - `agent:plan-required` → error toast ("Intent: Plan Upgrade Required")
 *     with the event message.
 * Toast failures are swallowed — the toast is informational, not critical.
 *
 * Dependency-light per src/store/renderer/AGENTS.md: no selector or store
 * imports; the toast lib is imported lazily.
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { isElectron } from "$lib/electron-bridge";
import { navigateToRoute } from "$lib/utils/navigation.client";

/** Payload of `agent:auth-required` (see $features/events/types.ts). */
interface AgentAuthRequiredEvent {
  workspaceId?: string;
  agentId?: string;
  isRemote: boolean;
  host?: string;
  message: string;
}

/** Payload of `agent:plan-required` (see $features/events/types.ts). */
interface AgentPlanRequiredEvent {
  workspaceId?: string;
  agentId?: string;
  message: string;
  helpUrl?: string;
}

async function handleAgentAuthRequired(data: AgentAuthRequiredEvent): Promise<void> {
  try {
    const { toast } = await import("svelte-sonner");
    toast.warning("Agent Authentication Required", {
      description: data.message,
      duration: 15000,
      action: {
        label: "Open Terminal",
        onClick: () => {
          if (data.workspaceId) {
            void navigateToRoute(`/workspace/${data.workspaceId}?panel=terminal`);
          }
        },
      },
    });
  } catch {
    // Toast not available - not critical
  }
}

async function handleAgentPlanRequired(data: AgentPlanRequiredEvent): Promise<void> {
  try {
    const { toast } = await import("svelte-sonner");
    toast.error("Intent: Plan Upgrade Required", {
      description: data.message,
      duration: 20000,
    });
  } catch {
    // Toast not available - not critical
  }
}

export function createAgentEventsIpcMiddleware(): StoreMiddleware {
  return () => {
    // Register the listeners once on middleware creation
    if (isElectron() && typeof window !== "undefined" && window.electronAPI?.on) {
      // Handlers are async but never reject (errors are swallowed), so
      // registering them directly is safe — and lets tests await them.
      window.electronAPI.on("agent:auth-required", handleAgentAuthRequired);
      window.electronAPI.on("agent:plan-required", handleAgentPlanRequired);
      // Note: No cleanup is performed. The listeners persist for the lifetime
      // of the renderer process (same as notification-ipc-service).
    }

    return (next) => (action) => {
      return next(action);
    };
  };
}
