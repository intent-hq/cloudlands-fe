import type { UpdateBackendResult } from '../../../shared/types/connections';
import { JsonRpcError } from './json-rpc-errors';
import type { JsonRpcClient } from './json-rpc-client';

/** Verify a no-op from fresh status; an accepted update needs verification after reconnect. */
export async function updateDaemonToExactVersion({
  client,
  version,
  signal,
  isCurrent,
  onVersion,
}: {
  client: JsonRpcClient;
  version: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
  onVersion: (version: string) => Promise<void>;
}): Promise<UpdateBackendResult> {
  let finished = false;
  let accepted = false;
  let sent = false;
  let reconnected = false;
  let verifying = false;
  let connectionGeneration = 0;
  let resolve!: (result: UpdateBackendResult) => void;
  const completion = new Promise<UpdateBackendResult>((done) => {
    resolve = done;
  });
  const finish = (result: UpdateBackendResult) => {
    if (finished) return;
    finished = true;
    resolve(result);
  };
  const fail = (error: unknown) =>
    finish({
      ok: false,
      ...(error instanceof JsonRpcError && error.rpcCode === -32601
        ? { reason: 'unsupported' as const }
        : {
            reason: 'failed' as const,
            message: error instanceof Error ? error.message : String(error),
          }),
    });
  const connected = (generation = connectionGeneration) =>
    !finished &&
    isCurrent() &&
    client.getStatus() === 'connected' &&
    generation === connectionGeneration;
  const verify = async () => {
    if (!accepted || !reconnected || verifying || finished) return;
    verifying = true;
    const generation = connectionGeneration;
    try {
      const status = await client.request<{ version?: unknown }>('system.status');
      if (!connected(generation)) {
        finish({ ok: false, reason: 'not-connected' });
        return;
      }
      const actualVersion = typeof status?.version === 'string' ? status.version : undefined;
      if (actualVersion) await onVersion(actualVersion);
      if (!connected(generation)) {
        finish({ ok: false, reason: 'not-connected' });
        return;
      }
      finish(
        actualVersion === version
          ? { ok: true, version }
          : { ok: false, reason: 'version-mismatch', version, actualVersion },
      );
    } catch (error) {
      fail(error);
    }
  };
  const onReconnect = () => {
    connectionGeneration += 1;
    if (!sent) return;
    reconnected = true;
    void verify();
  };
  const onAbort = () => finish({ ok: false, reason: 'not-connected' });
  client.on('reconnected', onReconnect);
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => finish({ ok: false, reason: 'timeout', version }), 120_000);
  timer.unref?.();
  try {
    if (signal.aborted) onAbort();
    // Race the entire operation, including status and handoff, against the bound.
    void (async () => {
      try {
        if (!connected()) {
          onAbort();
          return;
        }
        const generation = connectionGeneration;
        const status = await client.request<{
          version?: unknown;
          exactVersionUpdateSupported?: unknown;
        }>('system.status');
        if (!connected(generation)) {
          onAbort();
          return;
        }
        // The sitter does not restart a daemon already running the target.
        // This is a verified no-op, not an update acceptance or a cached hello.
        if (status?.version === version) {
          await onVersion(version);
          if (!connected(generation)) {
            onAbort();
            return;
          }
          finish({ ok: true, version });
          return;
        }
        if (status?.exactVersionUpdateSupported !== true) {
          finish({ ok: false, reason: 'unsupported' });
          return;
        }
        sent = true;
        const ack = await client.request<{ ok?: unknown; accepted?: unknown; version?: unknown }>(
          'system.requestUpdateVersion',
          { version },
        );
        if (finished) return;
        if (ack?.ok !== true || ack.accepted !== true || ack.version !== version) {
          finish({ ok: false, reason: 'invalid-ack' });
          return;
        }
        accepted = true;
        void verify();
      } catch (error) {
        fail(error);
      }
    })();
    return await completion;
  } finally {
    clearTimeout(timer);
    client.off('reconnected', onReconnect);
    signal.removeEventListener('abort', onAbort);
  }
}
