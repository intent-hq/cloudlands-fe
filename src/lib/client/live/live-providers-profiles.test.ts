/**
 * Wire-contract tests for `providers.profiles.*` (PROTOCOL §5.54): the exact
 * JSON-RPC request on `backend:request`, PROTOCOL-shaped responses passing
 * through, and divergent payloads / daemon rejections throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { classifyProviderProfileError, type ProviderProfile } from '$shared/provider-profiles';
import { LiveProvidersClient } from './live-providers-client';

const PROFILE: ProviderProfile = {
  id: 'p3k9x2m4q7t1a',
  providerRef: 'codex@p3k9x2m4q7t1a',
  baseProviderId: 'codex',
  name: 'Work',
  env: [
    { key: 'CODEX_HOME', kind: 'set', value: '********' },
    { key: 'OPENAI_BASE_URL', kind: 'set', value: '' },
    { key: 'OPENAI_API_KEY', kind: 'unset' },
  ],
  settingsFingerprint: 'f1',
  createdAt: '2026-10-17T10:00:00Z',
  updatedAt: '2026-10-17T10:00:00Z',
};

describe('LiveProvidersClient profiles', () => {
  let client: LiveProvidersClient;
  let invoke: ReturnType<typeof vi.fn>;
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    originalWindow = globalThis.window;
    client = new LiveProvidersClient();
    invoke = vi.fn();
    vi.stubGlobal('window', { electronAPI: { invoke, on: vi.fn(), offById: vi.fn() } });
  });
  afterEach(() => vi.stubGlobal('window', originalWindow));

  const lastRequest = () => invoke.mock.calls.at(-1);

  it('lists all profiles with empty params, or one base provider', async () => {
    invoke.mockResolvedValue({ ok: true, result: { profiles: [PROFILE], revision: 3 } });
    await expect(client.listProfiles()).resolves.toEqual({ profiles: [PROFILE], revision: 3 });
    expect(lastRequest()).toEqual([
      IPC_CHANNELS.BACKEND.REQUEST,
      { method: 'providers.profiles.list', params: {} },
    ]);
    await client.listProfiles('claude-code');
    expect(lastRequest()).toEqual([
      IPC_CHANNELS.BACKEND.REQUEST,
      { method: 'providers.profiles.list', params: { baseProviderId: 'claude-code' } },
    ]);
  });

  it('keeps additive env-entry fields from a newer daemon instead of failing the list', async () => {
    const withExtra = {
      ...PROFILE,
      env: [
        { key: 'CODEX_HOME', kind: 'set', value: '********', source: 'future' },
        { key: 'OPENAI_API_KEY', kind: 'unset', note: 'future' },
      ],
    };
    invoke.mockResolvedValue({ ok: true, result: { profiles: [withExtra], revision: 1 } });
    const result = await client.listProfiles();
    expect(result.profiles[0].env.map((entry) => entry.key)).toEqual([
      'CODEX_HOME',
      'OPENAI_API_KEY',
    ]);
  });

  it('creates with literal set, empty and unset entries, and omits absent env', async () => {
    invoke.mockResolvedValue({ ok: true, result: { profile: PROFILE, revision: 4 } });
    const env = [
      { key: 'CODEX_HOME', kind: 'set' as const, value: '/accounts/work' },
      { key: 'OPENAI_BASE_URL', kind: 'set' as const, value: '' },
      { key: 'OPENAI_API_KEY', kind: 'unset' as const },
    ];
    await client.createProfile({ baseProviderId: 'codex', name: 'Work', env });
    expect(lastRequest()).toEqual([
      IPC_CHANNELS.BACKEND.REQUEST,
      {
        method: 'providers.profiles.create',
        params: { baseProviderId: 'codex', name: 'Work', env },
      },
    ]);
    await client.createProfile({ baseProviderId: 'codex', name: 'Bare' });
    expect(lastRequest()?.[1]).toEqual({
      method: 'providers.profiles.create',
      params: { baseProviderId: 'codex', name: 'Bare' },
    });
  });

  it('updates with keep entries and returns the activation summary', async () => {
    const activation = { envChanged: true, runningProcesses: 2 };
    invoke.mockResolvedValue({ ok: true, result: { profile: PROFILE, revision: 5, activation } });
    const result = await client.updateProfile({
      profileId: PROFILE.id,
      env: [{ key: 'CODEX_HOME', kind: 'keep' }],
    });
    expect(result.activation).toEqual(activation);
    expect(lastRequest()?.[1]).toEqual({
      method: 'providers.profiles.update',
      params: { profileId: PROFILE.id, env: [{ key: 'CODEX_HOME', kind: 'keep' }] },
    });
    await client.updateProfile({ profileId: PROFILE.id, name: 'Personal' });
    expect(lastRequest()?.[1]).toEqual({
      method: 'providers.profiles.update',
      params: { profileId: PROFILE.id, name: 'Personal' },
    });
  });

  it('deletes by profile id', async () => {
    invoke.mockResolvedValue({ ok: true, result: { profileId: PROFILE.id, revision: 6 } });
    await expect(client.deleteProfile(PROFILE.id)).resolves.toEqual({
      profileId: PROFILE.id,
      revision: 6,
    });
    expect(lastRequest()?.[1]).toEqual({
      method: 'providers.profiles.delete',
      params: { profileId: PROFILE.id },
    });
  });

  it('throws on a response that diverges from §5.54', async () => {
    invoke.mockResolvedValue({ ok: true, result: { profile: { id: 'x' }, revision: 1 } });
    await expect(client.createProfile({ baseProviderId: 'codex', name: 'W' })).rejects.toThrow();
    invoke.mockResolvedValue({ ok: true, result: { profile: PROFILE, revision: 2 } });
    await expect(client.updateProfile({ profileId: PROFILE.id })).rejects.toThrow();
  });

  it('surfaces daemon field errors and in-use reasons for classification', async () => {
    invoke.mockResolvedValue({
      ok: false,
      error: {
        code: 'INVALID_PARAMS',
        message: 'invalid',
        rpcCode: -32602,
        data: {
          code: 'invalid-params',
          fieldErrors: [
            { field: 'env[0].key', code: 'env-key-reserved', message: 'PATH is Intent-owned' },
          ],
        },
      },
    });
    const error = await client
      .createProfile({ baseProviderId: 'codex', name: 'W' })
      .catch((e: unknown) => e);
    expect(classifyProviderProfileError(error)).toEqual({
      kind: 'fieldErrors',
      fieldErrors: [
        { field: 'env[0].key', code: 'env-key-reserved', message: 'PATH is Intent-owned' },
      ],
    });

    invoke.mockResolvedValue({
      ok: false,
      error: {
        code: 'INVALID_PARAMS',
        message: 'in use',
        rpcCode: -32602,
        data: {
          code: 'provider-profile-in-use',
          inUse: [
            { kind: 'defaultProvider' },
            { kind: 'specialistModelOption', specialistId: 'reviewer', source: 'user', index: 1 },
          ],
        },
      },
    });
    const inUse = await client.deleteProfile(PROFILE.id).catch((e: unknown) => e);
    expect(classifyProviderProfileError(inUse)).toEqual({
      kind: 'inUse',
      inUse: [
        { kind: 'defaultProvider' },
        { kind: 'specialistModelOption', specialistId: 'reviewer', source: 'user', index: 1 },
      ],
    });
  });
});

describe('classifyProviderProfileError', () => {
  it('recognizes not-found and treats unknown or transport failures as other', () => {
    expect(classifyProviderProfileError({ data: { code: 'not-found' } })).toEqual({
      kind: 'notFound',
    });
    expect(classifyProviderProfileError(new Error('socket closed'))).toEqual({ kind: 'other' });
    expect(
      classifyProviderProfileError({ data: { code: 'invalid-params', fieldErrors: 'bad' } }),
    ).toEqual({ kind: 'other' });
  });
});
