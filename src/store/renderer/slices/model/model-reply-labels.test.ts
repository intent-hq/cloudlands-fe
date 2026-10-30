/**
 * The store passes model-list reply labels through as one group
 * (`ModelReplyLabels`), so a label added to the shared `GetModelsEnvelope`
 * reaches the model slice's loading state — what the model picker reads —
 * without an edit in model-utils, the provider-models saga or the slice.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('$features/providers/provider-models.client', () => ({ getProviderModels: vi.fn() }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { warning: vi.fn() } }));

import {
  getProviderModels,
  type ProviderModelsResult,
} from '$features/providers/provider-models.client';
import type { GetModelsEnvelope } from '$shared/models/wire-model-info';
import { store } from '../../store';
import { providerCatalogLoaded } from '../provider-catalog/provider-catalog-slice';
import { providerModelsRequested } from '../provider-models/provider-models-slice';
import { selectProviderModelsRequests } from '../provider-models/provider-models-selectors';
import type { ProviderModelsFetchResult } from '../provider-models/provider-models-types';
import { setLoadingStateForProvider } from './model-slice';
import type { ModelLoadingState, ModelReplyLabels } from './model-types';
import { modelReloadSaga } from './sagas/model-reload-saga';

/** A reply carrying a label the store has never heard of. */
type ReplyWithFutureLabel = ProviderModelsResult & { futureLabel?: string };

const fetchModels = vi.mocked(getProviderModels);
const loadingState = (): Record<string, unknown> | undefined =>
  store.state.model.loadingState.codex;
/** Request a forced reload and wait until its outcome reaches the loading state. */
const load = async (reply: ReplyWithFutureLabel | Error) => {
  if (reply instanceof Error) fetchModels.mockRejectedValueOnce(reply);
  else fetchModels.mockResolvedValueOnce(reply);
  const before = fetchModels.mock.calls.length;
  store.dispatch(providerModelsRequested('codex', 'refresh'));
  await vi.waitFor(() => expect(fetchModels.mock.calls.length).toBe(before + 1));
  await vi.waitFor(() =>
    expect(selectProviderModelsRequests.select(store.state).codex?.status).not.toBe('loading'),
  );
};

let dispose: () => void;
let cancel: () => void;

beforeEach(() => {
  fetchModels.mockReset();
  dispose = store.init();
  store.dispatch(
    providerCatalogLoaded({
      providers: [
        {
          id: 'codex',
          displayName: 'codex',
          shortName: 'codex',
          command: 'codex',
          visible: true,
          canBeDisabled: true,
        },
      ],
    }),
  );
  cancel = store.runSaga(modelReloadSaga);
});
afterEach(() => {
  cancel();
  dispose();
});

describe('model reply labels', () => {
  it('derives the store label type from the shared reply envelope', () => {
    expectTypeOf<ModelReplyLabels>().toEqualTypeOf<
      Omit<GetModelsEnvelope, 'success' | 'data' | 'error'>
    >();
    expectTypeOf<ModelLoadingState>().toExtend<ModelReplyLabels>();
    expectTypeOf<ProviderModelsFetchResult>().toExtend<ModelReplyLabels>();
  });

  it('carries a new reply label into the loading state with the default carry rule', async () => {
    const models = [{ value: 'gpt-5', label: 'GPT-5' }];
    await load({ models, warning: 'probe failed', futureLabel: 'first' });
    expect(loadingState()).toMatchObject({
      status: 'success',
      warning: 'probe failed',
      futureLabel: 'first',
    });

    // A loading update keeps the last answer's label, like its warning.
    store.dispatch(setLoadingStateForProvider({ providerId: 'codex', status: 'loading' }));
    expect(loadingState()).toMatchObject({ status: 'loading', futureLabel: 'first' });

    // A fresh result replaces it…
    await load({ models, futureLabel: 'second' });
    expect(loadingState()).toMatchObject({ status: 'success', futureLabel: 'second' });

    // …a fresh result without it clears it…
    await load({ models });
    expect(loadingState()).not.toHaveProperty('futureLabel');

    // …and a failed load clears it.
    await load({ models, futureLabel: 'third' });
    await load(new Error('boom'));
    expect(loadingState()).toMatchObject({ status: 'error', error: 'boom' });
    expect(loadingState()).not.toHaveProperty('futureLabel');
  });
});
