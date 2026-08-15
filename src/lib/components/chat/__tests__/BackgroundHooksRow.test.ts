/**
 * @vitest-environment jsdom
 *
 * BackgroundHooksRow rendering: "Running Hooks:" label after the bolt icon,
 * pointer-cursor chips, hover-card timing durations (next-run-in, elapsed,
 * expires-in — monorepo#1756), and the "View script" affordances (hover-card
 * link + dropdown item) that open the HookScriptModal.
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { formatTime } from '$lib/i18n/format';

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
    vi.useRealTimers();
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

  it('caps every box between the row and the chip label so long names ellipsize, not overflow', () => {
    hooksState.hooks = [makeHook({ name: 'a-very-long-hook-name-that-would-overflow-a-narrow-row' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const chip = screen.getByTestId('background-hook-chip');
    // The chip clips overflow, caps its own width, and its label ellipsizes
    expect(chip.className).toContain('overflow-hidden');
    expect(chip.className).toContain('max-w-full');
    expect(chip.querySelector('.truncate')).toBeTruthy();
    // The cap must propagate up the trigger chain: the Tooltip trigger span
    // and the DropdownMenu root div (the wrap-row's actual flex item) both
    // need max-w-full — otherwise the flex item's automatic minimum size
    // floors at the full nowrap label width and the chip pokes out of a
    // narrow row instead of ellipsizing.
    const tooltipTrigger = chip.closest('span.inline-flex') as HTMLElement;
    expect(tooltipTrigger).toBeTruthy();
    expect(tooltipTrigger.className).toContain('max-w-full');
    const dropdownRoot = chip.closest('div.relative.inline-block') as HTMLElement;
    expect(dropdownRoot).toBeTruthy();
    expect(dropdownRoot.className).toContain('max-w-full');
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

  it('hover card shows next-run and elapsed as durations with absolute-time titles', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const trigger = document.querySelector('[data-tooltip-trigger]') as HTMLElement;
    await fireEvent.focus(trigger);

    const hoverCard = await waitFor(() => screen.getByTestId('background-hook-hover-card'));
    // now 10:03:00Z, nextRunAt 10:06:00Z, createdAt 10:00:00Z
    expect(hoverCard.textContent).toContain('Next run: in 3m');
    expect(hoverCard.textContent).toContain('Elapsed: 3m');
    // Absolute wall-clock times survive as secondary native titles
    const nextRunSpan = Array.from(hoverCard.querySelectorAll('span[title]')).find((el) =>
      el.textContent?.includes('Next run'),
    );
    expect(nextRunSpan?.getAttribute('title')).toBe(
      formatTime('2026-07-31T10:06:00Z', { seconds: true }),
    );
  });

  it('hover card elapsed counts from lastRunAt when the hook has already run', async () => {
    hooksState.hooks = [makeHook({ lastRunAt: '2026-07-31T10:02:00Z' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const trigger = document.querySelector('[data-tooltip-trigger]') as HTMLElement;
    await fireEvent.focus(trigger);

    const hoverCard = await waitFor(() => screen.getByTestId('background-hook-hover-card'));
    expect(hoverCard.textContent).toContain('Elapsed: 1m');
  });

  it('hover card shows the TTL as an expires-in duration when expiresAt is set', async () => {
    hooksState.hooks = [makeHook({ expiresAt: '2026-07-31T11:00:00Z' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const trigger = document.querySelector('[data-tooltip-trigger]') as HTMLElement;
    await fireEvent.focus(trigger);

    const hoverCard = await waitFor(() => screen.getByTestId('background-hook-hover-card'));
    // now 10:03:00Z → expiresAt 11:00:00Z = 57m remaining
    expect(hoverCard.textContent).toContain('TTL: expires in 57m');
    const ttlSpan = Array.from(hoverCard.querySelectorAll('span[title]')).find((el) =>
      el.textContent?.includes('TTL'),
    );
    expect(ttlSpan?.getAttribute('title')).toBe(
      formatTime('2026-07-31T11:00:00Z', { seconds: true }),
    );
  });

  it('hover card shows a minutes-and-seconds expires-in duration when not whole minutes', async () => {
    hooksState.hooks = [makeHook({ expiresAt: '2026-07-31T10:12:30Z' })];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const trigger = document.querySelector('[data-tooltip-trigger]') as HTMLElement;
    await fireEvent.focus(trigger);

    const hoverCard = await waitFor(() => screen.getByTestId('background-hook-hover-card'));
    expect(hoverCard.textContent).toContain('TTL: expires in 9m 30s');
  });

  it('omits the TTL line when expiresAt is missing (legacy hook)', async () => {
    hooksState.hooks = [makeHook()];
    render(BackgroundHooksRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const trigger = document.querySelector('[data-tooltip-trigger]') as HTMLElement;
    await fireEvent.focus(trigger);

    const hoverCard = await waitFor(() => screen.getByTestId('background-hook-hover-card'));
    expect(hoverCard.textContent).not.toContain('TTL:');
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
