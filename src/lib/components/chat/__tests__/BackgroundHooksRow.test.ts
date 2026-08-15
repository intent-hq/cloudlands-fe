/**
 * @vitest-environment jsdom
 *
 * BackgroundHooksRow rendering: "Running Hooks:" label after the bolt icon,
 * pointer-cursor chips, hover-card timing durations (next-run-in, elapsed,
 * expires-in — monorepo#1756), and the "View script" affordances (hover-card
 * link + dropdown item) that open the canonical hook-script panel.
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BackgroundHook } from '$features/hooks/background-hooks-service';

const { dispatchMock, hooksState, openHookTabMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  hooksState: { hooks: [] as unknown[] },
  openHookTabMock: vi.fn(),
}));

vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: () => ({
    getPanelIds: () => ['agent-panel'],
    getPanel: () => ({
      id: 'agent-panel',
      activeTabId: 'agent-tab',
      tabs: [{ id: 'agent-tab', type: 'agent', agentId: 'agent-1' }],
    }),
    openTabInAdjacentOrSplit: openHookTabMock,
  }),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
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
  beforeEach(() => {
    // Freeze only Date so hover-card durations are deterministic; real
    // timers keep waitFor/bits-ui polling functional.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-31T10:03:00Z'));
  });

  afterEach(() => {
    cleanup();
    dispatchMock.mockClear();
    openHookTabMock.mockClear();
    vi.useRealTimers();
  });

  it('renders a normalized inline disclosure row', () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const row = screen.getByTestId('background-hooks-row');
    expect(row).toBeTruthy();
    const summary = screen.getByTestId('background-hook-summary');
    const line = summary.closest('[data-hook-state]')?.firstElementChild;
    expect(summary.textContent).toContain('ci-watch');
    expect(line?.className).toContain('min-h-9');
    expect(line?.className).toContain('gap-2');
    expect(line?.className).toContain('px-3');
  });

  it('gives hook chips a pointer cursor', () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const chip = screen.getByTestId('background-hook-chip');
    expect(chip.className).toContain('cursor-pointer');
  });

  it('caps the restored disclosure summary so long names ellipsize, not overflow', () => {
    hooksState.hooks = [
      makeHook({ name: 'a-very-long-hook-name-that-would-overflow-a-narrow-row' }),
    ];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const row = screen.getByTestId('background-hooks-row');
    const summary = screen.getByTestId('background-hook-summary');
    const label = summary.querySelector('.truncate') as HTMLElement;
    expect(row.className).toContain('min-w-0');
    expect(row.className).toContain('max-w-full');
    expect(summary.className).toContain('min-w-0');
    expect(summary.className).toContain('max-w-full');
    expect(summary.className).toContain('overflow-hidden');
    expect(label).toBeTruthy();
    expect(label.className).toContain('min-w-0');
    expect(label.className).toContain('flex-1');
  });

  it('renders nothing when the agent has no active hooks', () => {
    hooksState.hooks = [makeHook({ state: 'dispatched' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    expect(screen.queryByTestId('background-hooks-row')).toBeNull();
  });

  it('inline details show a "View script" link instead of a raw code preview', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));

    const link = await waitFor(() => screen.getByTestId('background-hook-view-script-link'));
    expect(link.textContent).toContain('View script');
    // Raw code preview is gone from the hover card
    const details = screen.getByTestId('background-hook-details');
    expect(details.classList.contains('hidden')).toBe(false);
    expect(details.querySelector('pre')).toBeNull();
    expect(details.textContent).not.toContain('const status');
  });

  it('inline details show compact cadence, next-run, and run-count facts', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const details = screen.getByTestId('background-hook-details');
    expect(details.textContent).toContain('Delay: 60s');
    expect(details.textContent).toContain('Next run: in 3m');
    expect(details.textContent).toContain('6 runs completed');
    expect(details.textContent).not.toContain('Elapsed:');
  });

  it('shows the singular run-count copy', async () => {
    hooksState.hooks = [makeHook({ runCount: 1 })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    expect(screen.getByTestId('background-hook-details').textContent).toContain('1 run completed');
  });

  it('hover card shows the TTL as an expires-in duration when expiresAt is set', async () => {
    hooksState.hooks = [makeHook({ expiresAt: '2026-07-31T11:00:00Z' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const hoverCard = screen.getByTestId('background-hook-details');
    // now 10:03:00Z → expiresAt 11:00:00Z = 57m remaining
    expect(hoverCard.textContent).toContain('TTL: expires in 57m');
    expect(hoverCard.textContent).not.toContain('04:00:00 AM');
  });

  it('hover card shows a minutes-and-seconds expires-in duration when not whole minutes', async () => {
    hooksState.hooks = [makeHook({ expiresAt: '2026-07-31T10:12:30Z' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const hoverCard = screen.getByTestId('background-hook-details');
    expect(hoverCard.textContent).toContain('TTL: expires in 9m 30s');
  });

  it('omits the TTL line when expiresAt is missing (legacy hook)', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const hoverCard = screen.getByTestId('background-hook-details');
    expect(hoverCard.textContent).not.toContain('TTL:');
  });

  it('inline details link opens the hook panel from the owning agent panel', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-summary'));
    const link = await waitFor(() => screen.getByTestId('background-hook-view-script-link'));
    await fireEvent.click(link);

    expect(screen.queryByTestId('hook-script-modal')).toBeNull();
    expect(openHookTabMock).toHaveBeenCalledOnce();
    expect(openHookTabMock).toHaveBeenCalledWith(
      {
        type: 'hook-script',
        title: 'Hook: ci-watch',
        workspaceId: 'ws-1',
        hookId: 'hook-1',
        closable: true,
      },
      'agent-panel',
    );
  });

  it('chip dropdown offers "View script" alongside Run now / Cancel and opens the panel', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('background-hook-chip'));

    const item = await waitFor(() => screen.getByTestId('background-hook-view-script-item'));
    expect(item.textContent).toContain('View script');
    expect(screen.getByText('Run now')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();

    await fireEvent.click(item);
    expect(openHookTabMock).toHaveBeenCalledOnce();
    expect(openHookTabMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hook-script', workspaceId: 'ws-1', hookId: 'hook-1' }),
      'agent-panel',
    );
  });
});
