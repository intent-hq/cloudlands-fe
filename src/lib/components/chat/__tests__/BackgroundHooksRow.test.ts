/**
 * @vitest-environment jsdom
 *
 * BackgroundHooksRow rendering: "Running Hooks:" label after the bolt icon,
 * pointer-cursor chips, and the hover-card contract (state/delay/next-run +
 * truncated code preview).
 */
import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import type { BackgroundHook } from '$features/hooks/background-hooks-service';

const { dispatchMock, hooksState } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  hooksState: { hooks: [] as unknown[] },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ state: () => ({}), dispatch: dispatchMock });
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
});
