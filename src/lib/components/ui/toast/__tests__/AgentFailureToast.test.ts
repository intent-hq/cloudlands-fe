/**
 * AgentFailureToast component regression test (PR #385 review).
 *
 * Two failed agents can resolve to the IDENTICAL "Name — Workspace" string
 * (same-named agents in one workspace). Keying the detail-lines each block by
 * the line text raised Svelte 5's `each_key_duplicate` and crashed the toast
 * in exactly the multi-failure scenario the feature targets — lines are keyed
 * by agentId instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import AgentFailureToast from '../AgentFailureToast.svelte';

describe('AgentFailureToast', () => {
  afterEach(cleanup);

  it('renders duplicate "Name — Workspace" lines without a keyed-each crash', () => {
    expect(() =>
      render(AgentFailureToast, {
        props: {
          title: '2 agents failed',
          errorSummary: 'spawn failed: EPERM',
          detailLines: [
            { key: 'agent-1', label: 'Implementor — Fix login' },
            { key: 'agent-2', label: 'Implementor — Fix login' },
          ],
          retryLabel: 'Retry All 2 Agents',
          retrying: false,
          onRetry: vi.fn(),
          onClose: vi.fn(),
        },
      }),
    ).not.toThrow();

    expect(screen.getAllByText('Implementor — Fix login')).toHaveLength(2);
  });
});
