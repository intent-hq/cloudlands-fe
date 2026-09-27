import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { initialState as workspace } from '$store/renderer/slices/workspace/workspace-slice';
import { selectPrincipalAdmissionContext } from '$store/renderer/slices/principal/principal-selectors';
import CliBlock from './CliBlock.svelte';

const mocks = vi.hoisted(() => ({
  state: {} as any,
  invoke: vi.fn(),
  listen: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mocks.state, dispatch: mocks.dispatch });
});
vi.mock('svelte-tiptap', async () => ({
  NodeViewWrapper: (await import('./__tests__/NodeViewWrapperMock.svelte')).default,
}));
vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke, listenSync: mocks.listen }));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn() },
}));

function admit(role: 'owner' | 'member' | 'guest') {
  mocks.state = withLegacyPrincipal({
    workspace: {
      ...workspace,
      hasLoaded: true,
      loadedBackendId: 'local',
      workspaces: { ids: ['ws'], map: { ws: { id: 'ws', myRole: 'owner', canManage: true } } },
    },
  });
  mocks.state.principal.snapshot.capabilities.hostMembership = true;
  mocks.state.principal.snapshot.principal.hostRole = role;
  mocks.state.principal.snapshot.principal.isAdministrator = role === 'owner';
  mocks.state.workspace.loadedPrincipalContext = selectPrincipalAdmissionContext.select(
    mocks.state,
  );
}

function mount(terminalId?: string) {
  const updateAttributes = vi.fn();
  return {
    updateAttributes,
    ...render(CliBlock, {
      props: {
        node: { attrs: { data: { id: 'cli', command: 'echo example', terminalId } } },
        extension: { options: { workspaceId: 'ws' } },
        updateAttributes,
      } as any,
    }),
  };
}

describe('CLI workspace execution authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    admit('member');
    mocks.listen.mockReturnValue(vi.fn());
  });

  it.each([undefined, 'saved-terminal'])(
    'keeps guest command text but hides terminal action %s',
    (terminal) => {
      admit('guest');
      mount(terminal);
      expect(screen.getByText('echo example')).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
      expect(mocks.invoke).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'member'] as const)(
    'runs for the current %s and records its terminal',
    async (role) => {
      admit(role);
      mocks.invoke.mockResolvedValue({ ok: true, terminalId: 'new-terminal' });
      const { updateAttributes } = mount();
      await fireEvent.click(screen.getByRole('button', { name: /^Run$/i }));
      await waitFor(() =>
        expect(updateAttributes).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ terminalId: 'new-terminal' }),
          }),
        ),
      );
      expect(mocks.invoke).toHaveBeenCalledWith(
        'terminal:createWithCommand',
        expect.objectContaining({ workspaceId: 'ws', command: 'echo example' }),
      );
    },
  );

  it.each(['lab-off', 'admission', 'backend'] as const)(
    'refuses a stale rendered Run action after %s',
    async (change) => {
      mount();
      const run = screen.getByRole('button', { name: /^Run$/i });
      if (change === 'lab-off') mocks.state.userPreferences.labsMultiplayerEnabled = false;
      if (change === 'admission') mocks.state.principal.invalidation++;
      if (change === 'backend') mocks.state.connections.windowBackendId = 'other';
      await fireEvent.click(run);
      expect(mocks.invoke).not.toHaveBeenCalled();
    },
  );

  it.each(['lab-off', 'admission', 'backend'] as const)(
    'drops a held terminal result after %s',
    async (change) => {
      let resolve!: (value: unknown) => void;
      mocks.invoke.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      const { updateAttributes } = mount();
      await fireEvent.click(screen.getByRole('button', { name: /^Run$/i }));
      expect(mocks.invoke).toHaveBeenCalledTimes(1);
      if (change === 'lab-off') mocks.state.userPreferences.labsMultiplayerEnabled = false;
      if (change === 'admission') mocks.state.principal.invalidation++;
      if (change === 'backend') mocks.state.connections.windowBackendId = 'other';
      resolve({ ok: true, terminalId: 'stale-terminal' });
      await new Promise((done) => setTimeout(done, 0));
      expect(updateAttributes).not.toHaveBeenCalled();
      expect(mocks.listen).not.toHaveBeenCalled();
    },
  );
});
