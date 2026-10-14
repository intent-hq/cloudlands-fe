// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  transientUiReducer,
  setChatDraft,
} from '../../../../../src/store/renderer/slices/transient-ui/transient-ui-slice';
import { getChatDraft } from '../../../../../src/store/renderer/slices/transient-ui/transient-ui-projections';
import { useWorkspaceViewLifetime } from './workspace-view-lifetime';
const authority = vi.hoisted(() => ({
  backend: 'backend-a',
  principal: 'alice' as string | undefined,
  revoked: false,
  dispatch: vi.fn(),
}));
vi.mock('@/store', () => ({ store: { dispatch: authority.dispatch } }));
vi.mock('@/store/connections/connections-selectors', () => ({
  selectCurrentConnectionId: () => ({ value: authority.backend }),
}));
vi.mock('@/store/principal/principal-selectors', () => ({
  selectPrincipalSnapshot: () => ({
    value: authority.principal ? { principal: { id: authority.principal } } : null,
  }),
  selectPrincipalRevoked: () => ({ value: authority.revoked }),
}));
let state: ReturnType<typeof transientUiReducer>;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
function View({
  workspaceId = 'workspace',
  denied = false,
}: {
  workspaceId?: string;
  denied?: boolean;
}) {
  useWorkspaceViewLifetime(workspaceId, denied);
  return null;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  authority.backend = 'backend-a';
  authority.principal = 'alice';
  authority.revoked = false;
  state = transientUiReducer(undefined, { type: 'init' });
  authority.dispatch.mockImplementation((action) => {
    state = transientUiReducer(state, action);
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
async function render(props = {}) {
  await act(async () => root.render(<View {...props} />));
}
function edit() {
  authority.dispatch(setChatDraft('workspace', 'agent', 'not yet acknowledged'));
}
function draft() {
  return getChatDraft({ transientUi: state }, 'workspace', 'agent');
}
it('retains unsaved input across temporary disconnection and the same principal reconnect', async () => {
  await render();
  edit();
  authority.principal = undefined;
  await render();
  expect(draft()).toBe('not yet acknowledged');
  authority.principal = 'alice';
  await render();
  expect(draft()).toBe('not yet acknowledged');
  await render({ workspaceId: 'other' });
  expect(draft()).toBe('');
});
it('retires input before a different principal or backend can reuse the mounted route', async () => {
  await render();
  edit();
  authority.principal = undefined;
  await render();
  authority.principal = 'bob';
  await render();
  expect(draft()).toBe('');
  edit();
  authority.backend = 'backend-b';
  await render();
  expect(draft()).toBe('');
});
it('retires input on explicit revocation and admitted workspace removal', async () => {
  await render();
  edit();
  authority.revoked = true;
  await render();
  expect(draft()).toBe('');
  authority.revoked = false;
  await render();
  edit();
  await render({ denied: true });
  expect(draft()).toBe('');
});
