/**
 * @vitest-environment jsdom
 *
 * Covers the Agents-tab "Default model" picker: it must delegate entirely to
 * `selectSelectedModel` / `ModelPicker` and never fabricate a model (e.g.
 * opus4.7) when the active provider is unavailable — see spec "Fix:
 * Augment/Auggie leaks as default provider & model".
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });
  const writable = <T>(initial: T) => {
    let value = initial;
    const subs = new Set<(v: T) => void>();
    return {
      subscribe(run: (v: T) => void) {
        subs.add(run);
        run(value);
        return () => subs.delete(run);
      },
      set(v: T) {
        value = v;
        for (const run of subs) run(v);
      },
    };
  };
  return {
    readable,
    writable,
    specialists$: writable<unknown[]>([]),
    fileSpecialists$: writable<unknown[]>([]),
    defaultEffort$: writable<string>(''),
    effectivePrompt: { value: '' },
    explicitEffort: { value: undefined as string | undefined },
    effortLevels: { value: {} as Record<string, string[] | undefined> },
    // Model ids the loaded `availableModels` catalog knows about — drives the
    // selectModelDisplayName lookup that gates default-effort clearing.
    catalogModels: { value: [] as string[] },
    dispatched: [] as { type: string; payload: unknown[] }[],
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: (action: { type: string; payload: unknown[] }) => {
      mocks.dispatched.push(action);
    },
  });
});

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: () => mocks.specialists$,
  selectFileSpecialists: () => mocks.fileSpecialists$,
  selectIsBuiltIn: { select: () => true },
  selectIsFileBased: { select: () => false },
  selectEffectiveModel: { select: () => '' },
  selectExplicitModel: { select: () => undefined },
  selectEffectiveBehaviorPrompt: { select: () => mocks.effectivePrompt.value },
  selectGetFileSpecialist: { select: () => undefined },
  selectHasOverrides: { select: () => false },
  selectBundledSpecialists: { select: () => [] },
  selectSpecialistFilePath: { select: () => undefined },
  selectSpecialistSourceLabel: { select: () => null },
  selectSpecialistsFolderPath: () => mocks.readable(''),
  selectEffectiveCodingAgent: { select: () => '' },
  selectExplicitReasoningEffort: { select: () => mocks.explicitEffort.value },
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectActiveWorkspace: { select: () => undefined },
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => mocks.readable('auggie'),
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-slice', () => ({
  setActiveProvider: (id: string) => ({ type: 'providerSettings/setActiveProvider', payload: [id] }),
}));

vi.mock('$store/renderer/slices/model/model-slice', () => ({
  reloadModelsForProvider: () => ({ type: 'model/reloadModelsForProvider', payload: [] }),
  setDefaultReasoningEffort: (effort: string) => ({
    type: 'model/setDefaultReasoningEffort',
    payload: [effort],
  }),
}));

vi.mock('$store/renderer/slices/specialists/specialists-slice', () => ({
  deleteFileSpecialist: (ref: unknown) => ({
    type: 'specialists/deleteFileSpecialist',
    payload: [ref],
  }),
  saveFileSpecialist: (payload: unknown) => ({
    type: 'specialists/saveFileSpecialist',
    payload: [payload],
  }),
}));

const selectedModel$ = vi.hoisted(() => {
  let value = '';
  const subs = new Set<(v: string) => void>();
  return {
    subscribe(run: (v: string) => void) {
      subs.add(run);
      run(value);
      return () => subs.delete(run);
    },
    set(v: string) {
      value = v;
      for (const run of subs) run(v);
    },
  };
});

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: () => selectedModel$,
  selectDefaultReasoningEffort: () => mocks.defaultEffort$,
  selectAvailableModels: () => mocks.readable([]),
  selectModelEffortLevels: {
    select: (_state: unknown, modelId?: string) =>
      modelId ? mocks.effortLevels.value[modelId] : undefined,
  },
  selectModelDisplayName: {
    select: (_state: unknown, providerId: string, modelId: string) =>
      mocks.catalogModels.value.includes(`${providerId}:${modelId}`) ||
      mocks.catalogModels.value.includes(modelId)
        ? modelId
        : undefined,
  },
}));

vi.mock('./AgentRulesEditor.svelte', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/chat/input/ModelPicker.svelte', async () => ({
  default: (
    await import('../workspace/initializer/__tests__/mocks/MockModelPicker.svelte')
  ).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import AIBehaviorEditor from './AIBehaviorEditor.svelte';

describe('AIBehaviorEditor Default model picker', () => {
  afterEach(() => {
    cleanup();
    selectedModel$.set('');
  });

  it('never shows a fabricated opus4.7/Auggie model when nothing is resolvable', () => {
    selectedModel$.set('');
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    expect(screen.getByTestId('picker-selected').textContent).toBe('');
    expect(screen.queryByText(/opus4\.7/)).toBeNull();
  });

  it('passes through a resolved model for an available provider unchanged', () => {
    selectedModel$.set('claude-code:sonnet4.5');
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    expect(screen.getByTestId('picker-selected').textContent).toBe('claude-code:sonnet4.5');
  });
});

describe('AIBehaviorEditor default reasoning-effort dropdown', () => {
  const DEFAULT_MODEL = 'codex:gpt-5.3-codex';

  afterEach(() => {
    cleanup();
    selectedModel$.set('');
    mocks.defaultEffort$.set('');
    mocks.effortLevels.value = {};
    mocks.catalogModels.value = [];
    mocks.dispatched.length = 0;
  });

  const lastEffortDispatch = () =>
    mocks.dispatched.filter((a) => a.type === 'model/setDefaultReasoningEffort').at(-1);

  it('renders no dropdown when the default model advertises no effort levels', () => {
    selectedModel$.set('bare-model');
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    expect(screen.queryByTestId('default-effort')).toBeNull();
  });

  it('lists the default model effort levels plus Default', async () => {
    mocks.effortLevels.value = { [DEFAULT_MODEL]: ['low', 'medium', 'high'] };
    selectedModel$.set(DEFAULT_MODEL);
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    const wrapper = screen.getByTestId('default-effort');
    expect(wrapper.textContent).toContain('Default');

    await fireEvent.click(wrapper.querySelector('button')!);
    for (const level of ['low', 'medium', 'high']) {
      expect(screen.getByText(level)).toBeTruthy();
    }
  });

  it('dispatches the picked level and clears it back to empty on Default', async () => {
    mocks.effortLevels.value = { [DEFAULT_MODEL]: ['low', 'high'] };
    selectedModel$.set(DEFAULT_MODEL);
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    await fireEvent.click(screen.getByTestId('default-effort').querySelector('button')!);
    await fireEvent.click(screen.getByText('high'));
    expect(lastEffortDispatch()).toEqual({
      type: 'model/setDefaultReasoningEffort',
      payload: ['high'],
    });

    mocks.defaultEffort$.set('high');
    await fireEvent.click(screen.getByTestId('default-effort').querySelector('button')!);
    await fireEvent.click(screen.getByText('Default'));
    expect(lastEffortDispatch()).toEqual({
      type: 'model/setDefaultReasoningEffort',
      payload: [''],
    });
  });

  it('clears the stored level when the default model changes to one lacking it', async () => {
    mocks.effortLevels.value = { [DEFAULT_MODEL]: ['low', 'high'] };
    mocks.catalogModels.value = [DEFAULT_MODEL, 'user-picked-model'];
    selectedModel$.set(DEFAULT_MODEL);
    mocks.defaultEffort$.set('high');
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    // MockModelPicker picks 'user-picked-model', which has no effortLevels.
    await fireEvent.click(screen.getByTestId('pick-model'));

    expect(lastEffortDispatch()).toEqual({
      type: 'model/setDefaultReasoningEffort',
      payload: [''],
    });
  });

  it('keeps the stored level when the new default model still advertises it', async () => {
    mocks.effortLevels.value = {
      [DEFAULT_MODEL]: ['low', 'high'],
      'user-picked-model': ['high'],
    };
    mocks.catalogModels.value = [DEFAULT_MODEL, 'user-picked-model'];
    selectedModel$.set(DEFAULT_MODEL);
    mocks.defaultEffort$.set('high');
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    await fireEvent.click(screen.getByTestId('pick-model'));

    expect(lastEffortDispatch()).toBeUndefined();
  });

  it('keeps the stored level for a model the loaded catalog does not know', async () => {
    // Cross-provider pick: the global catalog holds only the current
    // provider's rows, so the newly picked model resolves no effortLevels.
    // That is a lookup miss, not "no effort support" — clearing here would
    // drop a level the new model may well advertise once its catalog loads.
    mocks.effortLevels.value = { [DEFAULT_MODEL]: ['low', 'high'] };
    mocks.catalogModels.value = [DEFAULT_MODEL];
    selectedModel$.set(DEFAULT_MODEL);
    mocks.defaultEffort$.set('high');
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    await fireEvent.click(screen.getByTestId('pick-model'));

    expect(lastEffortDispatch()).toBeUndefined();
  });
});

describe('AIBehaviorEditor specialist prompt reactivity', () => {
  const specialist = {
    id: 'implementor',
    name: 'Implementor',
    description: 'Implements tasks',
    defaultBehaviorPrompt: 'bundled prompt',
  };

  afterEach(() => {
    cleanup();
    mocks.specialists$.set([]);
    mocks.fileSpecialists$.set([]);
    mocks.effectivePrompt.value = '';
  });

  it('resyncs the prompt textarea when file specialists refetch after a save', async () => {
    mocks.effectivePrompt.value = 'saved prompt v1';
    mocks.specialists$.set([specialist]);
    render(AIBehaviorEditor, { activeView: { type: 'specialist', id: 'implementor' } });

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('saved prompt v1');

    // Post-save refetch: the effective prompt changes and fileSpecialists
    // emits. The AutoSaveTextarea value prop must track it (unfocused).
    mocks.effectivePrompt.value = 'saved prompt v2';
    mocks.fileSpecialists$.set([{ id: 'implementor', model: '' }]);
    flushSync();

    expect(textarea.value).toBe('saved prompt v2');
  });
});

describe('AIBehaviorEditor reasoning-effort dropdown', () => {
  const EFFORT_MODEL = 'codex:gpt-5.3-codex';
  const NO_EFFORT_MODEL = 'user-picked-model';
  const specialist = {
    id: 'implementor',
    name: 'Implementor',
    description: 'Implements tasks',
    defaultBehaviorPrompt: 'bundled prompt',
    resolvedModel: EFFORT_MODEL,
  };

  afterEach(() => {
    cleanup();
    mocks.specialists$.set([]);
    mocks.fileSpecialists$.set([]);
    mocks.effectivePrompt.value = '';
    mocks.explicitEffort.value = undefined;
    mocks.effortLevels.value = {};
    mocks.dispatched.length = 0;
  });

  function renderSpecialist() {
    mocks.specialists$.set([specialist]);
    render(AIBehaviorEditor, { activeView: { type: 'specialist', id: 'implementor' } });
  }

  const lastSave = () =>
    mocks.dispatched.filter((a) => a.type === 'specialists/saveFileSpecialist').at(-1)
      ?.payload[0] as Record<string, unknown> | undefined;

  it('lists the model effort levels plus Default and hides nothing when levels exist', async () => {
    mocks.effortLevels.value = { [EFFORT_MODEL]: ['low', 'medium', 'high'] };
    renderSpecialist();

    const wrapper = screen.getByTestId('specialist-effort');
    // Collapsed trigger shows the unset state.
    expect(wrapper.textContent).toContain('Default');

    await fireEvent.click(wrapper.querySelector('button')!);
    for (const level of ['low', 'medium', 'high']) {
      expect(screen.getByText(level)).toBeTruthy();
    }
  });

  it('renders no dropdown when the model advertises no effort levels', () => {
    mocks.effortLevels.value = {};
    renderSpecialist();

    expect(screen.queryByTestId('specialist-effort')).toBeNull();
  });

  it('persists the picked level as spec.reasoningEffort', async () => {
    mocks.effortLevels.value = { [EFFORT_MODEL]: ['low', 'high'] };
    renderSpecialist();

    await fireEvent.click(screen.getByTestId('specialist-effort').querySelector('button')!);
    await fireEvent.click(screen.getByText('high'));

    expect(lastSave()).toMatchObject({ id: 'implementor', reasoningEffort: 'high' });
  });

  it('resets to Default when the model changes to one lacking the current level', async () => {
    mocks.effortLevels.value = { [EFFORT_MODEL]: ['low', 'high'] };
    mocks.explicitEffort.value = 'high';
    renderSpecialist();

    expect(screen.getByTestId('specialist-effort').textContent).toContain('high');

    // MockModelPicker picks NO_EFFORT_MODEL, which has no effortLevels.
    await fireEvent.click(screen.getAllByTestId('pick-model')[0]);

    expect(lastSave()).toMatchObject({ model: NO_EFFORT_MODEL, reasoningEffort: undefined });
    expect(screen.queryByTestId('specialist-effort')).toBeNull();
  });
});
