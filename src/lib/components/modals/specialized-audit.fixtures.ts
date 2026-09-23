import { resolveBackendTransport } from '$lib/client/live/backend-transport-factory';

/** Isolate command-palette search from the live backend while auditing the real component. */
export function installEmptyTranscriptSearchFixture(): () => void {
  const transport = resolveBackendTransport();
  const previous = transport.request;
  transport.request = async <T>(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
  ) => {
    if (method === 'search.messages') return { matches: [] } as T;
    return previous.call(transport, method, params, options) as Promise<T>;
  };
  return () => {
    transport.request = previous;
  };
}
