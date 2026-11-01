import { store } from '$store/renderer/store';
import { getRendererStore } from '$store/renderer/renderer-store-bridge';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { appClient } from '$lib/client';
import { startChatFixtureSagas } from '../../test/chat-fixture-sagas';
import { setupHomeIntegrationsFixtures } from './home-integrations-browser-fixtures';
import { setupHomeAssistantActivityFixtures } from './home-assistant-activity-browser-fixtures';
import { setupHomeDismissFixtures } from './home-dismiss-browser-fixtures';
import { setupHomeAssistantRenameFixtures } from './home-assistant-rename-browser-fixtures';
import { setupHomeAssistantNewChatFixtures } from './home-assistant-new-chat-browser-fixtures';
import { homeWorkspacesSaga } from './home-workspaces-saga';

export function startHomePreviewFixtures(
  optionsOrExtra: { homePreferences?: boolean } | (() => Array<() => void>) = {},
) {
  const extraFixtures = typeof optionsOrExtra === 'function' ? optionsOrExtra : () => [];
  const homePreferences =
    typeof optionsOrExtra === 'function' ? true : (optionsOrExtra.homePreferences ?? true);
  return startHomePreview(() => {
    const stopIntegrations = setupHomeIntegrationsFixtures(store);
    const stopActivity = setupHomeAssistantActivityFixtures();
    const stopRenames = setupHomeAssistantRenameFixtures();
    const stopNewChats = setupHomeAssistantNewChatFixtures();
    const extraStops = extraFixtures();
    return [
      ...(homePreferences ? [store.runSaga(homeWorkspacesSaga)] : []),
      () => {
        extraStops.forEach((stop) => stop());
        stopNewChats();
        stopRenames();
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
  if (!initialized)
    return startRootStoreLifecycle(store, {
      startSagas: () => {
        const stops = startSagas();
        return [...startChatFixtureSagas(store, appClient.drafts), ...stops];
      },
    });
  const stops = startSagas();
  return () => stops.forEach((stop) => stop());
}

export function startHomeDismissPreview(collaborator: boolean, admissions = false) {
  return startHomePreviewFixtures(() => [setupHomeDismissFixtures(collaborator, admissions)]);
}
