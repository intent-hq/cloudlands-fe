import { describe, expect, it } from 'vitest';
import { AppSettingsValidationError, buildWsAppSettingsApi } from '../ws-app-settings-api';
import type { ToolCall } from '../protocol';

const call = {
  name: 'workspace_api',
  arguments: {},
  context: { agentId: 'agent-chief' },
} as ToolCall;

describe('buildWsAppSettingsApi', () => {
  it('builds a settings proposal for valid schema-backed changes', async () => {
    const api = buildWsAppSettingsApi('__chief__', call);

    const result = await api.propose({
      changes: [{ path: 'theme.preference', value: 'dark' }],
    });

    expect(result.ok).toBe(true);
    expect(result.proposal).toMatchObject({
      kind: 'settings-change',
      payload: {
        changes: [
          {
            path: 'theme.preference',
            value: 'dark',
            apply: { kind: 'redux-action', action: 'theme/requestThemePreferenceChange' },
          },
        ],
      },
    });
  });

  it('returns a structured validation error for unknown setting paths', async () => {
    const api = buildWsAppSettingsApi('__chief__', call);

    await expect(
      api.propose({ changes: [{ path: 'theme.doesNotExist', value: 'dark' }] }),
    ).rejects.toMatchObject({
      code: 'APP_SETTINGS_VALIDATION_ERROR',
      details: {
        path: 'theme.doesNotExist',
        reason: 'unknown setting path',
        expected: 'a path from APP_SETTING_DEFINITIONS',
      },
    });
  });

  it('returns a structured validation error for out-of-range values', async () => {
    const api = buildWsAppSettingsApi('__chief__', call);

    await expect(
      api.propose({ changes: [{ path: 'notifications.volume', value: 2 }] }),
    ).rejects.toBeInstanceOf(AppSettingsValidationError);
    await expect(
      api.propose({ changes: [{ path: 'notifications.volume', value: 2 }] }),
    ).rejects.toMatchObject({
      code: 'APP_SETTINGS_VALIDATION_ERROR',
      details: {
        path: 'notifications.volume',
        reason: 'value must be <= 1',
        expected: 'number',
        value: 2,
      },
    });
  });
});
