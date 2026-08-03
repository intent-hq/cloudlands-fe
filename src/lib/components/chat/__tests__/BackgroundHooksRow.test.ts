/**
 * @vitest-environment jsdom
 *
 * BackgroundHooksRow rendering: "Running Hooks:" label after the bolt icon,
 * pointer-cursor chips, and the "View script" affordances (hover-card link +
 * dropdown item) that open the HookScriptModal.
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

import BackgroundHooksRow from '../BackgroundHooksRow.svelte';
import { backgroundHooksRefetchRequested } from '$store/renderer/slices/background-hooks/background-hooks-slice';

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
    nextRunAt: '2026-07-31T10:06:00Z',
    runCount: 6,
    ...overrides,
  };
}

describe('BackgroundHooksRow', () => {
  afterEach(() => {
    cleanup();
    dispatchMock.mockClear();
  });

  it('renders the "Running Hooks:" label after the bolt icon', () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const row = screen.getByTestId('background-hooks-row');
    expect(row).toBeTruthy();
    expect(screen.getByText('Running Hooks:')).toBeTruthy();
    // Label precedes the first chip in DOM order
    const label = screen.getByText('Running Hooks:');
    const chip = screen.getByTestId('background-hook-chip');
    expect(label.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('gives hook chips a pointer cursor', () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const chip = screen.getByTestId('background-hook-chip');
    expect(chip.className).toContain('cursor-pointer');
  });

  it('renders nothing when the agent has no active hooks', () => {
    hooksState.hooks = [makeHook({ state: 'dispatched' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    expect(screen.queryByTestId('background-hooks-row')).toBeNull();
  });

  it('hover card shows a "View script" link instead of a raw code preview', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const trigger = document.querySelector('[data-tooltip-trigger]') as HTMLElement;
    expect(trigger).toBeTruthy();
    // bits-ui opens the tooltip on trigger focus (no hover delay)
    await fireEvent.focus(trigger);

    const link = await waitFor(() =>
      screen.getByTestId('background-hook-view-script-link'),
    );
    expect(link.textContent).toContain('View script');
    // Raw code preview is gone from the hover card
    const hoverCard = screen.getByTestId('background-hook-hover-card');
    expect(hoverCard.querySelector('pre')).toBeNull();
    expect(hoverCard.textContent).not.toContain('const status');
  });

  it('hover-card link opens the script modal and dispatches the refetch trigger', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const trigger = document.querySelector('[data-tooltip-trigger]') as HTMLElement;
    await fireEvent.focus(trigger);
    const link = await waitFor(() =>
      screen.getByTestId('background-hook-view-script-link'),
    );
    await fireEvent.click(link);

    await waitFor(() => {
      expect(screen.getByTestId('hook-script-modal')).toBeTruthy();
    });
    expect(dispatchMock).toHaveBeenCalledWith(backgroundHooksRefetchRequested('ws-1'));
  });

  it('chip dropdown offers "View script" alongside Run now / Cancel and opens the modal', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-chip'));

    const item = await waitFor(() =>
      screen.getByTestId('background-hook-view-script-item'),
    );
    expect(item.textContent).toContain('View script');
    expect(screen.getByText('Run now')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();

    await fireEvent.click(item);
    await waitFor(() => {
      expect(screen.getByTestId('hook-script-modal')).toBeTruthy();
    });
    expect(dispatchMock).toHaveBeenCalledWith(backgroundHooksRefetchRequested('ws-1'));
  });
});
