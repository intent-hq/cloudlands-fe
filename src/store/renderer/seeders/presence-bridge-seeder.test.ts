/**
 * Wire-contract tests for the bridge-less `presence:report` fallback.
 *
 * Asserts the handler forwards each report as `presence.update`, degrades an
 * unsupported daemon to a `null` typing source, and never lets an older report
 * land after a newer one even though the browser transport answers concurrent
 * requests out of order.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import { mockInvoke } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { PresenceReportParams, PresenceReportResult } from '$shared/types/presence';

const mockedRequest = vi.mocked(backendRequest);

function report(params: PresenceReportParams): Promise<PresenceReportResult> {
  return mockInvoke<PresenceReportResult>(IPC_CHANNELS.PRESENCE.REPORT, params);
}

const focusA: PresenceReportParams = { focus: [{ workspaceId: 'ws-a' }], typing: null };
const focusB: PresenceReportParams = { focus: [{ workspaceId: 'ws-b' }], typing: null };

describe('presence-bridge-seeder', () => {
  beforeAll(async () => {
    await import('./presence-bridge-seeder');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('forwards a report as presence.update and returns the connection typing source', async () => {
    mockedRequest.mockResolvedValueOnce({ typingSource: 'ts-1' });

    await expect(report(focusA)).resolves.toEqual({ typingSource: 'ts-1' });
    expect(mockedRequest).toHaveBeenCalledWith('presence.update', focusA);
  });

  it('answers a null typing source when the daemon has no presence method', async () => {
    mockedRequest.mockRejectedValueOnce({ code: 'METHOD_NOT_FOUND' });

    await expect(report(focusA)).resolves.toEqual({ typingSource: null });
  });

  it('holds a newer report until the older one settles so a stale update cannot land last', async () => {
    let settleFirst!: (value: { typingSource: string }) => void;
    mockedRequest.mockImplementationOnce(
      () => new Promise((resolve) => (settleFirst = resolve)) as never,
    );
    mockedRequest.mockResolvedValueOnce({ typingSource: 'ts-2' });

    const first = report(focusA);
    const second = report(focusB);
    await Promise.resolve();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenLastCalledWith('presence.update', focusA);

    settleFirst({ typingSource: 'ts-1' });
    await expect(first).resolves.toEqual({ typingSource: 'ts-1' });
    await expect(second).resolves.toEqual({ typingSource: 'ts-2' });
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(mockedRequest).toHaveBeenLastCalledWith('presence.update', focusB);
  });

  it('keeps forwarding after a failed report', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    mockedRequest.mockResolvedValueOnce({ typingSource: 'ts-3' });

    await expect(report(focusA)).rejects.toThrow('boom');
    await expect(report(focusB)).resolves.toEqual({ typingSource: 'ts-3' });
  });
});
