/**
 * @vitest-environment jsdom
 *
 * Covers the Agents-tab "Default model" picker: it must delegate entirely to
 * `selectSelectedModel` / `ModelPicker` and never fabricate a model (e.g.
 * opus4.7) when the active provider is unavailable — see spec "Fix:
 * Augment/Auggie leaks as default provider & model".
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    isFileBased: { value: false },
    fileSpecialist: {
      value: undefined as {
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
      } | undefined,
    },
    effortLevels: { value: {} as Record<string, string[] | undefined> },
    workspace: undefined as
      { path?: string; worktreePath?: string; repositoryPath?: string } | undefined,
    workspaceSelectCalls: [] as string[],
    // Model ids the loaded `availableModels` catalog knows about — drives the
    // selectModelDisplayName lookup that gates default-effort clearing.
    catalogModels: { value: [] as string[] },
    dispatched: [] as { type: string; payload: unknown[] }[],
  };
});

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
  selectHasOverrides: { select: () => false },
  selectBundledSpecialists: { select: () => [] },
  selectSpecialistFilePath: { select: () => undefined },
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
  default: (await import('../workspace/initializer/__tests__/mocks/MockModelPicker.svelte'))
    .default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import AIBehaviorEditor from './AIBehaviorEditor.svelte';

const editorSource = readFileSync(
  join(process.cwd(), 'src/lib/components/settings/AIBehaviorEditor.svelte'),
  'utf8',
);

describe('AIBehaviorEditor workspace ownership', () => {
  it('accepts an explicit owner without reading the legacy active workspace', () => {
    expect(editorSource).toContain('workspaceId?: WorkspaceId | null');
    expect(editorSource).toContain('workspaceId !== undefined ? workspaceId');
    expect(editorSource).not.toContain('selectActiveWorkspace');
  });

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
});

describe('AIBehaviorEditor create-specialist model reasoning', () => {
  afterEach(() => {
    cleanup();
    selectedModel$.set('');
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
    await fireEvent.input(screen.getAllByRole('textbox')[0], { target: { value: 'Reviewer' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create Specialist' }));

    const save = mocks.dispatched.find((a) => a.type === 'specialists/saveFileSpecialist')
      ?.payload[0] as Record<string, unknown>;
    expect(save).toMatchObject({ name: 'Reviewer', reasoningEffort: 'high' });

    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledOnce();
    expect(screen.getByTestId('picker-reasoning').textContent).toBe('');
  });
});
