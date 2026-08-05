/**
 * @vitest-environment jsdom
 *
 * Covers the Agents-tab "Default model" picker: it must delegate entirely to
 * `selectSelectedModel` / `ModelPicker` and never fabricate a model (e.g.
 * opus4.7) when the active provider is unavailable — see spec "Fix:
 * Augment/Auggie leaks as default provider & model".
 */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const readable = <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  });
  return { readable };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({ state: () => ({}) });
});

vi.mock('$store/renderer/slices/specialists/specialists-selectors', () => ({
  selectSpecialists: () => mocks.readable([]),
  selectFileSpecialists: () => mocks.readable([]),
  selectIsBuiltIn: { select: () => false },
  selectIsFileBased: { select: () => false },
  selectEffectiveModel: { select: () => '' },
  selectEffectiveBehaviorPrompt: { select: () => '' },
  selectGetFileSpecialist: { select: () => undefined },
  selectSpecialistFilePath: { select: () => undefined },
  selectSpecialistSourceLabel: { select: () => null },
  selectSpecialistsFolderPath: () => mocks.readable(''),
  selectEffectiveCodingAgent: { select: () => '' },
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
  deleteFileSpecialist: () => ({ type: 'specialists/deleteFileSpecialist', payload: [] }),
  saveFileSpecialist: () => ({ type: 'specialists/saveFileSpecialist', payload: [] }),
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
