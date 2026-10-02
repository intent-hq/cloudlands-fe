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
  it.each(
    (['text', 'chunks'] as const).flatMap((kind) =>
      ['11.1', '12.0'].map((protocolVersion) => ({ kind, protocolVersion })),
    ),
  )(
    'rejects $kind after $protocolVersion without sending any scoped read to the replacement daemon',
    async ({ kind, protocolVersion }) => {
      vi.useFakeTimers();
      const requests: Array<{ connection: number; method: string }> = [];
      let connections = 0;
      const sockets: Socket[] = [];
      class Socket implements BrowserWebSocketLike {
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onmessage: ((event: { data: unknown }) => void) | null = null;
        readonly connection = ++connections;
        constructor() {
          setTimeout(() => this.onopen?.(), 0);
        }
        close() {}
        send(data: string) {
          const { id, method } = JSON.parse(data);
          requests.push({ connection: this.connection, method });
          const first = this.connection === 1;
          const result =
            method === 'client.hello'
              ? { clientId: 'client', protocolVersion: first ? protocolVersion : '11.0' }
              : method === 'file.readChunk'
                ? { content: btoa(first ? 'R' : 'P'), bytesRead: 1, size: 2 }
                : first
                  ? 'root'
                  : 'WRONG PRIMARY';
          setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify({ jsonrpc: '2.0', id, result }) });
            // Reconnect between binary windows, before the next scoped read.
            if (first && kind === 'chunks' && method === 'file.readChunk') {
              this.onclose?.();
            }
          }, 0);
        }
      }
      const transport = new BrowserWebSocketTransport({
        url: 'ws://localhost/rpc',
        webSocketFactory: () => {
          const socket = new Socket();
          sockets.push(socket);
          return socket;
        },
        reconnectDelayMs: 1,
      });
      vi.mocked(backendRequest).mockImplementation((method, params, options) =>
        transport.request(method, params, options),
      );
      if (kind === 'text') {
        const warm = transport.request('workspace.get');
        await vi.advanceTimersByTimeAsync(10);
        await warm;
        sockets[0].onclose?.();
      }
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
