/**
 * Host-requirements check service — consumes the host-requirements trigger
 * actions (mirroring the provider-availability check service) so the git +
 * node + gh probes reach a TERMINAL state in the store for the onboarding
 * gate (gh is informational only and never gates).
 *
 * The middleware fans out the probes in parallel over the existing legacy
 * IPC bridges — `system:check-git` (→ daemon `host.checkGit`),
 * `system:check-node` (→ daemon `host.findBinary { name:"node" }` +
 * MINIMUM_NODE_VERSION comparison), and `system:check-gh` (→ daemon
 * `host.findBinary { name:"gh" }`), all PROTOCOL §5.14 — and dispatches each
 * tool's resolved action as ITS probe settles. Once every probe settles the
 * middleware ALWAYS dispatches `checkHostRequirementsComplete`, so
 * `hasCheckedOnce` flips and the UI never hangs on "checking"; probe/bridge
 * failures fold to not-available (the bridges themselves never reject —
 * missing binaries are normal answers — so the catch arms here only guard
 * transport-level surprises).
 *
 * Dependency-light per src/store/renderer/AGENTS.md: imports the configured
 * store, slice actions, and the logger (no selectors).
 */
import type { StoreMiddleware } from "$lib/store-shim/types";
import { invoke } from "$lib/electron-bridge";
import { createLogger } from "$lib/utils/client-logger";
import { IPC_CHANNELS } from "$shared/ipc-registry";
import { store as appStore } from "$store/renderer/store";
import {
  checkHostRequirementsComplete,
  checkHostRequirementsRequested,
  checkHostRequirementsStarted,
  ensureHostRequirementsChecked,
  ghRequirementResolved,
  gitRequirementResolved,
  nodeRequirementResolved,
} from "$store/renderer/slices/host-requirements/host-requirements-slice";

const SYSTEM_CHANNELS = IPC_CHANNELS.SYSTEM;

const logger = createLogger("HostRequirementsCheckService");

/** `system:check-git` envelope (host-bridge-seeder / system.ipc.ts). */
interface CheckGitResponse {
  success: boolean;
  data?: { available: boolean; version?: string };
}

/** `system:check-node` envelope (host-bridge-seeder / system.ipc.ts). */
interface CheckNodeResponse {
  success: boolean;
  data?: { available: boolean; versionOk: boolean; version?: string };
}

/** `system:check-gh` envelope (host-bridge-seeder / system.ipc.ts). */
interface CheckGhResponse {
  success: boolean;
  data?: { available: boolean; version?: string };
}

export function createHostRequirementsCheckMiddleware(): StoreMiddleware {
  /** Coalesce overlapping checks (mount + focus can fire together). */
  let inFlight: Promise<void> | null = null;

  const runGitCheck = async (): Promise<void> => {
    try {
      const result = await invoke<CheckGitResponse>(SYSTEM_CHANNELS.CHECK_GIT);
      const data = result?.success ? result.data : undefined;
      appStore.dispatch(
        gitRequirementResolved(data?.available === true, data?.version),
      );
    } catch (error) {
      logger.error("Git requirement check failed", { error });
      appStore.dispatch(gitRequirementResolved(false));
    }
  };

  const runNodeCheck = async (): Promise<void> => {
    try {
      const result = await invoke<CheckNodeResponse>(SYSTEM_CHANNELS.CHECK_NODE);
      const data = result?.success ? result.data : undefined;
      appStore.dispatch(
        nodeRequirementResolved(data?.versionOk === true, data?.version),
      );
    } catch (error) {
      logger.error("Node requirement check failed", { error });
      appStore.dispatch(nodeRequirementResolved(false));
    }
  };

  const runGhCheck = async (): Promise<void> => {
    try {
      const result = await invoke<CheckGhResponse>(SYSTEM_CHANNELS.CHECK_GH);
      const data = result?.success ? result.data : undefined;
      appStore.dispatch(
        ghRequirementResolved(data?.available === true, data?.version),
      );
    } catch (error) {
      logger.error("gh requirement check failed", { error });
      appStore.dispatch(ghRequirementResolved(false));
    }
  };

  const runCheck = (): Promise<void> => {
    if (inFlight) return inFlight;
    appStore.dispatch(checkHostRequirementsStarted());
    inFlight = (async () => {
      try {
        // Each probe dispatches its own resolved action as it settles;
        // `allSettled` prevents one rejection from short-circuiting the
        // group (the run* helpers already fold their own errors).
        await Promise.allSettled([runGitCheck(), runNodeCheck(), runGhCheck()]);
      } finally {
        appStore.dispatch(checkHostRequirementsComplete());
        inFlight = null;
      }
    })();
    return inFlight;
  };

  return () => (next) => (action) => {
    const result = next(action);
    if (action && typeof action.type === "string") {
      switch (action.type) {
        case ensureHostRequirementsChecked.type:
          // First-mount trigger: only probe when nothing has been checked yet.
          if (!appStore.state.hostRequirements.hasCheckedOnce) {
            void runCheck();
          }
          break;
        case checkHostRequirementsRequested.type:
          void runCheck();
          break;
      }
    }
    return result;
  };
}
