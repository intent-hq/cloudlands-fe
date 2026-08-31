/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const featureState = vi.hoisted(() => ({
  activeFeatures: [] as string[],
}));

const clientMocks = vi.hoisted(() => ({
  getActiveFeatures: vi.fn(),
  activateCode: vi.fn(),
  deactivateFeature: vi.fn(),
  restartApp: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));

vi.mock('$features/feature-codes/renderer/feature-codes.client', () => ({
  featureCodesClient: clientMocks,
}));

vi.mock('$store/renderer/slices/feature-codes/feature-codes-selectors', () => {
  const readable = <T>(getter: () => T) => ({
    subscribe(run: (value: T) => void) {
      run(getter());
      return () => {};
    },
  });
  return {
    selectActiveFeatures: vi.fn(() => readable(() => featureState.activeFeatures)),
    selectHasActiveFeatures: vi.fn(() => readable(() => featureState.activeFeatures.length > 0)),
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

const SET_ACTIVE_FEATURES = 'featureCodes/setActiveFeatures';

function getSetActiveFeaturesPayloads() {
  return storeMocks.dispatch.mock.calls.flatMap(([action]) => {
    const dispatchedAction = action as { type?: string; payload?: unknown } | undefined;
    return dispatchedAction?.type === SET_ACTIVE_FEATURES ? [dispatchedAction.payload] : [];
  });
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../FeatureCodeDialog.svelte'));

beforeEach(() => {
  featureState.activeFeatures = [];
  clientMocks.getActiveFeatures.mockReset();
  clientMocks.activateCode.mockReset();
  clientMocks.deactivateFeature.mockReset();
  clientMocks.restartApp.mockReset();
  clientMocks.getActiveFeatures.mockResolvedValue([]);
  storeMocks.dispatch.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('FeatureCodeDialog direct-client flow', () => {
  it('refreshes the active-features store from the client when opened', async () => {
    clientMocks.getActiveFeatures.mockResolvedValue(['cortex']);

    render(FeatureCodeDialog, { props: { open: true } });

    await waitFor(() => expect(getSetActiveFeaturesPayloads()).toEqual([[['cortex']]]));
    expect(clientMocks.getActiveFeatures).toHaveBeenCalledTimes(1);
  });

  it('activates a code through the client and refreshes the store', async () => {
    clientMocks.activateCode.mockResolvedValue({ status: 'activated' });
    clientMocks.getActiveFeatures.mockResolvedValueOnce([]).mockResolvedValueOnce(['new-feature']);

    render(FeatureCodeDialog, { props: { open: true } });
    await waitFor(() => expect(clientMocks.getActiveFeatures).toHaveBeenCalledTimes(1));

    const input = screen.getByPlaceholderText('Enter code...');
    await fireEvent.input(input, { target: { value: 'SECRET' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    await waitFor(() => expect(screen.getByText('Feature activated!')).toBeTruthy());
    expect(clientMocks.activateCode).toHaveBeenCalledWith('SECRET');
    await waitFor(() => expect(getSetActiveFeaturesPayloads()).toEqual([[[]], [['new-feature']]]));
  });

  it('shows the invalid-code feedback when activation rejects', async () => {
    clientMocks.activateCode.mockRejectedValue(new Error('invalid code'));

    render(FeatureCodeDialog, { props: { open: true } });
    await waitFor(() => expect(clientMocks.getActiveFeatures).toHaveBeenCalledTimes(1));

    const input = screen.getByPlaceholderText('Enter code...');
    await fireEvent.input(input, { target: { value: 'BAD' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

    await waitFor(() => expect(screen.getByText('Invalid code.')).toBeTruthy());
    expect(getSetActiveFeaturesPayloads()).toEqual([[[]]]);
  });

  it('deactivates a feature through the client and refreshes the store', async () => {
    featureState.activeFeatures = ['cortex'];
    clientMocks.deactivateFeature.mockResolvedValue({ success: true });
    clientMocks.getActiveFeatures.mockResolvedValueOnce(['cortex']).mockResolvedValueOnce([]);

    render(FeatureCodeDialog, { props: { open: true } });
    await waitFor(() => expect(clientMocks.getActiveFeatures).toHaveBeenCalledTimes(1));

    await fireEvent.click(screen.getByTitle('Remove cortex'));

    await waitFor(() =>
      expect(screen.getByText('Feature deactivated! Restart to apply.')).toBeTruthy(),
    );
    expect(clientMocks.deactivateFeature).toHaveBeenCalledWith('cortex');
    await waitFor(() => expect(getSetActiveFeaturesPayloads()).toEqual([[['cortex']], [[]]]));
  });

  it('keeps existing store state when the active-features fetch fails', async () => {
    featureState.activeFeatures = ['cortex'];
    clientMocks.getActiveFeatures.mockResolvedValue(null);

    render(FeatureCodeDialog, { props: { open: true } });

    await waitFor(() => expect(clientMocks.getActiveFeatures).toHaveBeenCalledTimes(1));
    expect(getSetActiveFeaturesPayloads()).toEqual([]);
  });

  it('still refreshes the store but shows no feedback when deactivation fails', async () => {
    featureState.activeFeatures = ['cortex'];
    clientMocks.deactivateFeature.mockResolvedValue({ success: false });
    clientMocks.getActiveFeatures.mockResolvedValue(['cortex']);

    render(FeatureCodeDialog, { props: { open: true } });
    await waitFor(() => expect(clientMocks.getActiveFeatures).toHaveBeenCalledTimes(1));

    await fireEvent.click(screen.getByTitle('Remove cortex'));

    await waitFor(() => expect(clientMocks.getActiveFeatures).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Feature deactivated! Restart to apply.')).toBeNull();
  });
});
