/**
 * Both `<provider>:get-models` build paths — the Electron main-process
 * handlers (`daemon-model-catalog.ts`) and the daemon/web-build bridge
 * (`model-catalog-bridge-seeder.ts`) — must return the shared
 * `toGetModelsEnvelope` output untouched, so a field added to that builder
 * reaches the desktop and web builds alike.
 *
 * The builder is wrapped to forward a stand-in "next field" from the wire
 * result; if either path rebuilds the envelope by hand, the field is lost on
 * that path and this test fails.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  backendRequest: vi.fn(),
  clientRequest: vi.fn(),
}));

vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.backendRequest }));
vi.mock('../../features/backend/main/backend.ipc', () => ({
  getBackendClientForIpcEvent: () => ({ client: { request: mocks.clientRequest } }),
}));
vi.mock('./wire-model-info', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./wire-model-info')>();
  return {
    ...actual,
    toGetModelsEnvelope: (result: Parameters<typeof actual.toGetModelsEnvelope>[0]) => ({
      ...actual.toGetModelsEnvelope(result),
      nextField: (result as { nextField?: unknown } | null | undefined)?.nextField,
    }),
  };
});

import { mockInvoke } from '$shared/ipc-mock-router';
import { getProviderModelsEnvelope } from '../../main/utils/daemon-model-catalog';
import type { WireModelsListResult } from './wire-model-info';

const WIRE_RESULT: WireModelsListResult & { nextField: string } = {
  providerId: 'codex',
  models: [{ id: 'gpt-a', name: 'GPT A', isDefault: true }],
  source: 'codex',
  stale: true,
  warning: 'codex CLI not found',
  warningKind: 'cli-missing',
  nextField: 'reaches-both-paths',
};

const EXPECTED = {
  success: true,
  data: [{ value: 'gpt-a', label: 'GPT A', isDefault: true }],
  warning: 'codex CLI not found',
  stale: true,
  warningKind: 'cli-missing',
  nextField: 'reaches-both-paths',
};

describe('get-models envelope parity across build paths', () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import('$store/renderer/seeders/model-catalog-bridge-seeder');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('a field added to toGetModelsEnvelope reaches the desktop and web replies alike', async () => {
    mocks.clientRequest.mockResolvedValue(WIRE_RESULT);
    mocks.backendRequest.mockResolvedValue(WIRE_RESULT);

    const desktop = await getProviderModelsEnvelope('codex');
    const web = await mockInvoke<unknown>('codex:get-models');

    expect(mocks.clientRequest).toHaveBeenCalledWith('models.list', { providerId: 'codex' });
    expect(mocks.backendRequest).toHaveBeenCalledWith('models.list', { providerId: 'codex' });
    expect(desktop).toEqual(EXPECTED);
    expect(web).toEqual(EXPECTED);
  });

  it('both paths fail closed with the same shape on a transport failure', async () => {
    mocks.clientRequest.mockRejectedValue(new Error('daemon unreachable'));
    mocks.backendRequest.mockRejectedValue(new Error('daemon unreachable'));

    const desktop = await getProviderModelsEnvelope('codex');
    const web = await mockInvoke<unknown>('codex:get-models');

    expect(desktop).toEqual({ success: false, error: 'daemon unreachable' });
    expect(web).toEqual(desktop);
  });
});
