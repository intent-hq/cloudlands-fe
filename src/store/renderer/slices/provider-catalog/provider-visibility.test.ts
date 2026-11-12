import { describe, expect, it } from 'vitest';
import { store } from '../../store';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { selectContextListedProviderIds } from './workspace-catalog-selectors';
import { selectIsProviderEnabled } from '../provider-settings/provider-settings-selectors';
import {
  MOCK_CURSOR_PROVIDER,
  MOCK_PROVIDER_CATALOG,
} from '../../../../test/fixtures/provider-catalog.fixture';
import type { StoreState } from '../../types';

describe('provider visibility follows the execution host', () => {
  for (const workspaceId of [undefined, 'remote']) {
    it.each([
      [undefined, false, false],
      [false, false, false],
      [true, false, true],
      [undefined, true, true],
      [false, true, true],
    ])(
      `lists Auggie on ${workspaceId ?? 'local'} installed=%s enabled=%s: %s`,
      (installed, enabled, listed) => {
        const dispose = store.init();
        try {
          const providers = MOCK_PROVIDER_CATALOG.providers;
          const readiness =
            installed === undefined
              ? {}
              : { auggie: { available: installed, authenticated: false } };
          const state = {
            ...store.state,
            agentAvailability: {
              ...store.state.agentAvailability,
              providerStatusMap: workspaceId ? { auggie: { available: !installed } } : readiness,
            },
            providerSettings: {
              ...store.state.providerSettings,
              enabledProviders: { auggie: workspaceId ? !enabled : enabled },
            },
            providerCatalog: {
              ...store.state.providerCatalog,
              providers: createCollection('id', providers),
              byWorkspaceId: {
                remote: {
                  catalog: { providers },
                  readiness,
                  specialists: [],
                  settings: [{ path: 'providers.enabled', value: { auggie: enabled } }],
                },
              },
            },
          } as StoreState;
          const ids = selectContextListedProviderIds.select(state, workspaceId);
          expect(ids.includes('auggie')).toBe(listed);
          expect(ids).toContain('codex');
        } finally {
          dispose();
        }
      },
    );
  }
});

describe('Cursor as an opt-in provider', () => {
  function cursorState(enabledProviders: Record<string, boolean>) {
    const providers = [...MOCK_PROVIDER_CATALOG.providers, MOCK_CURSOR_PROVIDER];
    const readiness = { cursor: { available: true, authenticated: true } };
    return {
      ...store.state,
      agentAvailability: { ...store.state.agentAvailability, providerStatusMap: readiness },
      providerSettings: { ...store.state.providerSettings, enabledProviders },
      providerCatalog: {
        ...store.state.providerCatalog,
        providers: createCollection('id', providers),
        byWorkspaceId: {
          remote: {
            catalog: { providers },
            readiness,
            specialists: [],
            settings: [{ path: 'providers.enabled', value: enabledProviders }],
          },
        },
      },
    } as StoreState;
  }

  for (const workspaceId of [undefined, 'remote']) {
    it.each([{}, { cursor: false }, { cursor: true }])(
      `lists an installed Cursor on ${workspaceId ?? 'local'} with providers.enabled %j`,
      (enabledProviders) => {
        const dispose = store.init();
        try {
          const ids = selectContextListedProviderIds.select(
            cursorState(enabledProviders),
            workspaceId,
          );
          expect(ids).toContain('cursor');
        } finally {
          dispose();
        }
      },
    );
  }

  it.each([
    [{}, false],
    [{ cursor: false }, false],
    [{ cursor: true }, true],
  ])('treats an installed Cursor with providers.enabled %j as enabled=%s', (enabled, expected) => {
    const dispose = store.init();
    try {
      expect(selectIsProviderEnabled.select(cursorState(enabled), 'cursor')).toBe(expected);
    } finally {
      dispose();
    }
  });
});
