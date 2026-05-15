import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { createWorkspaceMCPServer } from '../index';
import { WorkspaceJsApiTool } from '../workspace-js-api-tool';

describe('WorkspaceJsApiTool integration', () => {
  it('registers only workspace_api on the MCP server', async () => {
    const server = await createWorkspaceMCPServer('/tmp/test-workspace', 'workspace-1', {
      getWorkspace: vi.fn().mockResolvedValue(null),
    });

    expect(server.getTools().map((tool) => tool.name)).toEqual(['workspace_api']);
  });

  it('executes ws.workspace.info() through the composed API surface', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: {
        code: 'return await ws.workspace.info()',
      },
      context: {},
    } as any);

    expect(result.isError).toBe(false);
    expect((result.content[0] as any).text).toContain('"id": "workspace-1"');
    expect((result.content[0] as any).text).toContain('"path": "/tmp/test-workspace"');
  });

  it('documents the consolidated API groups', () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1');
    const definition = tool.getDefinition();

    expect(definition.description).toContain('ws.note.read(id)');
    expect(definition.description).toContain('statusMessage');
    expect(definition.description).toContain('ws.workspace.setStatusMessage(message)');
    expect(definition.description).toContain('does not change lifecycle `status` or task statuses');
    expect(definition.description).toContain('ws.agent.delegate({');
    expect(definition.description).toContain('ws.pr.status()');
  });

  it('documents Promise.allSettled as an option', () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1');
    const definition = tool.getDefinition();

    expect(definition.description).toContain('Promise.allSettled');
  });

  it('returns a clear error for syntax errors in user code', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'const x = {' },
      context: {},
    } as any);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text;
    expect(text).toContain('SyntaxError');
    expect(text).toContain('unclosed');
  });

  it('returns a clear error when accessing a non-existent namespace', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'return await ws.database.query("SELECT 1")' },
      context: {},
    } as any);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text;
    expect(text).toContain('query');
    expect(text).toContain('undefined');
  });

  it('returns a clear error for undefined variable references', async () => {
    const tool = new WorkspaceJsApiTool('/tmp/test-workspace', 'workspace-1');

    const result = await tool.execute({
      name: 'workspace_api',
      arguments: { code: 'return foo + bar' },
      context: {},
    } as any);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as any).text;
    expect(text).toContain('foo is not defined');
  });
});
