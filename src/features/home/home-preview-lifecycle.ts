import { store } from '$store/renderer/store';
import { getRendererStore } from '$store/renderer/renderer-store-bridge';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { chatDraftsSaga } from '$store/renderer/slices/chat-drafts/sagas/chat-drafts-saga';
import { setupHomeIntegrationsFixtures } from './home-integrations-browser-fixtures';
import { setupHomeAssistantActivityFixtures } from './home-assistant-activity-browser-fixtures';

export function startHomePreviewFixtures() {
  return startHomePreview(() => {
    const stopIntegrations = setupHomeIntegrationsFixtures(store);
    const stopActivity = setupHomeAssistantActivityFixtures();
    const stopDrafts = store.runSaga(chatDraftsSaga);
    return [
      () => {
        stopDrafts();
        stopActivity();
        stopIntegrations();
      },
    ];
  });
}

export function startHomePreview(startSagas: () => Array<() => void>) {
  let initialized = false;
  try {
    initialized = getRendererStore() === store;
  } catch {
    // Component tests mount without the application root layout.
  }
  if (!initialized) return startRootStoreLifecycle(store, { startSagas });
  const stops = startSagas();
  return () => stops.forEach((stop) => stop());
}
