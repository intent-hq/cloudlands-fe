// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { hasMockIpcHandler, mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import type { ProviderAvailabilityResult } from '$shared/types/provider-availability';
import {
  setupModelPickerPreviewHandler,
  setupProviderSelectorPreviewHandlers,
} from './catalog-preview-ipc';

afterEach(resetMockIpcRouter);

describe('catalog preview IPC fixtures', () => {
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
