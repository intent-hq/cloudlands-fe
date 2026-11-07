import { describe, expect, it } from 'vitest';
import { getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { PluginInfo } from '$lib/client/live/live-plugins-client';
import {
  initialState,
  installFailed,
  installPlugin,
  installSucceeded,
  pluginChanged,
  pluginsLoaded,
  pluginsSettingsReducer,
  rowActionFailed,
  togglePlugin,
} from './plugins-settings-slice';

const plugin = (name: string, enabled = true): PluginInfo => ({
  name,
  status: 'ok',
  enabled,
  path: `/home/ada/.intent/plugins/${name}`,
  skills: [],
  mcpServers: [],
  diagnostics: [],
});

const loaded = pluginsSettingsReducer(
  initialState,
  pluginsLoaded([plugin('alpha'), plugin('gamma')]),
);

describe('pluginsSettingsReducer', () => {
  it('flips a toggle optimistically and restores it when the daemon refuses', () => {
    const pending = pluginsSettingsReducer(loaded, togglePlugin('alpha', false));
    expect(getItems(pending.plugins)[0].enabled).toBe(false);
    expect(pending.busy).toBe('alpha');

    const failed = pluginsSettingsReducer(pending, rowActionFailed('alpha', 'denied', true));
    expect(getItems(failed.plugins)[0].enabled).toBe(true);
    expect(failed.busy).toBeNull();
    expect(failed.rowError).toEqual({ name: 'alpha', message: 'denied' });
  });

  it('keeps the list sorted when an install or update lands', () => {
    const installed = pluginsSettingsReducer(
      pluginsSettingsReducer(loaded, installPlugin('/src/beta')),
      installSucceeded(plugin('beta')),
    );
    expect(getItems(installed.plugins).map((p) => p.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(installed.installing).toBe(false);

    const updated = pluginsSettingsReducer(
      installed,
      pluginChanged({ ...plugin('beta'), version: '2' }),
    );
    expect(getItems(updated.plugins).map((p) => p.version ?? null)).toEqual([null, '2', null]);
  });

  it('keeps existing plugins when an install fails', () => {
    const failed = pluginsSettingsReducer(
      pluginsSettingsReducer(loaded, installPlugin('/nope')),
      installFailed('not a valid plugin'),
    );
    expect(getItems(failed.plugins)).toHaveLength(2);
    expect(failed.installing).toBe(false);
    expect(failed.installError).toBe('not a valid plugin');
  });
});
