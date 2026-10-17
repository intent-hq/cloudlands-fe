import { describe, expect, it, vi } from 'vitest';

const entryPoints = {
  clients: () => import('../browser-clients/browser-clients-slice'),
  registry: () => import('./browser-tab-registry-slice'),
  layout: () => import('../panel-layout/panel-layout-slice'),
};

describe('browser recovery module initialization', () => {
  it.each(['clients', 'registry', 'layout'] as const)(
    'registers the snapshot reducers when %s is imported first',
    async (entryPoint) => {
      vi.resetModules();
      await entryPoints[entryPoint]();
      const { browserTabSnapshotReceived } = await entryPoints.clients();
      const { browserTabRegistryReducer, initialState } = await entryPoints.registry();
      await entryPoints.layout();

      const next = browserTabRegistryReducer(
        initialState,
        browserTabSnapshotReceived('workspace', [], 'client', [], {}, 123),
      );
      expect(next.byWorkspaceId.workspace.phase).toBe('applied');
    },
  );
});
