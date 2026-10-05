import { selectProviderModelsClearEpoch } from '../../provider-models/provider-models-selectors';
import { call, getContext, put } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { selectActiveProviderId } from '../../provider-settings/provider-settings-selectors';
import { selectModelBootContext } from '../model-selectors';
import { setAvailableModels, setLoadingStateForProvider } from '../model-slice';

type Models = Awaited<ReturnType<typeof appClient.models.list>>;
type Outcome = { models: Models } | { error: unknown };
type CatalogRequest = {
  context: string;
  epoch: number;
  providerId: string;
  explicit: boolean;
  loadingStarted: boolean;
  published: boolean;
  settled: boolean;
  successful: boolean;
  result?: Promise<Outcome>;
};

// Transient request ownership only; catalogs/status remain in Redux. Each
// initialized Redux store has its own slot, including after app-store disposal.
const requests = new WeakMap<object, CatalogRequest>();
const bootLogger = createLogger('ModelBootSaga');
const reloadLogger = createLogger('ModelReloadSaga');

function begin(request: CatalogRequest) {
  if (request.result) return;
  // Track transport settlement even when every waiting saga was cancelled or
  // its admission became obsolete before publication.
  try {
    request.result = Promise.resolve(appClient.models.list(request.providerId)).then(
      (models): Outcome => {
        request.settled = true;
        return { models };
      },
      (error): Outcome => {
        request.settled = true;
        return { error };
      },
    );
  } catch (error) {
    request.settled = true;
    request.result = Promise.resolve({ error });
  }
}

function* isCurrent(owner: object, request: CatalogRequest) {
  if (requests.get(owner) !== request) return false;
  const providerId = yield* selectActiveProviderId.effect();
  return (
    (!providerId || providerId === request.providerId) &&
    request.context === (yield* selectModelBootContext.effect()) &&
    request.epoch === (yield* selectProviderModelsClearEpoch.effect())
  );
}

/** One publication owner for startup readiness and explicit active-catalog loads. */
export function* loadModelCatalog(
  providerId: string,
  context: string,
  explicit: boolean,
  force = false,
) {
  const owner = yield* getContext<object | undefined>('reduxStore');
  if (!owner || context !== (yield* selectModelBootContext.effect())) return false;

  const epoch = yield* selectProviderModelsClearEpoch.effect();
  const previous = requests.get(owner);
  const pending =
    previous &&
    !previous.settled &&
    previous.context === context &&
    previous.epoch === epoch &&
    previous.providerId === providerId;
  // A switch's readiness and explicit actions share one read. A subsequent
  // explicit reload, or a reconnect, takes a new token even for the same provider.
  const request =
    pending && !force && (!explicit || !previous.explicit)
      ? previous
      : {
          context,
          epoch,
          providerId,
          explicit: explicit || !!(force && pending && previous.explicit),
          loadingStarted: false,
          published: false,
          settled: false,
          successful: false,
          result: undefined,
        };
  if (explicit) request.explicit = true;
  requests.set(owner, request);

  if (request.explicit && !request.loadingStarted) {
    request.loadingStarted = true;
    if (!(yield* call(isCurrent, owner, request))) return true;
    yield* put(setLoadingStateForProvider({ providerId, status: 'loading' }));
    if (!(yield* call(isCurrent, owner, request))) return true;
    yield* put(setAvailableModels([], providerId));
  }
  if (!(yield* call(isCurrent, owner, request))) return true;
  yield* call(begin, request);
  const outcome = yield* call(() => request.result!);
  if (!(yield* call(isCurrent, owner, request))) return true;
  if (request.published) return request.successful;
  request.published = true;
  if ('error' in outcome) {
    if (request.explicit) {
      const error = outcome.error;
      const message =
        error instanceof Error && error.message ? error.message : m.settings_models_loadError();
      reloadLogger.error('reloadModelsForProvider failed', { providerId, error });
      yield* put(setLoadingStateForProvider({ providerId, status: 'error', error: message }));
    } else {
      bootLogger.warn('boot model catalog load failed; pickers will retry on demand', {
        error: outcome.error,
      });
    }
    return false;
  }
  if (outcome.models.length === 0) {
    if (request.explicit) {
      yield* put(
        setLoadingStateForProvider({
          providerId,
          status: 'error',
          error: m.settings_models_noneAvailable({ providerId }),
        }),
      );
    }
    return false;
  }
  yield* put(setAvailableModels(outcome.models, providerId));
  if (!(yield* call(isCurrent, owner, request))) return true;
  yield* put(setLoadingStateForProvider({ providerId, status: 'success', retryAttempt: 0 }));
  request.successful = true;
  return true;
}
