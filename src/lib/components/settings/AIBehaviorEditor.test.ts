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
    effectivePrompt: { value: '' },
    explicitEffort: { value: undefined as string | undefined },
    effortLevels: { value: {} as Record<string, string[] | undefined> },
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
  selectAvailableModels: () => mocks.readable([]),
  selectModelEffortLevels: {
    select: (_state: unknown, modelId?: string) =>
      modelId ? mocks.effortLevels.value[modelId] : undefined,
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
