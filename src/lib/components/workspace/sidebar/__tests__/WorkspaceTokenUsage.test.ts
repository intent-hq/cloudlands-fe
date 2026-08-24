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

    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(detailsId!)).toBeNull();
    expect(document.activeElement).toBe(disclosure);

    await fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.pointerDown(document.body);
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(detailsId!)).toBeNull();

    await fireEvent.click(disclosure);
    await fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(detailsId!)).toBeNull();
  });

  it('renders the full inspiration hierarchy with visible composition and ranked breakdowns', async () => {
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

    const details = screen.getByTestId('token-usage-details');
    const text = details.textContent ?? '';

    const compositionHeading = screen.getByRole('heading', { name: 'Token composition' });
    const modelSection = screen.getByTestId('token-usage-by-model');
    const agentSection = screen.getByTestId('token-usage-by-agent');
    expect(screen.queryByTestId('token-usage-breakdown-disclosure')).toBeNull();
    expect(details.querySelector('details')).toBeNull();
    expect(
      agentSection.compareDocumentPosition(modelSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      modelSection.compareDocumentPosition(compositionHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'By agent' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'By model' })).toBeTruthy();

    const composition = compositionHeading.closest('section')!;
    expect(visibleText(compositionHeading.parentElement!)).toContain(
      'Token composition Active scope Workspace 9.4M processed',
    );
    const compositionStrip = composition.querySelector('div[aria-hidden="true"]')!;
    const stripSegments = Array.from(compositionStrip.children) as HTMLElement[];
    expect(stripSegments).toHaveLength(3);
    expect(stripSegments[0].classList.contains('bg-success')).toBe(true);
    expect(stripSegments.every((segment) => segment.style.width.endsWith('%'))).toBe(true);
    const compositionRows = Array.from(composition.querySelectorAll('.composition-row'));
    expect(compositionRows).toHaveLength(4);
    const compositionValues = compositionRows.map((compositionRow) => ({
      metric: compositionRow.querySelector('.composition-metric')?.textContent?.trim(),
      description: compositionRow.querySelector('.composition-description')?.textContent?.trim(),
      value: compositionRow.querySelector('.composition-value')?.textContent?.trim(),
      context: compositionRow.querySelector('.composition-context')?.textContent?.trim(),
    }));
    expect(compositionValues).toEqual([
      {
        metric: 'Cached',
        description: 'Read and written context',
        value: '9.3M',
        context: '98.9%',
      },
      { metric: 'In', description: 'Prompt context', value: '1.2K', context: '0%' },
      { metric: 'Out', description: 'Model responses', value: '98K', context: '1%' },
      { metric: 'Reasoning', description: 'Internal tokens', value: '0', context: '0%' },
    ]);
    expect(
      compositionRows.every((compositionRow) => {
        const swatch = compositionRow.querySelector('.composition-metric [aria-hidden="true"]');
        return swatch !== null && swatch.className.includes('bg-');
      }),
    ).toBe(true);
    expect(new Set(compositionValues.map(({ metric }) => metric)).size).toBe(4);
    expect(composition.querySelectorAll('.composition-value')).toHaveLength(4);
    expect(composition.querySelectorAll('.composition-context')).toHaveLength(4);
    expect(text).toContain('9.4M processed');

    const modelRows = within(modelSection).getAllByRole('listitem');
    expect(modelRows).toHaveLength(2);
    expect(visibleText(modelRows[0])).toBe('Model Big 9.3M 99.7%');
    expect(visibleText(modelRows[1])).toBe('Model Small 31K 0.3%');
    expect(modelSection.querySelector('[title="model-big"]')?.textContent).toBe('Model Big');
    expect(modelSection.querySelector('[title="model-small"]')?.textContent).toBe('Model Small');

    const agentRows = within(agentSection).getAllByRole('listitem');
    expect(agentRows).toHaveLength(2);
    expect(visibleText(agentRows[0])).toBe('Beta 332.4K 91.5%');
    expect(visibleText(agentRows[1])).toBe('Alpha 31K 8.5%');
    expect(
      [...modelRows, ...agentRows].every(
        (listRow) =>
          listRow.querySelector('.breakdown-share-bar') !== null &&
          listRow.querySelector('.breakdown-metadata') !== null,
      ),
    ).toBe(true);
    expect(
      [...modelRows, ...agentRows].every((listRow) => {
        const shareBar = listRow.querySelector('[aria-hidden="true"] > [style*="width"]');
        return shareBar instanceof HTMLElement && shareBar.style.width.endsWith('%');
      }),
    ).toBe(true);

    expect(text).not.toContain('redits');
    expect(row.textContent).not.toContain('redits');
  });

  it('previews exact agent and model totals on pointer or keyboard focus and then resets', async () => {
    mocks.state.usage = makeUsage({
      byAgentId: {
        'agent-alpha': {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 40,
          thoughtTokens: 50,
        },
        'agent-beta': {
          inputTokens: 400,
          outputTokens: 300,
          cacheReadTokens: 200,
          cacheCreationTokens: 100,
          thoughtTokens: 0,
        },
      },
      totals: {
        inputTokens: 410,
        outputTokens: 320,
        cacheReadTokens: 230,
        cacheCreationTokens: 140,
        thoughtTokens: 50,
      },
      byModel: {
        'model-zero-cache': {
          inputTokens: 80,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          thoughtTokens: 0,
        },
        'model-reasoning': {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          thoughtTokens: 50,
        },
      },
      lastScanAt: 5000,
      isStale: false,
    });
    mocks.state.agents = [
      { id: 'agent-alpha', name: 'Alpha' },
      { id: 'agent-beta', name: 'Beta' },
    ];

    await renderExpandedTokenUsage();

    const disclosure = screen.getByTestId('token-usage-disclosure');
    const composition = screen
      .getByRole('heading', { name: 'Token composition' })
      .closest('section')!;
    const previewStatus = document.getElementById(
      'workspace-token-usage-details-ws-1-preview-status',
    )!;
    const values = () =>
      Array.from(composition.querySelectorAll('.composition-row')).map((row) => ({
        value: row.querySelector('.composition-value')?.textContent?.trim(),
        share: row.querySelector('.composition-context')?.textContent?.trim(),
      }));
    const alpha = screen.getByRole('button', { name: 'Alpha 150 13%' });
    const beta = screen.getByRole('button', { name: 'Beta 1K 87%' });
    const zeroCache = screen.getByRole('button', { name: 'Model Zero Cache 100 66.7%' });
    const reasoning = screen.getByRole('button', { name: 'Model Reasoning 50 33.3%' });

    expect(visibleText(previewStatus)).toBe('Active scope Workspace 1.1K processed');
    expect(visibleText(disclosure)).toContain('1.1K processed');

    await fireEvent.pointerEnter(alpha.closest('li')!, { pointerType: 'mouse' });
    expect(visibleText(previewStatus)).toBe('Active scope By agent Alpha 150 processed');
    expect(alpha.getAttribute('aria-current')).toBe('true');
    expect(values()).toEqual([
      { value: '70', share: '46.7%' },
      { value: '10', share: '6.7%' },
      { value: '20', share: '13.3%' },
      { value: '50', share: '33.3%' },
    ]);

    await fireEvent.pointerEnter(zeroCache.closest('li')!, { pointerType: 'mouse' });
    expect(visibleText(previewStatus)).toBe('Active scope By model Model Zero Cache 100 processed');
    expect(values()).toEqual([
      { value: '0', share: '0%' },
      { value: '80', share: '80%' },
      { value: '20', share: '20%' },
      { value: '0', share: '0%' },
    ]);

    await fireEvent.pointerLeave(zeroCache.closest('li')!, { pointerType: 'mouse' });
    expect(visibleText(previewStatus)).toBe('Active scope Workspace 1.1K processed');

    await fireEvent.focus(beta);
    expect(visibleText(previewStatus)).toBe('Active scope By agent Beta 1K processed');
    expect(values()).toEqual([
      { value: '300', share: '30%' },
      { value: '400', share: '40%' },
      { value: '300', share: '30%' },
      { value: '0', share: '0%' },
    ]);

    await fireEvent.pointerEnter(zeroCache.closest('li')!, { pointerType: 'mouse' });
    expect(visibleText(previewStatus)).toBe('Active scope By model Model Zero Cache 100 processed');
    await fireEvent.pointerLeave(zeroCache.closest('li')!, { pointerType: 'mouse' });
    expect(visibleText(previewStatus)).toBe('Active scope By agent Beta 1K processed');

    await fireEvent.blur(beta);
    await fireEvent.focus(reasoning);
    expect(visibleText(previewStatus)).toBe('Active scope By model Model Reasoning 50 processed');
    expect(values()).toEqual([
      { value: '0', share: '0%' },
      { value: '0', share: '0%' },
      { value: '0', share: '0%' },
      { value: '50', share: '100%' },
    ]);

    await fireEvent.blur(reasoning);
    expect(visibleText(previewStatus)).toBe('Active scope Workspace 1.1K processed');
    expect(visibleText(disclosure)).toContain('1.1K processed');

    await fireEvent.pointerEnter(alpha.closest('li')!, { pointerType: 'touch' });
    await fireEvent.pointerDown(alpha, { pointerType: 'touch' });
    await fireEvent.focus(alpha);
    expect(visibleText(previewStatus)).toBe('Active scope Workspace 1.1K processed');
    expect(screen.queryByTestId('token-usage-message-counts')).toBeNull();
  });

  it('cross-filters the full matrix view by row and category for pointer, focus, and touch', async () => {
    const matrix = [
      {
        agentId: 'agent-alpha',
        model: 'model-a',
        totals: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 40,
          thoughtTokens: 50,
          cost: { amount: 1, currency: 'USD' },
        },
        humanMessages: 2,
        agentMessages: 3,
      },
      {
        agentId: 'agent-alpha',
        model: 'model-b',
        totals: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 },
        humanMessages: 1,
        agentMessages: 1,
      },
      {
        agentId: 'agent-beta',
        model: 'model-a',
        totals: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 50,
          cacheCreationTokens: 0,
          cost: { amount: 0.5, currency: 'USD' },
        },
        humanMessages: 4,
        agentMessages: 2,
      },
      {
        agentId: 'agent-beta',
        model: 'model-b',
        totals: {
          inputTokens: 300,
          outputTokens: 250,
          cacheReadTokens: 150,
          cacheCreationTokens: 100,
          cost: { amount: 1.5, currency: 'USD' },
        },
        humanMessages: 2,
        agentMessages: 5,
      },
    ];
    mocks.state.usage = makeUsage({
      byAgentId: {
        'agent-alpha': {
          inputTokens: 15,
          outputTokens: 25,
          cacheReadTokens: 30,
          cacheCreationTokens: 40,
          thoughtTokens: 50,
          cost: { amount: 1, currency: 'USD' },
        },
        'agent-beta': {
          inputTokens: 400,
          outputTokens: 300,
          cacheReadTokens: 200,
          cacheCreationTokens: 100,
          cost: { amount: 2, currency: 'USD' },
        },
      },
      totals: {
        inputTokens: 415,
        outputTokens: 325,
        cacheReadTokens: 230,
        cacheCreationTokens: 140,
        thoughtTokens: 50,
        cost: { amount: 3, currency: 'USD' },
      },
      byModel: {
        'model-a': {
          inputTokens: 110,
          outputTokens: 70,
          cacheReadTokens: 80,
          cacheCreationTokens: 40,
          thoughtTokens: 50,
          cost: { amount: 1.5, currency: 'USD' },
        },
        'model-b': {
          inputTokens: 305,
          outputTokens: 255,
          cacheReadTokens: 150,
          cacheCreationTokens: 100,
          cost: { amount: 1.5, currency: 'USD' },
        },
      },
      byAgentModel: matrix,
      lastScanAt: '2026-08-24T00:00:00Z',
      isStale: false,
    });
    mocks.state.agents = [
      { id: 'agent-alpha', name: 'Alpha' },
      { id: 'agent-beta', name: 'Beta' },
    ];

    await renderExpandedTokenUsage();

    const details = screen.getByTestId('token-usage-details');
    const status = details.querySelector('.preview-status')!;
    const messageCounts = screen.getByTestId('token-usage-message-counts');
    const values = () =>
      Array.from(details.querySelectorAll('.composition-row')).map((row) => ({
        value: row.querySelector('.composition-value')?.textContent?.trim(),
        share: row.querySelector('.composition-context')?.textContent?.trim(),
      }));
    const agentSection = screen.getByTestId('token-usage-by-agent');
    const modelSection = screen.getByTestId('token-usage-by-model');
    const alphaControl = agentSection.querySelectorAll<HTMLButtonElement>(
      '.breakdown-metadata-control',
    )[1];
    const alphaRow = alphaControl.closest('li')!;

    expect(visibleText(messageCounts)).toBe('Human messages 9 Agent messages 11');
    expect(visibleText(status)).toBe('Active scope Workspace 1.2K processed');
    expect(
      agentSection.compareDocumentPosition(
        screen.getByRole('heading', { name: 'Token composition' }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(agentSection.querySelectorAll('.breakdown-segment').length).toBeGreaterThan(4);

    await fireEvent.pointerEnter(alphaRow, { pointerType: 'mouse' });
    expect(visibleText(status)).toBe('Active scope By agent Alpha 160 processed');
    expect(visibleText(messageCounts)).toBe('Human messages 3 Agent messages 4');
    expect(values()).toEqual([
      { value: '70', share: '43.8%' },
      { value: '15', share: '9.4%' },
      { value: '25', share: '15.6%' },
      { value: '50', share: '31.3%' },
    ]);
    expect(within(agentSection).getAllByRole('listitem')).toHaveLength(2);
    expect(within(modelSection).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByTestId('token-usage-total-cost').textContent).toContain('$1.00');

    const cachedSegment = screen.getByRole('button', {
      name: 'Alpha, Cached: 70 tokens, 43.8%',
    });
    await fireEvent.pointerEnter(cachedSegment, { pointerType: 'mouse' });
    expect(visibleText(status)).toBe('Active scope By agent Alpha · Cached 70 processed');
    expect(visibleText(messageCounts)).toBe('Human messages 3 Agent messages 4');
    expect(values()).toEqual([
      { value: '70', share: '100%' },
      { value: '0', share: '0%' },
      { value: '0', share: '0%' },
      { value: '0', share: '0%' },
    ]);
    await fireEvent.pointerLeave(cachedSegment, { pointerType: 'mouse' });
    expect(visibleText(status)).toBe('Active scope By agent Alpha 160 processed');
    await fireEvent.pointerLeave(alphaRow, { pointerType: 'mouse' });
    expect(visibleText(status)).toBe('Active scope Workspace 1.2K processed');

    const modelA = Array.from(
      modelSection.querySelectorAll<HTMLButtonElement>('.breakdown-metadata-control'),
    ).find((button) => button.textContent?.includes('Model A'))!;
    await fireEvent.focus(modelA);
    expect(visibleText(status)).toBe('Active scope By model Model A 350 processed');
    expect(visibleText(messageCounts)).toBe('Human messages 6 Agent messages 5');
    expect(within(agentSection).getAllByRole('listitem')).toHaveLength(2);
    await fireEvent.blur(modelA);

    const betaOut = screen.getByRole('button', { name: 'Beta, Out: 300 tokens, 30%' });
    const betaControl = Array.from(
      agentSection.querySelectorAll<HTMLButtonElement>('.breakdown-metadata-control'),
    ).find((button) => button.textContent?.includes('Beta'))!;
    await fireEvent.pointerDown(betaOut, { pointerType: 'touch' });
    expect(visibleText(status)).toBe('Active scope By agent Beta · Out 300 processed');
    expect(visibleText(messageCounts)).toBe('Human messages 6 Agent messages 7');
    await fireEvent.pointerDown(betaOut, { pointerType: 'touch' });
    expect(visibleText(status)).toBe('Active scope By agent Beta 1K processed');
    await fireEvent.pointerDown(betaControl, { pointerType: 'touch' });
    expect(visibleText(status)).toBe('Active scope Workspace 1.2K processed');

    const modelB = Array.from(
      modelSection.querySelectorAll<HTMLButtonElement>('.breakdown-metadata-control'),
    ).find((button) => button.textContent?.includes('Model B'))!;
    await fireEvent.pointerDown(modelB, { pointerType: 'touch' });
    expect(visibleText(status)).toBe('Active scope By model Model B 810 processed');
    expect(visibleText(messageCounts)).toBe('Human messages 3 Agent messages 6');
    await fireEvent.pointerDown(modelB, { pointerType: 'touch' });
    expect(visibleText(status)).toBe('Active scope Workspace 1.2K processed');
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
    expect(screen.queryByTestId('token-usage-breakdown-disclosure')).toBeNull();
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
    const reasoningRow = composition.querySelectorAll('.composition-row')[3];
    expect(visibleText(reasoningRow)).toBe('Reasoning Internal tokens 4.2K 99.3%');
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
    const reasoningRow = composition.querySelectorAll('.composition-row')[3];
    expect(visibleText(reasoningRow)).toBe('Reasoning Internal tokens 0 0%');
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

  it('renders the supported workspace total cost without repeating per-row costs', async () => {
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
    expect(visibleText(modelSection)).toBe('By model Model Big 31K 100%');
    expect(visibleText(agentSection)).toBe('By agent Alpha 31K 100%');
    expect(modelSection.textContent).not.toContain('$1.50');
    expect(agentSection.textContent).not.toContain('$1.50');

    const totalCost = screen.getByTestId('token-usage-total-cost');
    expect(visibleText(totalCost)).toBe('Total cost $1.50');
  });

  it('does not surface per-model costs when no workspace total is reported', async () => {
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
    expect(modelSection.textContent).not.toContain('$2.00');
    expect(modelSection.textContent).not.toContain('—');
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
