import { call, put, takeEvery, takeLatest, type SagaGenerator } from 'typed-redux-saga';

import {
  installPlugin as installPluginRequest,
  listPlugins,
  togglePlugin as togglePluginRequest,
  uninstallPlugin as uninstallPluginRequest,
  updatePlugin as updatePluginRequest,
} from '$lib/client/live/live-plugins-client';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  installFailed,
  installPlugin,
  installSucceeded,
  loadPlugins,
  pluginChanged,
  pluginRemoved,
  pluginsLoadFailed,
  pluginsLoaded,
  rowActionFailed,
  togglePlugin,
  uninstallPlugin,
  updatePlugin,
} from '../plugins-settings-slice';

const logger = createLogger('PluginsSettingsSaga');

function message(error: unknown): string {
  return error instanceof Error && error.message ? error.message : m.settings_plugins_error();
}

function* load(): SagaGenerator<void> {
  try {
    yield* put(pluginsLoaded(yield* call(listPlugins)));
  } catch (error) {
    logger.warn('plugin.list failed', { error });
    yield* put(pluginsLoadFailed(message(error)));
  }
}

function* install(action: ReturnType<typeof installPlugin>): SagaGenerator<void> {
  try {
    yield* put(installSucceeded(yield* call(installPluginRequest, action.payload[0])));
  } catch (error) {
    yield* put(installFailed(message(error)));
  }
}

function* toggle(action: ReturnType<typeof togglePlugin>): SagaGenerator<void> {
  const [name, enabled] = action.payload;
  try {
    yield* put(pluginChanged(yield* call(togglePluginRequest, name, enabled)));
  } catch (error) {
    yield* put(rowActionFailed(name, message(error), !enabled));
  }
}

function* update(action: ReturnType<typeof updatePlugin>): SagaGenerator<void> {
  const [name] = action.payload;
  try {
    yield* put(pluginChanged(yield* call(updatePluginRequest, name)));
  } catch (error) {
    yield* put(rowActionFailed(name, message(error)));
  }
}

function* uninstall(action: ReturnType<typeof uninstallPlugin>): SagaGenerator<void> {
  const [name] = action.payload;
  try {
    yield* call(uninstallPluginRequest, name);
    yield* put(pluginRemoved(name));
  } catch (error) {
    yield* put(rowActionFailed(name, message(error)));
  }
}

export function* pluginsSettingsSaga(): SagaGenerator<void> {
  yield* takeLatest(loadPlugins, load);
  yield* takeEvery(installPlugin, install);
  yield* takeEvery(togglePlugin, toggle);
  yield* takeEvery(updatePlugin, update);
  yield* takeEvery(uninstallPlugin, uninstall);
}
