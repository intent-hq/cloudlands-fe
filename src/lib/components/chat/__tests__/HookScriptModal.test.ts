/**
 * @vitest-environment jsdom
 *
 * HookScriptModal contract: dispatches the on-demand `hook.list` refetch on
 * open (hook:* events never carry `lastLogs`, §5.40), renders the full script
 * with JS highlighting on the Script tab, and renders `lastLogs` /
 * `lastError` / the empty state on the Logs tab.
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BackgroundHook } from '$features/hooks/background-hooks-service';

const { dispatchMock, hooksState } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  hooksState: { hooks: [] as unknown[] },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({
    state: () => ({ theme: { name: 'dark' } }),
    dispatch: dispatchMock,
  });
});

vi.mock('$store/renderer/slices/background-hooks/background-hooks-selectors', () => ({
  selectBackgroundHooks: () => ({
    subscribe: (run: (value: unknown[]) => void) => {
      run(hooksState.hooks);
      return () => {};
    },
  }),
}));

import HookScriptModal from '../HookScriptModal.svelte';
import { backgroundHooksRefetchRequested } from '$store/renderer/slices/background-hooks/background-hooks-slice';

/** PROTOCOL §5.40 Hook wire shape (`code`/`lastLogs` arrive from hook.list only). */
function makeHook(overrides: Partial<BackgroundHook> = {}): BackgroundHook {
  return {
    hookId: 'hook-1',
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    name: 'ci-watch',
    code: 'const status = await ws.ci.status();',
    delayMs: 60000,
    state: 'scheduled',
    createdAt: '2026-07-31T10:00:00Z',
    lastRunAt: '2026-07-31T10:05:00Z',
    nextRunAt: '2026-07-31T10:06:00Z',
    runCount: 6,
    lastLogs: 'checking CI\nall green',
    ...overrides,
  };
}

function renderModal() {
  return render(HookScriptModal, {
    props: { workspaceId: 'ws-1', hookId: 'hook-1', onClose: vi.fn() },
  });
}

describe('HookScriptModal', () => {
  afterEach(() => {
    cleanup();
    dispatchMock.mockClear();
  });

  it('dispatches the lastLogs refetch trigger on open', async () => {
    hooksState.hooks = [makeHook()];
    renderModal();

    await waitFor(() => {
      expect(dispatchMock).toHaveBeenCalledWith(backgroundHooksRefetchRequested('ws-1'));
    });
  });

  it('renders the hook title and the full script on the Script tab', async () => {
    hooksState.hooks = [makeHook()];
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Hook: ci-watch')).toBeTruthy();
    });
    const script = screen.getByTestId('hook-script-modal-script');
    expect(script.textContent).toContain('const status = await ws.ci.status();');
    // Highlighted (hljs spans), not a plain-text dump
    await waitFor(() => {
      expect(script.querySelector('.hljs-keyword, [class*="hljs"]')).toBeTruthy();
    });
  });

  it('renders lastLogs on the Logs tab', async () => {
    hooksState.hooks = [makeHook()];
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Last run logs')).toBeTruthy();
    });
    await fireEvent.click(screen.getByText('Last run logs'));

    const logs = screen.getByTestId('hook-script-modal-logs');
    expect(logs.textContent).toContain('checking CI');
    expect(logs.textContent).toContain('all green');
  });

  it('shows the empty state when the hook has no logs yet', async () => {
    hooksState.hooks = [makeHook({ lastLogs: undefined, lastRunAt: undefined })];
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Last run logs')).toBeTruthy();
    });
    await fireEvent.click(screen.getByText('Last run logs'));

    expect(
      screen.getByText('No logs yet — this hook has not completed a run.'),
    ).toBeTruthy();
  });

  it('shows lastError alongside the logs when present', async () => {
    hooksState.hooks = [makeHook({ lastError: 'TypeError: ws.ci is undefined' })];
    renderModal();

    await waitFor(() => {
      expect(screen.getByText('Last run logs')).toBeTruthy();
    });
    await fireEvent.click(screen.getByText('Last run logs'));

    const logs = screen.getByTestId('hook-script-modal-logs');
    expect(screen.getByText('Last error')).toBeTruthy();
    expect(logs.textContent).toContain('TypeError: ws.ci is undefined');
    expect(logs.textContent).toContain('checking CI');
  });
});
