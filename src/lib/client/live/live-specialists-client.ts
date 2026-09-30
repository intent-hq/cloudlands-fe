/**
 * Live specialists domain backed by the intentd daemon (PROTOCOL §5.11).
 *
 * `specialist.list` returns the resolved user and bundled view. Optional
 * workspaceId selects routing context without adding project definitions — as `{ specialists:
 * SpecialistDef[] }`. The defs are surfaced verbatim; splitting bundled vs
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
  /**
   * Raw `specialist.list` fetch — throws on transport/daemon failure. The
   * public `list()` folds errors to an empty list (picker falls back to the
   * hardcoded `SPECIALISTS`); event-driven refetches use this directly so a
   * transient failure keeps the last known-good view instead of wiping the
   * store (#610).
   */
  async listCatalog(provider?: string, workspaceId?: string): Promise<SpecialistCatalog> {
    // Preview context belongs to this request; global subscriptions keep
    // using the daemon's default context rather than the last picker choice.
    const result =
      provider === undefined && workspaceId === undefined
        ? await backendRequest<SpecialistCatalog>('specialist.list')
        : await backendRequest<SpecialistCatalog>('specialist.list', {
            ...(provider ? { provider } : {}),
            ...(workspaceId ? { workspaceId } : {}),
          });
    return {
      specialists: Array.isArray(result?.specialists) ? result.specialists : [],
      importDiagnostics: result?.importDiagnostics,
    };
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
    let subscriptionId: string | undefined;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    // Initial snapshot: emit the current resolved view.
    void this.listCatalog()
      .then((catalog) => {
        if (!disposed) handler(catalog);
      })
      .catch(() => {
        if (!disposed) onInitialFailure?.();
      });

    // Event/reconnect refetch: non-folding — on failure, log and skip the
    // emit so the store keeps its last known-good view (#610), matching
    // the specialists saga's authoritative refetch.
    const refetch = () => {
      this.listCatalog()
        .then((specialists) => {
          if (!disposed) handler(specialists);
        })
        .catch((error) => {
          logger.error('Failed to refetch specialist list; keeping last known-good view', error);
        });
    };

    // Register daemon subscription. Guard the late-resolving case: if the
    // subscriber disposed while registration was in flight, release the id
    // instead of leaking the daemon-side subscription.
    const doSubscribe = () =>
      backendSubscribe<{ subscriptionId?: string }>({
        eventTypes: ['specialists:changed', 'skills:changed'],
      })
        .then((result) => {
          subscriptionId = result?.subscriptionId;
          if (disposed && subscriptionId) void backendUnsubscribe(subscriptionId);
        })
        .catch(() => {
          // Without a daemon subscription we stay with the one-shot snapshot.
        });

    doSubscribe();

    // Listen for specialists:changed events and refetch the resolved view,
    // coalescing bursts into one `specialist.list` call.
    const removeNotificationListener = onBackendNotification((n) => {
      if ((n.method === 'specialists:changed' || n.method === 'skills:changed') && !disposed) {
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
      subscriptionId = undefined;
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
