import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { openTerminalOverlay } from '$store/renderer/slices/terminals/terminals-slice';

const dispatch = vi.hoisted(() => vi.fn());

vi.mock('$lib/components/terminal/Terminal.svelte', async () => ({
  default: (await import('./mocks/MockTerminal.svelte')).default,
}));
vi.mock('$lib/components/terminal/ScriptOutputViewer.svelte', async () => ({
  default: (await import('./mocks/MockTerminal.svelte')).default,
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch });
});

import TerminalTabTypeHeaderHarness from './mocks/TerminalTabTypeHeaderHarness.svelte';

const action = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>('[data-move-to-bottom-bar]');

describe('TerminalTabType header action lifecycle', () => {
  beforeEach(() => dispatch.mockClear());
  afterEach(cleanup);

  it('clears the terminal action when a cached browser tab becomes active', async () => {
    const view = render(TerminalTabTypeHeaderHarness, {
      props: { activeTabId: 'terminal-tab-1' },
    });
    await waitFor(() => expect(action(view.container)).not.toBeNull());

    await view.rerender({ activeTabId: 'browser-tab' });

    await waitFor(() => expect(action(view.container)).toBeNull());
  });

  it.each([
    ['terminal-tab-1', 'terminal-tab-2', 'terminal-session-2'],
    ['terminal-tab-2', 'terminal-tab-1', 'terminal-session-1'],
  ])('reassigns the action from %s to %s', async (from, to, terminalId) => {
    const view = render(TerminalTabTypeHeaderHarness, { props: { activeTabId: from } });
    await waitFor(() => expect(action(view.container)).not.toBeNull());

    await view.rerender({ activeTabId: to });
    dispatch.mockClear();
    await fireEvent.click(action(view.container)!);

    expect(dispatch).toHaveBeenCalledWith(openTerminalOverlay('workspace-1', terminalId));
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: closeTab.type,
        payload: expect.objectContaining({ wsId: 'layout-1', tabId: to }),
      }),
    );
  });

  it('clears an active terminal registration when that tab unmounts', async () => {
    const view = render(TerminalTabTypeHeaderHarness, {
      props: { activeTabId: 'terminal-tab-1' },
    });
    await waitFor(() => expect(action(view.container)).not.toBeNull());

    await view.rerender({ activeTabId: 'terminal-tab-1', firstMounted: false });

    await waitFor(() => expect(action(view.container)).toBeNull());
  });
});
