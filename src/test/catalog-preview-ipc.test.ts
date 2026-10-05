// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  hasMockIpcHandler,
  mockInvoke,
  registerMockIpcHandler,
  resetMockIpcRouter,
} from '$shared/ipc-mock-router';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import type { ProviderAvailabilityResult } from '$shared/types/provider-availability';
import {
  setupModelPickerPreviewHandler,
  setupProviderSelectorPreviewHandlers,
} from './catalog-preview-ipc';

afterEach(resetMockIpcRouter);

describe('catalog preview IPC fixtures', () => {
  it('restores the product model handler after preview teardown', async () => {
    registerMockIpcHandler('codex:get-models', async (...args) => ({
      success: true,
      data: [{ value: 'product-model', label: 'Product model' }],
      args,
    }));
    const cleanup = setupModelPickerPreviewHandler('codex', []);
    expect(await mockInvoke('codex:get-models')).toEqual({ success: true, data: [] });
    cleanup();
    expect(await mockInvoke('codex:get-models', { refresh: true })).toEqual({
      success: true,
      data: [{ value: 'product-model', label: 'Product model' }],
      args: [{ refresh: true }],
    });
  });

  it('restores both product provider handlers after preview teardown', async () => {
    const availability = {
      hasAnyProvider: false,
      hiddenProviders: [],
      providers: {},
    } as ProviderAvailabilityResult;
    const paths = { paths: { codex: '/usr/bin/codex' }, secondaryPaths: {} };
    registerMockIpcHandler(PROVIDERS_CHANNELS.GET_AVAILABILITY, () => ({
      success: true,
      data: { ...availability, hasAnyProvider: true },
    }));
    registerMockIpcHandler(PROVIDERS_CHANNELS.GET_PATHS, () => ({ success: true, data: paths }));
    const cleanup = setupProviderSelectorPreviewHandlers(availability);
    expect(await mockInvoke(PROVIDERS_CHANNELS.GET_AVAILABILITY)).toEqual({
      success: true,
      data: availability,
    });
    cleanup();
    expect(await mockInvoke(PROVIDERS_CHANNELS.GET_AVAILABILITY)).toEqual({
      success: true,
      data: { ...availability, hasAnyProvider: true },
    });
    expect(await mockInvoke(PROVIDERS_CHANNELS.GET_PATHS)).toEqual({ success: true, data: paths });
  });

  it('serves model rows, removes the handler on teardown, and supports a fresh setup', async () => {
    const rows = [{ value: 'preview-model', label: 'Preview model' }];
    const cleanup = setupModelPickerPreviewHandler('codex', rows);
    expect(await mockInvoke('codex:get-models')).toEqual({ success: true, data: rows });
    cleanup();
    expect(hasMockIpcHandler('codex:get-models')).toBe(false);
    const cleanupEmpty = setupModelPickerPreviewHandler('codex', []);
    expect(await mockInvoke('codex:get-models')).toEqual({ success: true, data: [] });
    cleanupEmpty();
    expect(hasMockIpcHandler('codex:get-models')).toBe(false);
  });

  it('serves availability and paths together and removes both handlers on teardown', async () => {
    const availability = {
      hasAnyProvider: false,
      hiddenProviders: [],
      providers: {},
    } as ProviderAvailabilityResult;
    const cleanup = setupProviderSelectorPreviewHandlers(availability);
    expect(await mockInvoke(PROVIDERS_CHANNELS.GET_AVAILABILITY)).toEqual({
      success: true,
      data: availability,
    });
    expect(await mockInvoke(PROVIDERS_CHANNELS.GET_PATHS)).toEqual({
      success: true,
      data: { paths: {}, secondaryPaths: {} },
    });
    cleanup();
    expect(hasMockIpcHandler(PROVIDERS_CHANNELS.GET_AVAILABILITY)).toBe(false);
    expect(hasMockIpcHandler(PROVIDERS_CHANNELS.GET_PATHS)).toBe(false);
  });
});
