/**
 * @vitest-environment jsdom
 *
 * Covers controlled reasoning in the model-options editor: the effort level
 * is picked inside the ModelPicker dropdown (the picker's embedded reasoning
 * selector — no separate per-row effort control exists) and committed as
 * `modelOptions[i].reasoningEffort` (PROTOCOL §5.11), draft rows stay
 * uncommitted until they gain a model, and a model switch to a model lacking
 * the current level resets the row to Default. Rows carry the triple shape
 * `{ provider?, model, hint, reasoningEffort? }` — picks consume the resolved
 * triple the picker emits, falling back to splitting a legacy compound id.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const EFFORT_PROVIDER = 'codex';
const EFFORT_BARE_MODEL = 'gpt-5.3-codex';
const EFFORT_MODEL = `${EFFORT_PROVIDER}:${EFFORT_BARE_MODEL}`;
const PICKED_MODEL = 'user-picked-model';

const mocks = vi.hoisted(() => ({
  effortLevels: { value: {} as Record<string, string[] | undefined> },
  readable: <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  }),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}) });
});

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectAvailableModels: () => mocks.readable([]),
  selectModelEffortLevels: {
    select: (_state: unknown, modelId?: string) =>
      modelId ? mocks.effortLevels.value[modelId] : undefined,
  },
}));

vi.mock('$lib/components/chat/input/ModelPicker.svelte', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockModelPicker.svelte'))
    .default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import SpecialistModelOptions from './SpecialistModelOptions.svelte';

describe('SpecialistModelOptions reasoning', () => {
  afterEach(() => {
    cleanup();
    mocks.effortLevels.value = {};
  });

  it('enables in-dropdown reasoning and commits a picked level on the triple', async () => {
    mocks.effortLevels.value = { [EFFORT_MODEL]: ['low', 'high'] };
    const onCommit = vi.fn();
    render(SpecialistModelOptions, {
      savedOptions: [{ provider: EFFORT_PROVIDER, model: EFFORT_BARE_MODEL, hint: 'deep' }],
      onCommit,
    });

    // The picker hosts the reasoning selector inside its dropdown; no
    // separate per-row effort control renders.
    expect(screen.getByTestId('picker-show-reasoning').textContent).toBe('true');
    expect(screen.getByTestId('picker-reasoning').textContent).toBe('');
    expect(screen.queryByTestId('effort-label')).toBeNull();
    // The picker boundary receives the recombined compound id.
    expect(screen.getByTestId('picker-selected').textContent).toBe(EFFORT_MODEL);
    await fireEvent.click(screen.getByTestId('pick-reasoning'));

    expect(onCommit).toHaveBeenCalledWith([
      {
        provider: EFFORT_PROVIDER,
        model: EFFORT_BARE_MODEL,
        hint: 'deep',
        reasoningEffort: 'high',
      },
    ]);
    // The picked level feeds back into the picker's controlled effort.
    expect(screen.getByTestId('picker-reasoning').textContent).toBe('high');
  });

  it('does not commit an effort change on a draft row until it gains a model', async () => {
    mocks.effortLevels.value = { [PICKED_MODEL]: ['low', 'high'] };
    const onCommit = vi.fn();
    render(SpecialistModelOptions, { savedOptions: [], onCommit });

    // Draft row: controlled reasoning is unset and no commit has fired.
    await fireEvent.click(screen.getByText('Add model option'));
    expect(screen.getByTestId('picker-reasoning').textContent).toBe('');
    expect(onCommit).not.toHaveBeenCalled();

    // Picking a model commits the row.
    await fireEvent.click(screen.getByTestId('pick-model'));
    expect(onCommit).toHaveBeenCalledWith([{ model: PICKED_MODEL, hint: '' }]);
  });

  it('resets the row to Default when the model changes to one lacking the level', async () => {
    mocks.effortLevels.value = { [EFFORT_MODEL]: ['low', 'high'] };
    const onCommit = vi.fn();
    render(SpecialistModelOptions, {
      savedOptions: [
        { provider: EFFORT_PROVIDER, model: EFFORT_BARE_MODEL, hint: '', reasoningEffort: 'high' },
      ],
      onCommit,
    });

    expect(screen.getByTestId('picker-reasoning').textContent).toBe('high');

    // MockModelPicker picks PICKED_MODEL, which has no effortLevels.
    await fireEvent.click(screen.getByTestId('pick-model'));

    expect(onCommit).toHaveBeenCalledWith([{ model: PICKED_MODEL, hint: '' }]);
    expect(screen.getByTestId('picker-reasoning').textContent).toBe('');
  });

  it('splits a compound pick into provider + bare model on the committed triple', async () => {
    const onCommit = vi.fn();
    render(SpecialistModelOptions, { savedOptions: [], onCommit });

    await fireEvent.click(screen.getByText('Add model option'));
    // MockModelPicker's cross-provider button emits a compound id.
    await fireEvent.click(screen.getByTestId('pick-cross-provider-model'));

    expect(onCommit).toHaveBeenCalledWith([
      { provider: 'codex', model: 'cross-provider-model', hint: '' },
    ]);
  });

  it('prefers the resolved triple the picker emits over splitting the model id', async () => {
    const onCommit = vi.fn();
    render(SpecialistModelOptions, { savedOptions: [], onCommit });

    await fireEvent.click(screen.getByText('Add model option'));
    // MockModelPicker's triple button emits a bare id + resolved pick legs
    // (catalog-group attribution for a bare cross-provider pick).
    await fireEvent.click(screen.getByTestId('pick-model-with-triple'));

    expect(onCommit).toHaveBeenCalledWith([
      { provider: 'codex', model: 'bare-picked-model', hint: '' },
    ]);
  });

  it('clears a committed row effort back to inherit', async () => {
    const onCommit = vi.fn();
    render(SpecialistModelOptions, {
      savedOptions: [
        { provider: EFFORT_PROVIDER, model: EFFORT_BARE_MODEL, hint: '', reasoningEffort: 'high' },
      ],
      onCommit,
    });

    await fireEvent.click(screen.getByTestId('clear-reasoning'));

    expect(onCommit).toHaveBeenCalledWith([
      { provider: EFFORT_PROVIDER, model: EFFORT_BARE_MODEL, hint: '' },
    ]);
  });
});
