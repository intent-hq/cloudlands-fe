/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  invoke: vi.fn(async () => ({ status: 'activated' })),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ dispatch: mocks.dispatch, state: {} });
});

vi.mock('$store/renderer/slices/feature-codes/feature-codes-selectors', async () => {
  const { createAppStoreMock } = await import('$store/renderer/utils/test-helpers/store-mock');
  const store = createAppStoreMock({ state: {} });
  return {
    selectActiveFeatures: store.createSelector(() => []),
    selectHasActiveFeatures: store.createSelector(() => false),
  };
});

vi.mock('$store/renderer/slices/feature-codes/feature-codes-slice', () => ({
  deactivateFeature: (featureId: string) => ({ type: 'feature-codes/deactivate', featureId }),
  fetchFeatures: () => ({ type: 'feature-codes/fetch' }),
}));

vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('svelte-fa', async () => ({
  default: (await import('../../ui/__tests__/mocks/Fa.svelte')).default,
}));
vi.mock('$shared/paraglide/messages.js', () => ({
  m: new Proxy({}, { get: (_target, key) => () => String(key) }),
}));

import FeatureCodeDialog from '../FeatureCodeDialog.svelte';

describe('FeatureCodeDialog autofill opt-out', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('ignores OTP/password autofill while preserving code activation', async () => {
    const { container } = render(FeatureCodeDialog, { props: { open: true } });
    const input = container.querySelector<HTMLInputElement>('input[type="password"]');

    expect(input).not.toBeNull();
    expect(input?.getAttribute('autocomplete')).toBe('off');
    expect(input?.getAttribute('data-1p-ignore')).toBe('true');
    expect(input?.getAttribute('data-lpignore')).toBe('true');
    expect(input?.getAttribute('data-bwignore')).toBe('true');
    expect(input?.getAttribute('data-form-type')).toBe('other');

    await fireEvent.input(input!, { target: { value: ' feature-code ' } });
    await fireEvent.keyDown(input!, { key: 'Enter' });

    expect(mocks.invoke).toHaveBeenCalledWith('feature-codes:activate', {
      code: 'feature-code',
    });
  });
});
