import {
  RepositoryContextSchema,
  isRepositoryContextForRequest,
  type RepositoryContextRequest,
} from '$shared/types/repository-context';
import type { RepositoryContextUpdate, Unsubscribe } from '../app-client';
import type { BoundRepositoryRoute } from './backend-transport-types';
import { captureBackendRepositoryRoute } from './backend-transport';

/** One read resource. Resolved repository facts belong only to the workspace slice. */
export function createRepositoryContextTransport(captureRoute = captureBackendRepositoryRoute) {
  return {
    async observe(
      request: RepositoryContextRequest,
      handler: (update: RepositoryContextUpdate) => void,
    ): Promise<Unsubscribe> {
      const captured = Object.freeze({ ...request });
      let active = true;
      let route: BoundRepositoryRoute | undefined;
      let stop: (() => void) | undefined;
      const close = () => {
        if (!active) return;
        active = false;
        stop?.();
        void route?.release();
      };
      const unavailable = () => {
        if (!active) return;
        try {
          handler({ type: 'unavailable', request: captured });
        } finally {
          close();
        }
      };
      // Return cancellation immediately; a late capture is disposed before any read.
      void (async () => {
        route = await captureRoute(
          captured.gitRootId === undefined
            ? { workspaceId: captured.workspaceId, kind: 'primary' }
            : {
                workspaceId: captured.workspaceId,
                kind: 'registered',
                gitRootId: captured.gitRootId,
              },
        );
        if (!active) {
          await route.release();
          return;
        }
        stop = route.onRetired(() => {
          if (!active) return;
          try {
            handler({ type: 'retired', request: captured });
          } finally {
            close();
          }
        });
        if (!active) {
          stop();
          return;
        }
        const result = await route.request('workspace.repositoryContext', {
          workspaceId: captured.workspaceId,
          ...(captured.gitRootId === undefined ? {} : { gitRootId: captured.gitRootId }),
        });
        if (!active) return;
        if (!result.current) {
          try {
            handler({ type: 'retired', request: captured });
          } finally {
            close();
          }
          return;
        }
        if (result.settlement.status !== 'fulfilled') {
          unavailable();
          return;
        }
        const context = RepositoryContextSchema.parse(result.settlement.value);
        if (!isRepositoryContextForRequest(context, captured)) {
          unavailable();
          return;
        }
        handler({ type: 'received', response: { request: captured, context } });
      })().catch(unavailable);
      return close;
    },
  };
}
