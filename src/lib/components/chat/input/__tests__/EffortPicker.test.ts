// @vitest-environment jsdom

/**
 * EffortPicker — the session-level reasoning-effort control next to the model
 * picker. Covers the hidden-without-levels gate, the centered provider-default
 * step plus one step per advertised level, the commit path
 * (`agent.update` via the AppClient seam + the session-field dispatch), and
 * re-derivation when the session's model changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
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
  faGaugeHigh: { iconName: 'gauge-high' },
}));

vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const Button = (await import('../../../ui/__tests__/mocks/button.svelte')).default;
  return { default: Button };
});

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

  it('renders nothing when the session model advertises no effort levels', () => {
    mount({ id: 'agent-1', workspaceId: 'ws-1', model: 'auggie:butler' });
    expect(screen.queryByTestId('effort-picker-trigger')).toBeFalsy();
  });

  it('renders for an effort-capable provider model inherited by the session', () => {
    inheritedModel = 'gpt5.6-sol';
    mount({ id: 'agent-1', workspaceId: 'ws-1', model: null });

    expect(trigger().getAttribute('aria-label')).toContain('Low');
    expect(screen.getByTestId('effort-gauge')).toBeTruthy();
  });

  it('renders an icon-only gauge with a concrete resolved level in its accessible label', () => {
    mount({ id: 'agent-1', workspaceId: 'ws-1', model: 'codex:gpt-5.3-codex' });
    expect(trigger().getAttribute('aria-label')).toContain('Low');
    expect(trigger().textContent?.trim()).toBe('');
    expect(screen.getByTestId('effort-gauge').dataset.gaugeValue).toBe('0');
    expect(screen.getByTestId('effort-gauge').dataset.gaugeCentered).toBe('true');
    expect(screen.getByTestId('effort-gauge-needle').getAttribute('style')).toContain(
      'rotate(0deg)',
    );
    expect(trigger().dataset.size).toBe('icon-sm');
    expect(screen.getByTestId('effort-gauge').getAttribute('width')).toBe('16');
    expect(screen.getByTestId('effort-gauge').getAttribute('height')).toBe('16');
  });

  it('reuses the slider content without a trigger or popover in embedded mode', async () => {
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

    expect(screen.queryByTestId('effort-picker-trigger')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    const content = screen.getByTestId('effort-picker-content');
    expect(content.textContent).not.toContain('Reasoning effort');
    expect(screen.queryByTestId('effort-current-value')).toBeNull();
    const nextSendCaption = screen.getByText('Applies on the next message you send.');
    expect(nextSendCaption).toBeTruthy();
    expect(nextSendCaption.className).toContain('text-muted-foreground');
    expect(nextSendCaption.parentElement?.className).toContain('justify-between');
    const gauge = screen.getByTestId('effort-gauge');
    expect(nextSendCaption.parentElement?.contains(gauge)).toBe(true);
    expect(gauge.dataset.gaugeValue).toBe('0');
    expect(gauge.dataset.gaugeCentered).toBe('false');
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('max')).toBe('2');
    expect(slider.getAttribute('aria-valuetext')).toBe('Low');
    expect(screen.getAllByTestId('effort-slider-tick')).toHaveLength(3);

    await fireEvent.change(slider, { target: { value: '2' } });
    expect(onEffortChange).toHaveBeenCalledWith('high');
    expect(gauge.dataset.gaugeValue).toBe('1');
    expect(applyReasoningEffort).not.toHaveBeenCalled();
  });

  it('represents the current effort level on the gauge', () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.3-codex',
      reasoningEffort: 'high',
    });
    expect(trigger().getAttribute('aria-label')).toContain('High');
    expect(screen.getByTestId('effort-gauge').dataset.gaugeValue).toBe('2');
    expect(screen.getByTestId('effort-gauge').dataset.gaugeCentered).toBe('false');
  });

  it('updates the label, stable ticks, and animated gauge live while sliding', async () => {
    mount({ id: 'agent-1', workspaceId: 'ws-1', model: 'codex:gpt-5.3-codex' });
    await fireEvent.click(trigger());

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /reasoning effort/i })).toBeTruthy();
    });
    expect(screen.getByRole('dialog').textContent).toContain('Reasoning effort');

    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('max')).toBe('4');
    expect(slider.className).toContain('operate-slider');
    expect(screen.getAllByTestId('effort-slider-tick')).toHaveLength(5);
    expect((slider as HTMLInputElement).valueAsNumber).toBe(2);
    expect(screen.getByTestId('effort-current-value').textContent?.trim()).toBe('Low');
    expect(screen.getByRole('dialog').textContent).not.toContain('Default');
    expect(screen.queryByTestId('effort-gauge-popover')).toBeNull();
    expect(
      screen
        .getAllByTestId('effort-slider-tick')
        .every((tick) => tick.className.includes('h-3 w-px')),
    ).toBe(true);

    await fireEvent.input(slider, { target: { value: '3' } });
    expect(slider.getAttribute('aria-valuetext')).toBe('High');
    expect(screen.getByTestId('effort-current-value').textContent?.trim()).toBe('High');
    expect(
      screen.getByTestId('effort-current-value').querySelector('[data-motion-direction]')?.dataset
        .motionDirection,
    ).toBe('up');
    expect(screen.getByTestId('effort-gauge').dataset.gaugeValue).toBe('2');
    expect(screen.getByTestId('effort-gauge-needle').className.baseVal).toContain(
      'transition-transform',
    );
    const markers = screen.getAllByTestId('effort-slider-tick-marker');
    expect(markers.every((marker) => marker.className.includes('w-px'))).toBe(true);

    await fireEvent.input(slider, { target: { value: '1' } });
    expect(screen.getByTestId('effort-current-value').textContent?.trim()).toBe('Medium');
    expect(
      screen.getByTestId('effort-current-value').querySelector('[data-motion-direction]')?.dataset
        .motionDirection,
    ).toBe('down');
  });

  it('commits the selected level, passing the previous effort for rollback', async () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.3-codex',
      reasoningEffort: 'low',
    });
    await fireEvent.click(trigger());

    const slider = await waitFor(() => screen.getByRole('slider'));
    await fireEvent.change(slider, { target: { value: '3' } });

    await waitFor(() => {
      expect(applyReasoningEffort).toHaveBeenCalledWith('agent-1', 'ws-1', 'high', 'low');
    });
  });

  it('commits the centered provider-default step as null to clear the session field', async () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.3-codex',
      reasoningEffort: 'high',
    });
    await fireEvent.click(trigger());

    const slider = await waitFor(() => screen.getByRole('slider'));
    await fireEvent.change(slider, { target: { value: '2' } });

    await waitFor(() => {
      expect(applyReasoningEffort).toHaveBeenCalledWith('agent-1', 'ws-1', null, 'high');
    });
  });

  it('commits the provider default to clear an unsupported persisted effort', async () => {
    // `gpt-5.1-codex-max` advertises only low/high, so the stale `xhigh`
    // already renders at the centered null position, which must still
    // clear it on the daemon rather than no-op.
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.1-codex-max',
      reasoningEffort: 'xhigh',
    });
    await fireEvent.click(trigger());

    const slider = await waitFor(() => screen.getByRole('slider'));
    expect((slider as HTMLInputElement).valueAsNumber).toBe(1);
    await fireEvent.change(slider, { target: { value: '1' } });

    await waitFor(() => {
      expect(applyReasoningEffort).toHaveBeenCalledWith('agent-1', 'ws-1', null, 'xhigh');
    });
  });

  it('does not commit when the slider lands back on the current level', async () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.3-codex',
      reasoningEffort: 'high',
    });
    await fireEvent.click(trigger());

    const slider = await waitFor(() => screen.getByRole('slider'));
    await fireEvent.change(slider, { target: { value: '3' } });

    expect(applyReasoningEffort).not.toHaveBeenCalled();
  });

  it('re-derives levels on a model switch and resolves unsupported effort concretely', async () => {
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
      expect(trigger().getAttribute('aria-label')).toContain('Low');
    });

    await fireEvent.click(trigger());
    const slider = await waitFor(() => screen.getByRole('slider'));
    expect(slider.getAttribute('max')).toBe('2');
    expect(screen.getAllByTestId('effort-slider-tick')).toHaveLength(3);
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
