/**
 * @vitest-environment jsdom
 *
 * Covers the quick-action settings pane (#1627): one ModelPicker per action,
 * scoped to the active provider. Edits dispatch editQuickAction, which also
 * retires a legacy shared default ('' picks the provider default).
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
  effectiveProviderId: { value: 'codex' },
  providerAvailable: { value: true },
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
  }),
);

vi.mock('$store/renderer/slices/provider-catalog/provider-catalog-selectors', () => ({
  selectEffectiveDefaultProviderId: () => mocks.readable(mocks.effectiveProviderId.value),
  selectProviderCatalogLoaded: () => mocks.readable(mocks.catalogLoaded.value),
}));

vi.mock('$store/renderer/slices/provider-settings/provider-settings-selectors', () => ({
  selectIsActiveProviderAvailable: () => mocks.readable(mocks.providerAvailable.value),
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
    mocks.effectiveProviderId.value = 'codex';
    mocks.providerAvailable.value = true;
    mocks.catalogLoaded.value = true;
    mocks.dispatched.length = 0;
    mocks.defaultModel.value = '';
  });

  const edit = (payload: Record<string, string>) => ({
    type: 'backgroundAgentSettings/editQuickAction',
    payload: [payload],
  });

  it.each(['auggie', 'droid', 'opencode', ''])(
    'never presents saved effort as applied for unsupported quick-action route %s',
    async (provider) => {
      mocks.effectiveProviderId.value = provider;
      render(BackgroundAgentSettings);
      expect(screen.queryAllByTestId('pick-reasoning')).toHaveLength(0);
      for (const button of screen.getAllByTestId('attempt-reasoning'))
        await fireEvent.click(button);
      expect(screen.getAllByTestId('picker-reasoning').map((el) => el.textContent)).toEqual([
        '',
        '',
      ]);
      expect(mocks.dispatched).toEqual([]);
    },
  );
  it.each(['codex', 'claude-code', 'pi'])(
    'keeps supported quick-action effort editable for %s',
    (provider) => {
      mocks.effectiveProviderId.value = provider;
      render(BackgroundAgentSettings);
      expect(screen.getAllByTestId('pick-reasoning')).toHaveLength(2);
    },
  );
  it('does not offer effort when the active provider is unavailable', () => {
    mocks.providerAvailable.value = false;
    render(BackgroundAgentSettings);
    expect(screen.queryAllByTestId('pick-reasoning')).toHaveLength(0);
    expect(mocks.dispatched).toEqual([]);
  });

  it('blocks effort editing for a foreign legacy default without changing saved values', () => {
    mocks.defaultModel.value = 'claude-code:other';
    render(BackgroundAgentSettings);
    expect(screen.queryAllByTestId('pick-reasoning')).toHaveLength(0);
    expect(screen.getAllByTestId('quick-action-effort-provider-note')).toHaveLength(2);
    expect(mocks.dispatched).toEqual([]);
  });

  it('blocks only the foreign action effort and keeps same-provider rows editable', async () => {
    mocks.typeOverrides.value = { commit: 'claude-code:other', pr: '', review: '', fast: '' };
    render(BackgroundAgentSettings);
    expect(screen.getAllByTestId('quick-action-effort-provider-note')).toHaveLength(1);
    expect(screen.getAllByTestId('pick-reasoning')).toHaveLength(1);
    await fireEvent.click(screen.getAllByTestId('pick-reasoning')[0]);
    expect(mocks.dispatched).toEqual([edit({ type: 'pr', effort: 'high' })]);
  });

  it('shows each action on its effective model and effort, including a legacy default', () => {
    mocks.defaultModel.value = 'legacy-default';
    mocks.typeOverrides.value = { commit: 'gpt-5.3-codex', pr: '', review: '', fast: '' };
    render(BackgroundAgentSettings);
    expect(screen.getAllByTestId('picker-selected').map((el) => el.textContent)).toEqual([
      'gpt-5.3-codex',
      'legacy-default',
    ]);
    expect(screen.getAllByTestId('picker-reasoning').map((el) => el.textContent)).toEqual([
      'medium',
      'medium',
    ]);
  });

  it('saves a picked model for its action', async () => {
    render(BackgroundAgentSettings);
    await fireEvent.click(screen.getAllByTestId('pick-model-with-triple')[0]);
    expect(mocks.dispatched).toEqual([edit({ type: 'commit', model: 'bare-picked-model' })]);
  });

  it('rejects model callbacks without provider ownership, including compound IDs', async () => {
    render(BackgroundAgentSettings);
    for (const id of ['pick-model', 'pick-cross-provider-model']) {
      for (const button of screen.getAllByTestId(id)) await fireEvent.click(button);
    }
    expect(mocks.dispatched).toEqual([]);
  });

  it('rejects a stale pick from a different provider instead of reinterpreting its bare ID', async () => {
    mocks.effectiveProviderId.value = 'claude-code';
    render(BackgroundAgentSettings);
    for (const button of screen.getAllByTestId('pick-model-with-triple'))
      await fireEvent.click(button);
    expect(mocks.dispatched).toEqual([]);
  });

  // §5.54: quick actions follow the default provider, which may be a profile.
  it('accepts picks from the default profile and keeps its effort route', async () => {
    mocks.effectiveProviderId.value = 'codex@pwork00000001';
    render(BackgroundAgentSettings);
    expect(screen.getAllByTestId('picker-show-reasoning')[0].textContent).toBe('true');
    await fireEvent.click(screen.getAllByTestId('pick-profile-model')[0]);
    // Another configuration of the same provider is a different account.
    await fireEvent.click(screen.getAllByTestId('pick-model-with-triple')[0]);
    expect(mocks.dispatched).toEqual([edit({ type: 'commit', model: 'gpt-5-work' })]);
  });

  it("saves '' when an action picks the provider default", async () => {
    mocks.typeOverrides.value = { commit: '', pr: 'some-model', review: '', fast: '' };
    render(BackgroundAgentSettings);
    await fireEvent.click(screen.getAllByTestId('pick-default')[1]);
    expect(mocks.dispatched).toEqual([edit({ type: 'pr', model: '' })]);
  });

  it('saves and clears effort per action without pinning its model', async () => {
    render(BackgroundAgentSettings);
    for (let index = 0; index < 2; index++) {
      await fireEvent.click(screen.getAllByTestId('pick-reasoning')[index]);
      await fireEvent.click(screen.getAllByTestId('clear-reasoning')[index]);
    }
    expect(mocks.dispatched).toEqual(
      ['commit', 'pr'].flatMap((type) => [
        edit({ type, effort: 'high' }),
        edit({ type, effort: '' }),
      ]),
    );
  });
});
