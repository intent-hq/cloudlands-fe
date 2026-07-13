/**
 * Live scripts domain backed by the intentd daemon (PROTOCOL §5.8).
 *
 * Wires the scripts panel through the daemon's `script.*` surface:
 * `list/create/remove/start/stop/restart/output/status/run`. Scripts run as
 * PTYs on the daemon's unified PTY host; `script.output` / `script.status`
 * are the historical poll reads while live output/state stream as the
 * `script:output` / `script:state` events (§6.5). Definitions and runtime
 * state cross the wire in the exact `ScriptWithState` shape the renderer
 * slice consumes (definition fields + a merged `runtime` block), so payloads
 * pass through verbatim.
 */
import type {
  ScriptRuntimeState,
  ScriptWithState,
  WorkspaceScript,
} from "$store/renderer/slices/scripts/scripts-types";
import type {
  MutationResult,
  ScriptCreateInput,
  ScriptCreateResult,
  ScriptRunResult,
  ScriptsClient,
  SubscriptionHandler,
  Unsubscribe,
} from "../app-client";
import { backendRequest } from "./backend-transport";
import { runMutation } from "./live-support";

export class LiveScriptsClient implements ScriptsClient {
  async list(workspaceId: string): Promise<ScriptWithState[]> {
    try {
      const result = await backendRequest<{ scripts?: unknown[] }>("script.list", {
        workspaceId,
      });
      return Array.isArray(result?.scripts) ? (result.scripts as ScriptWithState[]) : [];
    } catch {
      return [];
    }
  }

  async create(workspaceId: string, input: ScriptCreateInput): Promise<ScriptCreateResult> {
    try {
      const script = await backendRequest<WorkspaceScript>("script.create", {
        workspaceId,
        name: input.name,
        command: input.command,
        mode: input.mode,
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.env !== undefined ? { env: input.env } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.autoStart !== undefined ? { autoStart: input.autoStart } : {}),
        ...(input.scriptId !== undefined ? { scriptId: input.scriptId } : {}),
      });
      const id = typeof script?.id === "string" ? script.id : undefined;
      return { success: true, ...(id ? { id } : {}), ...(script ? { script } : {}) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async remove(workspaceId: string, scriptId: string): Promise<MutationResult> {
    return runMutation("script.remove", { workspaceId, scriptId });
  }

  async start(workspaceId: string, scriptId: string): Promise<MutationResult> {
    return runMutation("script.start", { workspaceId, scriptId });
  }

  async stop(workspaceId: string, scriptId: string): Promise<MutationResult> {
    return runMutation("script.stop", { workspaceId, scriptId });
  }

  async restart(workspaceId: string, scriptId: string): Promise<MutationResult> {
    return runMutation("script.restart", { workspaceId, scriptId });
  }

  async output(workspaceId: string, scriptId: string, maxLines?: number): Promise<string> {
    try {
      // `script.output` returns the output-buffer text as a bare JSON string (§5.8).
      const result = await backendRequest<unknown>("script.output", {
        workspaceId,
        scriptId,
        ...(maxLines !== undefined ? { maxLines } : {}),
      });
      return typeof result === "string" ? result : "";
    } catch {
      return "";
    }
  }

  async status(workspaceId: string, scriptId: string): Promise<ScriptRuntimeState | null> {
    try {
      const result = await backendRequest<ScriptRuntimeState>("script.status", {
        workspaceId,
        scriptId,
      });
      return result && typeof result === "object" ? result : null;
    } catch {
      return null;
    }
  }

  async run(
    workspaceId: string,
    scriptId: string,
    options?: { maxLines?: number; timeoutSeconds?: number },
  ): Promise<ScriptRunResult | null> {
    try {
      const result = await backendRequest<ScriptRunResult>("script.run", {
        workspaceId,
        scriptId,
        ...(options?.maxLines !== undefined ? { maxLines: options.maxLines } : {}),
        ...(options?.timeoutSeconds !== undefined
          ? { timeoutSeconds: options.timeoutSeconds }
          : {}),
      });
      return result && typeof result === "object" ? result : null;
    } catch {
      return null;
    }
  }

  subscribe(handler: SubscriptionHandler<ScriptWithState[]>): Unsubscribe {
    // The renderer slice consumes per-workspace snapshots via `list(workspaceId)`
    // (seeder + lifecycle-read refresh); this slice-wide subscription is unused
    // by the scripts panel (mirrors LiveTerminalsClient.subscribe).
    handler([]);
    return () => {};
  }
}
