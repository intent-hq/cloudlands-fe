import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceTerminals } from './workspace-terminal';
import { store } from '@/store';
import { terminalInteractionSaga } from '@/store/terminals/sagas/terminal-interaction-saga';
import { selectTerminalContext } from '@/store/terminals/terminals-selectors';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { createAdmittedLegacyPrincipal } from '../../../../../src/test/fixtures/admitted-legacy-principal';
import {
  setWorkspaceEntity,
  setWorkspaceHasLoaded,
} from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { workspaceMounted } from '../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { terminalViewOpened } from '../../../../../src/store/renderer/slices/terminals/terminals-slice';
import type { TerminalEngineOptions } from '../../../../../src/features/terminal/terminal-engine-options';
import type { Workspace } from '$shared/types';

const runtime = vi.hoisted(() => ({
  request: vi.fn(),
  engines: [] as Array<{
    options: TerminalEngineOptions;
    dispose: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock('@/features/backend/backend-transport', () => ({
  backend: { backendRequest: runtime.request },
}));
vi.mock('../../../../../src/features/terminal/TerminalEngine', () => ({
  TerminalEngine: class {
    dispose = vi.fn();
    focus = vi.fn();
    constructor(public options: TerminalEngineOptions) {
      runtime.engines.push(this);
    }
    async initialize() {
      this.options.onReady?.();
    }
  },
}));
const ws = 'terminal-host';
async function settleFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}
let dispose: () => void,
  stop: () => void,
  root: ReturnType<typeof createRoot>,
  container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  runtime.engines.length = 0;
  runtime.request.mockReset().mockImplementation(async (method, _params, options) => {
    options?.onDispatch?.();
    if (method === 'terminal.list') return { terminals: [{ id: 'genuine-pty', name: 'Terminal' }] };
    return { ok: true };
  });
  dispose = store.init(createAdmittedLegacyPrincipal());
  store.dispatch(
    setWorkspaceEntity({ id: ws, myRole: 'owner', worktreePath: '/owned/terminal' } as Workspace),
  );
  store.dispatch(
    setWorkspaceHasLoaded(
      true,
      store.state.connections.windowBackendId,
      selectPrincipalActionContext.select(store.state),
    ),
  );
  store.dispatch(workspaceMounted(ws));
  stop = store.runSaga(terminalInteractionSaga);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<WorkspaceTerminals workspaceId={ws} />));
  await settleFrame();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  stop();
  dispose();
  vi.unstubAllGlobals();
});
it('fences a retained editor callback immediately when another view owns the same workspace', async () => {
  await vi.waitFor(() =>
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === 'Open')).toBe(
      true,
    ),
  );
  await act(async () =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Open')!.click(),
  );
  await settleFrame();
  await vi.waitFor(() => expect(runtime.engines).toHaveLength(1));
  const engine = runtime.engines[0];
  expect(engine.options.autoFocus).toBe(false);
  runtime.request.mockClear();
  await act(async () => {
    store.dispatch(
      terminalViewOpened(ws, selectTerminalContext.select(store.state, ws)!, 'replacement-view'),
    );
    expect(engine.options.isCurrent?.()).toBe(false);
    await expect(
      engine.options.terminals.write('genuine-pty', 'late input', ws),
    ).resolves.toMatchObject({ success: false });
  });
  await settleFrame();
  expect(runtime.request).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(engine.dispose).toHaveBeenCalledWith({ killPty: false }));
  expect(container.querySelector('[data-testid="workspace-terminal-view"]')).toBeNull();
});
