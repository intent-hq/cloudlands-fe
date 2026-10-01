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
  ScriptArchiveFilter,
  ScriptArchiveResult,
  ScriptRestoreResult,
} from '$features/scripts/types';
import { m } from '$shared/paraglide/messages.js';
import type {
  ScriptRuntimeState,
  ScriptWithState,
  WorkspaceScript,
} from '$store/renderer/slices/scripts/scripts-types';
import type {
  MutationResult,
  ScriptCreateInput,
  ScriptCreateResult,
  ScriptRunResult,
  ScriptsClient,
  SubscriptionHandler,
  Unsubscribe,
} from '../app-client';
import { backendRequest } from './backend-transport';
import { runMutation } from './live-support';

export class LiveScriptsClient implements ScriptsClient {
  async supportsLifecycle(): Promise<boolean> {
    const result = await backendRequest<{
      server?: { capabilities?: { scriptLifecycle?: number } };
    }>('client.hello', {});
    return result?.server?.capabilities?.scriptLifecycle === 1;
  }

  async list(
    workspaceId: string,
    options?: { archive?: ScriptArchiveFilter },
  ): Promise<ScriptWithState[]> {
    const supported = await this.supportsLifecycle();
    // An explicit partition must never become a successful unfiltered snapshot.
    // Missing capability is legacy fallback only for default/all-list callers;
    // failed negotiation remains a retryable error rather than cached history.
    if (!supported && options?.archive && options.archive !== 'all') {
      throw new Error(m.scripts_history_unsupported_error());
    }
    const result = await backendRequest<{ scripts: ScriptWithState[] }>('script.list', {
      workspaceId,
      ...(supported ? { archive: options?.archive ?? 'active' } : {}),
    });
    if (!Array.isArray(result?.scripts)) throw new Error(m.scripts_history_load_error());
    return result.scripts;
  }

  async archive(
    workspaceId: string,
    scriptIds: string[],
    options?: { capabilityVerified: true },
  ): Promise<ScriptArchiveResult> {
    // The saga checks current workspace/connection authority after its one
    // negotiation. No further await may separate that check from wire dispatch.
    if (!options?.capabilityVerified && !(await this.supportsLifecycle()))
      throw new Error(m.scripts_history_unsupported_error());
    return backendRequest('script.archive', { workspaceId, scriptIds });
  }

  async restore(
    workspaceId: string,
    scriptIds: string[],
    options?: { capabilityVerified: true },
  ): Promise<ScriptRestoreResult> {
    // The saga checks current workspace/connection authority after its one
    // negotiation. No further await may separate that check from wire dispatch.
    if (!options?.capabilityVerified && !(await this.supportsLifecycle()))
      throw new Error(m.scripts_history_unsupported_error());
    return backendRequest('script.restore', { workspaceId, scriptIds });
  }

  async create(workspaceId: string, input: ScriptCreateInput): Promise<ScriptCreateResult> {
    try {
      const script = await backendRequest<WorkspaceScript>('script.create', {
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
      const id = typeof script?.id === 'string' ? script.id : undefined;
      return { success: true, ...(id ? { id } : {}), ...(script ? { script } : {}) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async remove(workspaceId: string, scriptId: string): Promise<MutationResult> {
    return runMutation('script.remove', { workspaceId, scriptId });
  }

  async start(workspaceId: string, scriptId: string): Promise<MutationResult> {
    return runMutation('script.start', { workspaceId, scriptId });
  }

  async stop(workspaceId: string, scriptId: string): Promise<MutationResult> {
    return runMutation('script.stop', { workspaceId, scriptId });
  }

  async restart(workspaceId: string, scriptId: string): Promise<MutationResult> {
    return runMutation('script.restart', { workspaceId, scriptId });
  }

  async output(workspaceId: string, scriptId: string, maxLines?: number): Promise<string> {
    try {
      // `script.output` returns the output-buffer text as a bare JSON string (§5.8).
      const result = await backendRequest<unknown>('script.output', {
        workspaceId,
        scriptId,
        ...(maxLines !== undefined ? { maxLines } : {}),
      });
      return typeof result === 'string' ? result : '';
    } catch {
      return '';
    }
  }

  async status(workspaceId: string, scriptId: string): Promise<ScriptRuntimeState | null> {
    try {
      const result = await backendRequest<ScriptRuntimeState>('script.status', {
        workspaceId,
        scriptId,
      });
      return result && typeof result === 'object' ? result : null;
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
      const result = await backendRequest<ScriptRunResult>('script.run', {
        workspaceId,
        scriptId,
        ...(options?.maxLines !== undefined ? { maxLines: options.maxLines } : {}),
        ...(options?.timeoutSeconds !== undefined
          ? { timeoutSeconds: options.timeoutSeconds }
          : {}),
      });
      return result && typeof result === 'object' ? result : null;
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
