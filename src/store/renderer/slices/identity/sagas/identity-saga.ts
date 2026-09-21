/**
 * Identity saga — mirrors the daemon's `identity.provider` setting (which
 * connected forge keys the primary principal) through `settings.get` /
 * `settings.update` (§5.12). An explicit write re-keys the primary daemon-side
 * and publishes `principal:identity-changed`, which the events bridge folds
 * into the slice as `identityChanged`.
 */
import { IDENTITY_PROVIDERS, type IdentityProvider } from '$features/workspace-sharing/types';
import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { call, put, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import {
  IDENTITY_PROVIDER_SETTING_PATH,
  identityLoaded,
  identityLoadFailed,
  identityProviderSaved,
  identityProviderSaveFailed,
  initializeIdentity,
  setIdentityProviderRequested,
} from '../identity-slice';

const logger = createLogger('IdentitySaga');

function asProvider(value: unknown): IdentityProvider | null {
  return typeof value === 'string' && (IDENTITY_PROVIDERS as readonly string[]).includes(value)
    ? (value as IdentityProvider)
    : null;
}

function* load(): SagaGenerator<void> {
  try {
    const setting = yield* call(
      [appClient.settings, appClient.settings.get],
      IDENTITY_PROVIDER_SETTING_PATH,
    );
    yield* put(identityLoaded(asProvider(setting?.value)));
  } catch (error) {
    logger.error('Failed to read identity.provider', error);
    yield* put(identityLoadFailed());
  }
}

function* save(action: ReturnType<typeof setIdentityProviderRequested>): SagaGenerator<void> {
  const [provider] = action.payload;
  try {
    yield* call(
      [appClient.settings, appClient.settings.update],
      [{ path: IDENTITY_PROVIDER_SETTING_PATH, value: provider }],
    );
    yield* put(identityProviderSaved(provider));
  } catch (error) {
    logger.error('Failed to write identity.provider', error);
    yield* put(identityProviderSaveFailed(m.settings_connections_identity_saveFailed_error()));
  }
}

export function* identitySaga(): SagaGenerator<void> {
  yield* takeLatest(initializeIdentity, load);
  yield* takeLatest(setIdentityProviderRequested, save);
}
