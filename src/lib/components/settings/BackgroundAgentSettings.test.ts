/**
 * @vitest-environment jsdom
 *
 * Covers the quick-action settings pane (#1627): the default picker AND the
 * per-action override rows all render the multi-provider ModelPicker (no
 * single-active-provider Dropdown asymmetry), override picks dispatch
 * setTypeOverride ('' for "use default"), and the `fast` row surfaces the
 * auggie-only `agent.enhancePrompt` gate when the effective provider is not
 * auggie.
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
  typeOverrides: { value: { commit: '', pr: '', review: '', fast: '' } },
  effectiveProviderId: { value: 'auggie' },
  dispatched: [] as { type: string; payload: unknown[] }[],
}));

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

vi.mock(
  '$store/renderer/slices/background-agent-settings/background-agent-settings-selectors',
  () => ({
    selectBgDefaultModel: () => mocks.readable(''),
    selectBgTypeOverrides: () => mocks.readable(mocks.typeOverrides.value),
    selectHasOverride: (type: string) =>
      mocks.readable(
        Boolean(mocks.typeOverrides.value[type as keyof typeof mocks.typeOverrides.value]),
      ),
  }),
);

vi.mock('$store/renderer/slices/provider-catalog/provider-catalog-selectors', () => ({
  selectEffectiveDefaultProviderId: () => mocks.readable(mocks.effectiveProviderId.value),
}));

vi.mock('$lib/components/chat/input/ModelPicker.svelte', async () => ({
  default: (
    await import('../workspace/initializer/__tests__/mocks/MockModelPicker.svelte')
  ).default,
}));

import BackgroundAgentSettings from './BackgroundAgentSettings.svelte';

describe('BackgroundAgentSettings (quick-action settings pane)', () => {
  afterEach(() => {
    cleanup();
    mocks.typeOverrides.value = { commit: '', pr: '', review: '', fast: '' };
    mocks.effectiveProviderId.value = 'auggie';
    mocks.dispatched.length = 0;
  });

  it('renders the multi-provider ModelPicker for the default AND all three override rows', () => {
    render(BackgroundAgentSettings);
    // 1 default picker + commit/pr/fast overrides — same catalog component everywhere.
    expect(screen.getAllByTestId('mock-model-picker')).toHaveLength(4);
  });

  it('shows the stored override model in its row picker', () => {
    mocks.typeOverrides.value = {
      commit: 'codex:gpt-5.3-codex',
      pr: '',
      review: '',
      fast: '',
    };
    render(BackgroundAgentSettings);
    const values = screen
      .getAllByTestId('picker-selected')
      .map((el) => el.textContent);
    expect(values).toEqual(['', 'codex:gpt-5.3-codex', '', '']);
  });

  it('dispatches setTypeOverride with the picked model for an override row', async () => {
    render(BackgroundAgentSettings);
    // Index 0 is the default picker; 1..3 are commit/pr/fast overrides.
    await fireEvent.click(screen.getAllByTestId('pick-model')[1]);
    expect(mocks.dispatched).toContainEqual({
      type: 'backgroundAgentSettings/setTypeOverride',
      payload: [{ type: 'commit', model: 'user-picked-model' }],
    });
  });

  it("dispatches setTypeOverride with '' when an override row picks the default option", async () => {
    mocks.typeOverrides.value = { commit: '', pr: '', review: '', fast: 'some-model' };
    render(BackgroundAgentSettings);
    await fireEvent.click(screen.getAllByTestId('pick-default')[3]);
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

  it("shows the note before hydration ('' provider) — enhancement is honestly unavailable", () => {
    mocks.effectiveProviderId.value = '';
    render(BackgroundAgentSettings);
    expect(screen.getByTestId('fast-auggie-only-note')).toBeTruthy();
  });
});
