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

const MODELS = PROVIDERS_CHANNELS.GET_MODELS;
const CODEX = { providerId: 'codex' };

afterEach(resetMockIpcRouter);

describe('catalog preview IPC fixtures', () => {
  it('restores the product model handler after preview teardown', async () => {
    registerMockIpcHandler(MODELS, async (...args) => ({
      success: true,
      data: [{ value: 'product-model', label: 'Product model' }],
      args,
    }));
    const cleanup = setupModelPickerPreviewHandler('codex', []);
    expect(await mockInvoke(MODELS, CODEX)).toEqual({ success: true, data: [] });
    cleanup();
    expect(await mockInvoke(MODELS, { ...CODEX, refresh: true })).toEqual({
      success: true,
      data: [{ value: 'product-model', label: 'Product model' }],
      args: [{ ...CODEX, refresh: true }],
    });
  });

  it('serves each provider its own rows and passes other providers through', async () => {
    registerMockIpcHandler(MODELS, () => ({ success: true, data: [], served: 'product' }));
    const codexRows = [{ value: 'codex-model', label: 'Codex model' }];
    const claudeRows = [{ value: 'claude-model', label: 'Claude model' }];
    const cleanupCodex = setupModelPickerPreviewHandler('codex', codexRows);
    const cleanupClaude = setupModelPickerPreviewHandler('claude-code', claudeRows);
    expect(await mockInvoke(MODELS, CODEX)).toEqual({ success: true, data: codexRows });
    expect(
      await mockInvoke(MODELS, { providerId: 'claude-code', providerRef: 'claude-code@work' }),
    ).toEqual({ success: true, data: claudeRows });
    expect(await mockInvoke(MODELS, { providerId: 'grok' })).toEqual({
      success: true,
      data: [],
      served: 'product',
    });
    cleanupClaude();
    cleanupCodex();
    expect(await mockInvoke(MODELS, CODEX)).toEqual({
      success: true,
      data: [],
      served: 'product',
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
    expect(await mockInvoke(MODELS, CODEX)).toEqual({ success: true, data: rows });
    cleanup();
    expect(hasMockIpcHandler(MODELS)).toBe(false);
    const cleanupEmpty = setupModelPickerPreviewHandler('codex', []);
    expect(await mockInvoke(MODELS, CODEX)).toEqual({ success: true, data: [] });
    cleanupEmpty();
    expect(hasMockIpcHandler(MODELS)).toBe(false);
  });

  it('serves a catalog warning alongside the model rows when one is given', async () => {
    const rows = [{ value: 'preview-model', label: 'Preview model' }];
    const cleanup = setupModelPickerPreviewHandler('codex', rows, 'codex: CLI not found');
    expect(await mockInvoke(MODELS, CODEX)).toEqual({
      success: true,
      data: rows,
      warning: 'codex: CLI not found',
    });
    cleanup();
    expect(hasMockIpcHandler(MODELS)).toBe(false);
  });

  it('serves a different first response, then the rows on every later call', async () => {
    const rows = [{ value: 'preview-model', label: 'Preview model' }];
    const cleanup = setupModelPickerPreviewHandler('codex', rows, undefined, {
      data: [],
      warning: 'codex: adapter exited',
    });
    expect(await mockInvoke(MODELS, CODEX)).toEqual({
      success: true,
      data: [],
      warning: 'codex: adapter exited',
    });
    expect(await mockInvoke(MODELS, { ...CODEX, forceRefresh: true })).toEqual({
      success: true,
      data: rows,
    });
    expect(await mockInvoke(MODELS, CODEX)).toEqual({ success: true, data: rows });
    cleanup();
    expect(hasMockIpcHandler(MODELS)).toBe(false);
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
