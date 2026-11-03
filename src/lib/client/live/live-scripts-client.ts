/**
 * Live scripts domain backed by the intentd daemon (PROTOCOL §5.8).
 *
 * Discovery reads one active summary page. Full definitions are read only for
 * selected edits or explicit bulk operations. Output is always a separate
 * known-ID read and never depends on membership in the loaded page.
 */
import type {
  ScriptArchiveFilter,
  ScriptListPage,
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

/** Rows per full-view `script.list` page (the host also caps page bytes). */
const FULL_PAGE_LIMIT = 200;

export class LiveScriptsClient implements ScriptsClient {
  async supportsLifecycle(): Promise<boolean> {
    const result = await backendRequest<{
      server?: { capabilities?: { scriptLifecycle?: number } };
    }>('client.hello', {});
    return result?.server?.capabilities?.scriptLifecycle === 1;
  }

  /** Resolves whether the host pages lists by default (`boundedReads: 1`, §5.8). */
  private async requireActiveLists(): Promise<{ fullPages: boolean }> {
    const hello = await backendRequest<{
      server?: { capabilities?: { scriptActiveLists?: number; boundedReads?: number } };
    }>('client.hello', {});
    // Gate on the advertised capability, not the protocol major: majors move
    // for unrelated changes (protocol 15 still serves active lists).
    if (hello.server?.capabilities?.scriptActiveLists !== 1)
      throw new Error(m.scripts_list_unsupported_error());
    return { fullPages: hello.server?.capabilities?.boundedReads === 1 };
  }

  /**
   * Explicit bulk operations only; normal discovery uses one summary page.
   * Returns every active definition: a host with paged full views
   * (`boundedReads: 1`) is read page by page until `nextCursor` is absent.
   */
  async list(
    workspaceId: string,
    options?: { archive?: ScriptArchiveFilter },
  ): Promise<ScriptWithState[]> {
    const { fullPages } = await this.requireActiveLists();
    const scripts: ScriptWithState[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await backendRequest<{ scripts: ScriptWithState[]; nextCursor?: string }>(
        'script.list',
        {
          workspaceId,
          archive: options?.archive ?? 'active',
          ...(fullPages ? { limit: FULL_PAGE_LIMIT, ...(cursor ? { cursor } : {}) } : {}),
        },
      );
      if (!Array.isArray(result?.scripts)) throw new Error(m.scripts_list_load_error());
      for (const row of result.scripts) {
        // A definition too big for one page arrives with `<field>Omitted`
        // markers in place of its largest fields; `script.get` serves it whole.
        scripts.push(hasOmittedFields(row) ? await readWholeScript(workspaceId, row.id) : row);
      }
      const next = fullPages ? result.nextCursor : undefined;
      if (typeof next === 'string' && next && !seen.has(next)) {
        seen.add(next);
        cursor = next;
      } else if (next !== undefined && next !== null) {
        // A repeated or malformed cursor would never finish.
        throw new Error(m.scripts_list_load_error());
      } else {
        cursor = undefined;
      }
    } while (cursor);
    return scripts;
  }

  async listPage(
    workspaceId: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<ScriptListPage> {
    await this.requireActiveLists();
    const result = await backendRequest<ScriptListPage>('script.list', {
      workspaceId,
      archive: 'active',
      view: 'summary',
      limit: 100,
      ...options,
    });
    if (result?.view !== 'summary' || !Array.isArray(result.scripts))
      throw new Error(m.scripts_list_unsupported_error());
    return result;
  }

  async get(workspaceId: string, scriptId: string): Promise<ScriptWithState> {
    await this.requireActiveLists();
    return readWholeScript(workspaceId, scriptId);
  }

  async archive(
    workspaceId: string,
    scriptIds: string[],
    options?: { capabilityVerified: true },
  ): Promise<ScriptArchiveResult> {
    // The saga checks current workspace/connection authority after its one
    // negotiation. No further await may separate that check from wire dispatch.
    if (!options?.capabilityVerified && !(await this.supportsLifecycle()))
      throw new Error(m.scripts_list_unsupported_error());
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
      throw new Error(m.scripts_list_unsupported_error());
    return backendRequest('script.restore', { workspaceId, scriptIds });
  }

  async create(workspaceId: string, input: ScriptCreateInput): Promise<ScriptCreateResult> {
    try {
      if (input.scriptId !== undefined) {
        // i18n-ignore (developer API misuse, rejected before any request)
        throw new Error('Use scriptsClient.update to edit an existing script.');
      }
      const script = await backendRequest<WorkspaceScript>('script.create', {
        workspaceId,
        name: input.name,
        command: input.command,
        mode: input.mode,
        ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
        ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
        ...(input.env !== undefined ? { env: input.env } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.autoStart !== undefined ? { autoStart: input.autoStart } : {}),
        ...(input.healthUrl !== undefined ? { healthUrl: input.healthUrl } : {}),
        ...(input.readyPattern !== undefined ? { readyPattern: input.readyPattern } : {}),
      });
      const id = typeof script?.id === 'string' ? script.id : undefined;
      return { success: true, ...(id ? { id } : {}), ...(script ? { script } : {}) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
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

/** Whether a paged list row had fields replaced by `<field>Omitted: true`. */
function hasOmittedFields(row: object): boolean {
  return Object.entries(row).some(([key, value]) => key.endsWith('Omitted') && value === true);
}

/** One `script.get` reply; a cut `command` carries the paging fields (§5.8). */
type ScriptGetPart = ScriptWithState & {
  commandTruncated?: boolean;
  commandBytes?: number;
  commandOffset?: number;
  nextCommandOffset?: number | null;
};

const SCRIPT_GET_ATTEMPTS = 3;

/**
 * Read one definition whole. A `command` too big for one reply arrives in
 * parts (`commandOffset` in, `nextCommandOffset` out); join them, restart
 * when the command changes between parts, and refuse a result whose byte
 * size does not match `commandBytes`.
 */
/** Most `script.get` parts one command may take before the read is incomplete. */
export const SCRIPT_GET_MAX_PARTS = 4096;

async function readWholeScript(workspaceId: string, scriptId: string): Promise<ScriptWithState> {
  for (let attempt = 0; attempt < SCRIPT_GET_ATTEMPTS; attempt++) {
    const first = await backendRequest<ScriptGetPart>('script.get', { workspaceId, scriptId });
    if (first?.commandTruncated !== true) return first;
    const size = first.commandBytes;
    let command = first.command;
    let next = first.nextCommandOffset;
    let changed = false;
    // Parts carry at least 64 KiB of JSON, so this covers any command the
    // daemon accepts; more parts, or one that does not move forward, means
    // the read can never complete.
    let parts = 1;
    while (typeof next === 'number') {
      if (++parts > SCRIPT_GET_MAX_PARTS) throw new Error(m.scripts_list_load_error());
      const part = await backendRequest<ScriptGetPart>('script.get', {
        workspaceId,
        scriptId,
        commandOffset: next,
      });
      // Every replacement stamps a new updatedAt, so a same-size edit between
      // parts is caught here rather than spliced into a command that never existed.
      if (
        part?.commandBytes !== size ||
        part.commandOffset !== next ||
        part.updatedAt !== first.updatedAt
      ) {
        changed = true;
        break;
      }
      command += part.command;
      const after = part.nextCommandOffset;
      if (typeof after === 'number' && after <= next) throw new Error(m.scripts_list_load_error());
      next = after;
    }
    if (changed) continue;
    if (new TextEncoder().encode(command).length !== size)
      throw new Error(m.scripts_list_load_error());
    const {
      commandTruncated: _truncated,
      commandBytes: _bytes,
      commandOffset: _offset,
      nextCommandOffset: _next,
      ...rest
    } = first;
    return { ...rest, command };
  }
  throw new Error(m.scripts_list_load_error());
}
