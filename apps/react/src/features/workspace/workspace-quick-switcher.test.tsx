import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from '@tanstack/react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { store } from '@/store';
import { WorkspaceQuickSwitcher } from './workspace-quick-switcher';
import { WorkspaceFileNavigation } from './workspace-file-navigation';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
  removeWorkspaceEntity,
  workspaceListReadStatusChanged,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import {
  setAgents,
  workspaceAgentMetadataStatusChanged,
} from '../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  loadFileContentSucceeded,
  updateFileContent,
} from '../../../../../src/store/renderer/slices/files/files-slice';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import {
  bulkUpsertSessions,
  updateSession,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { AgentStatus } from '$shared/types/agent.types';
import type { Workspace, AgentSession } from '$shared/types';
let root: ReturnType<typeof createRoot>, host: HTMLDivElement, dispose: () => void, context: string;
let router: ReturnType<typeof makeRouter>;
function FileHost() {
  const { workspaceId } = useParams({ strict: false });
  const editor = useRef<HTMLDivElement>(null);
  return (
    <div ref={editor}>
      <h1>{workspaceId}</h1>
      <textarea aria-label="Editor" />
      <WorkspaceFileNavigation workspaceId={workspaceId!} path="a.txt" editorHost={editor} />
    </div>
  );
}
function makeRouter(path = '/workspaces') {
  const parent = createRootRoute({
    component: () => (
      <>
        <WorkspaceQuickSwitcher />
        <Outlet />
      </>
    ),
  });
  const home = createRoute({
    getParentRoute: () => parent,
    path: '/workspaces',
    component: () => <h1>Home</h1>,
  });
  const workspace = createRoute({
    getParentRoute: () => parent,
    path: '/workspaces/$workspaceId',
    component: FileHost,
  });
  return createRouter({
    routeTree: parent.addChildren([home, workspace]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
}
async function render(path?: string) {
  router = makeRouter(path);
  await act(async () => {
    await router.load();
    root.render(<RouterProvider router={router} />);
  });
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 35));
  });
}
function button(text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(text),
  )!;
}
async function click(node: HTMLElement) {
  await act(async () => node.click());
  await settle();
}
async function query(value: string) {
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  return input;
}
async function key(node: Element, key: string, extra: KeyboardEventInit = {}) {
  await act(async () =>
    node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...extra })),
  );
  await settle();
}
function option(id: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((n) =>
    n.textContent?.includes(id),
  )!;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  dispose = store.init(createAdmittedLegacyPrincipal());
  context = selectPrincipalActionContext.select(store.state)!;
  for (const [id, title] of [
    ['alpha', 'Alpine plans'],
    ['beta', 'Beta project'],
  ])
    store.dispatch(
      setWorkspaceEntity({
        id: WorkspaceId(id),
        title,
        myRole: 'owner',
        worktreePath: '/owned/' + id,
      } as Workspace),
    );
  store.dispatch(setWorkspaceHasLoaded(true, store.state.connections.windowBackendId, context));
  store.dispatch(
    loadFileContentSucceeded(
      'alpha',
      'a.txt',
      '/owned/alpha/a.txt',
      { kind: 'editable-text', content: 'original' },
      false,
    ),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('opens with the effective shortcut, fuzzy matches canonically, restores focus on Escape and navigates with keyboard', async () => {
  await render();
  const opener = button('Quick switcher');
  opener.focus();
  await key(opener, 'k', { ctrlKey: true });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  const input = await query('alpl');
  expect(option('alpha')).toBeTruthy();
  expect(option('beta')).toBeUndefined();
  await key(input, 'Escape');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
  await click(opener);
  const search = await query('Beta');
  await key(search, 'ArrowDown');
  await key(search, 'Enter');
  expect(router.state.location.pathname).toBe('/workspaces/beta');
});
it('waits for a current complete conversation snapshot and distinguishes duplicate names by ID', async () => {
  const sessions = [
    {
      id: AgentId('agent-one'),
      workspaceId: WorkspaceId('alpha'),
      name: 'Same name',
      messages: [],
      status: AgentStatus.Active,
      backendSessionId: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    {
      id: AgentId('agent-two'),
      workspaceId: WorkspaceId('alpha'),
      name: 'Same name',
      messages: [],
      status: AgentStatus.Active,
      backendSessionId: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  ] as AgentSession[];
  store.dispatch(bulkUpsertSessions(sessions));
  store.dispatch(setAgents('alpha', sessions));
  await render('/workspaces/alpha');
  await click(button('Quick switcher'));
  expect(option('agent-one')).toBeUndefined();
  await act(async () =>
    store.dispatch(workspaceAgentMetadataStatusChanged('alpha', { context, status: 'ready' })),
  );
  await settle();
  expect(option('agent-one')).toBeTruthy();
  expect(option('agent-two')).toBeTruthy();
  await click(option('agent-two'));
  expect(router.state.location.search).toMatchObject({ agent: 'agent-two' });
});
it('rejects a removed row before selector delivery and preserves the current route', async () => {
  await render();
  await click(button('Quick switcher'));
  const stale = option('beta');
  await act(async () => {
    store.dispatch(removeWorkspaceEntity('beta'));
    stale.click();
  });
  await settle();
  expect(router.state.location.pathname).toBe('/workspaces');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('unavailable');
});
it('uses the real dirty-navigation Stay and Discard owner', async () => {
  await render('/workspaces/alpha?file=a.txt');
  await act(async () =>
    store.dispatch(
      updateFileContent(
        'alpha',
        'a.txt',
        { kind: 'editable-text', content: 'dirty' },
        { autoSave: false },
      ),
    ),
  );
  await settle();
  await click(button('Quick switcher'));
  await click(option('beta'));
  expect(button('Stay')).toBeTruthy();
  await click(button('Stay'));
  expect(router.state.location.pathname).toBe('/workspaces/alpha');
  await click(button('Quick switcher'));
  await click(option('beta'));
  await click(button('Discard'));
  expect(router.state.location.pathname).toBe('/workspaces/beta');
});
it('leaves IME, claimed events, editors and other dialogs in control of their keys', async () => {
  await render();
  const opener = button('Quick switcher');
  await key(opener, 'k', { ctrlKey: true, isComposing: true });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const terminal = document.createElement('textarea');
  terminal.className = 'xterm-helper-textarea';
  host.append(terminal);
  await key(terminal, 'k', { ctrlKey: true });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const editor = document.createElement('div');
  editor.className = 'monaco-editor';
  host.append(editor);
  await key(editor, 'k', { ctrlKey: true });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click(opener);
  const input = document.querySelector('[role="combobox"]')!;
  await key(input, 'k', { ctrlKey: true });
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
});
it('shows a list failure without claiming an empty successful result and offers canonical retry', async () => {
  store.dispatch(workspaceListReadStatusChanged(context, 'error'));
  await render();
  await click(button('Quick switcher'));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('unavailable');
  expect(button('Retry')).toBeTruthy();
});

it.each(['workspace', 'conversation'])(
  'keeps %s Retry reachable by pointer and keyboard without clearing query',
  async (kind) => {
    if (kind === 'workspace') store.dispatch(workspaceListReadStatusChanged(context, 'error'));
    else
      store.dispatch(
        workspaceAgentMetadataStatusChanged('alpha', {
          context,
          status: 'error',
          error: 'Unavailable',
        }),
      );
    await render('/workspaces/alpha');
    await click(button('Quick switcher'));
    const input = await query('beta');
    await key(input, 'Tab', { shiftKey: true });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(input.value).toBe('beta');
    const retry = button('Retry');
    retry.focus();
    expect(document.activeElement).toBe(retry);
    await act(async () => {
      retry.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      retry.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
      retry.click();
    });
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(input.value).toBe('beta');
  },
);
it('excludes pre-retired conversations and rejects retirement before selector delivery', async () => {
  const sessions = ['agent-one', 'agent-two'].map((id) => ({
    id: AgentId(id),
    workspaceId: WorkspaceId('alpha'),
    name: 'Same name',
    messages: [],
    status: AgentStatus.Active,
    backendSessionId: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...(id === 'agent-two' ? { retiredAt: '2026-01-02' } : {}),
  }));
  store.dispatch(bulkUpsertSessions(sessions));
  store.dispatch(setAgents('alpha', sessions));
  store.dispatch(workspaceAgentMetadataStatusChanged('alpha', { context, status: 'ready' }));
  await render('/workspaces/alpha');
  await click(button('Quick switcher'));
  expect(option('agent-two')).toBeUndefined();
  const captured = option('agent-one');
  expect(captured).toBeTruthy();
  await act(async () => {
    store.dispatch(updateSession(AgentId('agent-one'), { retiredAt: '2026-01-02' }));
    captured.click();
  });
  await settle();
  expect(router.state.location.search).not.toHaveProperty('agent');
  expect(option('agent-one')).toBeUndefined();
});
it('rejects a captured cross-workspace selection when its originating root retires before render', async () => {
  await render('/workspaces/alpha');
  await click(button('Quick switcher'));
  const captured = option('beta');
  await act(async () => {
    store.dispatch(
      setWorkspaceEntity({
        id: WorkspaceId('alpha'),
        title: 'Alpine plans',
        myRole: 'owner',
        worktreePath: '/owned/replaced-alpha',
      } as Workspace),
    );
    captured.click();
  });
  await settle();
  expect(router.state.location.pathname).toBe('/workspaces/alpha');
});
