import type { WorkspaceEvent } from '../../../features/events/types';
import type {
  EventQueryOptions,
  EventQueryPage,
  EventQueryPageOptions,
} from '../lifecycle-read-client-types';
import type { BackendRuntime } from './backend-transport-runtime';

/** Historical event reads through the owning renderer's actual backend. */
export function createBackendEventsClient(backend: Pick<BackendRuntime, 'backendRequest'>) {
  return {
    async query(workspaceId: string, options: EventQueryOptions = {}): Promise<WorkspaceEvent[]> {
      const { backendRequest } = backend;
      const result = await backendRequest<unknown>('event.query', {
        workspaceId,
        ...options,
      });
      return Array.isArray(result) ? (result as WorkspaceEvent[]) : [];
    },

    async queryPage(
      workspaceId: string,
      options: EventQueryPageOptions = {},
    ): Promise<EventQueryPage> {
      const { backendRequest } = backend;
      return backendRequest<EventQueryPage>('event.query', {
        workspaceId,
        ...options,
        paginate: true,
      });
    },
  };
}
