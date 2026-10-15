import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceAgentName, WorkspaceAgentNameStatus } from './workspace-agent-name';
import { store } from '@/store';
import { agentRenameSaga } from '@/store/agent-session/sagas/agent-rename-saga';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { selectAgentSession } from '@/store/agent-session/agent-session-selectors';
import { selectAgentRenameOperations } from '@/store/agent-session/agent-rename-selectors';
import {
  bulkUpsertSessions,
  updateSession,
  markAgentDetailHydrated,
  clearAllSessions,
  restoreStoredSessions,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import {
  workspaceMounted,
  workspaceUnmounted,
} from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import type { Workspace, AgentSession } from '$shared/types';
const transport = vi.hoisted(() => ({ backendRequest: vi.fn() }));
vi.mock('@/features/backend/backend-transport', () => ({ backend: transport }));
const ws = 'rename-workspace',
  agent = 'rename-agent';
let dispose: () => void,
  stop: () => void,
  root: ReturnType<typeof createRoot>,
  container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({
      id: ws,
      title: 'Workspace',
      myRole: 'owner',
      worktreePath: '/owned/repo',
    } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  store.dispatch(
    bulkUpsertSessions([{
      id: agent,
      workspaceId: ws,
      name: 'Original',
      nameExplicitlySet: false,
      messages: [],
      status: 'idle',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    } as unknown as AgentSession]),
  );
  store.dispatch(markAgentDetailHydrated(agent));
  transport.backendRequest.mockReset().mockImplementation(async (_method, params, options) => {
    options.onDispatch();
    return { success: true, name: params.name };
  });
  stop = store.runSaga(agentRenameSaga);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <>
        <h2>
          <WorkspaceAgentName workspaceId={ws} agentId={agent} />
        </h2>
        <WorkspaceAgentNameStatus workspaceId={ws} agentId={agent} />
      </>,
    ),
  );
  await vi.waitFor(() => expect(container.querySelector('button')).not.toBeNull());
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stop();
  dispose();
  vi.unstubAllGlobals();
});
async function edit(text: string) {
  await act(async () => container.querySelector('button')!.click());
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
async function key(input: HTMLInputElement, value: string) {
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })),
  );
}
const operations = () => selectAgentRenameOperations.select(store.state, agent);
it('uses actual public input for Unicode typing, noops, cancellation and single Enter plus blur', async () => {
  await key(await edit('discard'), 'Escape');
  expect(document.activeElement).toBe(container.querySelector('button'));
  await key(await edit('  '), 'Enter');
  await key(await edit(' Original '), 'Enter');
  expect(transport.backendRequest).not.toHaveBeenCalled();
  const input = await edit('');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    for (const character of 'Plan Café 日本語') {
      setter.call(input, input.value + character);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  expect(input.value).toBe('Plan Café 日本語');
  input.setSelectionRange(2, 2);
  expect(input.selectionStart).toBe(2);
  await key(input, 'Enter');
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(transport.backendRequest).toHaveBeenCalledTimes(1);
  expect(transport.backendRequest.mock.calls[0][1]).toEqual({
    agentId: agent,
    name: 'Plan Café 日本語',
    workspaceId: ws,
  });
  expect(operations().at(-1)?.status).toBe('confirmed');
  expect(selectAgentSession.select(store.state, agent)).toMatchObject({
    name: 'Plan Café 日本語',
    nameExplicitlySet: true,
  });
  await vi.waitFor(() =>
    expect(container.querySelector('h2')?.textContent).toContain('Plan Café 日本語'),
  );
});
it('keeps typed draft through authoritative ABA and declines its stale edit-start revision', async () => {
  const input = await edit('My old draft');
  await act(async () => {
    store.dispatch(updateSession(agent, { name: 'External' }));
    store.dispatch(updateSession(agent, { name: 'Original' }));
  });
  expect(input.value).toBe('My old draft');
  await key(input, 'Enter');
  expect(transport.backendRequest).not.toHaveBeenCalled();
  expect(selectAgentSession.select(store.state, agent)?.name).toBe('Original');
});
it('blocks duplicate activation while awaiting an acknowledgement and preserves a newer authoritative name', async () => {
  let resolve!: (value: unknown) => void;
  transport.backendRequest.mockImplementation(async (_method, _params, options) => {
    options.onDispatch();
    return new Promise((done) => {
      resolve = done;
    });
  });
  const input = await edit('Requested');
  await key(input, 'Enter');
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  await vi.waitFor(() => expect(container.querySelector('button')!.disabled).toBe(true));
  await act(async () => {
    store.dispatch(updateSession(agent, { name: 'Authoritative newer', nameExplicitlySet: true }));
    resolve({ success: true, name: 'Requested' });
  });
  expect(transport.backendRequest).toHaveBeenCalledTimes(1);
  expect(selectAgentSession.select(store.state, agent)?.name).toBe('Authoritative newer');
  expect(operations().at(-1)?.status).toBe('confirmed');
});
it('shows definite failure and allows a deliberate new edit while unknown prevents replay', async () => {
  transport.backendRequest.mockImplementationOnce(async (_method, _params, options) => {
    options.onDispatch();
    throw Object.assign(new Error('Rejected'), { rpcCode: -32602 });
  });
  await key(await edit('Rejected name'), 'Enter');
  await vi.waitFor(() =>
    expect(container.querySelector('[role=alert]')?.textContent).toContain('not saved'),
  );
  expect(selectAgentSession.select(store.state, agent)?.name).toBe('Original');
  transport.backendRequest.mockImplementationOnce(async (_method, _params, options) => {
    options.onDispatch();
    throw new Error('lost acknowledgement');
  });
  await key(await edit('Unknown name'), 'Enter');
  await vi.waitFor(() =>
    expect(container.querySelector('[role=alert]')?.textContent).toContain('unknown'),
  );
  expect(container.querySelector('button')!.disabled).toBe(true);
  expect(operations().at(-1)?.status).toBe('unknown');
  expect(transport.backendRequest).toHaveBeenCalledTimes(2);
});
it('declines a captured editor save after canonical departure and same-context reentry', async () => {
  const input = await edit('Stale callback');
  await act(async () => {
    store.dispatch(workspaceUnmounted(ws));
    store.dispatch(workspaceMounted(ws));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(transport.backendRequest).not.toHaveBeenCalled();
  expect(selectAgentSession.select(store.state, agent)?.name).toBe('Original');
});
it('rechecks view retirement after asynchronous preflight before any wire', async () => {
  let proceed!: () => void;
  let wire = 0;
  transport.backendRequest.mockImplementation(async (_method, params, options) => {
    await new Promise<void>((done) => {
      proceed = done;
    });
    options.onDispatch();
    wire++;
    return { success: true, name: params.name };
  });
  await key(await edit('Delayed'), 'Enter');
  await act(async () => root.render(<p>Departed</p>));
  await act(async () => proceed());
  expect(wire).toBe(0);
  expect(selectAgentSession.select(store.state, agent)?.name).toBe('Original');
  expect(operations().at(-1)?.status).toBe('failed');
});

it('rejects an edit-start callback across retirement and restoration in one render interval', async () => {
  const input = await edit('Draft before retirement');
  await act(async () => {
    store.dispatch(updateSession(agent, { retiredAt: '2026-10-15T13:00:00Z' }));
    store.dispatch(updateSession(agent, { retiredAt: undefined }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(transport.backendRequest).not.toHaveBeenCalled();
  expect(selectAgentSession.select(store.state, agent)?.name).toBe('Original');
});
it('rejects a preflight callback after retirement and restoration', async () => {
  let proceed!: () => void;
  let wire = 0;
  transport.backendRequest.mockImplementation(async (_method, params, options) => {
    await new Promise<void>((resolve) => { proceed = resolve; });
    options.onDispatch();
    wire++;
    return { success: true, name: params.name };
  });
  await key(await edit('Draft before preflight retirement'), 'Enter');
  await act(async () => {
    store.dispatch(updateSession(agent, { retiredAt: '2026-10-15T13:00:00Z' }));
    store.dispatch(updateSession(agent, { retiredAt: undefined }));
    proceed();
  });
  expect(wire).toBe(0);
  expect(selectAgentSession.select(store.state, agent)?.name).toBe('Original');
});
it('denies save while agent remains retired', async () => {
  const input = await edit('Draft before retirement');
  await act(async () => {
    store.dispatch(updateSession(agent, { retiredAt: '2026-10-15T13:00:00Z' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(transport.backendRequest).not.toHaveBeenCalled();
});
it('retains unknown across real-owner session clearing and fresh view', async () => {
  transport.backendRequest.mockImplementation(async (_method, _params, options) => {
    options.onDispatch();
    throw new Error('lost acknowledgement');
  });
  await key(await edit('Unknown receipt'), 'Enter');
  expect(operations().at(-1)?.status).toBe('unknown');
  const original = selectAgentSession.select(store.state, agent)!;
  await act(async () => {
    root.render(<p>Departed</p>);
    store.dispatch(clearAllSessions());
    store.dispatch(restoreStoredSessions([original]));
    store.dispatch(markAgentDetailHydrated(agent));
  });
  await act(async () => root.render(<WorkspaceAgentName workspaceId={ws} agentId={agent} />));
  await vi.waitFor(() => expect(container.querySelector('button')!.disabled).toBe(true));
  expect(transport.backendRequest).toHaveBeenCalledTimes(1);
  expect(operations().at(-1)?.status).toBe('unknown');
});
it('keeps the canonical name unchanged until actual acknowledgement', async () => {
  let resolve!: (value: unknown) => void;
  transport.backendRequest.mockImplementation(async (_method, _params, options) => {
    options.onDispatch();
    return new Promise((done) => { resolve = done; });
  });
  await key(await edit('Optimistic draft'), 'Enter');
  expect(selectAgentSession.select(store.state, agent)?.name).toBe('Original');
  await act(async () => resolve({ success: true, name: 'Accepted by daemon' }));
  expect(selectAgentSession.select(store.state, agent)?.name).toBe('Accepted by daemon');
});
