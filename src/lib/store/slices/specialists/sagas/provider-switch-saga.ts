import { call, put, takeEvery } from "typed-redux-saga";
import { createLogger } from "$lib/utils/client-logger";
import { selectUserOverrides, selectProviderModelOverrides } from "../specialists-selectors";
import {
  switchModelOverridesForProvider,
  setUserOverrides,
  setProviderModelOverrides,
  PROVIDER_MODEL_OVERRIDES_KEY,
  SPECIALISTS_OVERRIDES_KEY,
  type SpecialistOverrides,
} from "../specialists-slice";

const logger = createLogger("ProviderSwitchSaga");

function* handleSwitchModelOverrides(action: ReturnType<typeof switchModelOverridesForProvider>) {
  const [newProviderId, previousProviderId] = action.payload;

  logger.info("Switching specialist model overrides for provider:", {
    from: previousProviderId,
    to: newProviderId,
  });

  // Read current state
  const overrides: SpecialistOverrides = yield* selectUserOverrides.effect();
  const currentModelOverrides = { ...overrides.modelOverrides };

  // Get providerModelOverrides from state
  const providerModelOverrides: Record<string, Record<string, string>> = {
    ...( yield* selectProviderModelOverrides.effect() ),
  };

  // Save current model overrides for the outgoing provider
  if (Object.keys(currentModelOverrides).length > 0) {
    providerModelOverrides[previousProviderId] = currentModelOverrides;
  } else {
    providerModelOverrides[previousProviderId] = {};
  }

  // Save provider model overrides to state and localStorage
  yield* put(setProviderModelOverrides(providerModelOverrides));
  try {
    yield* call(
      [localStorage, localStorage.setItem],
      PROVIDER_MODEL_OVERRIDES_KEY,
      JSON.stringify(providerModelOverrides)
    );
  } catch (error) {
    logger.error("Failed to save per-provider model overrides cache:", error);
  }

  // Restore saved overrides for the incoming provider, or clear
  const saved = providerModelOverrides[newProviderId];
  let newModelOverrides: Record<string, string> = {};

  if (saved && Object.keys(saved).length > 0) {
    logger.info("Restoring specialist model overrides for provider:", {
      providerId: newProviderId,
      overrideKeys: Object.keys(saved),
    });
    newModelOverrides = { ...saved };
  }

  // Update overrides with the new model overrides (keeping behavior prompt and coding agent overrides)
  yield* put(setUserOverrides({
    codingAgentOverrides: { ...overrides.codingAgentOverrides },
    modelOverrides: newModelOverrides,
    behaviorPromptOverrides: { ...overrides.behaviorPromptOverrides },
  }));

  // Save the updated overrides to electron-store
  try {
    if (typeof window !== "undefined" && window.electronAPI) {
      yield* call(
        [window.electronAPI, window.electronAPI.invoke],
        'settings:set',
        {
          key: SPECIALISTS_OVERRIDES_KEY,
          value: {
            codingAgentOverrides: { ...overrides.codingAgentOverrides },
            modelOverrides: newModelOverrides,
            behaviorPromptOverrides: { ...overrides.behaviorPromptOverrides },
          },
        }
      );
    }
  } catch (error) {
    logger.error("Failed to save overrides after provider switch:", error);
  }
}

export function* providerSwitchSaga() {
  yield* takeEvery(switchModelOverridesForProvider, handleSwitchModelOverrides);
}

