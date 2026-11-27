// @verify-changed-triggers: src/**, scripts/check-hello-probes.mjs

import { describe, expect, it } from 'vitest';
import {
  checkHelloProbes,
  collectSourceFiles,
  findHelloProbes,
  isScannedPath,
} from './check-hello-probes.mjs';

const file = (path: string, ...lines: string[]) => ({ path, content: lines.join('\n') });

describe('client.hello probe guard', () => {
  it.each([
    ['backendRequest without params', "const hello = await backendRequest('client.hello');"],
    ['backendRequest with {}', "const hello = await backendRequest('client.hello', {});"],
    ['generic backendRequest', "await backendRequest<HelloResult>('client.hello', {});"],
    ['transport request', "await resolveBackendTransport().request('client.hello', {});"],
    ['optional transport request', 'await this.transport?.request(`client.hello`, undefined);'],
    ['null params', "await transport.request('client.hello', null);"],
    ['wrapped empty params', "await transport.request('client.hello', ({} as const));"],
    ['method as const', "await backendRequest('client.hello' as const, {});"],
    [
      'request split over lines',
      'const hello = await backendRequest<HelloResult>(',
      "  'client.hello',",
      '  {},',
      ');',
    ],
    ['saga call', "const hello = yield* call(backendRequest, 'client.hello', {});"],
    ['generic saga call', "const hello = yield* call(backendRequest<Hello>, 'client.hello');"],
    ['saga tuple', "yield call([transport, transport.request], 'client.hello', {});"],
    ['saga context call', "yield call({ context: t, fn: t.request }, 'client.hello');"],
    ['Function.prototype.call', "await backendRequest.call(undefined, 'client.hello', {});"],
    ['saga fork', "yield fork(backendRequest, 'client.hello', {});"],
    ['saga spawn', "yield spawn(backendRequest, 'client.hello');"],
    ['namespaced saga call', "yield effects.call(backendRequest, 'client.hello');"],
    ['saga apply', "yield apply(transport, transport.request, ['client.hello', {}]);"],
    ['Function.prototype.apply', "await backendRequest.apply(null, ['client.hello']);"],
    ['an exported method constant', "export const HELLO_METHOD = 'client.hello';"],
  ])('flags a probe: %s', (_name, ...lines) => {
    const hits = findHelloProbes(lines.join('\n'));
    const expectedLine = lines.findIndex((line) => line.includes('client.hello')) + 1;
    expect(hits).toEqual([{ line: expectedLine, text: lines[expectedLine - 1]?.trim() }]);
  });

  it('follows a method name held in a same-file constant', () => {
    const lines = [
      "const HELLO = 'client.hello';",
      "const METHODS = { hello: 'client.hello' } as const;",
      'await backendRequest(HELLO, {});',
      'await transport.request(METHODS.hello);',
      'yield* call(backendRequest, HELLO);',
      'await backendRequest(HELLO, { clientId });',
      'if (method === HELLO) return snapshot;',
    ];
    expect(findHelloProbes(lines.join('\n'))).toEqual(
      [3, 4, 5].map((line) => ({ line, text: lines[line - 1] })),
    );
  });

  it.each([
    ['the handshake read', 'const hello = await readBackendHello<HelloResult>();'],
    [
      'a hello that presents identity',
      "await backendRequest('client.hello', { clientId, capabilities: { reviewMonitoring: 1 } });",
    ],
    ['params held in a variable', "await transport.request('client.hello', params);"],
    ['spread params', "await backendRequest('client.hello', ...args);"],
    ['another method', "await backendRequest('client.list', {});"],
    [
      'the browser connect handshake',
      "await this.requestOnSocket('client.hello', {}, { timeoutMs }, socket);",
    ],
    [
      'the Electron handshake-snapshot read',
      "await api.invoke(BACKEND.REQUEST, { method: 'client.hello', params: {} });",
    ],
    ['a non-request call', "log('client.hello', {});"],
    ['a saga call of another function', "yield call(track, 'client.hello', {});"],
    ['a saga fork of another function', "yield fork(track, 'client.hello');"],
    ['an apply of another function', "yield apply(log, log.info, ['client.hello', {}]);"],
    ['a local method constant', "const HELLO = 'client.hello';"],
    ['an unrelated export', "const HELLO = 'client.hello'; export { OTHER };"],
    ['a string comparison', "if (method === 'client.hello') return snapshot;"],
    ['a line comment', "// backendRequest('client.hello', {}) renegotiates the connection"],
    ['a block comment', "/* transport.request('client.hello') */"],
  ])('ignores %s', (_name, ...lines) => {
    expect(findHelloProbes(lines.join('\n'))).toEqual([]);
  });

  it('reads Svelte script blocks and fails closed on a hello literal in markup', () => {
    const component = (markup: string) =>
      [
        '<script lang="ts">',
        '  const caps = () => readBackendHello();',
        "  const probe = () => backendRequest('client.hello', {});",
        '</script>',
        markup,
      ].join('\n');
    expect(findHelloProbes(component('<p>client.hello</p>'), 'A.svelte')).toEqual([
      { line: 3, text: "const probe = () => backendRequest('client.hello', {});" },
    ]);
    const inMarkup = "<button onclick={() => backendRequest('client.hello', { clientId })} />";
    expect(findHelloProbes(component(inMarkup), 'A.svelte')).toEqual([
      { line: 3, text: "const probe = () => backendRequest('client.hello', {});" },
      { line: 5, text: inMarkup },
    ]);
  });

  it.each([
    ['src/features/backend/backend-saga.ts', true],
    ['src/lib/client/live/live-clients-client.ts', true],
    ['src/routes/+layout.svelte', true],
    ['src/preload/index.ts', true],
    ['src/lib/browser-mock.ts', true],
    ['src/store/renderer/mock-bootstrap.ts', true],
    ['src/lib/component-catalog/chat-polish/chat-polish-fixture-adapter.ts', true],
    ['src/main/index.ts', false],
    ['src/features/backend/main/backend.ipc.ts', false],
    ['src/shared/main/paths.ts', false],
    ['src/store/main/store.ts', false],
    ['src/features/backend/backend-saga.test.ts', false],
    ['src/routes/__tests__/budgets.test.ts', false],
    ['src/test/fake-daemon-socket.ts', false],
    ['src/__mocks__/electron.ts', false],
    ['src/lib/client/mocks/browser-mock.ts', false],
    ['src/lib/client/mock/mock-app-client.ts', false],
    ['scripts/test-fixtures/hello.ts', false],
    ['src/features/home/home-integrations-fixtures.ts', false],
    ['src/features/script-monitor/script-monitor.fixture.ts', false],
    ['src/lib/components/workspace/list-labels.preview-fixtures.ts', false],
    ['src/app.css', false],
  ])('scans %s: %s', (filePath, scanned) => {
    expect(isScannedPath(filePath)).toBe(scanned);
  });

  it('reports hits in renderer source only', () => {
    const probe = "await backendRequest('client.hello', {});";
    const files = [
      file('src/features/remote-machines/remote-machines-saga.ts', probe),
      file('src/features/backend/main/transfer-connections.ts', probe),
      file('src/features/remote-machines/remote-machines-saga.test.ts', probe),
      file('src/lib/client/mocks/browser-mock.ts', probe),
    ];
    expect(checkHelloProbes(files, {})).toEqual({
      hits: [
        { path: 'src/features/remote-machines/remote-machines-saga.ts', line: 1, text: probe },
      ],
      stale: [],
      unreadable: [],
    });
  });

  it.each([
    [
      'an exported object member',
      ["export const METHODS = { hello: 'client.hello' } as const;"],
      'await backendRequest(METHODS.hello, {});',
      1,
    ],
    [
      'an export statement',
      ["const HELLO = 'client.hello';", 'export { HELLO };'],
      'await backendRequest(HELLO, {});',
      1,
    ],
    [
      'a renamed export',
      ["const HELLO = 'client.hello';", 'export { HELLO as HELLO_METHOD };'],
      'await transport.request(HELLO_METHOD);',
      1,
    ],
    [
      'a default export',
      ["const HELLO = 'client.hello';", 'export default HELLO;'],
      'await backendRequest(HELLO, {});',
      1,
    ],
    [
      'an object holding a constant, exported by statement',
      [
        "const HELLO = 'client.hello';",
        'const METHODS = { HELLO, other: HELLO };',
        'export { METHODS };',
      ],
      'yield* call(backendRequest, METHODS.HELLO);',
      2,
    ],
  ])(
    'fails closed on a hello constant another module can import: %s',
    (_name, declaration, request, line) => {
      const files = [
        file('src/features/backend/methods.ts', ...declaration),
        file(
          'src/features/backend/probe.ts',
          "import { METHODS, HELLO } from './methods';",
          request,
        ),
      ];
      expect(checkHelloProbes(files, {})).toEqual({
        hits: [{ path: 'src/features/backend/methods.ts', line, text: declaration[line - 1] }],
        stale: [],
        unreadable: [],
      });
    },
  );

  it('accepts an allowlisted file and reports a stale allowlist entry', () => {
    const allowlist = {
      'src/features/backend/backend-saga.ts': 'deliberate renegotiation',
      'src/features/agent/agent-saga.ts': 'no probe left',
    };
    const files = [
      file('src/features/backend/backend-saga.ts', "yield* call(backendRequest, 'client.hello');"),
      file('src/features/agent/agent-saga.ts', 'const hello = yield* call(readBackendHello);'),
    ];
    expect(checkHelloProbes(files, allowlist)).toEqual({
      hits: [],
      stale: ['src/features/agent/agent-saga.ts'],
      unreadable: [],
    });
  });

  it('reports a candidate file it cannot parse, even when allowlisted', () => {
    const broken = "const hello = await backendRequest('client.hello', { clientId ;";
    const files = [
      file('src/features/backend/broken.ts', broken),
      file('src/features/backend/backend-saga.ts', broken),
      file('src/features/backend/unrelated.ts', 'const = ;'),
    ];
    const { unreadable } = checkHelloProbes(files, {
      'src/features/backend/backend-saga.ts': 'deliberate renegotiation',
    });
    expect(unreadable).toEqual([
      { path: 'src/features/backend/broken.ts', line: 1, message: expect.any(String) },
      { path: 'src/features/backend/backend-saga.ts', line: 1, message: expect.any(String) },
    ]);
  });

  it('passes on the current tree and fails once a new renderer probe is added', () => {
    const tree = collectSourceFiles(process.cwd());
    expect(checkHelloProbes(tree)).toEqual({ hits: [], stale: [], unreadable: [] });
    const added = file(
      'src/features/remote-machines/remote-machines-probe.ts',
      "const hello = await backendRequest('client.hello', {});",
    );
    expect(checkHelloProbes([...tree, added]).hits).toEqual([
      { path: added.path, line: 1, text: added.content },
    ]);
  });
});
