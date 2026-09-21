// @verify-changed-triggers: src/**, scripts/check-agent-list-scope.mjs

import { describe, expect, it } from 'vitest';
import {
  checkAgentListScope,
  collectSourceFiles,
  findUnscopedAgentListRequests,
} from './check-agent-list-scope.mjs';

const file = (path: string, ...lines: string[]) => ({ path, content: lines.join('\n') });

describe('agent.list scope guard', () => {
  it.each([
    ['wire literal', "const r = await client.request('agent.list', { workspaceId });"],
    [
      'generic wire literal split over lines',
      'const r = await request<AgentsResponse>(',
      "  'agent.list',",
      '  { workspaceId },',
      ');',
    ],
    ['backend client', "await backendClient.call('agent.list', { workspaceId: id });"],
    ['wrapper list', 'const rows = yield call(appClient.agents.list, workspaceId);'],
    ['wrapper listWithMeta', 'const rows = await client.agents.listWithMeta(workspaceId);'],
    [
      'saga tuple',
      'const rows = yield call([appClient.agents, appClient.agents.list], workspaceId);',
    ],
  ])('flags an unscoped %s request', (_name, ...lines) => {
    const hits = findUnscopedAgentListRequests(lines.join('\n'));
    const expectedLine = lines.findIndex((line) => /agents?\.list/.test(line)) + 1;
    expect(hits).toEqual([{ line: expectedLine, text: lines[expectedLine - 1]?.trim() }]);
  });

  it.each([
    ['scope', "await request('agent.list', { workspaceId, scope: 'topLevel' });"],
    ['retiredOnly', "await request('agent.list', { workspaceId, retiredOnly: true });"],
    [
      'multi-line scoped wrapper',
      'const rows = yield call(appClient.agents.listWithMeta, workspaceId, {',
      "  scope: 'delegated',",
      '});',
    ],
    ['scoped saga tuple', "yield call([c.agents, c.agents.list], id, { scope: 'background' });"],
    ['string comparison', "if (method === 'agent.list') return handler(params);"],
    ['switch case', "case 'agent.list': {", '  return listHandler();', '}'],
    ['object key', "const handlers = { 'agent.list': listAgents };"],
    ['method definition', 'const agents = { list(workspaceId: string) { return rows; } };'],
    ['line comment', "// the old code did request('agent.list', { workspaceId })"],
    ['block comment', '/* request(`agent.list`, { workspaceId }) */'],
  ])('ignores %s', (_name, ...lines) => {
    expect(findUnscopedAgentListRequests(lines.join('\n'))).toEqual([]);
  });

  it('does not let a scope option in a comment satisfy the check', () => {
    const source = [
      "// scope: 'topLevel' is applied server-side",
      "await request('agent.list', { workspaceId });",
    ].join('\n');
    expect(findUnscopedAgentListRequests(source)).toEqual([
      { line: 2, text: "await request('agent.list', { workspaceId });" },
    ]);
  });

  it('reports hits in non-allowlisted source and skips test files', () => {
    const files = [
      file('src/features/agent/agent-saga.ts', 'yield call(appClient.agents.list, workspaceId);'),
      file('src/features/agent/agent-saga.test.ts', 'yield call(appClient.agents.list, ws);'),
      file('src/features/agent/__tests__/fixture.ts', "request('agent.list', { workspaceId });"),
      file('src/lib/client/mocks/browser-mock.ts', "request('agent.list', { workspaceId });"),
    ];
    const { hits } = checkAgentListScope(files, {});
    expect(hits).toEqual([
      {
        path: 'src/features/agent/agent-saga.ts',
        line: 1,
        text: 'yield call(appClient.agents.list, workspaceId);',
      },
    ]);
  });

  it('accepts an allowlisted file and reports a stale allowlist entry', () => {
    const allowlist = {
      'src/lib/client/live/live-agents-client.ts': 'the wire wrapper',
      'src/features/debug/main/debug.ipc.ts': 'dev-only dump',
    };
    const files = [
      file(
        'src/lib/client/live/live-agents-client.ts',
        "return request('agent.list', { workspaceId });",
      ),
      file(
        'src/features/debug/main/debug.ipc.ts',
        "await backendClient.call('agent.list', { workspaceId, scope: 'topLevel' });",
      ),
    ];
    expect(checkAgentListScope(files, allowlist)).toEqual({
      hits: [],
      stale: ['src/features/debug/main/debug.ipc.ts'],
    });
  });

  it('passes on the current tree and fails once a new unscoped caller is added', () => {
    const tree = collectSourceFiles(process.cwd());
    expect(checkAgentListScope(tree)).toEqual({ hits: [], stale: [] });
    const added = file(
      'src/features/agent/new-agent-saga.ts',
      'const rows = yield call(appClient.agents.list, workspaceId);',
    );
    expect(checkAgentListScope([...tree, added]).hits).toEqual([
      { path: added.path, line: 1, text: added.content },
    ]);
  });
});
