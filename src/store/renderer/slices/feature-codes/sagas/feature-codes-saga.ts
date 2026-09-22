import { call, put, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import { featureCodesClient } from '$features/feature-codes/renderer/feature-codes.client';
import {
  activateFeatureCodeRequested,
  deactivateFeatureRequested,
  featureCodeOperationFailed,
  featureCodeOperationSucceeded,
  loadActiveFeaturesRequested,
  restartForFeatureCodesRequested,
  setActiveFeatures,
} from '../feature-codes-slice';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function* refreshFeatures(): SagaGenerator<void> {
  const features: Awaited<ReturnType<typeof featureCodesClient.getActiveFeatures>> = yield* call([
    featureCodesClient,
    featureCodesClient.getActiveFeatures,
  ]);
  if (features !== null) yield* put(setActiveFeatures(features));
}

function* load(): SagaGenerator<void> {
  try {
    yield* call(refreshFeatures);
    yield* put(featureCodeOperationSucceeded('load', null));
  } catch (error) {
    yield* put(featureCodeOperationFailed('load', errorMessage(error)));
  }
}

function* activate(action: ReturnType<typeof activateFeatureCodeRequested>): SagaGenerator<void> {
  try {
    const result: Awaited<ReturnType<typeof featureCodesClient.activateCode>> = yield* call(
      [featureCodesClient, featureCodesClient.activateCode],
      action.payload[0],
    );
    yield* call(refreshFeatures);
    yield* put(featureCodeOperationSucceeded('activate', result.status));
  } catch (error) {
    yield* put(featureCodeOperationFailed('activate', errorMessage(error)));
  }
}

function* deactivate(action: ReturnType<typeof deactivateFeatureRequested>): SagaGenerator<void> {
  try {
    const result: Awaited<ReturnType<typeof featureCodesClient.deactivateFeature>> = yield* call(
      [featureCodesClient, featureCodesClient.deactivateFeature],
      action.payload[0],
    );
    if (!result.success) throw new Error('Feature deactivation failed');
    yield* call(refreshFeatures);
    yield* put(featureCodeOperationSucceeded('deactivate', 'deactivated'));
  } catch (error) {
    yield* put(featureCodeOperationFailed('deactivate', errorMessage(error)));
  }
}

function* restart(): SagaGenerator<void> {
  yield* call([featureCodesClient, featureCodesClient.restartApp]);
}

export function* featureCodesSaga(): SagaGenerator<void> {
  yield* takeLatest(loadActiveFeaturesRequested, load);
  yield* takeLatest(activateFeatureCodeRequested, activate);
  yield* takeLatest(deactivateFeatureRequested, deactivate);
  yield* takeLatest(restartForFeatureCodesRequested, restart);
}
