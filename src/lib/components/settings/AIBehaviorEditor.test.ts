/**
 * @vitest-environment jsdom
 *
 * Covers the Agents-tab "Default model" picker: it must delegate entirely to
 * `selectSelectedModel` / `ModelPicker` and never fabricate a model (e.g.
 * opus4.7) when the active provider is unavailable — see spec "Fix:
 * Augment/Auggie leaks as default provider & model".
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
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
    hasOverrides: { value: false },
    specialistFilePath: { value: undefined as string | undefined },
    explicitEffort: { value: undefined as string | undefined },
    isFileBased: { value: false },
    fileSpecialist: {
      value: undefined as
        | {
            id: string;
            name: string;
            description: string;
            codingAgent?: string;
            model?: string;
            roleReminder?: string;
            modelOptions?: unknown[];
            reasoningEffort?: string;
            behaviorPrompt: string;
            source: 'project' | 'user';
          }
        | undefined,
    },
    effortLevels: { value: {} as Record<string, string[] | undefined> },
    workspace: undefined as
      { path?: string; worktreePath?: string; repositoryPath?: string } | undefined,
    workspaceSelectCalls: [] as string[],
    // Model ids the loaded `availableModels` catalog knows about — drives the
    // selectModelDisplayName lookup that gates default-effort clearing.
    catalogModels: { value: [] as string[] },
    dispatched: [] as { type: string; payload: unknown[] }[],
    getUserRule: vi.fn(async () => ({ content: 'Original instructions' })),
    updateUserRule: vi.fn(async () => ({ success: true })),
  };
});

vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      getUserRule: mocks.getUserRule,
      updateUserRule: mocks.updateUserRule,
    },
  },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: (action: { type: string; payload: unknown[] }) => {
      mocks.dispatched.push(action);
    },
  });
});

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: Object.assign(() => mocks.specialists$, { select: () => [] }),
  selectFileSpecialists: () => mocks.fileSpecialists$,
  selectIsBuiltIn: {
    select: (_state: unknown, id: string) => mocks.fileSpecialist.value?.id !== id,
  },
  selectIsFileBased: {
    select: (_state: unknown, id: string) => mocks.fileSpecialist.value?.id === id,
  },
  selectEffectiveModel: { select: () => '' },
  selectExplicitModel: { select: () => undefined },
  selectEffectiveBehaviorPrompt: { select: () => mocks.effectivePrompt.value },
  selectGetFileSpecialist: {
    select: (_state: unknown, id: string) =>
      mocks.fileSpecialist.value?.id === id ? mocks.fileSpecialist.value : undefined,
  },
  selectHasOverrides: { select: () => mocks.hasOverrides.value },
  selectBundledSpecialists: { select: () => [] },
  selectSpecialistFilePath: { select: () => mocks.specialistFilePath.value },
  selectSpecialistSourceLabel: {
    select: (_state: unknown, id: string) =>
      mocks.fileSpecialist.value?.id === id
        ? mocks.fileSpecialist.value.source === 'project'
          ? 'Project'
          : 'User'
        : 'Built-in',
  },
  selectSpecialistsFolderPath: () => mocks.readable(''),
  selectEffectiveCodingAgent: { select: () => '' },
  selectExplicitReasoningEffort: { select: () => mocks.explicitEffort.value },
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: {
    select: (_state: unknown, id: string) => {
      mocks.workspaceSelectCalls.push(id);
      return mocks.workspace;
    },
  },
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectActiveProviderId: () => mocks.readable('auggie'),
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-slice', () => ({
  setActiveProvider: (id: string) => ({
    type: 'providerSettings/setActiveProvider',
    payload: [id],
  }),
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
  // Provider-scoped effort lookup: keyed by `provider:model` when a provider
  // is given, bare model id otherwise (mirrors the provider-aware selector).
  selectProviderModelEffortLevels: {
    select: (_state: unknown, providerId?: string, modelId?: string) =>
      modelId
        ? mocks.effortLevels.value[providerId ? `${providerId}:${modelId}` : modelId]
        : undefined,
  },
  selectModelDisplayName: {
    select: (_state: unknown, providerId: string, modelId: string) =>
      mocks.catalogModels.value.includes(`${providerId}:${modelId}`) ||
      mocks.catalogModels.value.includes(modelId)
        ? modelId
        : undefined,
  },
}));

vi.mock('$lib/components/chat/input/ModelPicker.svelte', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockModelPicker.svelte'))
    .default,
}));

vi.mock('$features/external-editors/components/OpenComboButton.svelte', async () => ({
  default: (await import('$features/layout/tab-types/__tests__/mocks/MockOpenComboButton.svelte'))
    .default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import AIBehaviorEditor from './AIBehaviorEditor.svelte';

describe('AIBehaviorEditor workspace ownership', () => {
  const projectSpecialist = {
    id: 'implementor',
    name: 'Implementor',
    description: 'Implements tasks',
    defaultBehaviorPrompt: 'bundled prompt',
  };

  afterEach(() => {
    cleanup();
    mocks.specialists$.set([]);
    mocks.fileSpecialists$.set([]);
    mocks.fileSpecialist.value = undefined;
    mocks.workspace = undefined;
    mocks.workspaceSelectCalls.length = 0;
    mocks.dispatched.length = 0;
  });

  function renderProjectSpecialist(workspaceId?: string) {
    mocks.fileSpecialist.value = {
      id: 'implementor',
      name: 'Implementor',
      description: 'Implements tasks',
      codingAgent: 'auggie',
      behaviorPrompt: 'project prompt',
      source: 'project',
    };
    mocks.specialists$.set([projectSpecialist]);
    mocks.fileSpecialists$.set([mocks.fileSpecialist.value]);
    render(AIBehaviorEditor, {
      activeView: { type: 'specialist', id: 'implementor' },
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
  }

  async function savePrompt(prompt: string) {
    const textarea = screen
      .getAllByRole('textbox')
      .find((element) => element.tagName === 'TEXTAREA') as HTMLTextAreaElement | undefined;
    if (!textarea) throw new Error('Expected specialist prompt textarea');
    await fireEvent.input(textarea, { target: { value: prompt } });
    await fireEvent.keyDown(textarea, { key: 's', ctrlKey: true });
  }

  it('sends the explicit project workspace path when saving a project specialist', async () => {
    mocks.workspace = { path: '/projects/example' };
    renderProjectSpecialist('workspace-project');

    await savePrompt('updated project prompt');

    expect(mocks.workspaceSelectCalls).toEqual(['workspace-project']);
    expect(mocks.dispatched.at(-1)).toEqual({
      type: 'specialists/saveFileSpecialist',
      payload: [
        {
          id: 'implementor',
          name: 'Implementor',
          description: 'Implements tasks',
          codingAgent: 'auggie',
          model: undefined,
          roleReminder: undefined,
          modelOptions: undefined,
          reasoningEffort: undefined,
          behaviorPrompt: 'updated project prompt',
          scope: 'project',
          workspacePath: '/projects/example',
        },
      ],
    });
  });

  it('omits project workspacePath when no explicit or route owner exists', async () => {
    mocks.workspace = { path: '/projects/should-not-be-used' };
    renderProjectSpecialist();

    await savePrompt('updated prompt without owner');

    expect(mocks.workspaceSelectCalls).toEqual([]);
    expect(mocks.dispatched.at(-1)).toEqual({
      type: 'specialists/saveFileSpecialist',
      payload: [
        expect.objectContaining({
          scope: 'project',
          behaviorPrompt: 'updated prompt without owner',
          workspacePath: undefined,
        }),
      ],
    });
  });
});

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

describe('AIBehaviorEditor default model reasoning', () => {
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

  it('enables controlled reasoning and passes the persisted effort to ModelPicker', () => {
    selectedModel$.set(DEFAULT_MODEL);
    mocks.defaultEffort$.set('high');
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    expect(screen.getByTestId('picker-show-reasoning').textContent).toBe('true');
    expect(screen.getByTestId('picker-reasoning').textContent).toBe('high');
  });

  it('dispatches the picked level and clears it back to empty on Default', async () => {
    selectedModel$.set(DEFAULT_MODEL);
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    await fireEvent.click(screen.getByTestId('pick-reasoning'));
    expect(lastEffortDispatch()).toEqual({
      type: 'model/setDefaultReasoningEffort',
      payload: ['high'],
    });

    await fireEvent.click(screen.getByTestId('clear-reasoning'));
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

describe('AIBehaviorEditor actions', () => {
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
    mocks.fileSpecialist.value = undefined;
    mocks.effectivePrompt.value = '';
    mocks.hasOverrides.value = false;
    mocks.specialistFilePath.value = undefined;
    mocks.dispatched.length = 0;
  });

  it('resets all specialist defaults', async () => {
    mocks.fileSpecialists$.set([
      {
        id: 'custom-reviewer',
        name: 'Reviewer',
        description: 'Reviews tasks',
        codingAgent: 'codex',
        model: 'codex:gpt-5.3-codex',
        behaviorPrompt: 'Review carefully',
        source: 'user',
      },
    ]);
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    const defaultsColumn = screen.getByTestId('all-agents-defaults-column');
    const reset = within(defaultsColumn).getByRole('button', { name: 'Reset all to default' });

    await fireEvent.click(reset);
    expect(mocks.dispatched.at(-1)).toEqual({
      type: 'specialists/saveFileSpecialist',
      payload: [
        {
          id: 'custom-reviewer',
          name: 'Reviewer',
          description: 'Reviews tasks',
          codingAgent: 'codex',
          model: undefined,
          roleReminder: undefined,
          modelOptions: undefined,
          reasoningEffort: undefined,
          behaviorPrompt: 'Review carefully',
          scope: 'user',
          workspacePath: undefined,
        },
      ],
    });
  });

  it('hides Reset all to default when every specialist inherits', () => {
    mocks.fileSpecialists$.set([
      {
        id: 'inheriting-reviewer',
        name: 'Reviewer',
        description: 'Reviews tasks',
        behaviorPrompt: 'Review carefully',
        source: 'user',
      },
    ]);

    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    expect(screen.queryByRole('button', { name: 'Reset all to default' })).toBeNull();
  });

  it('undoes unsaved global instructions', async () => {
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    const promptColumn = screen.getByTestId('all-agents-prompt-column');
    const textarea = (await within(promptColumn).findByRole('textbox')) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Original instructions');
    expect(within(promptColumn).queryByTestId('agent-rules-header')).toBeNull();

    await fireEvent.input(textarea, { target: { value: 'Edited instructions' } });

    const header = within(promptColumn).getByTestId('agent-rules-header');
    const undo = within(header).getByRole('button', { name: 'Undo changes' });

    await fireEvent.click(undo);
    expect(textarea.value).toBe('Original instructions');
    expect(within(promptColumn).queryByTestId('agent-rules-header')).toBeNull();
  });

  it('preserves a newline typed into global instructions across the debounced auto-save', async () => {
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    const promptColumn = screen.getByTestId('all-agents-prompt-column');
    const textarea = (await within(promptColumn).findByRole('textbox')) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Original instructions');

    vi.useFakeTimers();
    try {
      mocks.updateUserRule.mockClear();
      await fireEvent.input(textarea, { target: { value: '\nOriginal instructions\n' } });

      // Advance past the 1s debounce so the auto-save runs and settles.
      await vi.advanceTimersByTimeAsync(1100);
      flushSync();

      // A whitespace-only diff trims to the already-persisted value: no
      // redundant wire call is sent…
      expect(mocks.updateUserRule).not.toHaveBeenCalled();
      // …and the save must not rewrite the textarea mid-edit.
      expect(textarea.value).toBe('\nOriginal instructions\n');
      // Marked clean/saved consistently: the saved indicator shows and no
      // phantom "Undo changes" button remains.
      expect(within(promptColumn).getByTestId('agent-rules-saved-indicator').className).toContain(
        'opacity-100',
      );
      expect(within(promptColumn).queryByTestId('agent-rules-header')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces overlapping auto-saves so the backend converges to the latest text', async () => {
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    const promptColumn = screen.getByTestId('all-agents-prompt-column');
    const textarea = (await within(promptColumn).findByRole('textbox')) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Original instructions');

    vi.useFakeTimers();
    try {
      mocks.updateUserRule.mockClear();
      const deferreds: Array<(result: { success: boolean }) => void> = [];
      mocks.updateUserRule.mockImplementation(
        () =>
          new Promise<{ success: boolean }>((resolve) => {
            deferreds.push(resolve);
          }),
      );

      // Save A starts and stays in flight.
      await fireEvent.input(textarea, { target: { value: 'draft v1' } });
      await vi.advanceTimersByTimeAsync(1100);
      expect(mocks.updateUserRule).toHaveBeenCalledTimes(1);
      expect(mocks.updateUserRule).toHaveBeenLastCalledWith('base-system-prompt', 'draft v1');

      // Edit while A is in flight; the debounce requests save B, but
      // single-flight must not start a concurrent request.
      await fireEvent.input(textarea, { target: { value: 'draft v2\n' } });
      await vi.advanceTimersByTimeAsync(1100);
      expect(mocks.updateUserRule).toHaveBeenCalledTimes(1);

      // A resolves carrying the older payload: the editor must not report
      // "saved" and must immediately re-send the latest trimmed text.
      deferreds[0]({ success: true });
      await vi.advanceTimersByTimeAsync(0);
      flushSync();
      expect(mocks.updateUserRule).toHaveBeenCalledTimes(2);
      expect(mocks.updateUserRule).toHaveBeenLastCalledWith('base-system-prompt', 'draft v2');
      const savedIndicator = within(promptColumn).getByTestId('agent-rules-saved-indicator');
      expect(savedIndicator.className).toContain('opacity-0');

      // The trailing save resolves: persisted value matches the live text.
      deferreds[1]({ success: true });
      await vi.advanceTimersByTimeAsync(0);
      flushSync();
      expect(mocks.updateUserRule).toHaveBeenCalledTimes(2);
      expect(textarea.value).toBe('draft v2\n');
      expect(savedIndicator.className).toContain('opacity-100');
      // hasChanges stays consistent: content differs from the loaded original.
      expect(within(promptColumn).getByTestId('agent-rules-header')).toBeTruthy();
    } finally {
      vi.useRealTimers();
      mocks.updateUserRule.mockReset();
    }
  });

  it('persists the revert when Undo changes follows an auto-save', async () => {
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    const promptColumn = screen.getByTestId('all-agents-prompt-column');
    const textarea = (await within(promptColumn).findByRole('textbox')) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Original instructions');

    vi.useFakeTimers();
    try {
      mocks.updateUserRule.mockClear();

      // Edit and let the debounced auto-save persist the draft.
      await fireEvent.input(textarea, { target: { value: 'Edited draft' } });
      await vi.advanceTimersByTimeAsync(1100);
      expect(mocks.updateUserRule).toHaveBeenCalledTimes(1);
      expect(mocks.updateUserRule).toHaveBeenLastCalledWith('base-system-prompt', 'Edited draft');

      // Undo must reconcile the backend with the reverted content, not just
      // reset the textarea (intent-hq/intent#4094).
      const header = within(promptColumn).getByTestId('agent-rules-header');
      await fireEvent.click(within(header).getByRole('button', { name: 'Undo changes' }));
      await vi.advanceTimersByTimeAsync(0);
      flushSync();

      expect(textarea.value).toBe('Original instructions');
      expect(mocks.updateUserRule).toHaveBeenCalledTimes(2);
      expect(mocks.updateUserRule).toHaveBeenLastCalledWith(
        'base-system-prompt',
        'Original instructions',
      );
      expect(within(promptColumn).queryByTestId('agent-rules-header')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not persist a trim-only diff when the loaded rule carries padding whitespace', async () => {
    mocks.getUserRule.mockResolvedValueOnce({ content: '\nPadded instructions\n' });
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    const promptColumn = screen.getByTestId('all-agents-prompt-column');
    const textarea = (await within(promptColumn).findByRole('textbox')) as HTMLTextAreaElement;
    expect(textarea.value).toBe('\nPadded instructions\n');

    mocks.updateUserRule.mockClear();
    // Cmd/Ctrl+S with no edit must stay a quiet no-op — not silently persist
    // the trimmed value of a rule that was stored with padding whitespace.
    await fireEvent.keyDown(textarea, { key: 's', ctrlKey: true });
    flushSync();

    expect(mocks.updateUserRule).not.toHaveBeenCalled();
    expect(within(promptColumn).queryByTestId('agent-rules-header')).toBeNull();
  });

  it('converges the backend when a revert to the original lands while a save is in flight', async () => {
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    const promptColumn = screen.getByTestId('all-agents-prompt-column');
    const textarea = (await within(promptColumn).findByRole('textbox')) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Original instructions');

    vi.useFakeTimers();
    try {
      mocks.updateUserRule.mockClear();
      const deferreds: Array<(result: { success: boolean }) => void> = [];
      mocks.updateUserRule.mockImplementation(
        () =>
          new Promise<{ success: boolean }>((resolve) => {
            deferreds.push(resolve);
          }),
      );

      // The draft save starts and stays in flight.
      await fireEvent.input(textarea, { target: { value: 'draft' } });
      await vi.advanceTimersByTimeAsync(1100);
      expect(mocks.updateUserRule).toHaveBeenCalledTimes(1);
      expect(mocks.updateUserRule).toHaveBeenLastCalledWith('base-system-prompt', 'draft');

      // Revert to the exact original while the save is in flight.
      await fireEvent.input(textarea, { target: { value: 'Original instructions' } });
      await vi.advanceTimersByTimeAsync(1100);
      expect(mocks.updateUserRule).toHaveBeenCalledTimes(1);

      // The in-flight save resolves holding the stale draft: a trailing save
      // must re-send the reverted content instead of stranding the backend on
      // the draft (intent-hq/intent#4094, mid-flight-revert comment).
      deferreds[0]({ success: true });
      await vi.advanceTimersByTimeAsync(0);
      flushSync();
      expect(mocks.updateUserRule).toHaveBeenCalledTimes(2);
      expect(mocks.updateUserRule).toHaveBeenLastCalledWith(
        'base-system-prompt',
        'Original instructions',
      );

      // The trailing save resolves: the editor reports saved rather than
      // sticking at 'saving'.
      deferreds[1]({ success: true });
      await vi.advanceTimersByTimeAsync(0);
      flushSync();
      expect(mocks.updateUserRule).toHaveBeenCalledTimes(2);
      expect(textarea.value).toBe('Original instructions');
      expect(within(promptColumn).getByTestId('agent-rules-saved-indicator').className).toContain(
        'opacity-100',
      );
      expect(within(promptColumn).queryByTestId('agent-rules-header')).toBeNull();
    } finally {
      vi.useRealTimers();
      mocks.updateUserRule.mockReset();
    }
  });

  it('expands advanced specialist options', async () => {
    mocks.specialists$.set([specialist]);
    render(AIBehaviorEditor, { activeView: { type: 'specialist', id: 'implementor' } });

    const detailsColumn = screen.getByTestId('specialist-details-column');
    const advancedSummary = within(detailsColumn).getByText('Advanced', { selector: 'summary' });
    const advancedDetails = advancedSummary.closest('details');
    expect(advancedDetails).toBeTruthy();
    expect(advancedDetails?.open).toBe(false);

    await fireEvent.click(advancedSummary);

    expect(advancedDetails?.open).toBe(true);
    expect(
      within(advancedDetails as HTMLElement).getByRole('button', { name: 'Add model option' }),
    ).toBeTruthy();
  });

  it('resets a modified specialist', async () => {
    mocks.hasOverrides.value = true;
    mocks.effectivePrompt.value = 'customized prompt';
    mocks.specialistFilePath.value = '/Users/example/.intent/specialists/implementor.md';
    mocks.specialists$.set([specialist]);
    render(AIBehaviorEditor, { activeView: { type: 'specialist', id: 'implementor' } });

    const promptColumn = screen.getByTestId('specialist-prompt-column');
    const reset = within(promptColumn).getByRole('button', { name: 'Reset' });
    const open = within(promptColumn).getByTestId('open-combo-button');

    expect(open.getAttribute('data-file-path')).toBe(
      '/Users/example/.intent/specialists/implementor.md',
    );

    await fireEvent.click(reset);
    expect(mocks.dispatched.at(-1)).toEqual({
      type: 'specialists/deleteFileSpecialist',
      payload: [{ id: 'implementor', scope: 'user' }],
    });
  });

  it('updates the prompt heading when the selected specialist changes', async () => {
    const reviewer = {
      ...specialist,
      id: 'reviewer',
      name: 'Reviewer',
      description: 'Reviews tasks',
    };
    mocks.specialists$.set([specialist, reviewer]);
    const { rerender } = render(AIBehaviorEditor, {
      activeView: { type: 'specialist', id: 'implementor' },
    });

    const promptColumn = screen.getByTestId('specialist-prompt-column');
    expect(within(promptColumn).getByRole('heading', { name: 'Implementor' })).toBeTruthy();

    await rerender({ activeView: { type: 'specialist', id: 'reviewer' } });

    expect(within(promptColumn).getByRole('heading', { name: 'Reviewer' })).toBeTruthy();
    expect(within(promptColumn).queryByRole('heading', { name: 'Implementor' })).toBeNull();
  });

  it('saves specialist renames on blur and Enter', async () => {
    mocks.fileSpecialist.value = {
      ...specialist,
      behaviorPrompt: 'custom prompt',
      source: 'user',
    };
    mocks.specialists$.set([specialist]);
    mocks.fileSpecialists$.set([mocks.fileSpecialist.value]);
    const onSpecialistDeleted = vi.fn();
    render(AIBehaviorEditor, {
      activeView: { type: 'specialist', id: 'implementor' },
      onSpecialistDeleted,
    });

    const promptColumn = screen.getByTestId('specialist-prompt-column');
    const detailsColumn = screen.getByTestId('specialist-details-column');
    const nameInput = within(promptColumn).getByRole('textbox', {
      name: 'Name',
    }) as HTMLInputElement;
    const promptTextarea = within(promptColumn)
      .getAllByRole('textbox')
      .find((textbox) => textbox.tagName === 'TEXTAREA');
    const descriptionInput = within(detailsColumn).getByRole('textbox') as HTMLInputElement;

    expect(nameInput.value).toBe('Implementor');
    expect(promptTextarea?.tagName).toBe('TEXTAREA');
    expect(descriptionInput.value).toBe('Implements tasks');

    await fireEvent.input(nameInput, { target: { value: 'Renamed Implementor' } });
    await fireEvent.blur(nameInput);

    expect(mocks.dispatched.at(-1)).toEqual({
      type: 'specialists/saveFileSpecialist',
      payload: [
        {
          id: 'implementor',
          name: 'Renamed Implementor',
          description: 'Implements tasks',
          codingAgent: '',
          model: undefined,
          roleReminder: undefined,
          modelOptions: undefined,
          reasoningEffort: undefined,
          behaviorPrompt: '',
          scope: 'user',
          workspacePath: undefined,
        },
      ],
    });

    nameInput.focus();
    await fireEvent.input(nameInput, { target: { value: 'Keyboard Renamed Implementor' } });
    await fireEvent.keyDown(nameInput, { key: 'Enter' });

    expect(mocks.dispatched.at(-1)).toEqual({
      type: 'specialists/saveFileSpecialist',
      payload: [
        expect.objectContaining({ id: 'implementor', name: 'Keyboard Renamed Implementor' }),
      ],
    });

    await fireEvent.click(within(detailsColumn).getByRole('button', { name: 'Delete specialist' }));

    expect(mocks.dispatched.at(-1)).toEqual({
      type: 'specialists/deleteFileSpecialist',
      payload: [{ id: 'implementor', scope: 'user', workspacePath: undefined }],
    });
    expect(onSpecialistDeleted).toHaveBeenCalledOnce();
  });

  it('disables creation for an empty specialist draft', () => {
    render(AIBehaviorEditor, {
      activeView: { type: 'create-specialist' },
    });

    const detailsColumn = screen.getByTestId('create-specialist-details-column');
    expect(
      (
        within(detailsColumn).getByRole('button', {
          name: 'Create Specialist',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
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

describe('AIBehaviorEditor specialist model reasoning', () => {
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
    mocks.isFileBased.value = false;
    mocks.fileSpecialist.value = undefined;
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

  it('enables controlled reasoning and passes the explicit effort to ModelPicker', () => {
    mocks.explicitEffort.value = 'high';
    renderSpecialist();

    expect(screen.getByTestId('picker-show-reasoning').textContent).toBe('true');
    expect(screen.getByTestId('picker-reasoning').textContent).toBe('high');
  });

  it('persists the picked level as spec.reasoningEffort', async () => {
    mocks.effortLevels.value = { [EFFORT_MODEL]: ['low', 'high'] };
    renderSpecialist();

    await fireEvent.click(screen.getByTestId('pick-reasoning'));

    expect(lastSave()).toMatchObject({ id: 'implementor', reasoningEffort: 'high' });
  });

  it('clears a file specialist effort back to inherit', async () => {
    mocks.explicitEffort.value = 'high';
    mocks.isFileBased.value = true;
    mocks.fileSpecialist.value = {
      ...specialist,
      source: 'user',
      codingAgent: 'codex',
      model: EFFORT_MODEL,
      reasoningEffort: 'high',
      behaviorPrompt: 'bundled prompt',
    };
    renderSpecialist();

    await fireEvent.click(screen.getByTestId('clear-reasoning'));

    expect(lastSave()).toMatchObject({ id: 'implementor', reasoningEffort: undefined });
  });

  it('resets to Default when the model changes to one lacking the current level', async () => {
    mocks.effortLevels.value = { [EFFORT_MODEL]: ['low', 'high'] };
    mocks.explicitEffort.value = 'high';
    renderSpecialist();

    expect(screen.getByTestId('picker-reasoning').textContent).toBe('high');

    // MockModelPicker picks NO_EFFORT_MODEL, which has no effortLevels.
    await fireEvent.click(screen.getAllByTestId('pick-model')[0]);

    expect(lastSave()).toMatchObject({ model: NO_EFFORT_MODEL, reasoningEffort: undefined });
    expect(screen.getByTestId('picker-reasoning').textContent).toBe('');
  });

  it('attributes a bare cross-provider pick to the provider resolved by the picker', async () => {
    renderSpecialist();

    // MockModelPicker emits a bare model id plus the resolved pick triple —
    // the provider must come from the pick, not the default-provider fallback.
    await fireEvent.click(screen.getAllByTestId('pick-model-with-triple')[0]);

    expect(lastSave()).toMatchObject({ codingAgent: 'codex', model: 'bare-picked-model' });
  });

  it('keeps a supported effort across a cross-provider pick (provider-scoped lookup)', async () => {
    // The effort levels resolve only under the resolved provider's catalog —
    // a provider-blind bare-id lookup would drop the level.
    mocks.effortLevels.value = {
      [EFFORT_MODEL]: ['low', 'high'],
      'codex:bare-picked-model': ['low', 'high'],
    };
    mocks.explicitEffort.value = 'high';
    renderSpecialist();

    // The triple pick emits a BARE id + resolved provider leg; the effort
    // check must consult that provider's catalog, not the active one.
    await fireEvent.click(screen.getAllByTestId('pick-model-with-triple')[0]);

    expect(lastSave()).toMatchObject({
      codingAgent: 'codex',
      model: 'bare-picked-model',
      reasoningEffort: 'high',
    });
    expect(screen.getByTestId('picker-reasoning').textContent).toBe('high');
  });

  it('drops the effort when the resolved provider catalog lacks the level', async () => {
    // The same bare id advertises the level only under the ACTIVE catalog;
    // the pick resolves to codex, whose catalog does not carry it.
    mocks.effortLevels.value = {
      [EFFORT_MODEL]: ['low', 'high'],
      'bare-picked-model': ['low', 'high'],
    };
    mocks.explicitEffort.value = 'high';
    renderSpecialist();

    await fireEvent.click(screen.getAllByTestId('pick-model-with-triple')[0]);

    expect(lastSave()).toMatchObject({
      codingAgent: 'codex',
      model: 'bare-picked-model',
      reasoningEffort: undefined,
    });
    expect(screen.getByTestId('picker-reasoning').textContent).toBe('');
  });
});

describe('AIBehaviorEditor create-specialist model reasoning', () => {
  afterEach(() => {
    cleanup();
    selectedModel$.set('');
    mocks.effortLevels.value = {};
    mocks.dispatched.length = 0;
  });

  it('persists the picked effort and resets it on discard', async () => {
    selectedModel$.set('codex:gpt-5.3-codex');
    const onDiscard = vi.fn();
    render(AIBehaviorEditor, {
      activeView: { type: 'create-specialist' },
      onDiscard,
    });

    await fireEvent.click(screen.getByTestId('pick-reasoning'));
    expect(screen.getByTestId('picker-reasoning').textContent).toBe('high');
    await fireEvent.input(screen.getByPlaceholderText('e.g., Code Reviewer'), {
      target: { value: 'Reviewer' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Create Specialist' }));

    const save = mocks.dispatched.find((a) => a.type === 'specialists/saveFileSpecialist')
      ?.payload[0] as Record<string, unknown>;
    expect(save).toMatchObject({ name: 'Reviewer', reasoningEffort: 'high' });

    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(screen.getByTestId('picker-reasoning').textContent).toBe('');
  });

  it('keeps a supported effort across a cross-provider pick (provider-scoped lookup)', async () => {
    // The level resolves only under the resolved provider's catalog — a
    // provider-blind bare-id lookup would reset the new-specialist effort.
    mocks.effortLevels.value = { 'codex:bare-picked-model': ['low', 'high'] };
    render(AIBehaviorEditor, {
      activeView: { type: 'create-specialist' },
    });

    await fireEvent.click(screen.getByTestId('pick-reasoning'));
    await fireEvent.click(screen.getByTestId('pick-model-with-triple'));
    expect(screen.getByTestId('picker-reasoning').textContent).toBe('high');

    await fireEvent.input(screen.getByPlaceholderText('e.g., Code Reviewer'), {
      target: { value: 'Reviewer' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Create Specialist' }));

    const save = mocks.dispatched.find((a) => a.type === 'specialists/saveFileSpecialist')
      ?.payload[0] as Record<string, unknown>;
    expect(save).toMatchObject({
      name: 'Reviewer',
      codingAgent: 'codex',
      model: 'bare-picked-model',
      reasoningEffort: 'high',
    });
  });

  it('attributes a bare cross-provider pick to the provider resolved by the picker', async () => {
    render(AIBehaviorEditor, {
      activeView: { type: 'create-specialist' },
    });

    await fireEvent.click(screen.getByTestId('pick-model-with-triple'));
    await fireEvent.input(screen.getByPlaceholderText('e.g., Code Reviewer'), {
      target: { value: 'Reviewer' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Create Specialist' }));

    const save = mocks.dispatched.find((a) => a.type === 'specialists/saveFileSpecialist')
      ?.payload[0] as Record<string, unknown>;
    expect(save).toMatchObject({
      name: 'Reviewer',
      codingAgent: 'codex',
      model: 'bare-picked-model',
    });
  });
});
