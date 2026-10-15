import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { agentCreationSaga } from './agent-creation-saga';
import { createAdmittedLegacyPrincipal } from '../../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { principalContextChanged } from '../../../../../../src/store/renderer/slices/principal/principal-slice';
import {
  ensureWorkspaceCatalogRequested,
  workspaceCatalogReceived,
  workspaceCatalogReadFailed,
} from '../../../../../../src/store/renderer/slices/provider-catalog/provider-catalog-slice';
import type { WorkspaceCatalogSnapshot } from '../../../../../../src/store/renderer/slices/provider-catalog/provider-catalog-types';
import { createAgentFromConfigRequested } from '../../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice';
import { selectAgentCreationResource } from '../workspace-agents-selectors';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
import { call, takeEvery } from 'typed-redux-saga';

const factory = vi.hoisted(() => ({ createAgent: vi.fn() }));
vi.mock('@/features/agent/agent-factory', () => ({ agentFactory: factory }));
const id = WorkspaceId('workspace');
const stops: Array<() => void> = [];
const demands: string[] = [];
const snapshot: WorkspaceCatalogSnapshot = {
  catalog: { providers: [] },
  readiness: {},
  specialists: [],
  settings: [
    { path: 'model.defaultProvider', value: 'codex' },
    { path: 'model.default', value: 'configured-model' },
  ] as WorkspaceCatalogSnapshot['settings'],
};
function request() {
  const resource = selectAgentCreationResource.select(store.state, id);
  expect(resource).toBeTruthy();
  const action = createAgentFromConfigRequested(
    id,
    { workspaceId: id, source: 'workspace-general' },
    {
      consumer: { id: 'creation-control', resourceId: resource! },
      protectUncertainCreation: true,
      activateAgent: false,
      notifyOnError: false,
    },
  );
  void action.promise.catch(() => undefined);
  store.dispatch(action);
  return action.promise;
}
beforeEach(() => {
  stops.push(store.init(createAdmittedLegacyPrincipal()));
  store.dispatch(
    setWorkspaceEntity({ id, myRole: 'owner', path: '/owned/workspace' } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  factory.createAgent.mockReset().mockResolvedValue({ success: false, error: 'definite refusal' });
  demands.length = 0;
  stops.push(
    store.runSaga(function* () {
      yield* takeEvery(ensureWorkspaceCatalogRequested, function* ({ payload: [workspaceId] }) {
        yield* call([demands, demands.push], workspaceId);
      });
    }),
  );
  stops.push(store.runSaga(agentCreationSaga));
});
afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
});

describe('connected creation canonical catalog demand', () => {
  it('waits for the shared catalog before using the configured model', async () => {
    const result = request();
    expect(demands).toEqual([id]);
    expect(factory.createAgent).not.toHaveBeenCalled();
    store.dispatch(workspaceCatalogReceived(id, snapshot, 0));
    await expect(result).rejects.toThrow('definite refusal');
    expect(factory.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id }),
      expect.objectContaining({ model: 'configured-model' }),
      expect.anything(),
    );
  });
  it('reuses a fresh catalog without another read', async () => {
    store.dispatch(workspaceCatalogReceived(id, snapshot, 0));
    await expect(request()).rejects.toThrow('definite refusal');
    expect(demands).toEqual([]);
    expect(factory.createAgent).toHaveBeenCalledOnce();
  });
  it('settles a failed catalog read without dispatching a create and allows retry', async () => {
    const result = request();
    store.dispatch(workspaceCatalogReadFailed(id));
    await expect(result).rejects.toThrow();
    expect(factory.createAgent).not.toHaveBeenCalled();
    store.dispatch(workspaceCatalogReceived(id, snapshot, 0));
    await expect(request()).rejects.toThrow('definite refusal');
    expect(factory.createAgent).toHaveBeenCalledOnce();
  });
  it('rejects a late catalog after principal retirement without creation', async () => {
    const result = request();
    store.dispatch(principalContextChanged(null));
    store.dispatch(workspaceCatalogReceived(id, snapshot, 0));
    await expect(result).rejects.toThrow();
    expect(factory.createAgent).not.toHaveBeenCalled();
  });
});
