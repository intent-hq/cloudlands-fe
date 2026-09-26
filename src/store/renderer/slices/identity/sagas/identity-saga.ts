/**
 * Identity saga — mirrors the daemon's `identity.provider` setting (which
 * connected forge keys the primary principal) through `settings.get` /
 * `settings.update` (§5.12), and the identity the daemon actually holds
 * through `principal.me` (§5.46: `identity?` triple + cached `login`). An
 * explicit write re-keys the primary daemon-side and publishes
 * `principal:identity-changed`, which the events bridge folds into the slice
 * as `identityChanged`; the saga then re-reads `principal.me` for the new
 * `login`, as the event contract asks of clients holding a cached read.
 *
 * Every wire call is gated on the identity-seam capability: a daemon that
 * predates it has no `identity.provider` setting and no `identity` on
 * `principal.me`, so the slice settles as unset / unlinked without a request.
 */
import { IDENTITY_PROVIDERS, type IdentityProvider } from '$features/workspace-sharing/types';
import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import { call, put, select, takeLatest, type SagaGenerator } from 'typed-redux-saga';
import { takeLatestFromSelector, type SelectorChannelPayload } from '@augmentcode/themis/saga';

import { selectDaemonSupportsIdentitySeam } from '../../daemon-health/daemon-health-selectors';
import { selectIdentityLoadStatus } from '../identity-selectors';
import {
  IDENTITY_PROVIDER_SETTING_PATH,
  identityChanged,
  identityLoaded,
  identityLoadFailed,
  identityProviderSaved,
  identityProviderSaveFailed,
  initializeIdentity,
  principalLoaded,
  setIdentityProviderRequested,
} from '../identity-slice';
import type { PrincipalIdentity } from '../identity-types';

const logger = createLogger('IdentitySaga');

function asProvider(value: unknown): IdentityProvider | null {
  return typeof value === 'string' && (IDENTITY_PROVIDERS as readonly string[]).includes(value)
    ? (value as IdentityProvider)
    : null;
}

/** The `identity?` triple of a `principal.me` reply; `null` when omitted or malformed. */
function asIdentity(value: unknown): PrincipalIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const { provider, host, externalUserId } = value as Record<string, unknown>;
  const known = asProvider(provider);
  if (!known || typeof host !== 'string' || typeof externalUserId !== 'string') return null;
  return { provider: known, host, externalUserId };
}

type PrincipalMeResult = { identity?: unknown; login?: unknown };

async function requestPrincipalMe(): Promise<PrincipalMeResult> {
  return backendRequest<PrincipalMeResult>('principal.me', {});
}

function* readPrincipal(): SagaGenerator<void> {
  try {
    const me = yield* call(requestPrincipalMe);
    yield* put(
      principalLoaded(asIdentity(me?.identity), typeof me?.login === 'string' ? me.login : null),
    );
  } catch (error) {
    logger.error('Failed to read principal.me', error);
  }
}

function* load(): SagaGenerator<void> {
  const supported = yield* select(selectDaemonSupportsIdentitySeam.select);
  if (!supported) {
    yield* put(identityLoaded(null));
    return;
  }
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
  yield* call(readPrincipal);
}

/** The primary was re-keyed: the triple is already applied; refresh the cached `login`. */
function* refreshAfterChange(): SagaGenerator<void> {
  const supported = yield* select(selectDaemonSupportsIdentitySeam.select);
  if (!supported) return;
  yield* call(readPrincipal);
}

/**
 * The capability was proven after a component had already asked for the
 * identity (the first `system.status` poll landed late): run the real read.
 */
function* onCapabilityChanged({
  payload,
  prevPayload,
}: SelectorChannelPayload<boolean>): SagaGenerator<void> {
  if (!payload || prevPayload == null) return;
  const status = yield* select(selectIdentityLoadStatus.select);
  if (status === 'idle') return;
  yield* call(load);
}

function* save(action: ReturnType<typeof setIdentityProviderRequested>): SagaGenerator<void> {
  const [provider] = action.payload;
  const supported = yield* select(selectDaemonSupportsIdentitySeam.select);
  if (!supported) {
    yield* put(identityProviderSaveFailed(m.settings_connections_identity_saveFailed_error()));
    return;
  }
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
  yield* takeLatest(identityChanged, refreshAfterChange);
  yield* takeLatest(setIdentityProviderRequested, save);
  yield* takeLatestFromSelector(selectDaemonSupportsIdentitySeam, onCapabilityChanged);
}
