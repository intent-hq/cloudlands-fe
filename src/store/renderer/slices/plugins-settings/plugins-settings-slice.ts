import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import {
  createCollection,
  getItems,
  type Collection,
} from '@themislib/themis/utils/collections/collection-utils';
import type { PluginInfo } from '$lib/client/live/live-plugins-client';
import { hostExecutionConnectionChanged } from '../host-execution/host-execution-slice';

export type PluginsSettingsState = {
  plugins: Collection<PluginInfo, 'name'>;
  loading: boolean;
  loadError: string | null;
  installing: boolean;
  installError: string | null;
  /** Name of the plugin with a row action in flight. */
  busy: string | null;
  rowError: { name: string; message: string } | null;
};

export const initialState: PluginsSettingsState = {
  plugins: createCollection<PluginInfo, 'name'>('name'),
  loading: true,
  loadError: null,
  installing: false,
  installError: null,
  busy: null,
  rowError: null,
};

export const loadPlugins = createAction('pluginsSettings/load');
export const pluginsLoaded = createAction<[plugins: PluginInfo[]]>('pluginsSettings/loaded');
export const pluginsLoadFailed = createAction<[message: string]>('pluginsSettings/loadFailed');
export const installPlugin = createAction<[source: string]>('pluginsSettings/install');
export const installSucceeded = createAction<[plugin: PluginInfo]>('pluginsSettings/installed');
export const installFailed = createAction<[message: string]>('pluginsSettings/installFailed');
export const togglePlugin =
  createAction<[name: string, enabled: boolean]>('pluginsSettings/toggle');
export const updatePlugin = createAction<[name: string]>('pluginsSettings/update');
export const uninstallPlugin = createAction<[name: string]>('pluginsSettings/uninstall');
export const pluginChanged = createAction<[plugin: PluginInfo]>('pluginsSettings/changed');
export const pluginRemoved = createAction<[name: string]>('pluginsSettings/removed');
/** `enabled` restores the switch after a failed toggle. */
export const rowActionFailed = createAction<[name: string, message: string, enabled?: boolean]>(
  'pluginsSettings/rowActionFailed',
);

function collect(plugins: PluginInfo[]): Collection<PluginInfo, 'name'> {
  return createCollection<PluginInfo, 'name'>(
    'name',
    [...plugins].sort((a, b) => a.name.localeCompare(b.name)),
  );
}

function upsert(state: PluginsSettingsState, plugin: PluginInfo): Collection<PluginInfo, 'name'> {
  return collect([...getItems(state.plugins).filter((p) => p.name !== plugin.name), plugin]);
}

function mapPlugins(
  state: PluginsSettingsState,
  name: string,
  change: (plugin: PluginInfo) => PluginInfo,
): Collection<PluginInfo, 'name'> {
  return collect(getItems(state.plugins).map((p) => (p.name === name ? change(p) : p)));
}

function startRow(state: PluginsSettingsState, name: string): PluginsSettingsState {
  return { ...state, busy: name, rowError: null };
}

export const pluginsSettingsReducer = createReducer<PluginsSettingsState>(initialState);
pluginsSettingsReducer.with(loadPlugins, (state) => ({
  ...state,
  loading: getItems(state.plugins).length === 0,
}));
pluginsSettingsReducer.with(pluginsLoaded, (state, { payload: [plugins] }) => ({
  ...state,
  plugins: collect(plugins),
  loading: false,
  loadError: null,
}));
pluginsSettingsReducer.with(pluginsLoadFailed, (state, { payload: [message] }) => ({
  ...state,
  loading: false,
  loadError: message,
}));
pluginsSettingsReducer.with(installPlugin, (state) => ({
  ...state,
  installing: true,
  installError: null,
}));
pluginsSettingsReducer.with(installSucceeded, (state, { payload: [plugin] }) => ({
  ...state,
  plugins: upsert(state, plugin),
  installing: false,
}));
pluginsSettingsReducer.with(installFailed, (state, { payload: [message] }) => ({
  ...state,
  installing: false,
  installError: message,
}));
pluginsSettingsReducer.with(togglePlugin, (state, { payload: [name, enabled] }) => ({
  ...startRow(state, name),
  plugins: mapPlugins(state, name, (p) => ({ ...p, enabled })),
}));
pluginsSettingsReducer.with(updatePlugin, (state, { payload: [name] }) => startRow(state, name));
pluginsSettingsReducer.with(uninstallPlugin, (state, { payload: [name] }) => startRow(state, name));
pluginsSettingsReducer.with(pluginChanged, (state, { payload: [plugin] }) => ({
  ...state,
  plugins: upsert(state, plugin),
  busy: state.busy === plugin.name ? null : state.busy,
}));
pluginsSettingsReducer.with(pluginRemoved, (state, { payload: [name] }) => ({
  ...state,
  plugins: collect(getItems(state.plugins).filter((p) => p.name !== name)),
  busy: state.busy === name ? null : state.busy,
}));
pluginsSettingsReducer.with(rowActionFailed, (state, { payload: [name, message, enabled] }) => ({
  ...state,
  plugins:
    enabled === undefined ? state.plugins : mapPlugins(state, name, (p) => ({ ...p, enabled })),
  busy: state.busy === name ? null : state.busy,
  rowError: { name, message },
}));
pluginsSettingsReducer.with(hostExecutionConnectionChanged, () => initialState);
