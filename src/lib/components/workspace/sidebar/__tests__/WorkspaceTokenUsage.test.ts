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
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll('.animated-number-target').forEach((target) => target.remove());
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function mockReducedMotion() {
  vi.mocked(window.matchMedia).mockImplementation(
    (query) =>
      ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      }) as MediaQueryList,
  );
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
    mockReducedMotion();
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
      'workspace-token-usage-processed-ws-1',
    );
    expect(document.getElementById('workspace-token-usage-processed-ws-1')?.textContent).toMatch(
      /1K\s+tokens used/,
    );
    expect(document.getElementById('workspace-token-usage-cache-ws-1')).toBeNull();
    expect(document.getElementById(detailsId!)).toBeNull();
    expect(disclosure.querySelector('[aria-hidden="true"]')?.textContent).toBe('1K');
    expect(visibleText(disclosure)).toBe('1K 1K tokens used');
    expect(disclosure.querySelector('svg')).toBeNull();
    expect(disclosure.classList).toContain('font-normal');
    const closedClassName = disclosure.className;

    await fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(disclosure.getAttribute('aria-label')).toBe('Collapse token usage details');
    expect(disclosure.className).toBe(closedClassName);
    const details = document.getElementById(detailsId!);
    expect(details).not.toBeNull();
    expect(details?.getAttribute('aria-labelledby')).toBe('workspace-token-usage-title-ws-1');
    expect(details?.parentElement).toBe(document.body);
    expect(screen.getByTestId('workspace-token-usage').contains(details)).toBe(false);
    expect(
      screen.getByRole('heading', { name: 'Token composition' }).closest('section')?.classList,
    ).toContain('pb-3');
    expect(details?.querySelector('.breakdown-grid')).toBeNull();

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

  it('renders the minimal reference hierarchy with proportional stacked navigators', async () => {
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
    expect(visibleText(screen.getByTestId('token-usage-details'))).toContain('9M processed');
    expect(
      screen.getByTestId('token-usage-disclosure').querySelector('[aria-hidden="true"]')
        ?.textContent,
    ).toBe('9M');
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
      compositionHeading.compareDocumentPosition(agentSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'By agent' }).classList).toContain('sr-only');
    expect(screen.getByRole('heading', { name: 'By model' }).classList).toContain('sr-only');
    expect(compositionHeading.classList).toContain('sr-only');

    const composition = compositionHeading.closest('section')!;
    const breakdownGrid = details.querySelector('.breakdown-grid')!;
    const tokenSummary = composition.querySelector('.token-summary')!;
    const compositionStrip = screen.getByRole('img', { name: /Token composition/ });
    expect(visibleText(tokenSummary)).toBe('Token usage 9M');
    expect(tokenSummary.classList).not.toContain('uppercase');
    expect(tokenSummary.classList).not.toContain('tracking-[0.08em]');
    expect(tokenSummary.classList).toContain('tracking-normal');
    expect(tokenSummary.classList).toContain('font-normal');
    expect(tokenSummary.classList).toContain('text-muted-foreground');
    expect(tokenSummary.lastElementChild?.classList).toContain('font-normal');
    expect(composition.nextElementSibling).toBe(breakdownGrid);
    expect(details.lastElementChild).toBe(breakdownGrid);
    expect(composition.classList).toContain('pb-3');
    expect(breakdownGrid.classList).toContain('border-t');
    expect(breakdownGrid.classList).not.toContain('border-b');
    expect(modelSection.classList).toContain('breakdown-section');
    expect(composition.querySelector('.composition-header')).toBeNull();
    expect(composition.querySelector('.preview-status')?.classList).toContain('sr-only');
    expect(compositionStrip.nextElementSibling?.tagName).toBe('DL');
    expect(compositionStrip.classList).toContain('mb-5');
    expect(compositionStrip.classList).not.toContain('mb-3');
    expect(compositionStrip.classList).toContain('h-1.5');
    expect(compositionStrip.classList).not.toContain('h-2');
    expect(compositionStrip.getAttribute('aria-label')).toContain(
      'Token composition, Cached context: 9M tokens, 99%',
    );
    const compositionSegments = Array.from(
      compositionStrip.querySelectorAll<HTMLElement>('.composition-strip-segment'),
    );
    expect(compositionSegments.map((segment) => segment.dataset.metric)).toEqual([
      'cached',
      'output',
      'input',
    ]);
    expect(compositionSegments.map((segment) => segment.style.width)).toEqual([
      `calc(${9_264_137 / 9_363_371} * (100% - 2px))`,
      `calc(${98_000 / 9_363_371} * (100% - 2px))`,
      `calc(${1_234 / 9_363_371} * (100% - 2px))`,
    ]);
    const compositionRows = Array.from(composition.querySelectorAll('.composition-row'));
    expect(compositionRows).toHaveLength(4);
    const compositionValues = compositionRows.map((compositionRow) => ({
      label: compositionRow.querySelector('.composition-metric')?.textContent?.trim(),
      value: visibleText(compositionRow.querySelector('.composition-value')!),
      valueSuffix: compositionRow.querySelector('.composition-value-suffix')?.textContent?.trim(),
      context: visibleText(compositionRow.querySelector('.composition-context')!),
      contextSuffix: compositionRow
        .querySelector('.composition-context-suffix')
        ?.textContent?.trim(),
    }));
    expect(compositionValues).toEqual([
      {
        label: 'Cached context',
        value: '9M',
        valueSuffix: 'tokens',
        context: '99%',
        contextSuffix: 'of total',
      },
      {
        label: 'Model output',
        value: '98K',
        valueSuffix: undefined,
        context: '1%',
        contextSuffix: undefined,
      },
      {
        label: 'Reasoning tokens',
        value: '0',
        valueSuffix: undefined,
        context: '0%',
        contextSuffix: undefined,
      },
      {
        label: 'Input context',
        value: '1K',
        valueSuffix: undefined,
        context: '0%',
        contextSuffix: undefined,
      },
    ]);
    const zeroCompositionRows = compositionRows.filter(
      (compositionRow) => compositionRow.getAttribute('data-zero') === 'true',
    );
    expect(zeroCompositionRows).toHaveLength(1);
    expect(visibleText(zeroCompositionRows[0])).toBe('Reasoning tokens 0 0%');
    expect(
      [
        zeroCompositionRows[0].querySelector('.composition-metric'),
        zeroCompositionRows[0].querySelector('.composition-value'),
        zeroCompositionRows[0].querySelector('.composition-context'),
      ].every((element) => element?.classList.contains('text-muted-foreground')),
    ).toBe(true);
    expect(
      zeroCompositionRows[0].querySelector('.composition-key')?.getAttribute('data-zero'),
    ).toBe('true');
    expect(compositionRows[3].getAttribute('data-zero')).toBeNull();
    expect(composition.querySelector('.composition-description')).toBeNull();
    const compositionKeys = Array.from(
      composition.querySelectorAll<HTMLElement>('.composition-key[aria-hidden="true"]'),
    );
    expect(compositionKeys.map((key) => key.dataset.metric)).toEqual([
      'cached',
      'output',
      'reasoning',
      'input',
    ]);
    expect(composition.querySelectorAll('.message-composition-row .composition-key')).toHaveLength(
      0,
    );
    expect(new Set(compositionValues.map(({ label }) => label)).size).toBe(4);
    expect(composition.querySelectorAll('.composition-value')).toHaveLength(4);
    expect(composition.querySelectorAll('.composition-context')).toHaveLength(4);
    expect(
      [...composition.querySelectorAll('.composition-value')]
        .filter(
          (cell) => cell.closest('.token-composition-row')?.getAttribute('data-zero') !== 'true',
        )
        .every(
          (cell) =>
            cell.classList.contains('font-normal') && cell.classList.contains('text-foreground'),
        ),
    ).toBe(true);
    expect(
      [...composition.querySelectorAll('.composition-context')].every(
        (cell) =>
          cell.classList.contains('font-normal') &&
          cell.classList.contains('text-muted-foreground'),
      ),
    ).toBe(true);
    expect(text).toContain('9M processed');

    const modelRows = Array.from(modelSection.querySelectorAll('.breakdown-stack-item'));
    expect(modelRows).toHaveLength(2);
    expect(visibleText(modelSection)).toBe('By model Model Big 100%');
    expect(
      within(modelSection)
        .getByRole('radio', { name: 'By model, Model Big: 9M tokens, 100%' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      within(modelSection).getByRole('radio', { name: 'By model, Model Small: 31K tokens, 0%' }),
    ).toBeTruthy();

    const agentRows = Array.from(agentSection.querySelectorAll('.breakdown-stack-item'));
    expect(agentRows).toHaveLength(2);
    expect(visibleText(agentSection)).toBe('By agent Beta 91%');
    expect(
      within(agentSection)
        .getByRole('radio', { name: 'By agent, Beta: 332K tokens, 91%' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      within(agentSection).getByRole('radio', { name: 'By agent, Alpha: 31K tokens, 9%' }),
    ).toBeTruthy();
    const agentGroup = within(agentSection).getByRole('radiogroup', { name: 'By agent' });
    const modelGroup = within(modelSection).getByRole('radiogroup', { name: 'By model' });
    expect(
      within(agentGroup)
        .getAllByRole('radio')
        .filter((radio) => radio.tabIndex === 0),
    ).toHaveLength(1);
    expect(
      within(modelGroup)
        .getAllByRole('radio')
        .filter((radio) => radio.tabIndex === 0),
    ).toHaveLength(1);
    expect(details.querySelectorAll('[data-pulse="false"]')).toHaveLength(11);
    expect(
      [...modelRows, ...agentRows].every((listRow) =>
        listRow.classList.contains('breakdown-stack-item'),
      ),
    ).toBe(true);
    expect(
      [...modelRows, ...agentRows].every((listRow) =>
        (listRow as HTMLElement).style.width.includes('100% - 1px'),
      ),
    ).toBe(true);
    for (const section of [agentSection, modelSection]) {
      const navigatorRow = section.querySelector('.navigator-row')!;
      const selection = navigatorRow.querySelector('.navigator-selection')!;
      const stack = navigatorRow.querySelector('.breakdown-stack')!;
      const controls = Array.from(stack.querySelectorAll('.breakdown-item-control'));
      const activeControls = controls.filter(
        (control) => control.getAttribute('data-preview-active') === 'true',
      );
      const label = selection.firstElementChild!;
      const percentage = selection.lastElementChild!;
      expect(stack.previousElementSibling).toBe(selection);
      expect(stack.classList).toContain('h-1.5');
      expect(stack.classList).not.toContain('h-2');
      expect(navigatorRow.classList).toContain('flex-col');
      expect(controls.every((control) => control.tagName === 'BUTTON')).toBe(true);
      expect(controls.every((control) => control.classList.contains('appearance-none'))).toBe(true);
      expect(activeControls).toHaveLength(1);
      expect(activeControls[0]?.getAttribute('aria-checked')).toBe('true');
      expect(
        controls
          .filter((control) => control !== activeControls[0])
          .every(
            (control) =>
              control.getAttribute('data-preview-active') === null &&
              control.getAttribute('aria-checked') === 'false',
          ),
      ).toBe(true);
      expect(
        controls.every((control) => !control.classList.contains('focus-visible:ring-inset')),
      ).toBe(true);
      expect(percentage.classList).toContain('font-normal');
      expect(percentage.classList).not.toContain('ml-auto');
      expect(percentage.classList).not.toContain('w-14');
      expect(percentage.classList).toContain('shrink-0');
      expect(percentage.classList).toContain('text-right');
      expect(percentage.classList).toContain('text-muted-foreground');
      expect(percentage.classList).not.toContain('font-medium');
      expect(percentage.classList).not.toContain('text-success');
      expect(label.classList).toContain('font-medium');
      expect(label.classList).toContain('flex-1');
      expect(label.classList).toContain('min-w-0');
      expect(section.classList).toContain('pb-4');
      expect(section.classList).toContain('pt-3');
    }
    expect(details.querySelectorAll('.font-medium')).toHaveLength(2);
    expect(details.querySelectorAll('.breakdown-section + .breakdown-section')).toHaveLength(1);
    expect(composition.querySelectorAll('.composition-row + .composition-row')).toHaveLength(3);
    expect(details.querySelector('.breakdown-share-bar')).toBeNull();
    expect(details.querySelector('.breakdown-metadata')).toBeNull();

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
      Array.from(composition.querySelectorAll('.token-composition-row')).map((row) => ({
        value: visibleText(row.querySelector('.composition-value')!),
        share: visibleText(row.querySelector('.composition-context')!),
      }));
    const stripMetrics = () =>
      Array.from(composition.querySelectorAll<HTMLElement>('.composition-strip-segment')).map(
        (segment) => ({ metric: segment.dataset.metric, width: segment.style.width }),
      );
    const alpha = screen.getByRole('radio', { name: 'By agent, Alpha: 150 tokens, 13%' });
    const beta = screen.getByRole('radio', { name: 'By agent, Beta: 1K tokens, 87%' });
    const zeroCache = screen.getByRole('radio', {
      name: 'By model, Model Zero Cache: 100 tokens, 67%',
    });
    const reasoning = screen.getByRole('radio', {
      name: 'By model, Model Reasoning: 50 tokens, 33%',
    });

    expect(visibleText(previewStatus)).toBe('Active scope Workspace 1K processed');
    expect(visibleText(disclosure)).toContain('1K tokens used');

    await fireEvent.pointerEnter(alpha, { pointerType: 'mouse' });
    expect(visibleText(previewStatus)).toBe('Active scope By agent Alpha 150 processed');
    expect(alpha.getAttribute('aria-checked')).toBe('true');
    expect(values()).toEqual([
      { value: '70', share: '47%' },
      { value: '20', share: '13%' },
      { value: '50', share: '33%' },
      { value: '10', share: '7%' },
    ]);
    expect(stripMetrics()).toEqual([
      { metric: 'cached', width: `calc(${70 / 150} * (100% - 3px))` },
      { metric: 'output', width: `calc(${20 / 150} * (100% - 3px))` },
      { metric: 'reasoning', width: `calc(${50 / 150} * (100% - 3px))` },
      { metric: 'input', width: `calc(${10 / 150} * (100% - 3px))` },
    ]);

    await fireEvent.pointerEnter(zeroCache, { pointerType: 'mouse' });
    expect(visibleText(previewStatus)).toBe('Active scope By model Model Zero Cache 100 processed');
    expect(values()).toEqual([
      { value: '0', share: '0%' },
      { value: '20', share: '20%' },
      { value: '0', share: '0%' },
      { value: '80', share: '80%' },
    ]);
    expect(stripMetrics()).toEqual([
      { metric: 'output', width: 'calc(0.2 * (100% - 1px))' },
      { metric: 'input', width: 'calc(0.8 * (100% - 1px))' },
    ]);

    await fireEvent.pointerLeave(zeroCache, { pointerType: 'mouse' });
    expect(visibleText(previewStatus)).toBe('Active scope Workspace 1K processed');

    await fireEvent.focus(beta);
    expect(visibleText(previewStatus)).toBe('Active scope By agent Beta 1K processed');
    expect(values()).toEqual([
      { value: '300', share: '30%' },
      { value: '300', share: '30%' },
      { value: '0', share: '0%' },
      { value: '400', share: '40%' },
    ]);

    await fireEvent.pointerEnter(zeroCache, { pointerType: 'mouse' });
    expect(visibleText(previewStatus)).toBe('Active scope By model Model Zero Cache 100 processed');
    await fireEvent.pointerLeave(zeroCache, { pointerType: 'mouse' });
    expect(visibleText(previewStatus)).toBe('Active scope By agent Beta 1K processed');

    await fireEvent.blur(beta);
    await fireEvent.focus(reasoning);
    expect(visibleText(previewStatus)).toBe('Active scope By model Model Reasoning 50 processed');
    expect(values()).toEqual([
      { value: '0', share: '0%' },
      { value: '0', share: '0%' },
      { value: '50', share: '100%' },
      { value: '0', share: '0%' },
    ]);
    expect(stripMetrics()).toEqual([{ metric: 'reasoning', width: 'calc(1 * (100% - 0px))' }]);

    await fireEvent.blur(reasoning);
    expect(visibleText(previewStatus)).toBe('Active scope Workspace 1K processed');
    expect(visibleText(disclosure)).toContain('1K tokens used');

    await fireEvent.pointerEnter(alpha, { pointerType: 'touch' });
    await fireEvent.pointerDown(alpha, { pointerType: 'touch' });
    await fireEvent.focus(alpha);
    expect(visibleText(previewStatus)).toBe('Active scope By agent Alpha 150 processed');
    expect(composition.querySelector('.message-composition-row')).toBeNull();
    await fireEvent.pointerDown(alpha, { pointerType: 'touch' });
    expect(visibleText(previewStatus)).toBe('Active scope Workspace 1K processed');

    beta.focus();
    await fireEvent.keyDown(beta, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(alpha);
    expect(alpha.getAttribute('aria-checked')).toBe('true');
    expect(visibleText(previewStatus)).toBe('Active scope By agent Alpha 150 processed');
    await fireEvent.keyDown(alpha, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(beta);
    await fireEvent.keyDown(beta, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(alpha);
    await fireEvent.keyDown(alpha, { key: 'Home' });
    expect(document.activeElement).toBe(beta);
    await fireEvent.keyDown(beta, { key: 'End' });
    expect(document.activeElement).toBe(alpha);
  });

  it('selects exact matrix totals from either navigator with pointer, focus, and touch', async () => {
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
      {
        agentId: 'agent-zero',
        model: 'model-zero',
        totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
        humanMessages: 1,
        agentMessages: 1,
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
      { id: 'agent-zero', name: 'Zero token agent' },
    ];

    await renderExpandedTokenUsage();

    const details = screen.getByTestId('token-usage-details');
    const status = details.querySelector('.preview-status')!;
    const composition = screen
      .getByRole('heading', { name: 'Token composition' })
      .closest('section')!;
    const messageCounts = () =>
      Array.from(details.querySelectorAll('.message-composition-label')).map((label) =>
        visibleText(label),
      );
    const values = () =>
      Array.from(details.querySelectorAll('.token-composition-row')).map((row) => ({
        value: visibleText(row.querySelector('.composition-value')!),
        share: visibleText(row.querySelector('.composition-context')!),
      }));
    const agentSection = screen.getByTestId('token-usage-by-agent');
    const modelSection = screen.getByTestId('token-usage-by-model');
    const alphaControl = within(agentSection).getByRole('radio', {
      name: 'By agent, Alpha: 160 tokens, 14%',
    });

    expect(messageCounts()).toEqual(['6 human messages', '7 agent messages']);
    expect(composition.classList).toContain('pb-3');
    const messageRows = Array.from(details.querySelectorAll('.message-composition-row'));
    expect(messageRows).toHaveLength(1);
    expect(
      messageRows.every((row) =>
        row.querySelector('.composition-metric')?.classList.contains('message-composition-metric'),
      ),
    ).toBe(true);
    expect(messageRows[0].querySelectorAll('.message-composition-label')).toHaveLength(2);
    expect(messageRows.every((row) => row.querySelector('.composition-value') === null)).toBe(true);
    expect(messageRows.every((row) => row.querySelector('.composition-context') === null)).toBe(
      true,
    );
    expect(screen.queryByTestId('token-usage-message-counts')).toBeNull();
    expect(
      Array.from(details.querySelectorAll('.composition-row')).map((row) =>
        visibleText(row.querySelector('.composition-metric')!),
      ),
    ).toEqual([
      'Cached context',
      'Model output',
      'Reasoning tokens',
      'Input context',
      '6 human messages 7 agent messages',
    ]);
    expect(visibleText(status)).toBe('Active scope By agent Beta 1K processed');
    expect(
      screen
        .getByRole('heading', { name: 'Token composition' })
        .compareDocumentPosition(agentSection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(agentSection.querySelectorAll('.breakdown-item-control')).toHaveLength(2);
    expect(modelSection.querySelectorAll('.breakdown-item-control')).toHaveLength(2);
    expect(within(agentSection).queryByRole('radio', { name: /Zero token agent/ })).toBeNull();
    expect(within(modelSection).queryByRole('radio', { name: /model-zero/ })).toBeNull();

    await fireEvent.pointerEnter(alphaControl, { pointerType: 'mouse' });
    expect(visibleText(status)).toBe('Active scope By agent Alpha 160 processed');
    expect(messageCounts()).toEqual(['3 human messages', '4 agent messages']);
    expect(values()).toEqual([
      { value: '70', share: '44%' },
      { value: '25', share: '16%' },
      { value: '50', share: '31%' },
      { value: '15', share: '9%' },
    ]);
    expect(agentSection.querySelectorAll('.breakdown-stack-item')).toHaveLength(2);
    expect(modelSection.querySelectorAll('.breakdown-stack-item')).toHaveLength(2);
    expect(screen.queryByTestId('token-usage-total-cost')).toBeNull();
    expect(visibleText(details)).not.toMatch(/cost|\$/i);

    await fireEvent.pointerLeave(alphaControl, { pointerType: 'mouse' });
    expect(visibleText(status)).toBe('Active scope By agent Beta 1K processed');

    const modelA = within(modelSection).getByRole('radio', {
      name: 'By model, Model A: 350 tokens, 30%',
    });
    await fireEvent.focus(modelA);
    expect(visibleText(status)).toBe('Active scope By model Model A 350 processed');
    expect(messageCounts()).toEqual(['6 human messages', '5 agent messages']);
    expect(agentSection.querySelectorAll('.breakdown-stack-item')).toHaveLength(2);
    await fireEvent.blur(modelA);

    await fireEvent.pointerDown(alphaControl, { pointerType: 'touch' });
    expect(visibleText(status)).toBe('Active scope By agent Alpha 160 processed');
    expect(messageCounts()).toEqual(['3 human messages', '4 agent messages']);
    await fireEvent.pointerDown(alphaControl, { pointerType: 'touch' });
    expect(visibleText(status)).toBe('Active scope By agent Beta 1K processed');

    const modelB = within(modelSection).getByRole('radio', {
      name: 'By model, Model B: 810 tokens, 70%',
    });
    await fireEvent.pointerDown(modelB, { pointerType: 'touch' });
    expect(visibleText(status)).toBe('Active scope By model Model B 810 processed');
    expect(messageCounts()).toEqual(['3 human messages', '6 agent messages']);
    await fireEvent.pointerDown(modelB, { pointerType: 'touch' });
    expect(visibleText(status)).toBe('Active scope By agent Beta 1K processed');
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

    expect(
      screen.getByTestId('token-usage-disclosure').querySelector('[aria-hidden="true"]')
        ?.textContent,
    ).toBe('4K');

    const modelSection = screen.getByTestId('token-usage-by-model');
    const agentSection = screen.getByTestId('token-usage-by-agent');
    expect(visibleText(modelSection)).toBe('By model Model Big 100%');
    expect(visibleText(agentSection)).toBe('By agent Alpha 100%');
    const composition = screen
      .getByRole('heading', { name: 'Token composition' })
      .closest('section')!;
    const reasoningRow = composition.querySelectorAll('.composition-row')[2];
    expect(visibleText(reasoningRow)).toBe('Reasoning tokens 4K 99%');
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

    expect(
      screen.getByTestId('token-usage-disclosure').querySelector('[aria-hidden="true"]')
        ?.textContent,
    ).toBe('30');
    const modelSection = screen.getByTestId('token-usage-by-model');
    expect(visibleText(modelSection)).toBe('By model Model Big 100%');
    const composition = screen
      .getByRole('heading', { name: 'Token composition' })
      .closest('section')!;
    const reasoningRow = composition.querySelectorAll('.composition-row')[2];
    expect(visibleText(reasoningRow)).toBe('Reasoning tokens 0 0%');
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

    await renderExpandedTokenUsage();

    expect(screen.getByTestId('workspace-token-usage')).not.toBeNull();
    expect(screen.getByTestId('token-usage-by-model').textContent).toContain('Model Big');
    expect(screen.getByTestId('token-usage-by-agent').textContent).toContain('Alpha');
  });

  it('does not expose provider-reported cost in visible or accessible output', async () => {
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
    expect(visibleText(modelSection)).toBe('By model Model Big 100%');
    expect(visibleText(agentSection)).toBe('By agent Alpha 100%');
    const details = screen.getByTestId('token-usage-details');
    expect(visibleText(details)).not.toMatch(/cost|\$/i);
    expect(screen.queryByText(/total cost/i)).toBeNull();
    expect(screen.queryByTestId('token-usage-total-cost')).toBeNull();
    expect(
      Array.from(details.querySelectorAll('[aria-label], [aria-description], [title]')).every(
        (element) =>
          !Array.from(element.attributes).some((attribute) => /cost|\$/i.test(attribute.value)),
      ),
    ).toBe(true);
  });

  it('does not expose model cost when no workspace total cost is reported', async () => {
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

    const details = screen.getByTestId('token-usage-details');
    expect(visibleText(details)).not.toMatch(/cost|\$|—/i);
    expect(screen.queryByTestId('token-usage-total-cost')).toBeNull();
  });

  it('does not add cost output when no provider cost is reported', async () => {
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

    const details = screen.getByTestId('token-usage-details');
    expect(visibleText(details)).not.toMatch(/cost|\$/i);
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
