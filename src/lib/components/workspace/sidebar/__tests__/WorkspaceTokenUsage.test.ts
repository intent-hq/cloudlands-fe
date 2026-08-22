/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import type { WorkspaceTokenUsageState } from '$store/renderer/slices/token-usage/token-usage-types';
import { emptyWorkspaceTokenUsageState } from '$store/renderer/slices/token-usage/token-usage-types';
import { warmImport } from '../../../../../test/warm-import';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });
  const selector = <T>(getter: () => T) =>
    Object.assign(() => readable(getter()), { select: getter });
  const state = {
    usage: undefined as unknown,
    agents: [] as Array<{ id: string; name?: string }>,
  };
  return { dispatch, readable, selector, state };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: mocks.dispatch,
  });
});

vi.mock('$store/renderer/slices/token-usage/token-usage-selectors', () => ({
  selectWorkspaceTokenUsage: mocks.selector(() => mocks.state.usage),
}));

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: mocks.selector(() => mocks.state.agents),
}));

function makeUsage(overrides: Partial<WorkspaceTokenUsageState>): WorkspaceTokenUsageState {
  return { ...emptyWorkspaceTokenUsageState, ...overrides };
}

function visibleText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

async function renderTokenUsage(workspaceId = 'ws-1') {
  const WorkspaceTokenUsage = (await import('../WorkspaceTokenUsage.svelte')).default;
  return render(WorkspaceTokenUsage, { props: { workspaceId } });
}

async function renderExpandedTokenUsage(workspaceId = 'ws-1') {
  const rendered = await renderTokenUsage(workspaceId);
  await fireEvent.click(screen.getByRole('button', { name: 'Expand token usage details' }));
  return rendered;
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../WorkspaceTokenUsage.svelte'));

describe('WorkspaceTokenUsage', () => {
  beforeEach(() => {
    mocks.dispatch.mockClear();
    mocks.state.usage = emptyWorkspaceTokenUsageState;
    mocks.state.agents = [];
  });

  it('renders a closed, accessible disclosure and toggles its controlled details', async () => {
    mocks.state.usage = makeUsage({
      totals: {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadTokens: 600,
        cacheCreationTokens: 100,
      },
      lastScanAt: 5000,
      isStale: false,
    });

    await renderTokenUsage();

    const disclosure = screen.getByRole('button', { name: 'Expand token usage details' });
    const detailsId = disclosure.getAttribute('aria-controls');
    expect(disclosure.tagName).toBe('BUTTON');
    expect(disclosure.getAttribute('type')).toBe('button');
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(detailsId).toBe('workspace-token-usage-details-ws-1');
    expect(disclosure.getAttribute('aria-describedby')).toBe(
      'workspace-token-usage-processed-ws-1 workspace-token-usage-cache-ws-1',
    );
    expect(document.getElementById('workspace-token-usage-processed-ws-1')?.textContent).toContain(
      '1K processed',
    );
    expect(document.getElementById('workspace-token-usage-cache-ws-1')?.textContent).toContain(
      '70% Cached',
    );
    expect(document.getElementById(detailsId!)).toBeNull();
    expect(visibleText(disclosure)).toContain('Token usage');
    expect(visibleText(disclosure)).toContain('1K processed');
    expect(visibleText(disclosure)).toContain('70% Cached');

    await fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(disclosure.getAttribute('aria-label')).toBe('Collapse token usage details');
    const details = document.getElementById(detailsId!);
    expect(details).not.toBeNull();
    expect(details?.getAttribute('aria-labelledby')).toBe('workspace-token-usage-title-ws-1');

    await fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(detailsId!)).toBeNull();
  });

  it('renders visible composition values and ranked agent and model lists', async () => {
    mocks.state.usage = makeUsage({
      byAgentId: {
        'agent-a': {
          agentId: 'agent-a',
          sessionId: 'sess-a',
          lastMessageId: 'msg-1',
          computedAt: 1000,
          inputTokens: 1000,
          outputTokens: 30000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          byModel: {
            'model-small': {
              inputTokens: 1000,
              outputTokens: 30000,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
            },
          },
        },
        'agent-b': {
          agentId: 'agent-b',
          sessionId: 'sess-b',
          lastMessageId: 'msg-2',
          computedAt: 1000,
          inputTokens: 234,
          outputTokens: 68000,
          cacheReadTokens: 200_000,
          cacheCreationTokens: 64_137,
          byModel: {
            'model-big': {
              inputTokens: 234,
              outputTokens: 68000,
              cacheReadTokens: 200_000,
              cacheCreationTokens: 64_137,
            },
          },
        },
      },
      totals: {
        inputTokens: 1234,
        outputTokens: 98000,
        cacheReadTokens: 9_000_000,
        cacheCreationTokens: 264_137,
      },
      byModel: {
        'model-small': {
          inputTokens: 1000,
          outputTokens: 30000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        'model-big': {
          inputTokens: 234,
          outputTokens: 68000,
          cacheReadTokens: 9_000_000,
          cacheCreationTokens: 264_137,
        },
      },
      lastScanAt: 5000,
      isStale: false,
    });
    mocks.state.agents = [
      { id: 'agent-a', name: 'Alpha' },
      { id: 'agent-b', name: 'Beta' },
    ];

    await renderExpandedTokenUsage();

    const row = screen.getByTestId('workspace-token-usage');
    expect(visibleText(row)).toContain('9.4M processed');
    expect(visibleText(row)).toContain('98.9% Cached');
    expect(row.textContent).not.toContain('updating');

    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tokenUsage/fetchWorkspaceTokenUsage',
        payload: ['ws-1'],
      }),
    );

    const breakdown = screen.getByTestId('token-usage-details');
    const text = breakdown.textContent ?? '';

    const compositionHeading = screen.getByRole('heading', { name: 'Token composition' });
    const modelSection = screen.getByTestId('token-usage-by-model');
    const agentSection = screen.getByTestId('token-usage-by-agent');
    expect(
      compositionHeading.compareDocumentPosition(agentSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      agentSection.compareDocumentPosition(modelSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'By agent' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'By model' })).toBeTruthy();

    const composition = compositionHeading.closest('section')!;
    expect(visibleText(composition)).toContain('In 1.2K 0%');
    expect(visibleText(composition)).toContain('Out 98K 1%');
    expect(visibleText(composition)).toContain('Cached 9.3M 98.9%');
    expect(visibleText(composition)).toContain('Reasoning 0 0%');

    const modelRows = within(modelSection).getAllByRole('listitem');
    expect(modelRows).toHaveLength(2);
    expect(visibleText(modelRows[0])).toContain('Model Big 9.3M 99.7%');
    expect(visibleText(modelRows[1])).toContain('Model Small 31K 0.3%');
    expect(modelSection.querySelector('[title="model-big"]')?.textContent).toBe('Model Big');
    expect(modelSection.querySelector('[title="model-small"]')?.textContent).toBe('Model Small');

    const agentRows = within(agentSection).getAllByRole('listitem');
    expect(agentRows).toHaveLength(2);
    expect(visibleText(agentRows[0])).toContain('Beta 332.4K 91.5%');
    expect(visibleText(agentRows[1])).toContain('Alpha 31K 8.5%');

    expect(text).not.toContain('redits');
    expect(row.textContent).not.toContain('redits');
  });

  it('shows the unknown model bucket in the by-model section', async () => {
    mocks.state.usage = makeUsage({
      totals: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: {
        unknown: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      },
      lastScanAt: 5000,
      isStale: false,
    });

    await renderExpandedTokenUsage();

    const modelSection = screen.getByTestId('token-usage-by-model');
    expect(modelSection.textContent).toContain('Unknown');
    expect(modelSection.textContent).not.toContain('unknown');
    expect(modelSection.querySelector('[title="unknown"]')?.textContent).toBe('Unknown');
  });

  it('omits the by-model section when byModel is empty', async () => {
    mocks.state.usage = makeUsage({
      totals: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      lastScanAt: 5000,
      isStale: false,
    });

    await renderExpandedTokenUsage();

    expect(screen.queryByTestId('token-usage-by-model')).toBeNull();
    expect(screen.queryByTestId('token-usage-by-agent')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Token composition' })).toBeTruthy();
  });

  it('renders a thinking column and summary figure when the daemon reports thoughtTokens', async () => {
    mocks.state.usage = makeUsage({
      byAgentId: {
        'agent-a': {
          agentId: 'agent-a',
          sessionId: 'sess-a',
          lastMessageId: 'msg-1',
          computedAt: 1000,
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          thoughtTokens: 4200,
          byModel: {},
        },
      },
      totals: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        thoughtTokens: 4200,
      },
      byModel: {
        'model-big': {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          thoughtTokens: 4200,
        },
      },
      lastScanAt: 5000,
      isStale: false,
    });
    mocks.state.agents = [{ id: 'agent-a', name: 'Alpha' }];

    await renderExpandedTokenUsage();

    expect(visibleText(screen.getByTestId('token-usage-disclosure'))).toContain('4.2K processed');

    const modelSection = screen.getByTestId('token-usage-by-model');
    const agentSection = screen.getByTestId('token-usage-by-agent');
    expect(visibleText(modelSection)).toContain('Model Big 4.2K');
    expect(visibleText(agentSection)).toContain('Alpha 4.2K');
    const composition = screen
      .getByRole('heading', { name: 'Token composition' })
      .closest('section')!;
    expect(visibleText(composition)).toContain('Reasoning 4.2K 99.3%');
  });

  it('keeps the pre-thoughtTokens layout when the field is absent', async () => {
    mocks.state.usage = makeUsage({
      totals: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: {
        'model-big': {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      },
      lastScanAt: 5000,
      isStale: false,
    });

    await renderExpandedTokenUsage();

    expect(visibleText(screen.getByTestId('token-usage-disclosure'))).toContain('30 processed');
    const modelSection = screen.getByTestId('token-usage-by-model');
    expect(visibleText(modelSection)).toContain('Model Big 30');
    const composition = screen
      .getByRole('heading', { name: 'Token composition' })
      .closest('section')!;
    expect(visibleText(composition)).toContain('Reasoning 0 0%');
  });

  it('hides model and agent rows whose tokens are all zero', async () => {
    mocks.state.usage = makeUsage({
      byAgentId: {
        'agent-live': {
          agentId: 'agent-live',
          sessionId: 'sess-live',
          lastMessageId: 'msg-1',
          computedAt: 1000,
          inputTokens: 1000,
          outputTokens: 30000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          byModel: {},
        },
        'agent-idle': {
          agentId: 'agent-idle',
          sessionId: 'sess-idle',
          lastMessageId: 'msg-2',
          computedAt: 1000,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          byModel: {},
        },
      },
      totals: {
        inputTokens: 1000,
        outputTokens: 30000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: {
        'model-live': {
          inputTokens: 1000,
          outputTokens: 30000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        'model-idle': {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      },
      lastScanAt: 5000,
      isStale: false,
    });
    mocks.state.agents = [
      { id: 'agent-live', name: 'LiveAgent' },
      { id: 'agent-idle', name: 'IdleAgent' },
    ];

    await renderExpandedTokenUsage();

    const modelText = screen.getByTestId('token-usage-by-model').textContent ?? '';
    expect(modelText).toContain('Model Live');
    expect(modelText).not.toContain('Model Idle');

    const agentText = screen.getByTestId('token-usage-by-agent').textContent ?? '';
    expect(agentText).toContain('LiveAgent');
    expect(agentText).not.toContain('IdleAgent');
  });

  it('keeps rows and the summary visible when only thoughtTokens are non-zero (§5.23)', async () => {
    mocks.state.usage = makeUsage({
      byAgentId: {
        'agent-a': {
          agentId: 'agent-a',
          sessionId: 'sess-a',
          lastMessageId: 'msg-1',
          computedAt: 1000,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          thoughtTokens: 4200,
          byModel: {},
        },
      },
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        thoughtTokens: 4200,
      },
      byModel: {
        'model-big': {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          thoughtTokens: 4200,
        },
      },
      lastScanAt: 5000,
      isStale: false,
    });
    mocks.state.agents = [{ id: 'agent-a', name: 'Alpha' }];

    await renderTokenUsage();

    expect(screen.getByTestId('workspace-token-usage')).not.toBeNull();
    expect(screen.getByTestId('token-usage-by-model').textContent).toContain('Model Big');
    expect(screen.getByTestId('token-usage-by-agent').textContent).toContain('Alpha');
  });

  it('renders a cost column and total when the daemon reports cost', async () => {
    mocks.state.usage = makeUsage({
      byAgentId: {
        'agent-a': {
          agentId: 'agent-a',
          sessionId: 'sess-a',
          lastMessageId: 'msg-1',
          computedAt: 1000,
          inputTokens: 1000,
          outputTokens: 30000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cost: { amount: 1.5, currency: 'USD' },
          byModel: {},
        },
      },
      totals: {
        inputTokens: 1000,
        outputTokens: 30000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cost: { amount: 1.5, currency: 'USD' },
      },
      byModel: {
        'model-big': {
          inputTokens: 1000,
          outputTokens: 30000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cost: { amount: 1.5, currency: 'USD' },
        },
      },
      lastScanAt: 5000,
      isStale: false,
    });
    mocks.state.agents = [{ id: 'agent-a', name: 'Alpha' }];

    await renderExpandedTokenUsage();

    const modelSection = screen.getByTestId('token-usage-by-model');
    const agentSection = screen.getByTestId('token-usage-by-agent');
    expect(visibleText(modelSection)).toContain('Cost $1.50');
    expect(visibleText(agentSection)).toContain('Cost $1.50');

    const totalCost = screen.getByTestId('token-usage-total-cost');
    expect(totalCost.textContent).toContain('Total cost');
    expect(totalCost.textContent).toContain('$1.50');
  });

  it('renders a placeholder for rows without cost when some entry has cost', async () => {
    mocks.state.usage = makeUsage({
      totals: {
        inputTokens: 1000,
        outputTokens: 30000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: {
        'model-priced': {
          inputTokens: 500,
          outputTokens: 20000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cost: { amount: 2, currency: 'USD' },
        },
        'model-free': {
          inputTokens: 500,
          outputTokens: 10000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      },
      lastScanAt: 5000,
      isStale: false,
    });

    await renderExpandedTokenUsage();

    const modelSection = screen.getByTestId('token-usage-by-model');
    expect(modelSection.textContent).toContain('$2.00');
    expect(modelSection.textContent).toContain('—');
    // No workspace-wide cost reported → no total row.
    expect(screen.queryByTestId('token-usage-total-cost')).toBeNull();
  });

  it('omits cost values when no cost is reported', async () => {
    mocks.state.usage = makeUsage({
      totals: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      byModel: {
        'model-live': {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      },
      lastScanAt: 5000,
      isStale: false,
    });

    await renderExpandedTokenUsage();

    const modelSection = screen.getByTestId('token-usage-by-model');
    expect(modelSection.textContent).not.toContain('Cost');
    expect(screen.queryByTestId('token-usage-total-cost')).toBeNull();
  });

  it('omits non-finite reported cost values', async () => {
    mocks.state.usage = makeUsage({
      totals: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cost: { amount: Number.NaN, currency: 'USD' },
      },
      byModel: {
        'model-live': {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          cost: { amount: Number.POSITIVE_INFINITY, currency: 'USD' },
        },
      },
      lastScanAt: 5000,
      isStale: false,
    });

    await renderExpandedTokenUsage();

    const modelSection = screen.getByTestId('token-usage-by-model');
    expect(modelSection.textContent).not.toContain('Cost');
    expect(screen.queryByTestId('token-usage-total-cost')).toBeNull();
  });

  it('shows a subtle updating hint when the data is stale', async () => {
    mocks.state.usage = makeUsage({
      totals: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      lastScanAt: 5000,
      isStale: true,
    });

    await renderTokenUsage();

    expect(screen.getByTestId('workspace-token-usage').textContent).toContain('updating');
  });

  it('renders nothing when there is no usage data', async () => {
    const { container } = await renderTokenUsage();

    expect(screen.queryByTestId('workspace-token-usage')).toBeNull();
    expect(container.textContent?.trim()).toBe('');
  });
});
