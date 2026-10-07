import { providerTokenCapability } from '$shared/provider-catalog';
import { all, call, put, race, take, takeEvery } from 'typed-redux-saga';
import { readProviderToken, writeProviderToken } from '$features/settings/provider-access-token';
import {
  clearProviderTokenDrafts,
  takeProviderToken,
} from '$features/settings/provider-token-drafts';
import { selectProviderCatalogEntries } from '../../provider-catalog/provider-catalog-selectors';
import { providerCatalogLoaded } from '../../provider-catalog/provider-catalog-slice';
import { hostExecutionConnectionChanged } from '../../host-execution/host-execution-slice';
import { settingsChangesReceived } from '../../settings-events/settings-events-slice';
import {
  selectProviderAccessToken,
  selectProviderSettingsSessionActive,
} from '../provider-settings-selectors';
import {
  providerSettingsSessionClosed,
  providerTokenReadRequested,
  providerTokenReadStarted,
  providerTokenWriteRequested,
  providerTokenSettled,
} from '../provider-settings-slice';

function* readToken(action: ReturnType<typeof providerTokenReadRequested>) {
  const [providerId] = action.payload;
  const entry = (yield* selectProviderCatalogEntries.effect()).find((p) => p.id === providerId);
  const capability = providerTokenCapability(entry);
  if (!capability || (yield* selectProviderAccessToken.effect(providerId))?.busy) return;
  const requestId = crypto.randomUUID();
  yield* put(providerTokenReadStarted(providerId, requestId));
  try {
    const result = yield* call(readProviderToken, capability.settingPath);
    yield* put(providerTokenSettled(providerId, requestId, result));
  } catch {
    yield* put(providerTokenSettled(providerId, requestId, null));
  }
}

function* refreshTokens() {
  for (const entry of yield* selectProviderCatalogEntries.effect()) {
    if (providerTokenCapability(entry)) yield* put(providerTokenReadRequested(entry.id));
  }
}

function* writeToken(action: ReturnType<typeof providerTokenWriteRequested>) {
  const [providerId, operation, request] = action.payload;
  const token = takeProviderToken(request.id, request.sessionId);
  const pending = yield* selectProviderAccessToken.effect(providerId);
  if (pending?.requestId !== request.id || !pending.busy) return;
  try {
    const entry = (yield* selectProviderCatalogEntries.effect()).find((p) => p.id === providerId);
    const capability = providerTokenCapability(entry);
    if (!capability || !(yield* selectProviderSettingsSessionActive.effect(request.sessionId))) {
      throw new Error('Token settings unavailable');
    }
    if (operation === 'save' && !token?.trim()) throw new Error('Token is required');
    const result = yield* call(
      writeProviderToken,
      capability.settingPath,
      operation === 'save' ? token : undefined,
    );
    yield* put(providerTokenSettled(providerId, request.id, result));
  } catch {
    // Never log or render errors from a secret-bearing request.
    yield* put(providerTokenSettled(providerId, request.id, null));
  }
}

function* refreshChangedTokens(action: ReturnType<typeof settingsChangesReceived>) {
  const [changes] = action.payload;
  for (const entry of yield* selectProviderCatalogEntries.effect()) {
    const token = providerTokenCapability(entry);
    if (token && changes.some(({ path }) => path === token.settingPath)) {
      yield* put(providerTokenReadRequested(entry.id));
    }
  }
}

function clearSession(action: ReturnType<typeof providerSettingsSessionClosed>) {
  clearProviderTokenDrafts(action.payload[0]);
}

export function* providerAccessTokenSaga() {
  try {
    while (true) {
      yield* race({
        work: all([
          takeEvery(providerTokenReadRequested, readToken),
          takeEvery(providerTokenWriteRequested, writeToken),
          takeEvery(providerCatalogLoaded, refreshTokens),
          takeEvery(settingsChangesReceived, refreshChangedTokens),
          takeEvery(providerSettingsSessionClosed, clearSession),
        ]),
        connection: take(hostExecutionConnectionChanged),
      });
      clearProviderTokenDrafts();
    }
  } finally {
    clearProviderTokenDrafts();
  }
}
