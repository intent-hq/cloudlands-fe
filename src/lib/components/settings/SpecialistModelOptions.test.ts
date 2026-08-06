/**
 * @vitest-environment jsdom
 *
 * Covers the per-row reasoning-effort dropdown in the model-options editor:
 * the levels come from the row model's catalog `effortLevels`, a picked level
 * is committed as `modelOptions[i].reasoningEffort` (PROTOCOL §5.11), draft
 * rows stay uncommitted until they gain a model, and a model switch to a
 * model lacking the current level resets the row to Default.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const EFFORT_MODEL = 'codex:gpt-5.3-codex';
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
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
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
  default: (
    await import('../workspace/initializer/__tests__/mocks/MockModelPicker.svelte')
  ).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

import SpecialistModelOptions from './SpecialistModelOptions.svelte';

describe('SpecialistModelOptions effort dropdown', () => {
  afterEach(() => {
    cleanup();
    mocks.effortLevels.value = {};
  });

  it('shows the row model effort levels plus Default and commits a picked level', async () => {
    mocks.effortLevels.value = { [EFFORT_MODEL]: ['low', 'high'] };
    const onCommit = vi.fn();
    render(SpecialistModelOptions, {
      savedOptions: [{ model: EFFORT_MODEL, hint: 'deep' }],
      onCommit,
    });

    const wrapper = screen.getByTestId('option-effort-0');
    expect(wrapper.textContent).toContain('Default');

    await fireEvent.click(wrapper.querySelector('button')!);
    expect(screen.getByText('low')).toBeTruthy();
    await fireEvent.click(screen.getByText('high'));

    expect(onCommit).toHaveBeenCalledWith([
      { model: EFFORT_MODEL, hint: 'deep', reasoningEffort: 'high' },
    ]);
  });

  it('renders no dropdown for a row whose model advertises no levels', () => {
    mocks.effortLevels.value = {};
    render(SpecialistModelOptions, {
      savedOptions: [{ model: 'claude-code:opus4.5', hint: '' }],
      onCommit: vi.fn(),
    });

    expect(screen.queryByTestId('option-effort-0')).toBeNull();
  });

  it('does not commit an effort change on a draft row until it gains a model', async () => {
    mocks.effortLevels.value = { [PICKED_MODEL]: ['low', 'high'] };
    const onCommit = vi.fn();
    render(SpecialistModelOptions, { savedOptions: [], onCommit });

    // Draft row: no model yet, so no effort dropdown and no commit.
    await fireEvent.click(screen.getByText('Add model option'));
    expect(screen.queryByTestId('option-effort-0')).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();

    // Picking a model commits the row.
    await fireEvent.click(screen.getByTestId('pick-model'));
    expect(onCommit).toHaveBeenCalledWith([{ model: PICKED_MODEL, hint: '' }]);
  });

  it('resets the row to Default when the model changes to one lacking the level', async () => {
    mocks.effortLevels.value = { [EFFORT_MODEL]: ['low', 'high'] };
    const onCommit = vi.fn();
    render(SpecialistModelOptions, {
      savedOptions: [{ model: EFFORT_MODEL, hint: '', reasoningEffort: 'high' }],
      onCommit,
    });

    expect(screen.getByTestId('option-effort-0').textContent).toContain('high');

    // MockModelPicker picks PICKED_MODEL, which has no effortLevels.
    await fireEvent.click(screen.getByTestId('pick-model'));

    expect(onCommit).toHaveBeenCalledWith([{ model: PICKED_MODEL, hint: '' }]);
    expect(screen.queryByTestId('option-effort-0')).toBeNull();
  });
});
