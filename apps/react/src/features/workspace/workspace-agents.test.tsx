// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  workspaceAgentsReducer,
  createAgentFromConfigRequested,
  agentCreationFinished,
} from '../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice';
import { getAgentCreationOutcome } from '../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-projections';
import { WorkspaceAgents } from './workspace-agents';
const harness = vi.hoisted(() => ({
  state: null as unknown,
  authority: 'epoch1' as string | null,
  resource: 'principal:workspace',
  navigate: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => harness.navigate }));
vi.mock('@/store', () => ({
  store: {
    get state() {
      return harness.state;
    },
    dispatch: (action: unknown) => harness.dispatch(action),
  },
}));
vi.mock('@/store/workspace-agents/workspace-agents-selectors', async () => {
  const { getAgentCreationOutcome } =
    await import('../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-projections');
  const read = (
    ...args: Parameters<typeof getAgentCreationOutcome> extends [unknown, ...infer A] ? A : never
  ) =>
    getAgentCreationOutcome(
      harness.state as Parameters<typeof getAgentCreationOutcome>[0],
      ...args,
    );
  return {
    selectAgentCreationOutcome: Object.assign(
      (...args: Parameters<typeof read>) => ({ value: read(...args) }),
      { select: getAgentCreationOutcome },
    ),
    selectAgentCreationResource: () => ({ value: harness.resource }),
    selectFilteredForegroundWorkspaceAgents: () => ({ value: [] }),
    selectAgentsLoaded: () => ({ value: true }),
  };
});
vi.mock('@/store/workspace-lifecycle/workspace-lifecycle-selectors', () => ({
  selectAdmittedWorkspaceReadContext: Object.assign(() => ({ value: harness.authority }), {
    select: () => harness.authority,
  }),
}));
vi.mock('@/components/ui/collapsible-panel', () => ({
  CollapsiblePanel: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/patterns/collection', () => ({ ListView: () => null, ListRow: () => null }));
vi.mock('@/features/agent/components/agent-avatar/agent-avatar-with-state', () => ({
  AgentAvatarWithState: () => null,
}));
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
let state: ReturnType<typeof workspaceAgentsReducer>;
const requests: ReturnType<typeof createAgentFromConfigRequested>[] = [];
async function render() {
  await act(async () => root.render(<WorkspaceAgents workspaceId="workspace" />));
}
const button = () => container.querySelector('[data-testid=workspace-agent-creation] button')! as HTMLButtonElement;
const outcome = () =>
  getAgentCreationOutcome(
    { workspaceAgents: state } as Parameters<typeof getAgentCreationOutcome>[0],
    'workspace-general:principal:workspace',
    'workspace',
    'principal:workspace',
  );
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  harness.authority = 'epoch1';
  harness.resource = 'principal:workspace';
  harness.navigate.mockReset();
  requests.length = 0;
  state = workspaceAgentsReducer(undefined, { type: 'init' });
  harness.state = { workspaceAgents: state };
  harness.dispatch.mockImplementation((action) => {
    state = workspaceAgentsReducer(state, action);
    harness.state = { workspaceAgents: state };
    if (action.type === createAgentFromConfigRequested.type) requests.push(action);
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it('blocks repeated activation synchronously and navigates to the returned ID', async () => {
  await render();
  await act(async () => {
    button().click();
    button().click();
  });
  expect(requests).toHaveLength(1);
  await render();
  expect(button().disabled).toBe(true);
  const request = requests[0];
  harness.dispatch(
    agentCreationFinished({ ...outcome()!, status: 'success', agentId: 'actual-daemon-id' }),
  );
  request.success({ id: 'actual-daemon-id' } as never);
  await render();
  expect(harness.navigate).toHaveBeenCalledTimes(1);
  const navigation = harness.navigate.mock.calls[0][0];
  expect(navigation.search({ q: 'filter', homeQuery: 'home' })).toEqual({
    q: 'filter',
    homeQuery: 'home',
    homeFilter: 'all',
    agent: 'actual-daemon-id',
  });
});
it('does not navigate from a previous mount late completion and keeps uncertainty blocked', async () => {
  await render();
  await act(async () => button().click());
  const request = requests[0];
  await act(async () => root.render(null));
  harness.dispatch(
    agentCreationFinished({ ...outcome()!, status: 'success', agentId: 'late-agent' }),
  );
  request.success({ id: 'late-agent' } as never);
  await render();
  expect(harness.navigate).not.toHaveBeenCalled();
  await act(async () => button().click());
  const retry = requests[1];
  harness.dispatch(agentCreationFinished({ ...outcome()!, status: 'uncertain' }));
  retry.failure(new Error('reply lost'));
  await render();
  expect(button().disabled).toBe(true);
  await act(async () => root.render(null));
  await render();
  expect(button().disabled).toBe(true);
  expect(requests).toHaveLength(2);
});
it('retains pending creation across same-principal reconnect without a duplicate request', async () => {
  await render();
  await act(async () => button().click());
  harness.authority = null;
  await render();
  expect(button().disabled).toBe(true);
  harness.authority = 'epoch2';
  await render();
  await act(async () => button().click());
  expect(requests).toHaveLength(1);
});
