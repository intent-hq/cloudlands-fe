import type { RecoveryLifetime } from '$shared/event-recovery/resource';
import {
  rendererEventRecovery,
  type RendererRecoveryScope,
} from '$features/events/renderer-event-recovery';

type CatalogSource = RendererRecoveryScope | undefined;
const globalReads = new Map<Promise<unknown>, CatalogSource>();
/** Recovery waits for existing global reads to settle before starting a new snapshot. */
export async function settleGlobalSpecialistReads(): Promise<void> {
  await Promise.allSettled(
    [...globalReads].filter(([, captured]) => captured?.isCurrent()).map(([read]) => read),
  );
}
/**
 * Live specialists domain backed by the intentd daemon (PROTOCOL §5.11).
 *
 * `specialist.list` returns the resolved user and bundled view. Optional
 * workspaceId selects routing context. Project definitions require the explicit
 * listCatalog includeProject option; ordinary list/subscriptions remain global. The defs are surfaced verbatim; splitting bundled vs
 * file-backed entries into their store slices happens in the seeder. Reads
 * fold transport failures to an empty list so the specialist picker falls
 * back to the hardcoded `SPECIALISTS` constant instead of breaking.
 *
 * The daemon watches the user/project specialist tiers and emits
 * `specialists:changed` (payload `{ workspaceId }`) when the resolved set
 * changes; `subscribe` listens for that event and refetches — mirroring
 * `live-skills-client.ts`. No FE-side filesystem watching.
 */
import type {
  AppClient,
  SpecialistDef,
  SpecialistCatalog,
  SpecialistsClient,
  SubscriptionHandler,
  Unsubscribe,
} from '../app-client';
import { createLogger } from '$lib/utils/client-logger';
import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from './backend-transport';

const logger = createLogger('LiveSpecialistsClient');

/**
 * Trailing debounce applied to `specialists:changed` bursts so one refetch
 * serves e.g. a multi-file save (the daemon already debounces per workspace,
 * but a user-tier change fans out one event per open workspace and
 * `specialist.list` is global — one refetch covers them all).
 */
const REFETCH_DEBOUNCE_MS = 100;

export class LiveSpecialistsClient implements SpecialistsClient {
  private scope: RendererRecoveryScope | undefined;
  private globalRead:
    | { receipt: RecoveryLifetime; source: CatalogSource; promise: Promise<SpecialistCatalog> }
    | undefined;
  /**
   * Raw `specialist.list` fetch — throws on transport/daemon failure. The
   * public `list()` folds errors to an empty list (picker falls back to the
   * hardcoded `SPECIALISTS`); event-driven refetches use this directly so a
   * transient failure keeps the last known-good view instead of wiping the
   * store (#610).
   */
  private async fetchCatalog(
    provider?: string,
    workspaceId?: string,
    options?: { includeProject?: boolean },
  ): Promise<SpecialistCatalog> {
    // Preview context belongs to this request; global subscriptions keep
    // using the daemon's default context rather than the last picker choice.
    const result =
      provider === undefined && workspaceId === undefined && !options?.includeProject
        ? await (this.scope?.request ?? backendRequest)<SpecialistCatalog>('specialist.list')
        : await (this.scope?.request ?? backendRequest)<SpecialistCatalog>('specialist.list', {
            ...(provider ? { provider } : {}),
            ...(workspaceId ? { workspaceId } : {}),
            ...(options?.includeProject ? { includeProject: true } : {}),
          });
    return {
      specialists: Array.isArray(result?.specialists) ? result.specialists : [],
      importDiagnostics: result?.importDiagnostics,
    };
  }

  async listCatalog(
    provider?: string,
    workspaceId?: string,
    options?: { includeProject?: boolean },
  ): Promise<SpecialistCatalog> {
    if (provider || workspaceId || options?.includeProject)
      return this.fetchCatalog(provider, workspaceId, options);
    const receipt = rendererEventRecovery.capture('global-specialists');
    // Lease changes invalidate commit receipts, but do not retire physical requests.
    const source = this.scope;
    const previous = this.globalRead;
    if (previous?.source === source && previous?.receipt.isCurrent()) return previous.promise;
    const fetch = () => {
      if (!receipt.commit(() => undefined)) throw new Error('Specialist catalog lifetime retired');
      return this.fetchCatalog();
    };
    const read =
      previous && previous.source === source
        ? previous.promise.catch(() => undefined).then(fetch)
        : fetch();
    const pending = { receipt, source, promise: read };
    this.globalRead = pending;
    globalReads.set(read, source);
    try {
      return await read;
    } finally {
      globalReads.delete(read);
      if (this.globalRead === pending) this.globalRead = undefined;
    }
  }

  async list(provider?: string, workspaceId?: string): Promise<SpecialistDef[]> {
    try {
      return (await this.listCatalog(provider, workspaceId)).specialists;
    } catch {
      return [];
    }
  }

  subscribe(handler: SubscriptionHandler<SpecialistDef[]>): Unsubscribe {
    return this.subscribeCatalogSnapshot(
      (catalog) => handler(catalog.specialists),
      () => handler([]),
    );
  }

  subscribeCatalog(handler: SubscriptionHandler<SpecialistCatalog>): Unsubscribe {
    return this.subscribeCatalogSnapshot(handler);
  }

  private subscribeCatalogSnapshot(
    handler: SubscriptionHandler<SpecialistCatalog>,
    onInitialFailure?: () => void,
  ): Unsubscribe {
    // Subscribe to `specialists:changed` — emitted when the daemon detects a
    // create/modify/delete under a specialist tier it watches. The payload
    // carries `{ workspaceId }`, but `specialist.list` is global, so events
    // are debounced into a single refetch and the workspaceId is not needed.
    let disposed = false;
    let generation = 0;
    let scope: RendererRecoveryScope | undefined;
    let abort: AbortController | undefined;
    let subscriptionId: string | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    const refetch = (initial = false) => {
      const captured = generation;
      const receipt = rendererEventRecovery.capture('global-specialists');
      if (!receipt.commit(() => undefined)) return Promise.resolve();
      return this.listCatalog()
        .then((catalog) => {
          if (!disposed && captured === generation)
            receipt.commit(() => {
              handler(catalog);
            });
        })
        .catch((error) => {
          if (!disposed && captured === generation) {
            if (initial)
              receipt.commit(() => {
                onInitialFailure?.();
              });
            else
              logger.error(
                'Failed to refetch specialist list; keeping last known-good view',
                error,
              );
          }
        });
    };
    const doSubscribe = async () => {
      const captured = generation;
      const owner = scope;
      abort?.abort();
      const cancellation = new AbortController();
      abort = cancellation;
      try {
        const params = { eventTypes: ['specialists:changed', 'skills:changed'] };
        const result = owner
          ? await owner.subscribe(params, { recover: true, signal: cancellation.signal })
          : await backendSubscribe<{ subscriptionId?: string }>(params);
        const id = result && ('id' in result ? result.id : result.subscriptionId);
        if (typeof id !== 'string') return;
        if (disposed || captured !== generation) {
          if (owner) void owner.unsubscribe(id);
          else void backendUnsubscribe(id);
        } else subscriptionId = id;
      } catch {
        /* Keep the current snapshot when subscription registration fails. */
      }
    };
    const offRecovery = rendererEventRecovery.onSession((next) => {
      generation += 1;
      scope = next;
      this.scope = next;
      const previous = subscriptionId;
      subscriptionId = undefined;
      if (previous) void backendUnsubscribe(previous);
      void doSubscribe().then(() => {
        if (!disposed && scope === next) void refetch(true);
      });
      return () => {
        generation += 1;
        abort?.abort();
        const id = subscriptionId;
        subscriptionId = undefined;
        if (id) void next.unsubscribe(id);
        if (scope === next) scope = undefined;
        if (this.scope === next) this.scope = undefined;
      };
    });
    if (!scope) {
      void doSubscribe();
      void refetch(true);
    }

    // Listen for specialists:changed events and refetch the resolved view,
    // coalescing bursts into one `specialist.list` call.
    const removeNotificationListener = onBackendNotification((n) => {
      // Captured sessions deliver generic events through the registered owner.
      if (scope) return;
      if ((n.method === 'specialists:changed' || n.method === 'skills:changed') && !disposed) {
        if (!rendererEventRecovery.push('global-specialists')) return;
        if (debounceTimer !== undefined) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          refetch();
        }, REFETCH_DEBOUNCE_MS);
      }
    });

    // On reconnect the daemon dropped its subscription registry (RESUB-1);
    // the notification handler is still wired, so re-issue the subscribe and
    // refetch the resolved view once to converge on anything missed during
    // the outage (#609). Mirrors `live-git-client.ts`.
    const offReconnect = onBackendReconnected(() => {
      if (disposed) return;
      generation += 1;
      subscriptionId = undefined;
      if (scope) return;
      void doSubscribe();
      // Cancel any pending debounced refetch so the reconnect refetch is the
      // single one — otherwise a pre-outage burst's timer would fire later
      // and issue a redundant second `specialist.list`.
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      refetch();
    });

    return () => {
      disposed = true;
      generation += 1;
      abort?.abort();
      offRecovery();
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      removeNotificationListener();
      offReconnect();
      if (subscriptionId) void backendUnsubscribe(subscriptionId);
    };
  }

  async create(
    id: string,
    spec: SpecialistDef,
    scope?: 'project' | 'user',
    workspacePath?: string,
    workspaceId?: string,
  ): Promise<SpecialistDef> {
    const params: {
      id: string;
      spec: SpecialistDef;
      scope?: string;
      workspacePath?: string;
      workspaceId?: string;
    } = {
      id,
      spec,
    };
    if (scope) params.scope = scope;
    if (workspacePath) params.workspacePath = workspacePath;
    if (scope === 'project' && workspaceId) params.workspaceId = workspaceId;

    const result = await backendRequest<{ specialist: SpecialistDef }>('specialist.create', params);
    return result.specialist;
  }

  async edit(
    id: string,
    spec: SpecialistDef,
    scope: 'project' | 'user',
    workspacePath?: string,
    workspaceId?: string,
  ): Promise<SpecialistDef> {
    const params: {
      id: string;
      spec: SpecialistDef;
      scope: string;
      workspacePath?: string;
      workspaceId?: string;
    } = {
      id,
      spec,
      scope,
    };
    if (workspacePath) params.workspacePath = workspacePath;
    if (scope === 'project' && workspaceId) params.workspaceId = workspaceId;

    const result = await backendRequest<{ specialist: SpecialistDef }>('specialist.edit', params);
    return result.specialist;
  }

  async delete(
    id: string,
    scope: 'project' | 'user',
    workspacePath?: string,
    workspaceId?: string,
  ): Promise<{ success: true }> {
    const params: { id: string; scope: string; workspacePath?: string; workspaceId?: string } = {
      id,
      scope,
    };
    if (workspacePath) params.workspacePath = workspacePath;
    if (scope === 'project' && workspaceId) params.workspaceId = workspaceId;

    return await backendRequest<{ success: true }>('specialist.delete', params);
  }
}

// Tied to AppClient["specialists"] so the seam composition catches drift in CI.
const _interfaceCheck: AppClient['specialists'] | undefined = undefined as
  LiveSpecialistsClient | undefined;
void _interfaceCheck;
