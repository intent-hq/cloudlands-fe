/**
 * Wire-contract tests for the model catalog bridge seeder.
 *
 * Asserts `providers:get-models` forwards any provider id to the daemon's
 * per-provider model catalog (`models.list { providerId, forceRefresh }`,
 * PROTOCOL §6.7) and return honest envelopes: mapped rows on success,
 * daemon-provided `warning`/`stale` labeling on fallback, and
 * `success: false` only on wire/transport failure.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// FAKE transport only: the daemon bridge is mocked so no IPC ever fires.
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { mockInvoke } from '$shared/ipc-mock-router';
import { PROVIDERS_CHANNELS } from '$shared/ipc/channels';
import type { GetModelsEnvelope as Envelope } from '$shared/models/wire-model-info';
import { PROVIDER_AVAILABILITY_KEY_TO_ID } from '$shared/types/provider-availability';

const mockedRequest = vi.mocked(backendRequest);

const MODELS = PROVIDERS_CHANNELS.GET_MODELS;

const PROVIDER_IDS = [
  ...Object.values(PROVIDER_AVAILABILITY_KEY_TO_ID).filter((id) => id !== 'mock'),
  'provider-added-later',
];

describe('model-catalog-bridge-seeder', () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import('./model-catalog-bridge-seeder');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(PROVIDER_IDS)(
    '%s → models.list { providerId } with wire id/name mapped to value/label',
    async (providerId) => {
      mockedRequest.mockResolvedValue({
        providerId,
        models: [
          { id: 'model-a', name: 'Model A', description: 'desc', isDefault: true },
          { id: 'model-b', name: 'Model B' },
        ],
        source: providerId,
      });

      const response = await mockInvoke<Envelope>(MODELS, { providerId });

      expect(mockedRequest).toHaveBeenCalledWith('models.list', { providerId });
      expect(response.success).toBe(true);
      expect(response.data).toEqual([
        { value: 'model-a', label: 'Model A', description: 'desc', isDefault: true },
        { value: 'model-b', label: 'Model B' },
      ]);
      expect(response.warning).toBeUndefined();
      expect(response.stale).toBeUndefined();
    },
  );

  // §5.54: a profile catalog is listed under its own reference.
  it('lists a named profile under its own reference', async () => {
    mockedRequest.mockResolvedValue({ providerId: 'codex@pwork00000001', models: [] });
    await mockInvoke<Envelope>(MODELS, { providerId: 'codex', providerRef: 'codex@pwork00000001' });
    expect(mockedRequest).toHaveBeenCalledWith('models.list', {
      providerId: 'codex@pwork00000001',
    });
  });

  it("never lists another provider's profile", async () => {
    mockedRequest.mockResolvedValue({ providerId: 'codex', models: [] });
    await mockInvoke<Envelope>(MODELS, {
      providerId: 'codex',
      providerRef: 'claude-code@pwork00000001',
    });
    expect(mockedRequest).toHaveBeenCalledWith('models.list', { providerId: 'codex' });
  });

  it('forwards forceRefresh: true from the invoke payload', async () => {
    mockedRequest.mockResolvedValue({ providerId: 'auggie', models: [] });

    await mockInvoke<Envelope>(MODELS, { providerId: 'auggie', forceRefresh: true });

    expect(mockedRequest).toHaveBeenCalledWith('models.list', {
      providerId: 'auggie',
      forceRefresh: true,
    });
  });

  it('preserves Auggie legacy metadata from models.list through the IPC result', async () => {
    mockedRequest.mockResolvedValue({
      providerId: 'auggie',
      models: [
        { id: 'current', name: 'Current' },
        { id: 'legacy', name: 'Legacy', isLegacyModel: true },
      ],
      source: 'auggie',
    });

    const response = await mockInvoke<Envelope>(MODELS, { providerId: 'auggie' });

    expect(mockedRequest).toHaveBeenCalledWith('models.list', { providerId: 'auggie' });
    expect(response.data).toEqual([
      { value: 'current', label: 'Current' },
      { value: 'legacy', label: 'Legacy', isLegacyModel: true },
    ]);
  });

  it('omits forceRefresh from the wire params unless explicitly true', async () => {
    mockedRequest.mockResolvedValue({ providerId: 'auggie', models: [] });

    await mockInvoke<Envelope>(MODELS, { providerId: 'auggie', forceRefresh: false });

    expect(mockedRequest).toHaveBeenCalledWith('models.list', { providerId: 'auggie' });
  });

  it("preserves the daemon's warning + stale labeling on fallback catalogs", async () => {
    mockedRequest.mockResolvedValue({
      providerId: 'codex',
      models: [{ id: 'gpt-5.3-codex/medium', name: 'GPT-5.3 Codex (Medium)' }],
      source: 'static',
      stale: true,
      warning: 'Codex not installed; using static model list',
    });

    const response = await mockInvoke<Envelope>(MODELS, { providerId: 'codex' });

    expect(response.success).toBe(true);
    expect(response.data).toEqual([
      { value: 'gpt-5.3-codex/medium', label: 'GPT-5.3 Codex (Medium)' },
    ]);
    expect(response.warning).toBe('Codex not installed; using static model list');
    expect(response.stale).toBe(true);
  });

  it.each([
    ['cli-missing', 'cli-missing'],
    ['prerequisite-missing', 'prerequisite-missing'],
    ['some-future-kind', undefined],
  ] as const)('forwards a known daemon warningKind (%s)', async (wire, expected) => {
    mockedRequest.mockResolvedValue({
      providerId: 'codex',
      models: [],
      source: 'static',
      warning: 'codex: Install codex on the execution host',
      warningKind: wire,
    });
    const response = await mockInvoke<Envelope>(MODELS, { providerId: 'codex' });
    expect(response.warningKind).toBe(expected);
  });

  it('drops a warningKind that arrives without a warning', async () => {
    mockedRequest.mockResolvedValue({
      providerId: 'codex',
      models: [],
      warningKind: 'cli-missing',
    });
    const response = await mockInvoke<Envelope>(MODELS, { providerId: 'codex' });
    expect(response.warningKind).toBeUndefined();
  });

  it('returns an honest empty-with-warning envelope for a degraded static fallback', async () => {
    mockedRequest.mockResolvedValue({
      providerId: 'opencode',
      models: [],
      source: 'static',
      warning: 'opencode: opencode binary not found',
    });

    const response = await mockInvoke<Envelope>(MODELS, { providerId: 'opencode' });

    expect(mockedRequest).toHaveBeenCalledWith('models.list', { providerId: 'opencode' });
    expect(response.success).toBe(true);
    expect(response.data).toEqual([]);
    expect(response.warning).toBe('opencode: opencode binary not found');
  });

  it('passes claude-code catalogs through unmodified — the daemon owns the `default` alias', async () => {
    // The daemon returns the adapter's real `default` row on the live probe
    // and includes `default` in its static tier fallback, so the FE must not
    // fabricate or merge alias rows.
    mockedRequest.mockResolvedValue({
      providerId: 'claude-code',
      models: [
        { id: 'default', name: 'Default' },
        { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
      ],
      source: 'claude-code',
    });
    const live = await mockInvoke<Envelope>(MODELS, { providerId: 'claude-code' });
    expect(live.success).toBe(true);
    expect(live.data?.map((m) => m.value)).toEqual(['default', 'claude-sonnet-4-5']);

    mockedRequest.mockResolvedValue({
      providerId: 'claude-code',
      models: [],
      warning: 'Claude Code not available',
    });
    const empty = await mockInvoke<Envelope>(MODELS, { providerId: 'claude-code' });
    expect(empty.data).toEqual([]);
    expect(empty.warning).toBe('Claude Code not available');
  });

  it('drops malformed rows (missing id/name) instead of failing the envelope', async () => {
    mockedRequest.mockResolvedValue({
      providerId: 'droid',
      models: [
        { id: 'valid', name: 'Valid' },
        { id: '', name: 'No id' },
        { name: 'Missing id' },
        { id: 'missing-name' },
      ],
    });

    const response = await mockInvoke<Envelope>(MODELS, { providerId: 'droid' });

    expect(response.success).toBe(true);
    expect(response.data).toEqual([{ value: 'valid', label: 'Valid' }]);
  });

  it.each([
    ['no params', undefined],
    ['no provider id', { forceRefresh: true }],
    ['an empty provider id', { providerId: '' }],
  ])('refuses %s without calling the daemon', async (_name, params) => {
    const response = await mockInvoke<Envelope>(MODELS, params);
    expect(response.success).toBe(false);
    expect(response.error).toBeTruthy();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('returns success: false on wire/transport failure', async () => {
    mockedRequest.mockRejectedValue(new Error('daemon unreachable'));

    const response = await mockInvoke<Envelope>(MODELS, { providerId: 'cortex' });

    expect(response.success).toBe(false);
    expect(response.error).toBe('daemon unreachable');
    expect(response.data).toBeUndefined();
  });
});
