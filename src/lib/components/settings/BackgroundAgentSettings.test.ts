/**
 * @vitest-environment jsdom
 *
 * Covers the quick-action settings pane (#1627): the default picker AND the
 * per-action override rows all render the multi-provider ModelPicker (no
 * single-active-provider Dropdown asymmetry), override picks dispatch
 * setTypeOverride ('' for "use default"), and the `fast` row surfaces the
 * auggie-only `agent.enhancePrompt` gate when the catalog is hydrated and
 * the effective provider is not auggie (hidden pre-hydration to avoid a
 * flash of the note for auggie users).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readable: <T>(value: T) => ({
    subscribe(run: (v: T) => void) {
      run(value);
      return () => {};
    },
  }),
  defaultModel: { value: '' },
  typeOverrides: { value: { commit: '', pr: '', review: '', fast: '' } },
  effectiveProviderId: { value: 'auggie' },
  catalogLoaded: { value: true },
  dispatched: [] as { type: string; payload: unknown[] }[],
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

vi.mock(
  '$store/renderer/slices/background-agent-settings/background-agent-settings-selectors',
  () => ({
    selectBgDefaultModel: () => mocks.readable(mocks.defaultModel.value),
    selectBgDefaultReasoningEffort: () => mocks.readable('medium'),
    selectBgTypeReasoningEffortOverrides: () => mocks.readable({}),
    selectBgTypeOverrides: () => mocks.readable(mocks.typeOverrides.value),
    selectHasOverride: (type: string) =>
      mocks.readable(
        Boolean(mocks.typeOverrides.value[type as keyof typeof mocks.typeOverrides.value]),
      ),
  }),
);

vi.mock('$store/renderer/slices/provider-catalog/provider-catalog-selectors', () => ({
  selectEffectiveDefaultProviderId: () => mocks.readable(mocks.effectiveProviderId.value),
  selectProviderCatalogLoaded: () => mocks.readable(mocks.catalogLoaded.value),
}));

vi.mock('$lib/components/chat/input/ModelPicker.svelte', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockModelPicker.svelte'))
    .default,
}));

import BackgroundAgentSettings from './BackgroundAgentSettings.svelte';

describe('BackgroundAgentSettings (quick-action settings pane)', () => {
  afterEach(() => {
    cleanup();
    mocks.typeOverrides.value = { commit: '', pr: '', review: '', fast: '' };
    mocks.effectiveProviderId.value = 'auggie';
    mocks.catalogLoaded.value = true;
    mocks.dispatched.length = 0;
    mocks.defaultModel.value = '';
  });

  it('blocks effort editing for a foreign inherited default without changing saved values', () => {
    mocks.defaultModel.value = 'codex:other';
    render(BackgroundAgentSettings);
    expect(screen.queryAllByTestId('pick-reasoning')).toHaveLength(0);
    expect(screen.getAllByTestId('quick-action-effort-provider-note')).toHaveLength(4);
    expect(mocks.dispatched).toEqual([]);
  });

  it('blocks only the foreign action effort and keeps same-provider rows editable', async () => {
    mocks.typeOverrides.value = { commit: 'codex:other', pr: '', review: '', fast: '' };
    render(BackgroundAgentSettings);
    expect(screen.getAllByTestId('quick-action-effort-provider-note')).toHaveLength(1);
    expect(screen.getAllByTestId('pick-reasoning')).toHaveLength(3);
    await fireEvent.click(screen.getAllByTestId('pick-reasoning')[1]);
    expect(mocks.dispatched).toEqual([
      {
        type: 'backgroundAgentSettings/setTypeReasoningEffortOverride',
        payload: [{ type: 'pr', effort: 'high' }],
      },
    ]);
  });

  it('shows the stored override model in its row picker', () => {
    mocks.typeOverrides.value = {
      commit: 'codex:gpt-5.3-codex',
      pr: '',
      review: '',
      fast: '',
    };
    render(BackgroundAgentSettings);
    const values = screen.getAllByTestId('picker-selected').map((el) => el.textContent);
    expect(values).toEqual(['', 'codex:gpt-5.3-codex', '', '']);
  });

  it('dispatches setTypeOverride with the picked model for an override row', async () => {
    render(BackgroundAgentSettings);
    // Index 0 is the default picker; 1..3 are commit/pr/fast overrides.
    await fireEvent.click(screen.getAllByTestId('pick-model')[1]);
    expect(mocks.dispatched).toHaveLength(1);
    expect(mocks.dispatched).toContainEqual({
      type: 'backgroundAgentSettings/setTypeOverride',
      payload: [{ type: 'commit', model: 'user-picked-model' }],
    });
  });

  it('sets and clears the quick-action default without changing action overrides', async () => {
    mocks.typeOverrides.value = { commit: 'pinned-commit', pr: '', review: '', fast: '' };
    render(BackgroundAgentSettings);
    await fireEvent.click(screen.getAllByTestId('pick-model')[0]);
    await fireEvent.click(screen.getAllByTestId('pick-default')[0]);
    expect(mocks.dispatched).toEqual([
      { type: 'backgroundAgentSettings/setDefaultModel', payload: ['user-picked-model'] },
      { type: 'backgroundAgentSettings/setDefaultModel', payload: [''] },
    ]);
  });

  it("dispatches setTypeOverride with '' when an override row picks the default option", async () => {
    mocks.typeOverrides.value = { commit: '', pr: '', review: '', fast: 'some-model' };
    render(BackgroundAgentSettings);
    await fireEvent.click(screen.getAllByTestId('pick-default')[3]);
    expect(mocks.dispatched).toHaveLength(1);
    expect(mocks.dispatched).toContainEqual({
      type: 'backgroundAgentSettings/setTypeOverride',
      payload: [{ type: 'fast', model: '' }],
    });
  });

  it('hides the auggie-only note on the fast row when the effective provider is auggie', () => {
    mocks.effectiveProviderId.value = 'auggie';
    render(BackgroundAgentSettings);
    expect(screen.queryByTestId('fast-auggie-only-note')).toBeNull();
  });

  it('shows the auggie-only note on the fast row when the effective provider is not auggie', () => {
    mocks.effectiveProviderId.value = 'codex';
    render(BackgroundAgentSettings);
    expect(screen.getByTestId('fast-auggie-only-note')).toBeTruthy();
  });

  it('hides the note before catalog hydration — no flash for auggie users', () => {
    mocks.catalogLoaded.value = false;
    mocks.effectiveProviderId.value = '';
    render(BackgroundAgentSettings);
    expect(screen.queryByTestId('fast-auggie-only-note')).toBeNull();
  });

  it("shows the note when hydrated but the provider is still '' — genuinely unavailable", () => {
    mocks.catalogLoaded.value = true;
    mocks.effectiveProviderId.value = '';
    render(BackgroundAgentSettings);
    expect(screen.getByTestId('fast-auggie-only-note')).toBeTruthy();
  });
});

it('each quick-action row saves and clears effort without pinning its inherited model', async () => {
  render(BackgroundAgentSettings);
  for (let index = 0; index < 4; index++) {
    await fireEvent.click(screen.getAllByTestId('pick-reasoning')[index]);
    await fireEvent.click(screen.getAllByTestId('clear-reasoning')[index]);
  }
  expect(mocks.dispatched).toEqual([
    { type: 'backgroundAgentSettings/setDefaultReasoningEffort', payload: ['high'] },
    { type: 'backgroundAgentSettings/setDefaultReasoningEffort', payload: [''] },
    ...['commit', 'pr', 'fast'].flatMap((type) => [
      {
        type: 'backgroundAgentSettings/setTypeReasoningEffortOverride',
        payload: [{ type, effort: 'high' }],
      },
      {
        type: 'backgroundAgentSettings/setTypeReasoningEffortOverride',
        payload: [{ type, effort: '' }],
      },
    ]),
  ]);
  cleanup();
});
