// @vitest-environment jsdom

/**
 * EffortPicker — the session-level reasoning-effort control next to the model
 * picker. Covers the hidden-without-levels gate, the step ordering (a leading
 * "Default" step plus one step per advertised level), the commit path
 * (`agent.update` via the AppClient seam + the session-field dispatch), and
 * re-derivation when the session's model changes.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/svelte';
import { writable } from 'svelte/store';

type Session = { id: string; workspaceId: string; model?: string; reasoningEffort?: string | null };

const sessions = new Map<string, Session>();
const sessionVersion$ = writable(0);
const modelEffortLevels = new Map<string, string[]>();

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
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ state: () => ({ sessions }), dispatch: mockDispatch });
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentReasoningEffort: Object.assign(
    (agentIdStore: Parameters<typeof selectorReadable>[0]) =>
      selectorReadable(agentIdStore, (agentId) => sessions.get(agentId)?.reasoningEffort ?? undefined),
    { select: (_state: unknown, agentId: string) => sessions.get(agentId)?.reasoningEffort },
  ),
}));

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectAgentModelEffortLevels: Object.assign(
    (agentIdStore: Parameters<typeof selectorReadable>[0]) =>
      selectorReadable(agentIdStore, (agentId) => {
        const model = sessions.get(agentId)?.model;
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

  it('renders the Default label when the session has no explicit effort', () => {
    mount({ id: 'agent-1', workspaceId: 'ws-1', model: 'codex:gpt-5.3-codex' });
    expect(trigger().textContent ?? '').toContain('Default');
  });

  it('renders the current effort level on the trigger', () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.3-codex',
      reasoningEffort: 'high',
    });
    expect(trigger().textContent ?? '').toContain('High');
  });

  it('renders one slider step per advertised level, in catalog order, after Default', async () => {
    mount({ id: 'agent-1', workspaceId: 'ws-1', model: 'codex:gpt-5.3-codex' });
    await fireEvent.click(trigger());

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /reasoning effort/i })).toBeTruthy();
    });

    const labels = screen.getAllByTestId('effort-step-label').map((el) => el.textContent?.trim());
    expect(labels).toEqual(['Default', 'Low', 'Medium', 'High', 'Extra high']);

    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('max')).toBe('4');
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

  it('commits the Default step as an explicit null to clear the session field', async () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.3-codex',
      reasoningEffort: 'high',
    });
    await fireEvent.click(trigger());

    const slider = await waitFor(() => screen.getByRole('slider'));
    await fireEvent.change(slider, { target: { value: '0' } });

    await waitFor(() => {
      expect(applyReasoningEffort).toHaveBeenCalledWith('agent-1', 'ws-1', null, 'high');
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

  it('re-derives levels on a model switch and falls back to Default for an unsupported effort', async () => {
    mount({
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.3-codex',
      reasoningEffort: 'xhigh',
    });
    expect(trigger().textContent ?? '').toContain('Extra high');

    sessions.set('agent-1', {
      id: 'agent-1',
      workspaceId: 'ws-1',
      model: 'codex:gpt-5.1-codex-max',
      reasoningEffort: 'xhigh',
    });
    bumpVersion();

    await waitFor(() => {
      expect(trigger().textContent ?? '').toContain('Default');
    });

    await fireEvent.click(trigger());
    const labels = await waitFor(() =>
      screen.getAllByTestId('effort-step-label').map((el) => el.textContent?.trim()),
    );
    expect(labels).toEqual(['Default', 'Low', 'High']);
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
