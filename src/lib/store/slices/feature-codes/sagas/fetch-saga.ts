import { call, put, takeLatest, takeEvery } from "typed-redux-saga";
import { invoke } from "$lib/electron-bridge";
import { createLogger } from "$lib/utils/client-logger";
import {
  fetchFeatures,
  fetchFeaturesSuccess,
  deactivateFeature,
} from "../feature-codes-slice";

const logger = createLogger("FeatureCodesSaga");

/**
 * Fetch active features from the main process via IPC.
 */
function* handleFetchFeatures() {
  try {
    const result = (yield* call(invoke, "feature-codes:get-active")) as {
      features?: string[];
    };
    if (result?.features && Array.isArray(result.features)) {
      yield* put(fetchFeaturesSuccess(result.features));
      logger.debug("Loaded active features", { features: result.features });
    }
  } catch (error) {
    logger.error("Failed to fetch active features", { error });
  }
}

/**
 * Deactivate a feature via IPC, then refresh the feature list.
 */
function* handleDeactivateFeature(
  action: ReturnType<typeof deactivateFeature>
) {
  const [featureId] = action.payload;
  try {
    yield* call(invoke, "feature-codes:deactivate", { featureId });
    // Refresh the full list after deactivation
    yield* put(fetchFeatures());
  } catch (error) {
    logger.error("Failed to deactivate feature", { error, featureId });
  }
}

/**
 * Feature codes fetch saga:
 * - On init, fetches active features from the main process
 * - Watches for fetchFeatures actions to refresh
 * - Watches for deactivateFeature actions to deactivate + refresh
 */
export function* featureCodesFetchSaga() {
  // Init: fetch active features on startup
  yield* call(handleFetchFeatures);

  // Watch for refresh requests
  yield* takeLatest(fetchFeatures, handleFetchFeatures);

  // Watch for deactivate requests
  yield* takeEvery(deactivateFeature, handleDeactivateFeature);
}

