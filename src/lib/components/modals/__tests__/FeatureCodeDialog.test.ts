/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const featureState = vi.hoisted(() => ({
  activeFeatures: [] as string[],
  operation: {
    version: 0,
    status: 'idle',
    kind: null,
    result: null,
    error: null,
  } as {
    version: number;
    status: 'idle' | 'loading' | 'success' | 'error';
    kind: 'load' | 'activate' | 'deactivate' | null;
    result: 'activated' | 'already_active' | 'invalid' | 'deactivated' | null;
    error: string | null;
  },
  subscribers: new Set<() => void>(),
  notify() {
    for (const subscriber of this.subscribers) subscriber();
  },
}));

const storeMocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));

vi.mock('$store/renderer/slices/feature-codes/feature-codes-selectors', () => {
  const readable = <T>(getter: () => T) => ({
    subscribe(run: (value: T) => void) {
      const notify = () => run(getter());
      notify();
      featureState.subscribers.add(notify);
      return () => featureState.subscribers.delete(notify);
    },
  });
  return {
    selectActiveFeatures: vi.fn(() => readable(() => featureState.activeFeatures)),
    selectHasActiveFeatures: vi.fn(() => readable(() => featureState.activeFeatures.length > 0)),
    selectFeatureCodeOperation: Object.assign(
      vi.fn(() => readable(() => featureState.operation)),
      {
        select: () => featureState.operation,
      },
    ),
  };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: storeMocks.dispatch,
  });
});

import FeatureCodeDialog from '../FeatureCodeDialog.svelte';
import { warmImport } from '../../../../test/warm-import';

function expectDispatched(type: string, payload?: unknown[]) {
  expect(storeMocks.dispatch).toHaveBeenCalledWith(
    expect.objectContaining(payload ? { type, payload } : { type }),
  );
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../FeatureCodeDialog.svelte'));

beforeEach(() => {
  featureState.activeFeatures = [];
  featureState.operation = {
    version: 0,
    status: 'idle',
    kind: null,
    result: null,
    error: null,
  };
  storeMocks.dispatch.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('FeatureCodeDialog selector-backed flow', () => {
  it('requests active features when opened', async () => {
    render(FeatureCodeDialog, { props: { open: true } });
    await waitFor(() => expectDispatched('featureCodes/loadActiveFeaturesRequested'));
  });

  it('dispatches activation and renders selector-backed success', async () => {
    render(FeatureCodeDialog, { props: { open: true } });

    const input = screen.getByPlaceholderText('Enter code...');
    await fireEvent.input(input, { target: { value: 'SECRET' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    expectDispatched('featureCodes/activateFeatureCodeRequested', ['SECRET']);
    featureState.operation = {
      version: 1,
      status: 'success',
      kind: 'activate',
      result: 'activated',
      error: null,
    };
    featureState.notify();
    await waitFor(() => expect(screen.getByText('Feature activated!')).toBeTruthy());
  });

  it('shows invalid-code feedback from selector-backed failure', async () => {
    render(FeatureCodeDialog, { props: { open: true } });

    const input = screen.getByPlaceholderText('Enter code...');
    await fireEvent.input(input, { target: { value: 'BAD' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    expectDispatched('featureCodes/activateFeatureCodeRequested', ['BAD']);
    featureState.operation = {
      version: 1,
      status: 'error',
      kind: 'activate',
      result: null,
      error: 'invalid code',
    };
    featureState.notify();
    await waitFor(() => expect(screen.getByText('Invalid code.')).toBeTruthy());
  });

  it('dispatches deactivation and renders selector-backed success', async () => {
    featureState.activeFeatures = ['cortex'];

    render(FeatureCodeDialog, { props: { open: true } });

    await fireEvent.click(screen.getByTitle('Remove cortex'));

    expectDispatched('featureCodes/deactivateFeatureRequested', ['cortex']);
    featureState.operation = {
      version: 1,
      status: 'success',
      kind: 'deactivate',
      result: 'deactivated',
      error: null,
    };
    featureState.notify();
    await waitFor(() =>
      expect(screen.getByText('Feature deactivated! Restart to apply.')).toBeTruthy(),
    );
  });

  it('renders active features exclusively from selector state', async () => {
    featureState.activeFeatures = ['cortex'];

    render(FeatureCodeDialog, { props: { open: true } });
    expect(screen.getByText('cortex')).toBeTruthy();
    await waitFor(() => expectDispatched('featureCodes/loadActiveFeaturesRequested'));
  });

  it('shows no deactivation success feedback when the selector reports failure', async () => {
    featureState.activeFeatures = ['cortex'];

    render(FeatureCodeDialog, { props: { open: true } });
    await fireEvent.click(screen.getByTitle('Remove cortex'));

    featureState.operation = {
      version: 1,
      status: 'error',
      kind: 'deactivate',
      result: null,
      error: 'failed',
    };
    featureState.notify();
    expect(screen.queryByText('Feature deactivated! Restart to apply.')).toBeNull();
  });
});
