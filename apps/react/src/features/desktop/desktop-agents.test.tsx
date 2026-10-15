import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { DesktopAgents } from './desktop-agents';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { bulkUpsertSessions } from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import {
  setAgents,
  workspaceAgentMetadataStatusChanged,
} from '../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice';
import { openWorkspaceTab } from '../../../../../src/store/renderer/slices/tab-state/tab-state-slice';
import { resetLayout } from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import { selectDesktopLayout } from '@/store/desktop/desktop-selectors';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus, type Workspace, type AgentSession } from '$shared/types';
const ui = vi.hoisted(() => ({
  click: undefined as undefined | ((e: { metaKey: boolean; ctrlKey: boolean }) => void),
}));
vi.mock('@/components/ui/button', async (original) => {
  const actual = await original<typeof import('@/components/ui/button')>();
  return {
    ...actual,
    Button: (props: any) => {
      if (props['data-agent-panel-row']) ui.click = props.onClick;
      return <actual.Button {...props} />;
    },
  };
});
const ws = WorkspaceId('reviewer-sidebar'),
  agent = AgentId('reviewer-agent');
let dispose: () => void, root: ReturnType<typeof createRoot>, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(setWorkspaceEntity({ id: ws, title: 'Review', myRole: 'owner' } as Workspace));
  const context = selectPrincipalActionContext.select(store.state)!;
  store.dispatch(setWorkspaceHasLoaded(true, store.state.connections.windowBackendId, context));
  const session = {
    id: agent,
    workspaceId: ws,
    name: 'Review agent',
    status: AgentStatus.RuntimeIdle,
    messages: [],
    createdAt: '2026-10-15T18:00:00Z',
    updatedAt: '2026-10-15T18:00:00Z',
    backendSessionId: null,
  } as AgentSession;
  store.dispatch(bulkUpsertSessions([session]));
  store.dispatch(setAgents(ws, [session]));
  store.dispatch(workspaceAgentMetadataStatusChanged(ws, { context, status: 'ready' }));
  store.dispatch(resetLayout(ws));
  store.dispatch(openWorkspaceTab(ws));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  ui.click = undefined;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  dispose();
  vi.unstubAllGlobals();
});
const render = (active = true) =>
  act(async () =>
    root.render(
      <DesktopAgents
        workspaceId={ws}
        active={active}
        onClose={() => {}}
        onUnavailable={() => {}}
      />,
    ),
  );
function opened() {
  return Object.values(selectDesktopLayout.select(store.state, ws).panels)
    .flatMap((p) => p.tabs)
    .some((t) => t.agentId === agent);
}
const event = { metaKey: false, ctrlKey: false };
it('positive control: a live row opens the canonical agent tab', async () => {
  await render();
  expect(ui.click).toBeTypeOf('function');
  await act(async () => ui.click!(event));
  expect(opened()).toBe(true);
});
it('rejects captured sidebar callback after workspace switch before React emission', async () => {
  await render();
  const click = ui.click!;
  await act(async () => {
    store.dispatch(openWorkspaceTab('reviewer-other'));
    click(event);
  });
  expect(opened()).toBe(false);
});
it('rejects captured sidebar callback after the component is parked', async () => {
  await render();
  const click = ui.click!;
  await render(false);
  await act(async () => click(event));
  expect(opened()).toBe(false);
});
it('rejects captured sidebar callback after the component unmounts', async () => {
  await render();
  const click = ui.click!;
  await act(async () => root.unmount());
  await act(async () => click(event));
  expect(opened()).toBe(false);
});
