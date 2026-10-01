// protocol-version-ok-file: old/new daemon handshake fixtures for scoped reader regressions.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendRequest } from './backend-transport';
import {
  BrowserWebSocketTransport,
  type BrowserWebSocketLike,
} from './browser-websocket-transport';
import { LiveFilesClient } from './live-files-client';
import { readPdf } from '$features/file/services/read-pdf';

vi.mock('./backend-transport', () => ({ backendRequest: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('production scoped readers across a daemon downgrade', () => {
  it.each(['text', 'chunks'] as const)(
    'rejects %s without sending any scoped read to the replacement daemon',
    async (kind) => {
      vi.useFakeTimers();
      const requests: Array<{ connection: number; method: string }> = [];
      let connections = 0;
      class Socket implements BrowserWebSocketLike {
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onmessage: ((event: { data: unknown }) => void) | null = null;
        readonly connection = ++connections;
        private hellos = 0;
        constructor() {
          setTimeout(() => this.onopen?.(), 0);
        }
        close() {}
        send(data: string) {
          const { id, method } = JSON.parse(data);
          requests.push({ connection: this.connection, method });
          const first = this.connection === 1;
          if (method === 'client.hello') this.hellos++;
          const result =
            method === 'client.hello'
              ? { clientId: 'client', protocolVersion: first ? '11.1' : '11.0' }
              : method === 'file.readChunk'
                ? { content: btoa(first ? 'R' : 'P'), bytesRead: 1, size: 2 }
                : first
                  ? 'root'
                  : 'WRONG PRIMARY';
          setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id, result }) });
            // Drop after the renderer's support probe, or between binary chunks.
            if (
              first &&
              ((kind === 'text' && this.hellos === 2) ||
                (kind === 'chunks' && method === 'file.readChunk'))
            ) {
              this.onclose?.();
            }
          }, 0);
        }
      }
      const transport = new BrowserWebSocketTransport({
        url: 'ws://localhost/rpc',
        webSocketFactory: () => new Socket(),
        reconnectDelayMs: 1,
      });
      vi.mocked(backendRequest).mockImplementation((method, params, options) =>
        transport.request(method, params, options),
      );
      const result = (
        kind === 'text'
          ? new LiveFilesClient().read('ws', 'same.txt', { gitRootId: 'root-a' })
          : readPdf('ws', 'same.pdf', new AbortController().signal, 'root-a')
      ).catch((error) => error);
      await vi.advanceTimersByTimeAsync(20);
      expect(await result).toBeInstanceOf(Error);
      expect(requests.filter(({ connection }) => connection === 2)).toEqual([
        { connection: 2, method: 'client.hello' },
      ]);
      transport.dispose();
    },
  );
});
