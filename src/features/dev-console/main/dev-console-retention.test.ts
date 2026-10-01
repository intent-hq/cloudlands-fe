// @vitest-environment node
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

/** A fresh Node process isolates the heap oracle from Vitest mocks, source maps and fixtures. */
async function retainedWireFrames(mode: 'before-open' | 'after-close' | 'positive-control') {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    TSX_TSCONFIG_PATH: resolve('tsconfig.main.json'),
  };
  delete environment.NODE_OPTIONS;
  const { stdout } = await run(
    process.execPath,
    [
      '--expose-gc',
      '--no-sparkplug',
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      `
import { EventEmitter } from 'node:events';
import { getHeapSnapshot } from 'node:v8';
import { JsonRpcClient } from './src/features/backend/main/json-rpc-client.ts';
import { DevConsoleCaptureService } from './src/features/dev-console/main/dev-console-capture.ts';
const mode = process.argv[1];
class Socket extends EventEmitter {
  retained = null;
  write(frame) {
    if (mode === 'positive-control') this.retained = frame;
    return true;
  }
  destroy() {}
}
const socket = new Socket();
const client = new JsonRpcClient({ socketFactory: () => socket, requestTimeoutMs: 60000 });
const capture = new DevConsoleCaptureService();
capture.registerClient('local', 'main', client);
client.start();
socket.emit('connect');
const session = mode === 'after-close' ? capture.openSession('local') : null;
const pending = client.request('capture-retention-probe', { text: 'x'.repeat(1024 * 1024) });
if (session) capture.closeSession('local', session.sessionId);
await new Promise(setImmediate);
global.gc();
global.gc();
const chunks = [];
for await (const chunk of getHeapSnapshot()) chunks.push(chunk);
const heap = JSON.parse(Buffer.concat(chunks).toString());
const fields = heap.snapshot.meta.node_fields;
const types = heap.snapshot.meta.node_types[fields.indexOf('type')];
let retainedFrames = 0;
for (let offset = 0; offset < heap.nodes.length; offset += fields.length) {
  const name = heap.strings[heap.nodes[offset + fields.indexOf('name')]];
  const size = heap.nodes[offset + fields.indexOf('self_size')];
  const type = types[heap.nodes[offset + fields.indexOf('type')]];
  if (type === 'string' && size >= 1024 * 1024 && name.startsWith('{"jsonrpc":') && name.includes('capture-retention-probe')) retainedFrames++;
}
socket.emit('data', '{"jsonrpc":"2.0","id":1,"result":true}\\n');
await pending;
client.dispose();
process.stdout.write(JSON.stringify({ retainedFrames }));
`,
      mode,
    ],
    { env: environment, timeout: 25_000, maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(stdout) as { retainedFrames: number };
}

describe('Dev Console pending-request payload retention', () => {
  it('detects a full wire frame deliberately retained by the socket', async () => {
    expect(await retainedWireFrames('positive-control')).toEqual({ retainedFrames: 1 });
  });

  it.each(['before-open', 'after-close'] as const)(
    'does not retain serialized payloads through pending callbacks: %s',
    async (mode) => {
      expect(await retainedWireFrames(mode)).toEqual({ retainedFrames: 0 });
    },
  );
});
