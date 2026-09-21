// @vitest-environment jsdom

/**
 * EffortPicker — the session-level reasoning-effort control next to the model
 * picker. Covers the hidden-without-levels gate, Auto plus each provider level,
 * the canonical select interaction, the commit path
 * (`agent.update` via the AppClient seam + the session-field dispatch), and
 * re-derivation when the session's model changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { writable } from 'svelte/store';

type Session = {
  id: string;
  workspaceId: string;
  model?: string | null;
  reasoningEffort?: string | null;
};

const sessions = new Map<string, Session>();
const sessionVersion$ = writable(0);
const modelEffortLevels = new Map<string, string[]>();
let inheritedModel: string | undefined;

const bumpVersion = () => sessionVersion$.update((value) => value + 1);

const mockDispatch = vi.hoisted(() => vi.fn());
const applyReasoningEffort = vi.hoisted(() => vi.fn(async () => true));

function selectorReadable<T>(
  agentIdStore: { subscribe: (run: (value: string) => void) => () => void },
  compute: (agentId: string) => T,
) {
  return {
    subscribe(run: (value: T) => void) {
      let currentAgentId = '';
      const emit = () => run(compute(currentAgentId));
      const unsubscribeId = agentIdStore.subscribe((value) => {
        currentAgentId = value;
        emit();
      });
      const unsubscribeVersion = sessionVersion$.subscribe(emit);
      return () => {
        unsubscribeId();
        unsubscribeVersion();
      };
    },
  };
}

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faChevronDown: { iconName: 'chevron-down' },
}));

vi.mock('$features/agent/reasoning-effort', () => ({ applyReasoningEffort }));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({ sessions }), dispatch: mockDispatch });
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentReasoningEffort: Object.assign(
    (agentIdStore: Parameters<typeof selectorReadable>[0]) =>
      selectorReadable(
        agentIdStore,
        (agentId) => sessions.get(agentId)?.reasoningEffort ?? undefined,
      ),
    { select: (_state: unknown, agentId: string) => sessions.get(agentId)?.reasoningEffort },
  ),
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectAgentModelEffortLevels: Object.assign(
    (agentIdStore: Parameters<typeof selectorReadable>[0]) =>
      selectorReadable(agentIdStore, (agentId) => {
        const model = sessions.get(agentId)?.model ?? inheritedModel;
        return model ? modelEffortLevels.get(model) : undefined;
      }),
    { select: () => undefined },
  ),
}));

import EffortPicker from '../EffortPicker.svelte';

describe('EffortPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyReasoningEffort.mockResolvedValue(true);
    sessions.clear();
    modelEffortLevels.clear();
    modelEffortLevels.set('codex:gpt-5.3-codex', ['low', 'medium', 'high', 'xhigh']);
    modelEffortLevels.set('codex:gpt-5.1-codex-max', ['low', 'high']);
    modelEffortLevels.set('gpt5.6-sol', ['low', 'medium', 'high', 'max']);
    modelEffortLevels.set('provider:off-capable', ['none', 'low', 'ultra']);
    inheritedModel = undefined;
    sessionVersion$.set(0);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  function mount(session: Session) {
    sessions.set(session.id, session);
    bumpVersion();
    return render(EffortPicker, {
      props: { agentId: session.id, workspaceId: session.workspaceId },
    });
  }

  const trigger = () => screen.getByTestId('effort-picker-trigger');

  async function openSelect() {
    await fireEvent.click(trigger());
    return await screen.findByRole('listbox');
  }

  async function selectOption(listbox: HTMLElement, name: string) {
    await fireEvent.pointerUp(within(listbox).getByRole('option', { name }), {
      pointerType: 'mouse',
    });
  }

  it('renders nothing when the session model advertises no effort levels', () => {
    mount({ id: 'agent-1', workspaceId: 'ws-1', model: 'auggie:butler' });
    expect(screen.queryByTestId('effort-picker-trigger')).toBeFalsy();
  });

  it('renders for an effort-capable provider model inherited by the session', () => {
    inheritedModel = 'gpt5.6-sol';
    mount({ id: 'agent-1', workspaceId: 'ws-1', model: null });

    expect(trigger().getAttribute('aria-label')).toContain('Auto');
    expect(trigger().textContent).toContain('Auto');
  });

  it('renders a compact canonical select without slider-only UI', () => {
    mount({ id: 'agent-1', workspaceId: 'ws-1', model: 'codex:gpt-5.3-codex' });
    expect(trigger().getAttribute('aria-label')).toContain('Auto');
    expect(trigger().textContent?.trim()).toContain('Reasoning effort · Auto');
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger().className).toContain('h-7');
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByTestId('effort-gauge')).toBeNull();
    expect(screen.queryByTestId('effort-slider-tick')).toBeNull();
  });

  it('uses an owned portalled select in embedded mode', async () => {
    const onEffortChange = vi.fn(async () => true);
    render(EffortPicker, {
      props: {
        mode: 'embedded',
        agentId: 'agent-1',
        workspaceId: 'ws-1',
        effortLevels: ['low', 'high'],
        effort: 'low',
        onEffortChange,
      },
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    const content = screen.getByTestId('effort-picker-content');
    expect(content.textContent).toContain('Reasoning effort');
    expect(trigger().textContent?.trim()).toBe('Low');
    const gauge = screen.getByTestId('effort-gauge');
    expect(screen.getByText('Reasoning effort').nextElementSibling).toBe(gauge);
    expect(gauge.dataset.gaugeValue).toBe('0');
    expect(gauge.className.baseVal).toContain('[&_line]:transition-none!');

    const listbox = await openSelect();
    expect(content.contains(listbox)).toBe(false);
    expect(
      document.getElementById(trigger().getAttribute('aria-controls')!)?.contains(listbox),
    ).toBe(true);
    expect(within(listbox).getAllByRole('option')).toHaveLength(3);
    await selectOption(listbox, 'High');
    expect(onEffortChange).toHaveBeenCalledWith('high');
    expect(applyReasoningEffort).not.toHaveBeenCalled();
  });

  it('shows the localized current effort label', () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.3-codex',
      reasoningEffort: 'high',
    });
    expect(trigger().getAttribute('aria-label')).toContain('High');
    expect(trigger().textContent).toContain('High');
    const gauge = screen.getByTestId('effort-gauge');
    expect(trigger().contains(gauge)).toBe(true);
    expect(screen.getByText('Reasoning effort').nextElementSibling).toBe(gauge);
    expect(gauge.dataset.gaugeValue).toBe('2');
  });

  it('hides the dial for standalone and embedded Auto selections', () => {
    mount({ id: 'agent-1', workspaceId: 'ws-1', model: 'codex:gpt-5.3-codex' });
    expect(screen.queryByTestId('effort-gauge')).toBeNull();
    cleanup();

    render(EffortPicker, {
      props: { mode: 'embedded', effortLevels: ['low', 'high'], effort: null },
    });
    expect(screen.queryByTestId('effort-gauge')).toBeNull();
  });

  it('lists Auto followed by localized provider levels in their advertised order', async () => {
    mount({ id: 'agent-1', workspaceId: 'ws-1', model: 'codex:gpt-5.3-codex' });
    const listbox = await openSelect();
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent?.replace('✓', '').trim()),
    ).toEqual(['Auto', 'Low', 'Medium', 'High', 'Extra high']);
    expect(applyReasoningEffort).not.toHaveBeenCalled();
  });

  it('labels explicit none as Off while preserving provider order and exact commits', async () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'provider:off-capable',
      reasoningEffort: 'none',
    });

    expect(trigger().textContent).toContain('Off');
    expect(trigger().getAttribute('aria-label')).toContain('Off');
    const listbox = await openSelect();
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent?.replace('✓', '').trim()),
    ).toEqual(['Auto', 'Off', 'Low', 'ultra']);
    expect(applyReasoningEffort).not.toHaveBeenCalled();
    await selectOption(listbox, 'Auto');
    expect(screen.queryByTestId('effort-gauge')).toBeNull();

    await waitFor(() => {
      expect(applyReasoningEffort).toHaveBeenCalledWith('agent-1', 'ws-1', null, 'none');
    });
  });

  it('commits the exact explicit none value separately from Auto', async () => {
    mount({ id: 'agent-1', workspaceId: 'ws-1', model: 'provider:off-capable' });
    const listbox = await openSelect();
    await selectOption(listbox, 'Off');
    expect(screen.getByTestId('effort-gauge')).toBeTruthy();

    await waitFor(() => {
      expect(applyReasoningEffort).toHaveBeenCalledWith('agent-1', 'ws-1', 'none', null);
    });
  });

  it('commits the selected level, passing the previous effort for rollback', async () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.3-codex',
      reasoningEffort: 'low',
    });
    const listbox = await openSelect();
    await selectOption(listbox, 'High');

    await waitFor(() => {
      expect(applyReasoningEffort).toHaveBeenCalledWith('agent-1', 'ws-1', 'high', 'low');
    });
  });

  it('commits Auto as null to clear the session field', async () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.3-codex',
      reasoningEffort: 'high',
    });
    const listbox = await openSelect();
    await selectOption(listbox, 'Auto');

    await waitFor(() => {
      expect(applyReasoningEffort).toHaveBeenCalledWith('agent-1', 'ws-1', null, 'high');
    });
  });

  it('commits the provider default to clear an unsupported persisted effort', async () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.1-codex-max',
      reasoningEffort: 'xhigh',
    });
    expect(trigger().textContent).toContain('Auto');
    const listbox = await openSelect();
    expect(applyReasoningEffort).not.toHaveBeenCalled();
    await selectOption(listbox, 'Auto');

    await waitFor(() => {
      expect(applyReasoningEffort).toHaveBeenCalledWith('agent-1', 'ws-1', null, 'xhigh');
    });
  });

  it('does not commit when merely opened or when the current level is selected', async () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.3-codex',
      reasoningEffort: 'high',
    });
    const listbox = await openSelect();
    expect(applyReasoningEffort).not.toHaveBeenCalled();
    await selectOption(listbox, 'High');

    expect(applyReasoningEffort).not.toHaveBeenCalled();
  });

  it('re-derives levels on a model switch and resolves unsupported effort to Auto', async () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.3-codex',
      reasoningEffort: 'xhigh',
    });
    expect(trigger().getAttribute('aria-label')).toContain('Extra high');

    sessions.set('agent-1', {
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.1-codex-max',
      reasoningEffort: 'xhigh',
    });
    bumpVersion();

    await waitFor(() => {
      expect(trigger().getAttribute('aria-label')).toContain('Auto');
    });
    expect(screen.queryByTestId('effort-gauge')).toBeNull();

    const listbox = await openSelect();
    expect(within(listbox).getAllByRole('option')).toHaveLength(3);
    expect(within(listbox).getByRole('option', { name: 'Auto' })).toBeTruthy();
  });

  it('delegates keyboard navigation, Escape, and focus restoration to the canonical select', async () => {
    const onEffortChange = vi.fn(async () => true);
    render(EffortPicker, {
      props: {
        mode: 'embedded',
        effortLevels: ['low', 'medium', 'high'],
        effort: 'low',
        onEffortChange,
      },
    });

    const selectTrigger = trigger();
    selectTrigger.focus();
    await fireEvent.keyDown(selectTrigger, { key: 'Enter' });
    expect(screen.getByRole('listbox')).toBeTruthy();
    await fireEvent.keyDown(selectTrigger, { key: 'ArrowDown' });
    await fireEvent.keyDown(selectTrigger, { key: 'Enter' });
    expect(onEffortChange).toHaveBeenLastCalledWith('medium');
    expect(document.activeElement).toBe(selectTrigger);

    await fireEvent.keyDown(selectTrigger, { key: 'Enter' });
    await fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(selectTrigger);
  });

  it('uses the canonical disabled state', () => {
    render(EffortPicker, {
      props: { mode: 'embedded', effortLevels: ['low', 'high'], disabled: true },
    });
    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides the control once the session switches to a model without effort levels', async () => {
    mount({ id: 'agent-1', workspaceId: 'ws-1', model: 'codex:gpt-5.3-codex' });
    expect(screen.queryByTestId('effort-picker-trigger')).toBeTruthy();

    sessions.set('agent-1', { id: 'agent-1', workspaceId: 'ws-1', model: 'auggie:butler' });
    bumpVersion();

    await waitFor(() => {
      expect(screen.queryByTestId('effort-picker-trigger')).toBeFalsy();
    });
  });
});
