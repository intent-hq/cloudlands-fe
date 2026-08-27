/**
 * @vitest-environment jsdom
 *
 * Covers the Agents-tab "Default model" picker: it must delegate entirely to
 * `selectSelectedModel` / `ModelPicker` and never fabricate a model (e.g.
 * opus4.7) when the active provider is unavailable — see spec "Fix:
 * Augment/Auggie leaks as default provider & model".
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushSync } from 'svelte';
import { compile } from 'svelte/compiler';
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

describe('AIBehaviorEditor full-height layouts', () => {
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

  it('overrides the compiled scoped grid for every full-height editor view at desktop widths', () => {
    const compiledStyles = compile(editorSource, {
      filename: 'AIBehaviorEditor.svelte',
      generate: 'client',
      css: 'external',
    }).css?.code;
    expect(compiledStyles).toBeTruthy();

    const scopeClass = compiledStyles?.match(/\.svelte-[\w-]+/)?.[0].slice(1);
    expect(scopeClass).toBeTruthy();

    const scopedStyles = document.createElement('style');
    scopedStyles.textContent = compiledStyles ?? '';
    document.head.appendChild(scopedStyles);

    const specialistContainer = document.createElement('div');
    specialistContainer.className = `editor-container full-height-editor-container specialist-editor-container ${scopeClass}`;
    const allAgentsContainer = document.createElement('div');
    allAgentsContainer.className = `editor-container full-height-editor-container ${scopeClass}`;
    const createSpecialistContainer = document.createElement('div');
    createSpecialistContainer.className = `editor-container full-height-editor-container ${scopeClass}`;
    const standardContainer = document.createElement('div');
    standardContainer.className = `editor-container ${scopeClass}`;
    document.body.append(
      specialistContainer,
      allAgentsContainer,
      createSpecialistContainer,
      standardContainer,
    );

    const desktopStyles = document.createElement('style');

    try {
      expect(getComputedStyle(specialistContainer).display).toBe('grid');
      expect(getComputedStyle(allAgentsContainer).display).toBe('grid');
      expect(getComputedStyle(createSpecialistContainer).display).toBe('grid');
      expect(getComputedStyle(standardContainer).display).toBe('grid');

      const desktopRule = Array.from(scopedStyles.sheet?.cssRules ?? []).find(
        (rule): rule is CSSMediaRule =>
          rule.type === CSSRule.MEDIA_RULE &&
          (rule as CSSMediaRule).conditionText.includes('1280px'),
      );
      expect(desktopRule).toBeDefined();

      // jsdom does not evaluate viewport media queries, so activate the actual
      // compiled desktop declarations directly to exercise their scoped cascade.
      desktopStyles.textContent = Array.from(desktopRule?.cssRules ?? [])
        .map((rule) => rule.cssText)
        .join('\n');
      document.head.appendChild(desktopStyles);

      expect(getComputedStyle(specialistContainer).display).toBe('flex');
      expect(getComputedStyle(specialistContainer).flexDirection).toBe('column');
      expect(getComputedStyle(specialistContainer).gridTemplateRows).toBe('none');
      expect(getComputedStyle(specialistContainer).flexGrow).toBe('1');
      expect(getComputedStyle(allAgentsContainer).display).toBe('flex');
      expect(getComputedStyle(allAgentsContainer).flexDirection).toBe('column');
      expect(getComputedStyle(allAgentsContainer).gridTemplateRows).toBe('none');
      expect(getComputedStyle(allAgentsContainer).flexGrow).toBe('1');
      expect(getComputedStyle(createSpecialistContainer).display).toBe('flex');
      expect(getComputedStyle(createSpecialistContainer).flexDirection).toBe('column');
      expect(getComputedStyle(createSpecialistContainer).gridTemplateRows).toBe('none');
      expect(getComputedStyle(createSpecialistContainer).flexGrow).toBe('1');
      expect(getComputedStyle(standardContainer).display).toBe('grid');
      expect(getComputedStyle(standardContainer).gridTemplateRows).toBe(
        'min-content min-content 1fr min-content',
      );
    } finally {
      desktopStyles.remove();
      scopedStyles.remove();
      specialistContainer.remove();
      allAgentsContainer.remove();
      createSpecialistContainer.remove();
      standardContainer.remove();
    }
  });

  it('places global instructions beside the description, defaults, and quiet reset action', async () => {
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

    const layout = screen.getByTestId('all-agents-editor-layout');
    const promptColumn = screen.getByTestId('all-agents-prompt-column');
    const defaultsColumn = screen.getByTestId('all-agents-defaults-column');
    const description = within(defaultsColumn).getByText(
      'Custom instructions that will be included for all agents.',
    );
    const modelRow = within(defaultsColumn).getByTestId('all-agents-default-model-row');
    const reset = within(defaultsColumn).getByRole('button', { name: 'Reset all to default' });
    const editorContainer = layout.parentElement;

    expect(Array.from(layout.children)).toEqual([promptColumn, defaultsColumn]);
    expect(layout.className).toContain('grid-cols-1');
    expect(layout.className).toContain('xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]');
    expect(layout.className).toContain('xl:h-full');
    expect(layout.className).toContain('xl:min-h-0');
    expect(layout.className).toContain('xl:flex-1');
    expect(promptColumn.className).toContain('min-w-0');
    expect(promptColumn.className).toContain('xl:flex-col');
    expect(defaultsColumn.className).toContain('min-w-0');
    expect(defaultsColumn.classList.contains('xl:pt-8')).toBe(false);
    expect(Array.from(defaultsColumn.classList).some((className) => /^pt-/.test(className))).toBe(
      false,
    );
    expect(editorContainer?.className).toContain('full-height-editor-container');
    expect(editorContainer?.className).not.toContain('specialist-editor-container');
    expect(within(promptColumn).queryByRole('heading')).toBeNull();
    expect(
      within(promptColumn).queryByText('Custom instructions that will be included for all agents.'),
    ).toBeNull();
    expect(Array.from(defaultsColumn.children)).toEqual([description, modelRow, reset]);
    expect(within(defaultsColumn).getByText('Default model')).toBeTruthy();
    expect(within(defaultsColumn).getByTestId('mock-model-picker')).toBeTruthy();
    expect(reset.parentElement).toBe(defaultsColumn);
    expect(reset.className).toContain('self-start');
    expect(reset.className).toContain('text-muted-foreground');
    expect(reset.className).not.toContain('border');
    expect(reset.className).not.toContain('rounded');
    expect(reset.className).not.toContain('bg-');

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

  it('shows unsaved-instructions Undo only in the prompt column', async () => {
    render(AIBehaviorEditor, { activeView: { type: 'system-prompt' } });

    const promptColumn = screen.getByTestId('all-agents-prompt-column');
    const defaultsColumn = screen.getByTestId('all-agents-defaults-column');
    const textarea = (await within(promptColumn).findByRole('textbox')) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Original instructions');
    expect(within(promptColumn).queryByTestId('agent-rules-header')).toBeNull();

    await fireEvent.input(textarea, { target: { value: 'Edited instructions' } });

    const header = within(promptColumn).getByTestId('agent-rules-header');
    const description = within(defaultsColumn).getByText(
      'Custom instructions that will be included for all agents.',
    );
    const undo = within(header).getByRole('button', { name: 'Undo changes' });
    expect(header.contains(undo)).toBe(true);
    expect(header.className).toContain('items-center');
    expect(defaultsColumn.firstElementChild).toBe(description);

    await fireEvent.click(undo);
    expect(textarea.value).toBe('Original instructions');
    expect(within(promptColumn).queryByTestId('agent-rules-header')).toBeNull();
  });

  it('places the wider prompt column before specialist details in a responsive grid', async () => {
    mocks.specialists$.set([specialist]);
    render(AIBehaviorEditor, { activeView: { type: 'specialist', id: 'implementor' } });

    const layout = screen.getByTestId('specialist-editor-layout');
    const promptColumn = screen.getByTestId('specialist-prompt-column');
    const detailsColumn = screen.getByTestId('specialist-details-column');
    const editorContainer = layout.parentElement;
    const textarea = within(promptColumn).getByRole('textbox');
    const promptHeading = within(promptColumn).getByRole('heading', { name: 'Implementor' });
    const textareaRegion = textarea.parentElement;
    const autoSaveContainer = textareaRegion?.parentElement;

    expect(Array.from(layout.children)).toEqual([promptColumn, detailsColumn]);
    expect(layout.className).toContain('grid-cols-1');
    expect(layout.className).toContain('xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]');
    expect(layout.className).toContain('xl:h-full');
    expect(layout.className).toContain('xl:min-h-0');
    expect(layout.className).toContain('xl:flex-1');
    expect(layout.className).toContain('xl:items-stretch');
    expect(editorContainer?.className).toContain('specialist-editor-container');
    expect(editorContainer?.className).toContain('xl:h-full');
    expect(editorContainer?.className).toContain('xl:min-h-0');
    expect(editorContainer?.className).toContain('xl:flex-col');
    expect(promptColumn.className).toContain('min-w-0');
    expect(promptColumn.className).toContain('h-full');
    expect(promptColumn.className).toContain('xl:flex-col');
    expect(detailsColumn.className).toContain('min-w-0');
    expect(detailsColumn.classList.contains('xl:pt-8')).toBe(true);
    expect(Array.from(detailsColumn.classList).some((className) => /^pt-/.test(className))).toBe(
      false,
    );
    expect(autoSaveContainer?.className).toContain('h-full');
    expect(autoSaveContainer?.className).toContain('xl:min-h-0');
    expect(autoSaveContainer?.className).toContain('xl:flex-1');
    expect(textareaRegion?.className).toContain('min-h-0');
    expect(textareaRegion?.className).toContain('grow');
    expect(textarea.className).toContain('grow');
    expect(promptHeading.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(within(promptColumn).queryByText('System prompt')).toBeNull();
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(screen.getAllByRole('heading', { name: 'Implementor' })).toHaveLength(1);
    expect(within(detailsColumn).queryByRole('heading', { name: 'Implementor' })).toBeNull();
    expect(within(detailsColumn).queryByText('Implementor')).toBeNull();
    expect(screen.queryByText('Modified')).toBeNull();
    expect(within(detailsColumn).getByText('Implements tasks')).toBeTruthy();
    expect(within(detailsColumn).queryByText('~/.intent/specialists/implementor.md')).toBeNull();
    expect(detailsColumn.textContent).not.toContain('This is a built-in specialist');
    expect(within(detailsColumn).getByTestId('mock-model-picker')).toBeTruthy();
    const advancedSummary = within(detailsColumn).getByText('Advanced', { selector: 'summary' });
    const advancedDetails = advancedSummary.closest('details');
    expect(advancedDetails).toBeTruthy();
    expect(advancedDetails?.open).toBe(false);
    expect(advancedSummary.className).toContain('text-ui');
    expect(advancedSummary.className).toContain('text-muted-foreground');
    expect(advancedSummary.className).toContain('cursor-pointer');

    await fireEvent.click(advancedSummary);

    expect(advancedDetails?.open).toBe(true);
    expect(
      within(advancedDetails as HTMLElement).getByRole('button', { name: 'Add model option' }),
    ).toBeTruthy();
  });

  it('orders Modified, Reset, and Open-in in the single specialist prompt header', async () => {
    mocks.hasOverrides.value = true;
    mocks.effectivePrompt.value = 'customized prompt';
    mocks.specialistFilePath.value = '/Users/example/.intent/specialists/implementor.md';
    mocks.specialists$.set([specialist]);
    render(AIBehaviorEditor, { activeView: { type: 'specialist', id: 'implementor' } });

    const promptColumn = screen.getByTestId('specialist-prompt-column');
    const detailsColumn = screen.getByTestId('specialist-details-column');
    const header = within(promptColumn).getByTestId('specialist-prompt-header');
    const heading = within(promptColumn).getByRole('heading', { name: 'Implementor' });
    const modifiedBadge = within(promptColumn).getByText('Modified');
    const reset = within(promptColumn).getByRole('button', { name: 'Reset' });
    const open = within(promptColumn).getByTestId('open-combo-button');

    expect(screen.getAllByRole('heading', { name: 'Implementor' })).toHaveLength(1);
    expect(screen.getAllByText('Modified')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Reset' })).toHaveLength(1);
    expect(screen.getAllByTestId('open-combo-button')).toHaveLength(1);
    expect(heading.parentElement).toBe(header);
    expect(modifiedBadge.parentElement).toBe(header);
    expect(reset.parentElement).toBe(header);
    expect(open.closest('.ml-auto')?.parentElement).toBe(header);
    expect(header.className).toContain('flex-wrap');
    expect(heading.compareDocumentPosition(modifiedBadge) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(modifiedBadge.compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(reset.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(modifiedBadge.className).toContain('bg-primary/15');
    expect(open.getAttribute('data-file-path')).toBe(
      '/Users/example/.intent/specialists/implementor.md',
    );
    expect(editorSource).toContain('<Fa icon={faPencil} class="w-2.5 h-2.5" />');
    expect(within(detailsColumn).queryByText('Implementor')).toBeNull();
    expect(within(detailsColumn).queryByText('Modified')).toBeNull();
    expect(within(detailsColumn).queryByRole('button', { name: 'Reset' })).toBeNull();
    expect(within(detailsColumn).queryByTestId('open-combo-button')).toBeNull();
    expect(within(detailsColumn).queryByText('~/.intent/specialists/implementor.md')).toBeNull();
    expect(detailsColumn.textContent).not.toContain("You've customized this built-in specialist");
    expect(detailsColumn.textContent).not.toContain('Click Reset to restore defaults.');

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
    expect(within(promptColumn).queryByText('System prompt')).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'Reviewer' })).toHaveLength(1);
    expect(
      within(screen.getByTestId('specialist-details-column')).queryByText('Reviewer'),
    ).toBeNull();
  });

  it('keeps the editable specialist name only in the prompt heading and saves renames', async () => {
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
    expect(screen.getAllByDisplayValue('Implementor')).toHaveLength(1);
    expect(promptTextarea?.tagName).toBe('TEXTAREA');
    expect(descriptionInput.value).toBe('Implements tasks');
    expect(within(detailsColumn).queryByDisplayValue('Implementor')).toBeNull();
    expect(within(detailsColumn).queryByRole('heading')).toBeNull();

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

  it('uses the full-height prompt-first two-column layout for Create Specialist', () => {
    const { container } = render(AIBehaviorEditor, {
      activeView: { type: 'create-specialist' },
    });

    const layout = screen.getByTestId('create-specialist-editor-layout');
    const promptColumn = screen.getByTestId('create-specialist-prompt-column');
    const detailsColumn = screen.getByTestId('create-specialist-details-column');

    expect(layout.className).toContain('xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]');
    expect(layout.firstElementChild).toBe(promptColumn);
    expect(layout.lastElementChild).toBe(detailsColumn);
    expect(within(promptColumn).getByRole('heading', { name: 'Create Specialist' })).toBeTruthy();
    expect(
      within(promptColumn).getByPlaceholderText('Instructions for this specialist...'),
    ).toBeTruthy();
    expect(within(promptColumn).queryByText('System prompt')).toBeNull();
    expect(detailsColumn.textContent).not.toContain('Creates a file in');
    expect(detailsColumn.textContent).not.toContain('~/.intent/specialists/');
    expect(within(detailsColumn).getByPlaceholderText('e.g., Code Reviewer')).toBeTruthy();
    expect(within(detailsColumn).getByRole('button', { name: 'Discard' })).toBeTruthy();
    expect(
      (
        within(detailsColumn).getByRole('button', {
          name: 'Create Specialist',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(container.querySelector('.editor-container')?.className).toContain('xl:h-full');
    expect(container.querySelector('.editor-container')?.className).toContain(
      'full-height-editor-container',
    );
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
});
